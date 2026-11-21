import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import worldLand from './world-land.json';
import { isTaiwan, people } from './person-data.js';

export const taiwanPeople = people.filter((person) => person.locations.some(isTaiwan));
export const overseasPeople = people.filter((person) => person.locations.some((point) => !isTaiwan(point)));

function popup(person, point) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = person.name;
  const place = document.createElement('p');
  place.textContent = [point.institution, point.city, point.country].filter(Boolean).join(' · ');
  const claim = document.createElement('p');
  claim.textContent = person.affiliation_text;
  content.append(title, place, claim);
  if (person.portrait) {
    const image = document.createElement('img');
    image.src = person.portrait.image;
    image.alt = `${person.name}的公開照片`;
    image.width = 64;
    content.prepend(image);
  }
  const refs = [...person.refs, { label: '機構座標來源', url: point.source_url }];
  if (person.portrait) refs.push({ label: '照片來源', url: person.portrait.source_url, description: person.portrait.credit });
  const list = document.createElement('ul');
  for (const ref of refs) {
    if (!/^https?:\/\//i.test(ref.url)) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = ref.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = ref.label;
    item.append(link);
    if (ref.description) item.append(`，${ref.description}`);
    list.append(item);
  }
  content.append(list);
  return content;
}

function markerKey(person, point) {
  return JSON.stringify([person.section, person.raw, point.country, point.institution]);
}

function avatarIcon(person) {
  const face = document.createElement(person.portrait ? 'img' : 'span');
  if (person.portrait) {
    face.src = person.portrait.image;
    face.alt = '';
    face.decoding = 'async';
  } else {
    const name = person.name.trim();
    const words = name.split(/\s+/);
    face.textContent = /\p{Script=Han}/u.test(name[0] ?? '')
      ? [...name].slice(-2).join('')
      : words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  }
  return L.divIcon({ className: 'person-avatar', html: face, iconSize: [36, 36] });
}

function addPersonMarkers(map, entries, include, avatarZoom) {
  const pins = [];
  const byPerson = new Map();
  const markers = L.markerClusterGroup({
    maxClusterRadius: 34,
    removeOutsideVisibleBounds: false,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction(cluster) {
      return L.divIcon({
        className: 'person-cluster',
        html: String(cluster.getChildCount()),
        iconSize: [34, 34],
      });
    },
  });
  const dot = L.divIcon({ className: 'person-pin', iconSize: [16, 16] });
  let showAvatars = map.getZoom() >= avatarZoom;
  for (const person of entries) {
    for (const point of person.locations.filter(include)) {
      const avatar = avatarIcon(person);
      const marker = L.marker([point.lat, point.lon], { icon: showAvatars ? avatar : dot, title: person.name, alt: person.name });
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', person.name));
      marker.bindPopup(() => popup(person, point), { maxWidth: 320 });
      markers.addLayer(marker);
      pins.push({ marker, avatar });
      byPerson.set(markerKey(person, point), person);
    }
  }
  map.addLayer(markers);
  map.on('zoomend', () => {
    const next = map.getZoom() >= avatarZoom;
    if (next === showAvatars) return;
    showAvatars = next;
    for (const { marker, avatar } of pins) {
      marker.setIcon(next ? avatar : dot);
      marker.getElement()?.setAttribute('aria-label', marker.options.title);
    }
  });
  return (person, point) => {
    const record = byPerson.get(markerKey(person, point));
    if (!record) return;
    const coordinates = L.latLng(point.lat, point.lon);
    map.closePopup();
    map.setView(coordinates, Math.min(10, map.getMaxZoom()), { reset: true });
    L.popup({ maxWidth: 320 }).setLatLng(coordinates).setContent(popup(record, point)).openOn(map);
  };
}

export function addTaiwanPeople(map) {
  return addPersonMarkers(map, taiwanPeople, isTaiwan, 9);
}

export function createWorldMap(container) {
  const map = L.map(container, {
    minZoom: 0, maxZoom: 12, zoomSnap: 0, zoomDelta: 0.75, worldCopyJump: true, scrollWheelZoom: false,
  }).fitBounds([[-57, -178], [82, 179]], { padding: [10, 10] });
  L.geoJSON(worldLand, { interactive: false, className: 'world-land' }).addTo(map);
  map.attributionControl.addAttribution('Natural Earth');
  const locate = addPersonMarkers(map, overseasPeople, (point) => !isTaiwan(point), 4);
  return { map, locate };
}
