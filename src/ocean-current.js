import land from './ocean-land.json';

const stepMs = 1000 / 30;
const colors = ['#267985', '#438f9c', '#e9fbfa'];
const eddies = [
  { lon: 124.1, lat: 22.7, radius: .95, turn: -1.3 },
  { lon: 125.6, lat: 24.8, radius: 1.25, turn: 1.15 },
  { lon: 122.8, lat: 19.9, radius: .85, turn: 1 },
  { lon: 118.8, lat: 22.4, radius: .75, turn: -.45 },
];

function bell(value) {
  return Math.exp(-value * value);
}

// An illustrative flow field with a wide offshore jet, a strait drift and eddies.
function velocity(lon, lat) {
  const bend = Math.max(0, lat - 23.6);
  const offshore = 122.1 + .26 * bend ** 2 + .18 * Math.max(0, 21.8 - lat);
  const jet = bell((lon - offshore) / 1.45);
  const strait = bell((lon - (119.4 + (lat - 23.5) * .64)) / 1.65);
  let east = .1 + jet * (.15 + .57 * bend) + strait * .62;
  let north = .14 + jet * 1.28 + strait * .66;
  for (const { lon: centerX, lat: centerY, radius, turn } of eddies) {
    const x = (lon - centerX) / radius;
    const y = (lat - centerY) / radius;
    const spin = Math.exp(-.68 * (x * x + y * y)) * turn;
    east -= y * spin;
    north += x * spin;
  }
  const extent = Math.min(
    1, (lon - 114) / 2, (131 - lon) / 3, (lat - 16) / 3, (31 - lat) / 3,
  );
  return { east, north, strength: Math.max(0, extent) * Math.min(1, jet + strait + .24) };
}

function landMask(map, width, height) {
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const context = mask.getContext('2d');
  context.beginPath();
  for (const ring of land.rings) {
    ring.forEach(([lon, lat], index) => {
      const { x, y } = map.latLngToContainerPoint([lat, lon]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  }
  context.fill('evenodd');
  context.lineWidth = 2;
  context.stroke();
  return context.getImageData(0, 0, width, height).data;
}

export function addOceanCurrent(map) {
  const pane = map.createPane('current');
  pane.classList.add('atlas-current');
  pane.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  pane.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame;
  let lastDraw = 0;
  let width = 0;
  let height = 0;
  let landPixels;
  let west;
  let longitudePerPixel;
  let latitudes;
  let opacity;
  let particles = [];

  function flowAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height ||
        landPixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3]) return;
    return velocity(west + x * longitudePerPixel, latitudes[Math.floor(y)]);
  }

  function seed(particle, initial = false) {
    particle.age = 0;
    particle.life = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const flow = flowAt(x, y);
      if (!flow || Math.random() >= flow.strength) continue;
      particle.x = x;
      particle.y = y;
      particle.age = initial ? Math.random() * 50 : 0;
      particle.life = 43 + Math.random() * 62;
      return;
    }
  }

  function draw() {
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = 'rgba(0, 0, 0, .12)';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    context.lineWidth = .95;
    context.lineCap = 'round';
    for (const particle of particles) {
      const { x, y, age, life, color } = particle;
      if (age >= life) {
        seed(particle);
        continue;
      }

      const { east, north, strength } = flowAt(x, y) ?? {};
      if (!strength) {
        seed(particle);
        continue;
      }
      const nextX = x + east * 1.55;
      const nextY = y - north * 1.55;
      if (!flowAt(nextX, nextY)?.strength) {
        seed(particle);
        continue;
      }
      context.globalAlpha = opacity * strength * Math.min(1, age / 10, (life - age) / 14) * .72;
      context.strokeStyle = colors[color];
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(nextX, nextY);
      context.stroke();
      particle.x = nextX;
      particle.y = nextY;
      particle.age += 1;
    }
    context.globalAlpha = 1;
  }

  function animate(now) {
    if (now - lastDraw >= stepMs) {
      draw();
      lastDraw = now - (now - lastDraw) % stepMs;
    }
    frame = requestAnimationFrame(animate);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = undefined;
  }

  function update() {
    stop();
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const inView = bounds.getWest() < 131 && bounds.getEast() > 114 &&
      bounds.getSouth() < 31 && bounds.getNorth() > 16;
    const size = map.getSize();
    opacity = inView && zoom >= 5 ? Math.min(1, Math.max(0, (11 - zoom) / 3)) : 0;
    pane.classList.toggle('is-current-visible', Boolean(opacity && size.x && size.y));
    if (!opacity || !size.x || !size.y || document.hidden) return;

    width = size.x;
    height = size.y;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const position = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    west = bounds.getWest();
    longitudePerPixel = (bounds.getEast() - west) / width;
    latitudes = Array.from({ length: height }, (_, y) => map.containerPointToLatLng([0, y]).lat);
    landPixels = landMask(map, width, height);
    const count = Math.min(670, Math.max(150, Math.round(width * height / 1500)));
    particles = Array.from({ length: count }, (_, i) => {
      const particle = { color: i % colors.length };
      seed(particle, true);
      return particle;
    });
    for (let i = 0; i < 18; i += 1) draw();
    if (!reducedMotion.matches) {
      lastDraw = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  map.on('movestart', stop);
  map.on('moveend resize', update);
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', update);
  map.once('unload', () => {
    stop();
    document.removeEventListener('visibilitychange', update);
    reducedMotion.removeEventListener('change', update);
  });
}
