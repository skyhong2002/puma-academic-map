import L from 'leaflet';
import 'leaflet.markercluster';
import { locatedUnit, unitLocations } from './unit-locations.js';
import { emblemFor, emblemImage, institutionMark } from './emblems.js';

const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();

const START = [[21.87, 118.15], [26.42, 122.16]];
const MOBILE_START = [[21.87, 120.01], [25.31, 122.01]];
const CAMPUS_ZOOM = 14;
const UNIT_ZOOM = 17;
const CAMPUS_PEOPLE_ZOOM = 20;
const CAMPUS_FOCUS_RADIUS_METRES = 1500;
const PREVIEW_LIMIT = 4;
const PERSON_HEIGHT = 34;
const COMPACT_PERSON_SIZE = 30;
const PERSON_GAP = 4;

function hasRoom(box, occupied) {
  return occupied.every((other) =>
    box.right + PERSON_GAP <= other.left || box.left >= other.right + PERSON_GAP ||
    box.bottom + PERSON_GAP <= other.top || box.top >= other.bottom + PERSON_GAP);
}

function moveBox(box, x, y) {
  return { left: box.left + x, right: box.right + x, top: box.top + y, bottom: box.bottom + y };
}

function findViewportRoom(box, occupied, size) {
  const minimumX = PERSON_GAP - box.left;
  const maximumX = size.x - PERSON_GAP - box.right;
  const minimumY = PERSON_GAP - box.top;
  const maximumY = size.y - PERSON_GAP - box.bottom;
  if (minimumX > maximumX || minimumY > maximumY) return;

  const limit = (value, min, max) => Math.min(max, Math.max(min, value));
  const closestX = limit(0, minimumX, maximumX);
  const closestY = limit(0, minimumY, maximumY);
  if (hasRoom(moveBox(box, closestX, closestY), occupied)) return [closestX, closestY];

  const xCandidates = new Set([closestX]);
  for (const other of occupied) {
    xCandidates.add(limit(other.left - PERSON_GAP - box.right, minimumX, maximumX));
    xCandidates.add(limit(other.right + PERSON_GAP - box.left, minimumX, maximumX));
  }
  let position;
  let bestDistance = Infinity;
  for (const x of [...xCandidates].sort((a, b) => Math.abs(a) - Math.abs(b))) {
    if (x * x >= bestDistance) break;
    const neighbours = occupied.filter((other) =>
      box.right + x + PERSON_GAP > other.left && box.left + x < other.right + PERSON_GAP);
    const yCandidates = [closestY];
    for (const other of neighbours) {
      yCandidates.push(limit(other.top - PERSON_GAP - box.bottom, minimumY, maximumY));
      yCandidates.push(limit(other.bottom + PERSON_GAP - box.top, minimumY, maximumY));
    }
    for (const y of yCandidates) {
      const distance = x * x + y * y;
      if (distance < bestDistance && hasRoom(moveBox(box, x, y), neighbours)) {
        bestDistance = distance;
        position = [x, y];
      }
    }
  }
  return position;
}

function button(label, className, activate) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = className;
  item.textContent = label;
  item.addEventListener('click', activate);
  return item;
}

function campusKey(point) {
  return JSON.stringify([point.country, point.institution, point.lat, point.lon]);
}

function campusGroups(people) {
  const groups = new Map();
  for (const person of people) {
    for (const point of person.locations) {
      const key = campusKey(point);
      if (!groups.has(key)) groups.set(key, { point, people: new Map() });
      groups.get(key).people.set(`${person.section}\0${person.raw}`, person);
    }
  }
  for (const institution of catalog) {
    for (const campus of institution.campuses) {
      if (!Number.isFinite(campus.lat) || !Number.isFinite(campus.lon)) continue;
      const point = {
        institution: institution.name,
        campus: campus.name,
        city: campus.county,
        country: '臺灣',
        lat: campus.lat,
        lon: campus.lon,
        source_url: campus.coordinate_source_url,
        address_source_url: campus.source_url,
        address: campus.address,
      };
      const key = campusKey(point);
      const existing = groups.get(key);
      if (existing) existing.point = { ...existing.point, ...point };
      else if (campus.coordinate_source_url) groups.set(key, { point, people: new Map() });
    }
  }
  return [...groups.values()].map(({ point, people }) => ({
    point,
    people: [...people.values()].sort((a, b) => Number(Boolean(b.portrait)) - Number(Boolean(a.portrait))),
  }));
}

