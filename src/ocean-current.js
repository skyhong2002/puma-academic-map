// Decorative tracks through the waters around Taiwan.
const tracks = [
  [[20.6, 116.9], [22, 118.3], [23.15, 119], [23.8, 119.4], [24.5, 119.85], [25.35, 120.6], [26.05, 121.7], [26.8, 123.1]],
  [[18.8, 123.3], [20.7, 122.9], [22, 122.45], [23.45, 122.2], [24.65, 122.45], [25.5, 123.35], [26.15, 124.65], [27.15, 126.3]],
];
const palette = ['23, 101, 125', '247, 254, 248', '44, 133, 148'];
const mix = (a, b, t) => a + (b - a) * t;

function smooth(a, b, c, d, t) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

function projectTrack(map, track) {
  const anchors = track.map((point) => map.latLngToContainerPoint(point));
  const points = [{ ...anchors[0], distance: 0 }];
  let distance = 0;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i - 1] ?? anchors[i];
    const b = anchors[i];
    const c = anchors[i + 1];
    const d = anchors[i + 2] ?? c;
    for (let j = 1; j <= 10; j += 1) {
      const t = j / 10;
      const x = smooth(a.x, b.x, c.x, d.x, t);
      const y = smooth(a.y, b.y, c.y, d.y, t);
      const previous = points.at(-1);
      distance += Math.hypot(x - previous.x, y - previous.y);
      points.push({ x, y, distance });
    }
  }
  return { points, distance };
}

function pointAt(track, distance, lane, time) {
  const { points } = track;
  let first = 0;
  let last = points.length - 1;
  while (last - first > 1) {
    const middle = (first + last) >> 1;
    if (points[middle].distance <= distance) first = middle;
    else last = middle;
  }
  const a = points[first];
  const b = points[last];
  const span = b.distance - a.distance || 1;
  const t = (distance - a.distance) / span;
  const offset = lane.offset + Math.sin(distance / 62 - time * .52 + lane.phase) * 3;
  return {
    x: mix(a.x, b.x, t) - (b.y - a.y) * offset / span,
    y: mix(a.y, b.y, t) + (b.x - a.x) * offset / span,
  };
}

function drawStreak(context, track, head, lane, time, opacity, size) {
  const tail = Math.max(0, head - lane.length);
  const fade = Math.min(1, head / 45, (track.distance - head) / 58);
  if (fade <= 0) return;
  const a = pointAt(track, tail, lane, time);
  const b = pointAt(track, head, lane, time);
  if (Math.max(a.x, b.x) < -24 || Math.min(a.x, b.x) > size.x + 24 ||
      Math.max(a.y, b.y) < -24 || Math.min(a.y, b.y) > size.y + 24) return;

  const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
  const alpha = fade * opacity * lane.opacity;
  gradient.addColorStop(0, `rgba(${lane.color}, 0)`);
  gradient.addColorStop(.66, `rgba(${lane.color}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${lane.color}, ${alpha * .5})`);
  context.beginPath();
  context.moveTo(a.x, a.y);
  for (let i = 1; i <= 9; i += 1) {
    const point = pointAt(track, mix(tail, head, i / 9), lane, time);
    context.lineTo(point.x, point.y);
  }
  context.strokeStyle = gradient;
  context.lineWidth = lane.width;
  context.stroke();
}

function makeLanes(count) {
  return Array.from({ length: count }, (_, i) => ({
    offset: (i - (count - 1) / 2) * 8,
    phase: i * 2.35,
    speed: 13 + i % 4 * 4,
    length: 31 + i % 4 * 11,
    spacing: 80 + i % 3 * 28,
    color: palette[i % palette.length],
    width: i % 3 === 1 ? 1.6 : 1.25,
    opacity: i % 3 === 1 ? .77 : .56,
  }));
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
  const bands = [makeLanes(5), makeLanes(7)];
  let projected = [];
  let size;
  let opacity = 0;
  let frame;
  let lastDraw = -Infinity;
  const origin = performance.now();

  function draw(time) {
    context.clearRect(0, 0, size.x, size.y);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const [i, track] of projected.entries()) {
      for (const lane of bands[i]) {
        const period = track.distance + lane.length;
        const offset = lane.phase * 31 + time * lane.speed;
        for (let step = 0; step < period; step += lane.spacing) {
          const head = (offset + step) % period;
          if (head < track.distance) drawStreak(context, track, head, lane, time, opacity, size);
        }
      }
    }
  }

  function animate(now) {
    if (now - lastDraw >= 1000 / 30) {
      draw((now - origin) / 1000);
      lastDraw = now;
    }
    frame = requestAnimationFrame(animate);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = undefined;
  }

  function update() {
    size = map.getSize();
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const inView = bounds.getWest() < 127 && bounds.getEast() > 116 &&
      bounds.getSouth() < 28 && bounds.getNorth() > 18;
    opacity = inView && zoom >= 4 && size.x && size.y ? Math.min(1, Math.max(0, (11 - zoom) / 3)) : 0;
    pane.classList.toggle('is-current-visible', Boolean(opacity));
    if (!opacity || document.hidden) {
      stop();
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.ceil(size.x * ratio), height = Math.ceil(size.y * ratio);
    if (width !== canvas.width || height !== canvas.height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const position = map.containerPointToLayerPoint([0, 0]);
    canvas.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    projected = tracks.map((track) => projectTrack(map, track));
    if (reducedMotion.matches) {
      stop();
      draw(0);
    } else if (frame === undefined) frame = requestAnimationFrame(animate);
  }

  map.on('move resize', update);
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', update);
  map.once('unload', () => {
    stop();
    document.removeEventListener('visibilitychange', update);
    reducedMotion.removeEventListener('change', update);
  });
}
