import L from 'leaflet';
import 'leaflet.markercluster';
import { locatedUnit, unitLocations } from './unit-locations.js';
import { emblemFor, emblemImage } from './emblems.js';

const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();

const START = [[21.87, 119.65], [25.35, 122.12]];
const CAMPUS_ZOOM = 14;
const UNIT_ZOOM = 17;
const PREVIEW_LIMIT = 4;
const PERSON_HEIGHT = 34;
const PERSON_GAP = 4;

function hasRoom(box, occupied, ignored) {
  return occupied.every((other) => other === ignored ||
    box.right + PERSON_GAP <= other.left || box.left >= other.right + PERSON_GAP ||
    box.bottom + PERSON_GAP <= other.top || box.top >= other.bottom + PERSON_GAP);
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
      else groups.set(key, { point, people: new Map() });
    }
  }
  return [...groups.values()].map(({ point, people }) => ({
    point,
    people: [...people.values()].sort((a, b) => Number(Boolean(b.portrait)) - Number(Boolean(a.portrait))),
  }));
}

function campusTitle(point) {
  return point.campus ? `${point.institution}・${point.campus}` : point.institution;
}

function addEmblem(item, institution) {
  const emblem = emblemFor(institution);
  if (emblem) {
    item.prepend(emblemImage(emblem));
    return;
  }
  const glyph = document.createElement('span');
  glyph.className = 'atlas-emblem';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = /大學|college|university|大學校/i.test(institution) ? '學' : '研';
  item.prepend(glyph);
}