export function pointKey(point) {
  return JSON.stringify([campusKey(point), point.unit]);
}

function campusTitle(point) {
  return point.campus ? `${point.institution}・${point.campus}` : point.institution;
}

export function createAtlas(container, people, { onCampus, onCampusZoom, onPerson, isNarrow, preserveResizeOrigin }) {
  const map = L.map(container, { minZoom: 2, maxZoom: CAMPUS_PEOPLE_ZOOM, zoomControl: false, worldCopyJump: true });
  map.attributionControl.setPrefix('<a href="https://github.com/skyhong2002/puma-academic-map">GitHub 原始碼</a>');
  L.control.zoom({ position: 'bottomright', zoomInTitle: '放大', zoomOutTitle: '縮小' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: CAMPUS_PEOPLE_ZOOM,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const current = map.createPane('current');
  current.classList.add('atlas-current');
  current.setAttribute('aria-hidden', 'true');
  map.on('moveend resize', () => {
    const { x, y } = map.getSize();
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const inView = bounds.getWest() < 127 && bounds.getEast() > 115 &&
      bounds.getSouth() < 27 && bounds.getNorth() > 20;
    const opacity = inView && zoom >= 5 ? Math.min(1, Math.max(0, (11 - zoom) / 3)) : 0;
    current.classList.toggle('is-current-visible', Boolean(x && y && opacity));
    current.style.setProperty('--current-opacity', opacity);
    current.style.width = `${x}px`;
    current.style.height = `${y}px`;
    L.DomUtil.setPosition(current, map.containerPointToLayerPoint([0, 0]));
  });
  const orange = getComputedStyle(container).getPropertyValue('--map-orange').trim();
  const registeredCampuses = campusGroups(people);
  const groups = registeredCampuses.filter((group) => group.people.length);
  const clusters = L.markerClusterGroup({
    maxClusterRadius: 52,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction(cluster) {
      const count = new Set(cluster.getAllChildMarkers().flatMap((marker) => marker.options.campus.people)).size;
      return L.divIcon({ html: String(count), className: 'atlas-cluster', iconSize: [42, 42] });
    },
  });
  clusters.on('clusterclick', ({ layer }) => {
    const zoom = Math.min(CAMPUS_ZOOM, Math.max(map.getZoom() + 1, map.getBoundsZoom(layer.getBounds(), false, [48, 48])));
    map.setView(layer.getLatLng(), zoom);
  });
  for (const group of groups) {
    const single = group.people.length === 1;
    const label = single ? group.people[0].name : campusTitle(group.point);
    const text = document.createElement('span');
    text.textContent = single ? label : String(group.people.length);
    const marker = L.marker([group.point.lat, group.point.lon], {
      campus: group,
      title: label,
      alt: label,
      icon: L.divIcon({ html: text, className: single ? 'atlas-single' : 'atlas-cluster',
        iconSize: single ? null : [42, 42] }),
    });
    marker.on('click', () => {
      if (single) onPerson(group.people[0], group.point);
      else map.setView(marker.getLatLng(), CAMPUS_ZOOM + 1);
    });
    clusters.addLayer(marker);
  }

  const cards = L.layerGroup().addTo(map);
  const positions = [0, 1, -1, 2, -2, 3, -3].flatMap((row) =>
    [0, 1, -1, 2, -2, 3, -3].map((column) => [column * 210, row * 125 - 10]));
  const peopleByUnit = new Map();
  const campusByUnit = new Map();
  const unitsByCampus = new Map();
  for (const group of groups) {
    for (const person of group.people) {
      const unit = locatedUnit(person, group.point);
      if (!unit) continue;
      if (!unitsByCampus.has(group.point)) unitsByCampus.set(group.point, new Set());
      unitsByCampus.get(group.point).add(unit);
      if (!peopleByUnit.has(unit)) {
        peopleByUnit.set(unit, new Set());
        campusByUnit.set(unit, group.point);
      }
      peopleByUnit.get(unit).add(person);
    }
  }

  function mapPill(label, modifier, action) {
    const item = button('', `atlas-map-pill ${modifier}`, action);
    const text = document.createElement('span');
    text.className = 'atlas-map-pill__label';
    text.textContent = label;
    item.append(text);
    L.DomEvent.disableClickPropagation(item);
    return item;
  }

  let focusedUnit;
  const canExpandUnit = (point) => (peopleByUnit.get(point)?.size ?? 0) > PREVIEW_LIMIT;

  const selectionMark = L.circleMarker([0, 0], {
    className: 'atlas-selection-mark', radius: 16, weight: 2,
    color: orange, fillColor: '#fff', fillOpacity: 0.3, interactive: false,
  });
  const selectionButtons = new Map();
  let selectedPlace;
  let selection;
  const placeKey = (point, person) => JSON.stringify([
    campusKey(point), point.unit, person?.section, person?.raw,
  ]);

  function registerSelection(item, point, person) {
    const key = placeKey(point, person);
    selectionButtons.set(item, key);
    if (selectedPlace === key) item.setAttribute('aria-current', 'location');
  }

  function select(point, person) {
    selection = point && { point, person };
    selectedPlace = point && placeKey(point, person);
    for (const [item, key] of selectionButtons) {
      if (selectedPlace === key) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    }
    if (!point) {
      selectionMark.remove();
    } else {
      selectionMark.setLatLng([point.lat, point.lon]).addTo(map).bringToFront();
    }
  }

  function showUnitPins(bounds) {
    const buildings = [];
    const units = [...peopleByUnit].sort(([a], [b]) =>
      Number(b === focusedUnit) - Number(a === focusedUnit));
    for (const [point, signers] of units) {
      const { lat, lon, unit } = point;
      const anchor = L.latLng(lat, lon);
      if (!bounds.contains(anchor)) continue;
      const people = [...signers];
      const item = mapPill(unit, 'atlas-unit-label', () => onCampus({
        point, unit, people,
      }));
      item.title = unit;
      registerSelection(item, point);
      appendCount(item, people.length);
      cards.addLayer(L.marker(anchor, {
        icon: L.divIcon({ html: item, className: 'atlas-unit-marker', iconSize: [0, 0] }),
        interactive: false, keyboard: false,
        animationOrigin: campusByUnit.get(point),
      }));
      buildings.push({ anchor, members: people.map((person) => ({ person, point })), label: item });
    }
    return buildings;
  }

  function placeLabels(individualGroups, detailed) {
    const viewport = container.getBoundingClientRect();
    const labels = [
      ...container.querySelectorAll('.atlas-campus'),
      ...container.querySelectorAll('.atlas-unit-label, .atlas-campus-fallback'),
    ];
    const occupied = [];
    const groupsByLabel = new Map(individualGroups.map((group) => [group.label, group]));
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      const box = {
        left: rect.left - viewport.left,
        right: rect.right - viewport.left,
        top: rect.top - viewport.top,
        bottom: rect.bottom - viewport.top,
      };
      const group = groupsByLabel.get(label);
      if (group) group.labelBox = box;
      if (detailed) {
        const [x, y] = findViewportRoom(box, occupied, map.getSize()) ?? [0, 0];
        label.style.translate = `${x}px ${y}px`;
        const moved = moveBox(box, x, y);
        if (group) {
          group.labelBox = moved;
          group.labelOffsetX = x;
          group.labelOffset = y;
        }
        occupied.push(moved);
        continue;
      }
      const visible = box.right > 0 && box.left < viewport.width &&
        box.bottom > 0 && box.top < viewport.height;
      if (visible && !label.classList.contains('atlas-campus') && !hasRoom(box, occupied)) {
        const step = rect.height + PERSON_GAP;
        const shifted = (dy) => ({ ...box, top: box.top + dy, bottom: box.bottom + dy });
        const candidates = [];
        for (let distance = step; distance <= viewport.height + step; distance += step) {
          candidates.push(-distance, distance);
        }
        const available = (dy) => hasRoom(shifted(dy), occupied);
        const offset = candidates.find((dy) => box.top + dy >= 0 &&
          box.bottom + dy <= viewport.height && available(dy)) ?? candidates.find(available);
        if (offset !== undefined) {
          label.style.translate = `0 ${offset}px`;
          const moved = shifted(offset);
          if (group) {
            group.labelBox = moved;
            group.labelOffset = offset;
          }
          occupied.push(moved);
          continue;
        }
      }
      occupied.push(box);
    }
    return occupied;
  }

  function personRows(pins, rowWidth, center, labelBox, size, height) {
    const rows = [];
    const firstTop = labelBox ? labelBox.bottom + PERSON_GAP : center.y - height / 2;
    for (const pin of pins) {
      const width = Math.ceil(pin.button.getBoundingClientRect().width);
      const row = rows.at(-1);
      if (row && row.width + PERSON_GAP + width <= rowWidth) {
        row.items.push({ ...pin, width });
        row.width += PERSON_GAP + width;
      } else {
        rows.push({ items: [{ ...pin, width }], width });
      }
    }
    rows.forEach((row, index) => {
      row.left = Math.max(8, Math.min(center.x - row.width / 2, size.x - row.width - 8));
      row.top = firstTop + index * (height + PERSON_GAP);
    });
    const box = {
      left: Math.min(labelBox?.left ?? Infinity, ...rows.map((row) => row.left)),
      right: Math.max(labelBox?.right ?? -Infinity, ...rows.map((row) => row.left + row.width)),
      top: labelBox?.top ?? firstTop,
      bottom: rows.at(-1).top + height,
    };
    return { rows, box };
  }

  function showPeople(groups, occupied, detailed) {
    const size = map.getSize();
    const rowWidth = Math.max(COMPACT_PERSON_SIZE, Math.min(size.x - 16, size.x < 540 ? 280 : 360));
    const overflow = [];
    if (detailed) groups.sort((a, b) =>
      Number(b.members[0].point === focusedUnit) - Number(a.members[0].point === focusedUnit) ||
      b.members.length - a.members.length);
    for (const { anchor, members, campus, label, labelBox, labelOffsetX = 0, labelOffset = 0 } of groups) {
      const center = map.latLngToContainerPoint(anchor);
      const pins = members.map(({ person, point }) => {
        const pin = mapPill(person.name, 'atlas-person-dot atlas-person-dot--named', () => onPerson(person, point));
        pin.title = `${person.name}・${point.unit ?? campusTitle(point)}`;
        pin.setAttribute('aria-label', person.name);
        pin.style.maxWidth = `${rowWidth}px`;
        registerSelection(pin, point, person);
        if (person.portrait) {
          const portrait = document.createElement('span');
          portrait.className = 'atlas-person-dot__portrait';
          const image = document.createElement('img');
          image.src = person.portrait.image;
          image.alt = '';
          image.addEventListener('error', () => {
            if (!pin.classList.contains('atlas-person-dot--compact')) return;
            portrait.hidden = true;
            pin.querySelector('.atlas-map-pill__label').hidden = false;
          });
          portrait.append(image);
          pin.prepend(portrait);
        }
        const marker = L.marker(anchor, {
          icon: L.divIcon({ html: pin, className: 'atlas-person-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false, zIndexOffset: 300,
          animationOrigin: campusByUnit.get(point),
        });
        cards.addLayer(marker);
        return { button: pin, marker, person };
      });
      const neighbours = occupied.filter((other) => other !== labelBox);
      let height = PERSON_HEIGHT;
      let layout = personRows(pins, rowWidth, center, labelBox, size, height);
      let position;
      if (detailed) {
        position = findViewportRoom(layout.box, neighbours, size);
        if (!position) {
          for (const { button: pin, person } of pins) {
            const text = pin.querySelector('.atlas-map-pill__label');
            text.textContent = Array.from(person.name)[0] ?? '';
            text.hidden = Boolean(person.portrait);
            pin.classList.replace('atlas-person-dot--named', 'atlas-person-dot--compact');
          }
          height = COMPACT_PERSON_SIZE;
          layout = personRows(pins, rowWidth, center, labelBox, size, height);
          position = findViewportRoom(layout.box, neighbours, size);
        }
      } else {
        const step = height + PERSON_GAP;
        const candidates = [0, -step, step, -2 * step, 2 * step, -3 * step, 3 * step];
        const dy = candidates.find((offset) => {
          const box = moveBox(layout.box, 0, offset);
          return (campus || (box.top >= 0 && box.bottom <= size.y)) && hasRoom(box, neighbours);
        });
        if (dy !== undefined) position = [0, dy];
      }

      if (!position) {
        let hidden = 0;
        for (const row of layout.rows) {
          let left = row.left;
          for (const { marker, width } of row.items) {
            const box = { left, right: left + width, top: row.top, bottom: row.top + height };
            const room = detailed && findViewportRoom(box, occupied, size);
            if (room) {
              const [x, y] = room;
              occupied.push(moveBox(box, x, y));
              marker.setLatLng(map.containerPointToLatLng([left + x + width / 2, row.top + y + height / 2]));
            } else {
              cards.removeLayer(marker);
              hidden += 1;
            }
            left += width + PERSON_GAP;
          }
        }
        if (detailed && hidden) overflow.push({ anchor, members, label });
        continue;
      }
      const [dx, dy] = position;
      if (labelBox) {
        occupied.splice(occupied.indexOf(labelBox), 1);
        label.style.translate = `${labelOffsetX + dx}px ${labelOffset + dy}px`;
        if (detailed && Math.hypot(labelOffsetX + dx, labelOffset + dy) > 48) {
          const pin = map.containerPointToLatLng([
            (labelBox.left + labelBox.right) / 2 + dx, (labelBox.top + labelBox.bottom) / 2 + dy,
          ]);
          cards.addLayer(L.polyline([anchor, pin], { color: orange, weight: 1,
            opacity: 0.6, dashArray: '2 4', interactive: false }));
        }
      }
      occupied.push(moveBox(layout.box, dx, dy));
      for (const row of layout.rows) {
        let left = row.left + dx;
        for (const { marker, width } of row.items) {
          marker.setLatLng(map.containerPointToLatLng([left + width / 2, row.top + dy + height / 2]));
          left += width + PERSON_GAP;
        }
      }
    }
    for (const group of overflow) showOverflowLabel(group, occupied, size);
  }

  function showOverflowLabel({ anchor, members, label }, occupied, size) {
    const { point } = members[0];
    const people = members.map(({ person }) => person);
    if (!label) {
      label = mapPill(campusTitle(point), 'atlas-campus-fallback',
        () => onCampus({ point, people, campusOnly: true }));
      registerSelection(label, point);
      appendCount(label, people.length);
      cards.addLayer(L.marker(anchor, {
        icon: L.divIcon({ html: label, className: 'atlas-fallback-marker', iconSize: [0, 0] }),
        interactive: false, keyboard: false,
      }));
      const viewport = container.getBoundingClientRect();
      const rect = label.getBoundingClientRect();
      const box = { left: rect.left - viewport.left, right: rect.right - viewport.left,
        top: rect.top - viewport.top, bottom: rect.bottom - viewport.top };
      const [x, y] = findViewportRoom(box, occupied, size) ?? [0, 0];
      label.style.translate = `${x}px ${y}px`;
      occupied.push(moveBox(box, x, y));
    }
    const description = `${label.querySelector('.atlas-map-pill__label').textContent}・查看全部 ${people.length} 位署名者`;
    label.title = description;
    label.setAttribute('aria-label', description);
    label.classList.add('atlas-map-pill--overflow');
  }

  function appendCount(label, total) {
    const count = document.createElement('span');
    count.className = 'atlas-campus-fallback__count';
    count.textContent = `${total} 人`;
    label.append(count);
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const fadingMarkers = new Set();
  let previousZoom;

  function animateCampusChange(outgoing) {
    for (const { parent, copy } of outgoing) {
      copy.setAttribute('inert', '');
      copy.setAttribute('aria-hidden', 'true');
      parent.append(copy);
      fadingMarkers.add(copy);
      const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180, easing: 'ease-out', fill: 'forwards',
      });
      fade.onfinish = () => {
        copy.remove();
        fadingMarkers.delete(copy);
      };
    }

    cards.eachLayer((layer) => {
      if (!(layer instanceof L.Marker)) return;
      const element = layer.getElement();
      const origin = layer.options.animationOrigin;
      const at = map.latLngToLayerPoint(layer.getLatLng());
      const offset = origin ? map.latLngToLayerPoint([origin.lat, origin.lon]).subtract(at) : L.point(0, 8);
      const fraction = Math.min(1, 120 / Math.max(1, Math.hypot(offset.x, offset.y)));
      element.animate([
        { opacity: 0, translate: `${offset.x * fraction}px ${offset.y * fraction}px` },
        { opacity: 1, translate: '0px 0px' },
      ], { duration: 280, easing: 'cubic-bezier(.22, .72, .28, 1)' });
    });
  }

  function showCampuses() {
    selectionButtons.clear();
    const zoom = map.getZoom();
    const detailed = zoom >= UNIT_ZOOM;
    for (const marker of fadingMarkers) marker.remove();
    fadingMarkers.clear();
    const animate = !reducedMotion.matches && zoom >= CAMPUS_ZOOM && previousZoom >= CAMPUS_ZOOM &&
      detailed !== (previousZoom >= UNIT_ZOOM);
    previousZoom = zoom;
    const outgoing = animate ? cards.getLayers().flatMap((layer) => {
      if (!(layer instanceof L.Marker)) return [];
      const element = layer.getElement();
      return [{ parent: element.parentElement, copy: element.cloneNode(true) }];
    }) : [];
    if (map.getZoom() < CAMPUS_ZOOM) {
      cards.clearLayers();
      if (!map.hasLayer(clusters)) clusters.addTo(map);
      return;
    }
    if (map.hasLayer(clusters)) clusters.remove();
    cards.clearLayers();
    const size = map.getSize();
    const bounds = detailed ? map.getBounds() : map.getBounds().pad(0.08);
    const placed = [];
    const visible = groups.filter(({ point }) => bounds.contains([point.lat, point.lon]))
      .sort((a, b) => b.people.length - a.people.length);
    const individualGroups = detailed ? showUnitPins(bounds) : [];
    for (const group of visible) {
      const { point, people } = group;
      const anchor = L.latLng(point.lat, point.lon);
      const screen = map.latLngToContainerPoint(anchor);
      const groupTitle = campusTitle(point);
      const individualPeople = detailed ? people.filter((person) => !locatedUnit(person, point)) : people;
      if (individualPeople.length > 0 && individualPeople.length <= PREVIEW_LIMIT) {
        individualGroups.push({
          anchor,
          campus: true,
          members: individualPeople.map((person) => ({ person, point: locatedUnit(person, point) ?? point })),
        });
        continue;
      }
      if (detailed) {
        if (!individualPeople.length) continue;
        const open = () => onCampus({ ...group, people: individualPeople, campusOnly: true });
        const marker = mapPill(groupTitle, 'atlas-campus-fallback', open);
        registerSelection(marker, point);
        appendCount(marker, individualPeople.length);
        const emblem = emblemFor(point.institution);
        if (emblem) marker.prepend(emblemImage(emblem));
        marker.title = `${groupTitle}・查看 ${people.length} 位署名者`;
        marker.setAttribute('aria-label', marker.title);
        cards.addLayer(L.marker(anchor, {
          icon: L.divIcon({ html: marker, className: 'atlas-fallback-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false,
        }));
        individualGroups.push({
          anchor,
          label: marker,
          members: individualPeople.map((person) => ({ person, point })),
        });
        continue;
      }
      const width = 196;
      const height = 114;
      const position = positions.find(([x, y]) => {
        const left = screen.x + x - width / 2;
        const top = screen.y + y - height;
        return left >= 4 && left + width <= size.x - 4 && top >= 4 && top + height <= size.y - 4
          && placed.every((box) => Math.abs(screen.x + x - box.x) >= (box.width + width) / 2 + 8
            || screen.y + y <= box.y - box.height - 8 || top >= box.y + 8);
      });
      const openCampus = () => {
        const focus = L.latLngBounds([anchor]);
        for (const { lat, lon } of unitsByCampus.get(point) ?? []) {
          const coordinate = L.latLng(lat, lon);
          if (map.distance(anchor, coordinate) <= CAMPUS_FOCUS_RADIUS_METRES) focus.extend(coordinate);
        }
        onCampusZoom?.();
        select(point);
        map.setView(focus.getCenter(), UNIT_ZOOM);
      };
      {
        const pin = L.circleMarker(anchor, { radius: 5, color: '#fff', weight: 1, fillColor: orange, fillOpacity: 1 });
        pin.on('click', openCampus);
        cards.addLayer(pin);
      }
      if (!position) continue;
      const [x, y] = position;
      placed.push({ x: screen.x + x, y: screen.y + y, width, height });
      const at = map.containerPointToLatLng([screen.x + x, screen.y + y]);
      if (x || y !== -10) cards.addLayer(L.polyline([anchor, at], {
        color: orange, weight: 1, opacity: 0.85, interactive: false,
      }));
      const card = document.createElement('div');
      card.className = 'atlas-campus';
      L.DomEvent.disableClickPropagation(card);
      const title = button('', 'atlas-campus__title', openCampus);
      title.title = groupTitle;
      registerSelection(title, point);
      const titleText = document.createElement('span');
      titleText.className = 'atlas-campus__title-text';
      titleText.textContent = groupTitle;
      title.append(institutionMark(point.institution), titleText);
      card.append(title);
      const previews = document.createElement('div');
      previews.className = 'atlas-campus__people';
      for (const person of people.slice(0, PREVIEW_LIMIT)) {
        const location = locatedUnit(person, point) ?? point;
        const entry = button(person.name, 'atlas-campus__person', () => onPerson(person, location));
        registerSelection(entry, location, person);
        entry.title = person.name;
        if (person.portrait) {
          const img = document.createElement('img');
          img.src = person.portrait.image;
          img.alt = '';
          entry.prepend(img);
        }
        previews.append(entry);
      }
      card.append(previews, button(`查看全部 ${people.length} 人`, 'atlas-campus__more', () => onCampus(group)));
      const icon = L.divIcon({ className: 'atlas-campus-marker', html: card, iconSize: [width, height], iconAnchor: [width / 2, height] });
      cards.addLayer(L.marker(at, { icon, interactive: false, keyboard: false }));
    }
    if (detailed || individualGroups.length) {
      const occupied = placeLabels(individualGroups, detailed);
      if (individualGroups.length) showPeople(individualGroups, occupied, detailed);
    }
    if (animate) animateCampusChange(outgoing);
  }

  function reset() {
    focusedUnit = undefined;
    select();
    const { x, y } = map.getSize();
    const narrow = isNarrow();
    map.fitBounds(narrow ? MOBILE_START : START, {
      padding: [Math.min(32, x / 40), narrow ? Math.min(22, y / 25) : Math.min(44, y / 8)],
      animate: false,
    });
  }
  map.on('moveend', showCampuses);
  reset();
  const resize = (options) => map.invalidateSize({ pan: !preserveResizeOrigin?.(), ...options });
  new ResizeObserver(() => resize({ debounceMoveend: true })).observe(container);
  return {
    reset,
    resize,
    select,
    snapshot() {
      const { lat, lng } = map.getCenter();
      return { lat, lng, zoom: map.getZoom(), selection, focusedUnit };
    },
    restoreView({ lat, lng, zoom }, unit) {
      if (![lat, lng, zoom].every(Number.isFinite) || Math.abs(lat) > 90) return;
      focusedUnit = unit;
      map.setView([lat, lng], zoom, { reset: true });
    },
    resolvePoint(key) {
      return unitLocations.find((point) => pointKey(point) === key) ??
        registeredCampuses.find(({ point }) => pointKey(point) === key)?.point;
    },
    resolveCampus(point, campusOnly) {
      if (point.unit) return { point, unit: point.unit, people: [...(peopleByUnit.get(point) ?? [])] };
      const group = registeredCampuses.find(({ point: candidate }) => campusKey(candidate) === campusKey(point));
      if (!group || !campusOnly) return group;
      return { ...group, campusOnly: true, people: group.people.filter((person) => !locatedUnit(person, point)) };
    },
    expandCampus(point) {
      select(point);
      focusedUnit = point.unit ? point : undefined;
      map.setView([point.lat, point.lon], CAMPUS_PEOPLE_ZOOM, { animate: false });
    },
    campusesFor(institution) {
      const campuses = registeredCampuses.filter(({ point }) => point.institution === institution)
        .sort((a, b) => b.people.length - a.people.length);
      const distinct = new Map();
      for (const campus of campuses) {
        const { point } = campus;
        const key = JSON.stringify([point.campus, point.city, point.country]);
        if (!distinct.has(key)) distinct.set(key, campus);
      }
      return [...distinct.values()];
    },
    peopleAt(point) { return [...(peopleByUnit.get(point) ?? [])]; },
    canExpandUnit,
    locate(point, person) {
      select(point, person);
      focusedUnit = point.unit ? point : undefined;
      const targetZoom = canExpandUnit(point) ? CAMPUS_PEOPLE_ZOOM :
        point.unit ? UNIT_ZOOM + 1 : CAMPUS_ZOOM + 1;
      const zoom = person || point.unit ? Math.max(targetZoom, map.getZoom()) : targetZoom;
      map.setView([point.lat, point.lon], zoom, { animate: false });
    },
  };
}
