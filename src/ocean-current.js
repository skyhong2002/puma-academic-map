import land from './ocean-land.json';

const frameInterval = 1000 / 30;
const waves = [
  { center: [23.26, 118.55], span: 4.55, angle: -.58, phase: .15 },
  { center: [23.15, 123.95], span: 4.75, angle: -.21, phase: 2.4 },
];
const bands = [
  { offset: -.17, thickness: .072, color: '#eb6000', opacity: .74, inset: 0 },
  { offset: -.115, thickness: .029, color: '#fff7eb', opacity: .94, inset: .045 },
  { offset: -.044, thickness: .09, color: '#ef7312', opacity: .77, inset: .022 },
  { offset: .022, thickness: .026, color: '#fffdfa', opacity: .96, inset: .015 },
  { offset: .072, thickness: .057, color: '#e85d00', opacity: .68, inset: .04 },
  { offset: .113, thickness: .014, color: '#fff9f0', opacity: .9, inset: .09 },
];

function edge(x, time, band) {
  return band.offset +
    .055 * Math.sin(x * 7.1 - time) +
    .021 * Math.sin(x * 12.5 - time * 1.45 + .8) +
    .01 * Math.sin(x * 21 - time * 1.9);
}

function traceBand(context, band, time, side) {
  const steps = 72;
  for (let step = 0; step <= steps; step += 1) {
    const progress = side > 0 ? step / steps : 1 - step / steps;
    const x = band.inset + progress * (1 - 2 * band.inset);
    const taper = Math.sin(progress * Math.PI) ** .65;
    const roughness = .83 + .1 * Math.sin(x * 80 - time * 2) + .07 * Math.sin(x * 207 - time);
    const y = edge(x, time, band) + side * band.thickness / 2 * taper * roughness;
    if (side > 0 && step === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
}

function drawWave(context, wave, seconds, opacity) {
  const time = seconds * .85 + wave.phase;
  context.save();
  context.translate(wave.x, wave.y);
  context.rotate(wave.angle);
  context.scale(wave.width, wave.height);
  context.translate(-.5, 0);

  for (const band of bands) {
    context.globalAlpha = opacity * band.opacity;
    context.fillStyle = band.color;
    context.beginPath();
    traceBand(context, band, time, 1);
    traceBand(context, band, time, -1);
    context.closePath();
    context.fill();
  }

  // Foam strokes travel along each crest and dissolve before the next one forms.
  context.fillStyle = '#fffdfa';
  for (const [bandIndex, band] of bands.entries()) {
    if (bandIndex % 2 === 0) continue;
    for (let i = 0; i < 15; i += 1) {
      const progress = (i * .171 + bandIndex * .053 + seconds * (.055 + i % 4 * .013)) % 1;
      const x = band.inset + progress * (1 - 2 * band.inset);
      const offset = (.014 + i % 4 * .006) * (i % 2 ? 1 : -1);
      const y = edge(x, time, band) + offset;
      const fade = Math.sin(progress * Math.PI) ** 2;
      context.globalAlpha = opacity * fade * (.38 + (i % 4) * .13);
      context.beginPath();
      context.ellipse(x, y, .002 + i % 4 * .0027, .002 + i % 3 * .0018, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function projectCoastline(map) {
  const path = new Path2D();
  for (const ring of land.rings) {
    ring.forEach(([lon, lat], index) => {
      const { x, y } = map.latLngToContainerPoint([lat, lon]);
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
  }
  return path;
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
  let lastDraw = -Infinity;
  let size;
  let opacity;
  let coast;
  let projected;
  const start = performance.now();

  function draw(seconds) {
    context.clearRect(0, 0, size.x, size.y);
    for (const wave of projected) drawWave(context, wave, seconds, opacity);
    context.globalCompositeOperation = 'destination-out';
    context.fill(coast, 'evenodd');
    context.lineWidth = 2;
    context.stroke(coast);
    context.globalCompositeOperation = 'source-over';
  }

  function animate(now) {
    if (now - lastDraw >= frameInterval) {
      draw((now - start) / 1000);
      lastDraw = now;
    }
    frame = requestAnimationFrame(animate);
  }

  function stop() {
    cancelAnimationFrame(frame);
  }

  function update() {
    stop();
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const inView = bounds.getWest() < 127 && bounds.getEast() > 115 &&
      bounds.getSouth() < 27 && bounds.getNorth() > 20;
    size = map.getSize();
    opacity = inView && zoom >= 5 ? Math.min(1, Math.max(0, (11 - zoom) / 3)) : 0;
    pane.classList.toggle('is-current-visible', Boolean(opacity && size.x && size.y));
    if (!opacity || !size.x || !size.y || document.hidden) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(size.x * ratio);
    canvas.height = Math.ceil(size.y * ratio);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const position = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    const pixelsPerDegree = size.x / (bounds.getEast() - bounds.getWest());
    projected = waves.map((wave) => {
      const { x, y } = map.latLngToContainerPoint(wave.center);
      const width = wave.span * pixelsPerDegree;
      return { ...wave, x, y, width, height: width / 1.25 };
    });
    coast = projectCoastline(map);
    draw(reducedMotion.matches ? 0 : (performance.now() - start) / 1000);
    if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
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