export function createAtlas(container, people, { onCampus, onPerson }) {
  const map = L.map(container, { minZoom: 2, maxZoom: 19, zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright', zoomInTitle: '放大', zoomOutTitle: '縮小' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const groups = campusGroups(people);
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
  for (const group of groups.filter(({ people }) => people.length)) {
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
  const campusesWithUnits = new Set();
  for (const group of groups) {
    for (const person of group.people) {
      const unit = locatedUnit(person, group.point);
      if (!unit) continue;
      campusesWithUnits.add(group.point);
      if (!peopleByUnit.has(unit)) peopleByUnit.set(unit, new Set());
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

  function showUnitPins(bounds) {
    const byBuilding = new Map();
    const buildings = [];
    for (const point of unitLocations) {
      if (!bounds.contains([point.lat, point.lon])) continue;
      const key = `${point.lat},${point.lon}`;
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key).push(point);
    }
    for (const points of byBuilding.values()) {
      const { lat, lon, building } = points[0];
      const anchor = L.latLng(lat, lon);
      const members = points.flatMap((point) =>
        [...(peopleByUnit.get(point) ?? [])].map((person) => ({ person, point })));
      const item = mapPill(points.length === 1 ? points[0].unit : building, 'atlas-unit-label', () => onCampus({
        point: points[0], unit: points.length === 1 ? points[0].unit : building,
        people: [...new Set(members.map(({ person }) => person))],
      }));
      item.title = [building, ...new Set(points.map((point) => point.unit))].join('・');
      cards.addLayer(L.marker(anchor, {
        icon: L.divIcon({ html: item, className: 'atlas-unit-marker', iconSize: [0, 0] }),
        interactive: false, keyboard: false,
      }));
      buildings.push({ anchor, members });
    }
    return buildings;
  }

  function showPeople(buildings, occupied) {
    const size = map.getSize();
    const columns = size.x < 540 ? 3 : 4;
    const step = 54 + (map.getZoom() - UNIT_ZOOM) * 20;
    const pins = [];
    const labelCount = occupied.length;
    for (const { anchor, members } of buildings) {
      const center = map.latLngToContainerPoint(anchor);
      members.forEach(({ person, point }, index) => {
        const row = Math.floor(index / columns);
        const rowSize = Math.min(columns, members.length - row * columns);
        const x = center.x + (index % columns - (rowSize - 1) / 2) * step;
        const y = center.y + 35 + row * (PERSON_HEIGHT + PERSON_GAP);
        const width = person.portrait ? 50 : PERSON_HEIGHT;
        const box = { left: x - width / 2, right: x + width / 2,
          top: y - PERSON_HEIGHT / 2, bottom: y + PERSON_HEIGHT / 2 };
        while (!hasRoom(box, occupied)) {
          box.top += PERSON_HEIGHT + PERSON_GAP;
          box.bottom += PERSON_HEIGHT + PERSON_GAP;
        }
        occupied.push(box);
        const position = map.containerPointToLatLng([x, box.top + PERSON_HEIGHT / 2]);
        const initial = Array.from(person.name)[0] ?? '';
        const pin = mapPill(initial, 'atlas-person-dot', () => onPerson(person, point));
        pin.setAttribute('aria-label', person.name);
        pin.title = `${person.name}・${point.unit}`;
        if (person.portrait) {
          const image = document.createElement('img');
          image.src = person.portrait.image;
          image.alt = '';
          pin.prepend(image);
        }
        const fullName = document.createElement('span');
        fullName.className = 'atlas-person-dot__full';
        fullName.setAttribute('aria-hidden', 'true');
        fullName.textContent = person.name;
        pin.append(fullName);
        cards.addLayer(L.marker(position, {
          icon: L.divIcon({ html: pin, className: 'atlas-person-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false, zIndexOffset: 300,
        }));
        pins.push({ pin, fullName, box, x, width, portrait: Boolean(person.portrait) });
      });
    }
    // Reserve the compact hit areas first so a full name never covers a neighbour.
    const expanded = pins.map(({ fullName, width, x, box, portrait }) => {
      const chrome = portrait ? 43 : 16;
      const half = Math.max(width, Math.min(180, Math.ceil(fullName.getBoundingClientRect().width) + chrome)) / 2;
      return { ...box, left: x - half, right: x + half };
    });
    pins.forEach(({ pin, box }, index) => {
      const candidate = expanded[index];
      if (candidate.left < 0 || candidate.right > size.x ||
          !hasRoom(candidate, occupied, box)) return;
      occupied[index + labelCount] = candidate;
      pin.classList.add('atlas-person-dot--named');
    });
  }

  function showCampuses() {
    if (map.getZoom() < CAMPUS_ZOOM) {
      cards.clearLayers();
      if (!map.hasLayer(clusters)) clusters.addTo(map);
      return;
    }
    if (map.hasLayer(clusters)) clusters.remove();
    cards.clearLayers();
    const bounds = map.getBounds().pad(0.08);
    const placed = [];
    const visible = groups.filter(({ point }) => bounds.contains([point.lat, point.lon]))
      .sort((a, b) => b.people.length - a.people.length);
    const detailed = map.getZoom() >= UNIT_ZOOM;
    const buildings = detailed ? showUnitPins(bounds) : [];
    const unitLabels = [];
    if (detailed) cards.eachLayer((layer) => unitLabels.push(layer.getElement().firstElementChild));
    const size = map.getSize();
    for (const group of visible) {
      const { point, people } = group;
      const anchor = L.latLng(point.lat, point.lon);
      const screen = map.latLngToContainerPoint(anchor);
      const groupTitle = campusTitle(point);
      const directPerson = people.length === 1;
      if (detailed) {
        const fallback = people.filter((person) => !locatedUnit(person, point));
        if (!fallback.length && people.length) continue;
        const label = fallback.length === 1 && directPerson ? fallback[0].name : groupTitle;
        const open = () => fallback.length === 1 && directPerson
          ? onPerson(fallback[0], point) : onCampus({ ...group, people: fallback, campusOnly: true });
        const marker = mapPill(fallback.length > 1 ? `${label} · ${fallback.length}` : label, 'atlas-campus-fallback', open);
        const emblem = emblemFor(point.institution);
        if (emblem && !directPerson) marker.prepend(emblemImage(emblem));
        marker.title = fallback.length ? `${label}・校區定位` : label;
        cards.addLayer(L.marker(anchor, {
          icon: L.divIcon({ html: marker, className: 'atlas-fallback-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false,
        }));
        unitLabels.push(marker);
        continue;
      }
      const width = directPerson ? 172 : 196;
      const height = !people.length || directPerson ? 48 : people.length > PREVIEW_LIMIT ? 114 : 94;
      const position = positions.find(([x, y]) => {
        const left = screen.x + x - width / 2;
        const top = screen.y + y - height;
        return left >= 4 && left + width <= size.x - 4 && top >= 4 && top + height <= size.y - 4
          && placed.every((box) => Math.abs(screen.x + x - box.x) >= (box.width + width) / 2 + 8
            || screen.y + y <= box.y - box.height - 8 || top >= box.y + 8);
      });
      const openCampus = () => {
        if (directPerson) {
          const person = people[0];
          onPerson(person, locatedUnit(person, point) ?? point);
        } else if (campusesWithUnits.has(point)) {
          const coordinates = people.map((person) => locatedUnit(person, point)).filter(Boolean)
            .map(({ lat, lon }) => [lat, lon]);
          map.setView(L.latLngBounds(coordinates).getCenter(), UNIT_ZOOM);
        } else onCampus(group);
      };
      {
        const pin = L.circleMarker(anchor, { radius: 5, color: '#fff', weight: 1, fillColor: '#ac491e', fillOpacity: 1 });
        pin.on('click', openCampus);
        cards.addLayer(pin);
      }
      if (!position) continue;
      const [x, y] = position;
      placed.push({ x: screen.x + x, y: screen.y + y, width, height });
      const at = map.containerPointToLatLng([screen.x + x, screen.y + y]);
      if (x || y !== -10) cards.addLayer(L.polyline([anchor, at], {
        color: '#9b471e', weight: 1, opacity: 0.75, interactive: false,
      }));
      const card = document.createElement('div');
      card.className = 'atlas-campus';
      L.DomEvent.disableClickPropagation(card);
      const title = button(directPerson ? people[0].name : groupTitle, 'atlas-campus__title', openCampus);
      title.title = groupTitle;
      if (directPerson && people[0].portrait) {
        const img = document.createElement('img');
        img.src = people[0].portrait.image;
        img.alt = '';
        title.prepend(img);
      } else addEmblem(title, point.institution);
      card.append(title);
      if (!directPerson && people.length) {
        const previews = document.createElement('div');
        previews.className = 'atlas-campus__people';
        for (const person of people.slice(0, PREVIEW_LIMIT)) {
          const entry = button(person.name, 'atlas-campus__person', () => onPerson(person, locatedUnit(person, point) ?? point));
          entry.title = person.name;
          if (person.portrait) {
            const img = document.createElement('img');
            img.src = person.portrait.image;
            img.alt = '';
            entry.prepend(img);
          }
          previews.append(entry);
        }
        card.append(previews);
        if (people.length > PREVIEW_LIMIT) {
          card.append(button(`查看全部 ${people.length} 人`, 'atlas-campus__more', () => onCampus(group)));
        }
      }
      const icon = L.divIcon({ className: 'atlas-campus-marker', html: card, iconSize: [width, height], iconAnchor: [width / 2, height] });
      cards.addLayer(L.marker(at, { icon, interactive: false, keyboard: false }));
    }
    if (detailed) {
      const { left, top } = container.getBoundingClientRect();
      const occupied = unitLabels.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left - left, right: box.right - left, top: box.top - top, bottom: box.bottom - top };
      });
      showPeople(buildings, occupied);
    }
  }

  const reset = () => map.fitBounds(START, { padding: [32, 44], animate: false });
  map.on('moveend', showCampuses);
  reset();
  return {
    reset,
    reveal(point, leftInset) {
      const at = map.latLngToContainerPoint([point.lat, point.lon]);
      const minimumX = leftInset + Math.min(105, (map.getSize().x - leftInset) / 2);
      if (at.x < minimumX) map.panBy([at.x - minimumX, 0], { animate: false });
    },
    peopleAt(point) { return [...(peopleByUnit.get(point) ?? [])]; },
    locate(point, offset = 0) {
      const zoom = Math.max(point.unit ? UNIT_ZOOM + 1 : CAMPUS_ZOOM + 1, map.getZoom());
      const center = map.project([point.lat, point.lon], zoom).subtract([offset, 0]);
      map.setView(map.unproject(center, zoom), zoom, { animate: false });
    },
  };
}
