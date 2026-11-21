import L from 'leaflet';
import 'leaflet.markercluster';
import { locatedUnit } from './unit-locations.js';
import { emblemFor, emblemImage } from './emblems.js';

const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();

const START = [[21.87, 119.65], [25.35, 122.12]];
const CAMPUS_ZOOM = 14;
const UNIT_ZOOM = 17;
const CAMPUS_PEOPLE_ZOOM = 20;
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
  const map = L.map(container, { minZoom: 2, maxZoom: CAMPUS_PEOPLE_ZOOM, zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright', zoomInTitle: '放大', zoomOutTitle: '縮小' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: CAMPUS_PEOPLE_ZOOM,
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
    for (const point of peopleByUnit.keys()) {
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
    const step = map.getZoom() < UNIT_ZOOM ? 82 : map.getZoom() === UNIT_ZOOM ? 54 : 90;
    const groups = [];
    for (const { anchor, members, campus = false, offsetY = campus ? 0 : 35 } of buildings) {
      const center = map.latLngToContainerPoint(anchor);
      const pins = [];
      members.forEach(({ person, point }, index) => {
        const row = Math.floor(index / columns);
        const rowSize = Math.min(columns, members.length - row * columns);
        const x = center.x + (index % columns - (rowSize - 1) / 2) * step;
        const y = center.y + offsetY + row * (PERSON_HEIGHT + PERSON_GAP);
        const box = { left: x - PERSON_HEIGHT / 2, right: x + PERSON_HEIGHT / 2,
          top: y - PERSON_HEIGHT / 2, bottom: y + PERSON_HEIGHT / 2 };
        for (let offset = 1; !hasRoom(box, occupied); offset += 1) {
          const distance = campus ? Math.ceil(offset / 2) * (offset % 2 ? 1 : -1) : offset;
          const shifted = y + distance * (PERSON_HEIGHT + PERSON_GAP);
          box.top = shifted - PERSON_HEIGHT / 2;
          box.bottom = shifted + PERSON_HEIGHT / 2;
        }
        occupied.push(box);
        const position = map.containerPointToLatLng([x, box.top + PERSON_HEIGHT / 2]);
        const initial = Array.from(person.name)[0] ?? '';
        const pin = mapPill(initial, 'atlas-person-dot', () => onPerson(person, point));
        pin.setAttribute('aria-label', person.name);
        pin.title = `${person.name}・${point.unit ?? campusTitle(point)}`;
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
        const marker = L.marker(position, {
          icon: L.divIcon({ html: pin, className: 'atlas-person-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false, zIndexOffset: 300,
        });
        cards.addLayer(marker);
        pins.push({ pin, marker, fullName, box, x, portrait: Boolean(person.portrait) });
      });
      groups.push({ pins, center, offsetY });
    }
    const layouts = groups.map((group) => ({
      ...group,
      expanded: group.pins.map(({ fullName, x, box, portrait }) => {
        const extraWidth = portrait ? 43 : 16;
        const half = Math.max(PERSON_HEIGHT, Math.ceil(fullName.getBoundingClientRect().width) + extraWidth) / 2;
        return { ...box, left: x - half, right: x + half };
      }),
    }));
    // People sharing an anchor switch display modes together.
    for (const { pins, center, offsetY, expanded } of layouts) {
      const compact = new Set(pins.map(({ box }) => box));
      const neighbours = occupied.filter((box) => !compact.has(box));
      const fits = (boxes) => boxes.every((box) => box.left >= 0 && box.right <= size.x &&
        hasRoom(box, neighbours) && hasRoom(box, boxes, box));
      let named = expanded;
      if (!fits(named) && map.getZoom() > UNIT_ZOOM) {
        const maxWidth = Math.min(size.x - 16, columns * step);
        const rows = [];
        for (const box of expanded) {
          const width = box.right - box.left;
          const last = rows.at(-1);
          if (last && last.widths.length < columns && last.total + PERSON_GAP + width <= maxWidth) {
            last.widths.push(width);
            last.total += PERSON_GAP + width;
          } else rows.push({ widths: [width], total: width });
        }
        const rowStep = PERSON_HEIGHT + PERSON_GAP;
        let top = center.y + offsetY - PERSON_HEIGHT / 2;
        let skips = 4;
        named = [];
        for (const { widths, total } of rows) {
          let left = Math.max(8, Math.min(center.x - total / 2, size.x - total - 8));
          const row = widths.map((width) => {
            const box = { left, right: left + width, top, bottom: top + PERSON_HEIGHT };
            left = box.right + PERSON_GAP;
            return box;
          });
          while (skips > 0 && row.some((box) => !hasRoom(box, neighbours))) {
            skips -= 1;
            top += rowStep;
            row.forEach((box) => {
              box.top = top;
              box.bottom = top + PERSON_HEIGHT;
            });
          }
          named.push(...row);
          top += rowStep;
        }
      }
      if (!fits(named)) continue;
      pins.forEach(({ pin, marker, box }, index) => {
        const target = named[index];
        occupied[occupied.indexOf(box)] = target;
        if (named !== expanded) marker.setLatLng(map.containerPointToLatLng([
          (target.left + target.right) / 2, target.top + PERSON_HEIGHT / 2,
        ]));
        pin.classList.add('atlas-person-dot--named');
      });
    }
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
    const individualGroups = detailed ? showUnitPins(bounds) : [];
    const size = map.getSize();
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
        const count = document.createElement('span');
        count.className = 'atlas-campus-fallback__count';
        count.textContent = `${individualPeople.length} 人`;
        marker.append(count);
        const emblem = emblemFor(point.institution);
        if (emblem) marker.prepend(emblemImage(emblem));
        marker.title = `${groupTitle}・查看 ${individualPeople.length} 位署名者`;
        marker.setAttribute('aria-label', marker.title);
        cards.addLayer(L.marker(anchor, {
          icon: L.divIcon({ html: marker, className: 'atlas-fallback-marker', iconSize: [0, 0] }),
          interactive: false, keyboard: false,
        }));
        if (map.getZoom() === CAMPUS_PEOPLE_ZOOM) {
          individualGroups.push({
            anchor,
            offsetY: 59,
            members: individualPeople.map((person) => ({ person, point })),
          });
        }
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
        if (campusesWithUnits.has(point)) {
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
      const title = button(groupTitle, 'atlas-campus__title', openCampus);
      title.title = groupTitle;
      addEmblem(title, point.institution);
      card.append(title);
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
      card.append(previews, button(`查看全部 ${people.length} 人`, 'atlas-campus__more', () => onCampus(group)));
      const icon = L.divIcon({ className: 'atlas-campus-marker', html: card, iconSize: [width, height], iconAnchor: [width / 2, height] });
      cards.addLayer(L.marker(at, { icon, interactive: false, keyboard: false }));
    }
    if (individualGroups.length) {
      const { left, top } = container.getBoundingClientRect();
      const labels = container.querySelectorAll('.atlas-unit-label, .atlas-campus-fallback, .atlas-campus');
      const occupied = Array.from(labels, (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left - left, right: box.right - left, top: box.top - top, bottom: box.bottom - top };
      });
      showPeople(individualGroups, occupied);
    }
  }

  const reset = () => map.fitBounds(START, { padding: [32, 44], animate: false });
  map.on('moveend', showCampuses);
  reset();
  return {
    reset,
    expandCampus(point) {
      map.setView([point.lat, point.lon], CAMPUS_PEOPLE_ZOOM, { animate: false });
    },
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
