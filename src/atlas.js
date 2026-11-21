import L from 'leaflet';
import 'leaflet.markercluster';

const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();

const START = [[21.87, 119.65], [25.35, 122.12]];
const CAMPUS_ZOOM = 14;
const PREVIEW_LIMIT = 4;

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
  const positions = [[0, -10], [0, 128], [210, 0], [-210, 0], [210, 128], [-210, 128], [0, 250], [210, 250], [-210, 250]];
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
    for (const group of visible) {
      const { point, people } = group;
      const anchor = L.latLng(point.lat, point.lon);
      const screen = map.latLngToContainerPoint(anchor);
      const groupTitle = campusTitle(point);
      const width = people.length === 1 ? 172 : 196;
      const height = people.length <= 1 ? 48 : people.length > PREVIEW_LIMIT ? 114 : 94;
      const position = positions.find(([x, y]) => placed.every((box) =>
        Math.abs(screen.x + x - box.x) >= (box.width + width) / 2 + 8
        || screen.y + y <= box.y - box.height - 8 || screen.y + y - height >= box.y + 8));
      const pin = L.circleMarker(anchor, { radius: 5, color: '#fff', weight: 1, fillColor: '#ac491e', fillOpacity: 1 });
      pin.on('click', () => people.length === 1 ? onPerson(people[0], point) : onCampus(group));
      cards.addLayer(pin);
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
      const title = button(people.length === 1 ? people[0].name : groupTitle, 'atlas-campus__title', () => {
        if (people.length === 1) onPerson(people[0], point);
        else onCampus(group);
      });
      title.title = groupTitle;
      if (people.length === 1 && people[0].portrait) {
        const img = document.createElement('img');
        img.src = people[0].portrait.image;
        img.alt = '';
        title.prepend(img);
      } else addEmblem(title, point.institution);
      card.append(title);
      if (people.length > 1) {
        const previews = document.createElement('div');
        previews.className = 'atlas-campus__people';
        for (const person of people.slice(0, PREVIEW_LIMIT)) {
          const entry = button(person.name, 'atlas-campus__person', () => onPerson(person, point));
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
    locate(point, offset = 0) {
      const zoom = Math.max(CAMPUS_ZOOM + 1, map.getZoom());
      const center = map.project([point.lat, point.lon], zoom).subtract([offset, 0]);
      map.setView(map.unproject(center, zoom), zoom, { animate: false });
    },
  };
}
