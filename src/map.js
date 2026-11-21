import L from 'leaflet';
import { addTaiwanPeople, campusFor } from './person-map.js';

/** 統一縣市寫法（台 → 臺），讓圖資、機構資料與名錄用同一個鍵。 */
export const normalizeCounty = (name) => String(name ?? '').trim().replace(/台/g, '臺');

// 全臺視圖：本島加澎湖。金門、連江以左下角小框呈現。
const NATIONAL = L.latLngBounds([21.82, 119.25], [25.38, 122.08]);
const PAN_LIMIT = L.latLngBounds([20.6, 117.4], [27.0, 123.6]);
const INSET_COUNTIES = ['金門縣', '連江縣'];
// 全臺視圖下面積太小、標籤會互相遮擋的縣市，放大後才顯示。
const SMALL_COUNTIES = new Set(['基隆市', '新竹市', '嘉義市']);
// 標籤位置。巢狀縣市（臺北/新北、嘉義縣/市）的幾何中心會落在別的縣市上，所以用手調的點。
const LABEL_AT = {
  臺北市: [25.09, 121.56],
  新北市: [24.9, 121.66],
  基隆市: [25.12, 121.72],
  桃園市: [24.9, 121.22],
  新竹縣: [24.69, 121.17],
  新竹市: [24.79, 120.95],
  苗栗縣: [24.5, 120.93],
  臺中市: [24.23, 120.95],
  彰化縣: [23.99, 120.46],
  南投縣: [23.84, 120.99],
  雲林縣: [23.69, 120.39],
  嘉義縣: [23.4, 120.62],
  嘉義市: [23.48, 120.45],
  臺南市: [23.15, 120.33],
  高雄市: [22.98, 120.64],
  屏東縣: [22.5, 120.65],
  宜蘭縣: [24.6, 121.65],
  花蓮縣: [23.78, 121.4],
  臺東縣: [22.9, 121.05],
  澎湖縣: [23.58, 119.6],
  金門縣: [24.45, 118.38],
  連江縣: [26.16, 119.95],
};

/**
 * 縣市的「主要範圍」：最大島加上附近島嶼。
 * 排除釣魚臺、烏坵這類離主體很遠的小島，否則下鑽後縣市本體會縮成一小塊。
 */
function coreBounds(feature) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
  const boxes = polygons.map((polygon) => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of polygon[0]) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    return { west, south, east, north, size: (east - west) * (north - south) };
  });
  const main = boxes.reduce((a, b) => (b.size > a.size ? b : a));
  const cx = (main.west + main.east) / 2;
  const cy = (main.south + main.north) / 2;
  const bounds = L.latLngBounds([]);
  for (const box of boxes) {
    const dx = (box.west + box.east) / 2 - cx;
    const dy = (box.south + box.north) / 2 - cy;
    if (Math.hypot(dx, dy) <= 1.1) {
      bounds.extend([box.south, box.west]);
      bounds.extend([box.north, box.east]);
    }
  }
  return bounds;
}

/**
 * 建立縣市地圖。
 * @param {object} options
 * @param {HTMLElement} options.container 主地圖容器
 * @param {HTMLElement} options.insetContainer 離島小框容器
 * @param {object} options.geojson 縣市 FeatureCollection（properties.COUNTYNAME）
 * @param {(county: string) => number} options.binOf 縣市對應的色階 0–4
 * @param {(county: string|null) => void} options.onHover
 * @param {(county: string) => void} options.onSelect
 * @returns {{ counties: string[], select: (county: string|null) => void, highlight: (county: string|null) => void }}
 */
export function createCountyMap({ container, insetContainer, geojson, binOf, onHover, onSelect }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');

  const map = L.map(container, {
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    maxZoom: 12,
    attributionControl: false,
    zoomControl: false,
    maxBounds: PAN_LIMIT,
    maxBoundsViscosity: 0.8,
    keyboard: false, // 鍵盤操作走縣市清單，避免地圖容器吃掉 Tab 焦點後無事可做
  });
  L.control.zoom({ position: 'topright', zoomInTitle: '放大', zoomOutTitle: '縮小' }).addTo(map);
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';

  /** county → { layers: L.Path[], labelEl, insetEl, bounds } */
  const entries = new Map();
  const entryOf = (county) => {
    if (!entries.has(county)) entries.set(county, { layers: [], labelEl: null, insetEl: null, bounds: null });
    return entries.get(county);
  };

  let selected = null;
  let hovered = null;
  let baseZoom = 0;

  const paint = () => {
    for (const [county, entry] of entries) {
      const isSelected = county === selected;
      const isHover = county === hovered;
      const isDimmed = selected !== null && !isSelected;
      const targets = [...entry.layers.map((layer) => layer.getElement()), entry.labelEl, entry.insetEl];
      for (const el of targets) {
        if (!el) continue;
        el.classList.toggle('is-selected', isSelected);
        el.classList.toggle('is-hover', isHover);
        el.classList.toggle('is-dimmed', isDimmed);
      }
    }
    // 外框較粗的放到最上層，避免被相鄰縣市的邊線蓋掉。
    for (const county of [hovered, selected]) {
      if (county) entries.get(county)?.layers[0]?.bringToFront();
    }
  };

  const setHover = (county) => {
    if (hovered === county) return;
    hovered = county;
    paint();
    onHover?.(county);
  };

  L.geoJSON(geojson, {
    style: (feature) => ({ className: `county bin-${binOf(normalizeCounty(feature.properties.COUNTYNAME))}` }),
    onEachFeature(feature, layer) {
      const county = normalizeCounty(feature.properties.COUNTYNAME);
      const entry = entryOf(county);
      entry.layers.push(layer);
      entry.bounds = coreBounds(feature);
      layer.on({
        mouseover: () => setHover(county),
        mouseout: () => setHover(null),
        click: () => onSelect?.(county),
      });
    },
  }).addTo(map);

  for (const [county, entry] of entries) {
    const at = LABEL_AT[county] ?? entry.bounds.getCenter();
    const marker = L.marker(at, {
      pane: 'labels',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: `county-label${SMALL_COUNTIES.has(county) ? ' county-label--small' : ''}${binOf(county) >= 3 ? ' county-label--on-dark' : ''}${INSET_COUNTIES.includes(county) ? ' county-label--inset' : ''}`,
        html: `<span>${county}</span>`,
        iconSize: [0, 0],
      }),
    }).addTo(map);
    entry.labelEl = marker.getElement();
  }

  // 離島小框：各自一張不可拖曳的小地圖，整個框是一顆按鈕。
  const insetMaps = [];
  for (const county of INSET_COUNTIES) {
    const feature = geojson.features.find((f) => normalizeCounty(f.properties.COUNTYNAME) === county);
    if (!feature || !insetContainer) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inset';
    button.tabIndex = -1; // 縣市清單已提供相同操作
    const canvas = document.createElement('span');
    canvas.className = 'inset__map';
    const caption = document.createElement('span');
    caption.className = 'inset__name';
    caption.textContent = county;
    button.append(canvas, caption);
    insetContainer.append(button);

    const insetMap = L.map(canvas, {
      zoomSnap: 0.1,
      attributionControl: false,
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    const layer = L.geoJSON(feature, {
      interactive: false,
      style: { className: `county bin-${binOf(county)}` },
    }).addTo(insetMap);
    const entry = entryOf(county);
    entry.layers.push(...layer.getLayers());
    entry.insetEl = button;
    const bounds = entry.bounds ?? coreBounds(feature);
    insetMaps.push({ map: insetMap, bounds });
    insetMap.fitBounds(bounds, { padding: [6, 6], animate: false });

    button.addEventListener('pointerenter', () => setHover(county));
    button.addEventListener('pointerleave', () => setHover(null));
    button.addEventListener('click', () => onSelect?.(county));
  }

  const syncInteraction = () => {
    const zoomedIn = map.getZoom() > baseZoom + 0.2;
    container.classList.toggle('is-close', map.getZoom() >= baseZoom + 1);
    // 觸控裝置在全臺視圖不攔截拖曳，讓頁面可以正常上下捲動。
    if (coarsePointer.matches && !(selected || zoomedIn)) map.dragging.disable();
    else map.dragging.enable();
  };

  const frame = (animate) => {
    const target = selected ? entries.get(selected)?.bounds : NATIONAL;
    if (!target) return;
    const size = map.getSize();
    const options = selected
      ? { paddingTopLeft: [28, Math.min(120, size.y * 0.22)], paddingBottomRight: [28, 36], maxZoom: 11 }
      : { padding: [10, 10] };
    if (animate && !reducedMotion.matches) map.flyToBounds(target, { ...options, duration: 0.75 });
    else map.fitBounds(target, { ...options, animate: false });
  };

  const fitBase = () => {
    if (container.classList.contains('is-campus')) {
      map.invalidateSize({ animate: false });
      return;
    }
    map.setMinZoom(0);
    map.invalidateSize({ animate: false });
    map.fitBounds(NATIONAL, { padding: [10, 10], animate: false });
    baseZoom = map.getZoom();
    map.setMinZoom(baseZoom - 0.5);
    if (selected) frame(false);
    for (const inset of insetMaps) {
      inset.map.invalidateSize({ animate: false });
      inset.map.fitBounds(inset.bounds, { padding: [6, 6], animate: false });
    }
    syncInteraction();
  };

  fitBase();
  const locate = addTaiwanPeople(map);
  paint();
  map.on('zoomend', syncInteraction);

  let resizeTimer = 0;
  let lastSize = `${container.clientWidth}x${container.clientHeight}`;
  new ResizeObserver(() => {
    const size = `${container.clientWidth}x${container.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitBase, 120);
  }).observe(container);

  return {
    counties: [...entries.keys()],
    locate,
    campus: campusFor(map),
    refocus: () => frame(true),
    select(county) {
      const next = county && entries.has(county) ? county : null;
      if (next === selected) return;
      selected = next;
      paint();
      frame(true);
      syncInteraction();
    },
    highlight: setHoverQuiet,
  };

  // 清單 hover/focus 時同步地圖高亮，但不回呼 onHover（呼叫端自己已經知道）。
  function setHoverQuiet(county) {
    const next = county && entries.has(county) ? county : null;
    if (hovered === next) return;
    hovered = next;
    paint();
  }
}
