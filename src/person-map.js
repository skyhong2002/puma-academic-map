import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { createCampusView } from './campus-map.js';
import worldCountries from './world-countries.json';
import { isTaiwan, people } from './person-data.js';

export const taiwanPeople = people.filter((person) => person.locations.some(isTaiwan));
export const overseasPeople = people.filter((person) => person.locations.some((point) => !isTaiwan(point)));

export function personDetails(person, point, { showName = true } = {}) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = person.name;
  const place = document.createElement('p');
  place.textContent = [point.institution, point.city, point.country].filter(Boolean).join(' · ');
  const claim = document.createElement('p');
  claim.textContent = person.affiliation_text;
  if (showName) content.append(title);
  content.append(place, claim);
  if (person.portrait) {
    const image = document.createElement('img');
    image.src = person.portrait.image;
    image.alt = `${person.name}的公開照片`;
    image.width = 64;
    content.prepend(image);
  }
  const activities = person.refs.filter((ref) => ref.kind === 'support');
  const refs = [...person.refs.filter((ref) => ref.kind !== 'support'), { label: '機構座標來源', url: point.source_url }];
  if (point.address_source_url) refs.push({ label: '機構地址來源', url: point.address_source_url });
  if (person.portrait) {
    refs.push({ label: '照片來源', url: person.portrait.source_url, description: person.portrait.credit });
    if (person.portrait.license_url) refs.push({ label: '照片授權', url: person.portrait.license_url });
  }
  const list = document.createElement('ul');
  for (const ref of [...refs, ...activities]) {
    if (!/^https?:\/\//i.test(ref.url)) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = ref.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = ref.kind === 'support' ? `相關公開活動・${ref.label}` : ref.label;
    item.append(link);
    if (ref.description) item.append(`，${ref.description}`);
    list.append(item);
  }
  content.append(list);
  return content;
}

const institutionFiles = import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' });
const aliasesByInstitution = new Map(Object.values(institutionFiles).flat()
  .map(({ name, aliases }) => [name, aliases]));

const normalizeUnit = (text) => text.replace(/\s+/g, '').replaceAll('台', '臺');

function departmentFor(person, institution) {
  const aliases = [institution, institution.replace(/^國立/, ''), ...aliasesByInstitution.get(institution) ?? []]
    .map(normalizeUnit).sort((a, b) => b.length - a.length);
  for (const ref of person.refs) {
    if (!ref.label.startsWith('教育部 ') || !ref.label.endsWith('師資名錄')) continue;
    const listing = ref.description.split('記載：')[1];
    for (const claim of listing?.split('；') ?? []) {
      const heading = normalizeUnit(claim.split('，')[0].split('財團法人').at(-1));
      const alias = aliases.find((item) => heading.startsWith(item));
      if (alias && heading.length > alias.length) return heading.slice(alias.length);
    }
  }
  for (const claim of person.affiliation_text.split(/[、，；／/]/)) {
    const heading = normalizeUnit(claim).replace(/^(前|曾任)/, '');
    const alias = aliases.find((item) => heading.startsWith(item));
    if (!alias) continue;
    const department = heading.slice(alias.length).match(/^([\p{Script=Han}]{1,24}?(?:學系|研究所|學位學程|學程|學院|中心|系|所))(?=兼任|專任|名譽|榮譽|退休|教授|副教授|助理|博士|碩士|講師|研究員|主任|特聘|講座|$)/u);
    if (department) return department[1];
  }
  return '系所未標明';
}

function groupIcon(count) {
  return L.divIcon({ className: 'person-cluster', html: String(count), iconSize: [34, 34] });
}

function rosterPopup(entries, selected) {
  const groups = new Map();
  for (const { person, point } of entries) {
    if (!groups.has(point.institution)) groups.set(point.institution, new Map());
    const departments = groups.get(point.institution);
    const label = departmentFor(person, point.institution);
    const key = label.replaceAll('學系', '系');
    if (!departments.has(key)) departments.set(key, { label, entries: [] });
    departments.get(key).entries.push({ person, point });
  }

  const panel = document.createElement('div');
  panel.className = 'place-roster';
  const overview = document.createElement('div');
  let showSelected;
  const heading = document.createElement('strong');
  heading.textContent = `${entries.length} 筆署名`;
  overview.append(heading);
  for (const [institution, departments] of groups) {
    const title = document.createElement('h3');
    title.textContent = institution;
    overview.append(title);
    const ordered = [...departments.values()].sort((a, b) =>
      Number(a.label === '系所未標明') - Number(b.label === '系所未標明')
      || a.label.localeCompare(b.label, 'zh-TW'));
    for (const department of ordered) {
      const section = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${department.label}（${department.entries.length}）`;
      section.append(summary);
      for (const item of department.entries) {
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'place-roster__person';
        name.textContent = item.person.name;
        if (item.person.portrait) {
          const image = document.createElement('img');
          image.src = item.person.portrait.image;
          image.alt = '';
          image.loading = 'lazy';
          name.prepend(image);
        }
        function showPerson(focus) {
          const back = document.createElement('button');
          back.type = 'button';
          back.className = 'place-roster__person';
          back.textContent = '返回系所名單';
          back.addEventListener('click', () => {
            panel.replaceChildren(overview);
            name.focus();
          });
          panel.replaceChildren(back, personDetails(item.person, item.point));
          if (focus) back.focus();
        }
        name.addEventListener('click', () => showPerson(true));
        if (selected?.person === item.person && selected.point.institution === item.point.institution) {
          section.open = true;
          showSelected = () => showPerson(false);
        }
        section.append(name);
      }
      overview.append(section);
    }
  }
  panel.append(overview);
  showSelected?.();
  return panel;
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
    face.textContent = person.name;
  }
  const className = person.portrait ? 'person-avatar' : 'person-name-pin';
  return L.divIcon({ className, html: face, iconSize: [36, 36] });
}

function addPersonMarkers(map, entries, include, avatarZoom, onGroup) {
  const pins = [];
  const byPerson = new Map();
  const byCoordinate = new Map();
  const membersByMarker = new Map();
  for (const person of entries) {
    for (const point of person.locations.filter(include)) {
      const key = `${point.lat},${point.lon}`;
      if (!byCoordinate.has(key)) byCoordinate.set(key, []);
      byCoordinate.get(key).push({ person, point });
      byPerson.set(markerKey(person, point), person);
    }
  }

  let rosterPanel;
  map.on('clearplaceroster', () => rosterPanel?.remove());
  function showRoster(members, selected) {
    map.closePopup();
    rosterPanel?.remove();
    const view = document.createElement('section');
    view.className = 'place-roster-panel';
    view.setAttribute('aria-label', '同地點的系所名單');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'place-roster-panel__close';
    close.textContent = '關閉';
    close.addEventListener('click', () => view.remove());
    view.append(close, rosterPopup(members, selected));
    L.DomEvent.disableClickPropagation(view);
    view.addEventListener('click', (event) => event.stopPropagation());
    L.DomEvent.disableScrollPropagation(view);
    map.getContainer().append(view);
    rosterPanel = view;
  }

  const markers = L.markerClusterGroup({
    maxClusterRadius: 34,
    removeOutsideVisibleBounds: false,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction(cluster) {
      const count = cluster.getAllChildMarkers().reduce((sum, marker) => sum + membersByMarker.get(marker).length, 0);
      return groupIcon(count);
    },
  });
  markers.on('clusterclick', ({ layer }) => {
    if (map.getZoom() < avatarZoom) {
      layer.zoomToBounds();
      return;
    }
    const members = layer.getAllChildMarkers().flatMap((marker) => membersByMarker.get(marker));
    onGroup(members);
  });

  const dot = L.divIcon({ className: 'person-pin', iconSize: [16, 16] });
  let showAvatars = map.getZoom() >= avatarZoom;
  for (const members of byCoordinate.values()) {
    const { person, point } = members[0];
    const shared = members.length > 1;
    const avatar = shared ? null : avatarIcon(person);
    const icon = shared ? groupIcon(members.length) : showAvatars ? avatar : dot;
    const title = shared ? `${point.institution}等據點，${members.length} 筆署名` : person.name;
    const marker = L.marker([point.lat, point.lon], { icon, title, alt: title });
    marker.on('add', () => marker.getElement()?.setAttribute('aria-label', title));
    if (shared) marker.on('click', () => onGroup(members));
    else {
      marker.on('click', () => rosterPanel?.remove());
      marker.bindPopup(() => personDetails(person, point), { maxWidth: 330 });
    }
    membersByMarker.set(marker, members);
    markers.addLayer(marker);
    if (!shared) pins.push({ marker, avatar });
  }
  map.addLayer(markers);
  map.on('campusview', ({ active }) => {
    if (active) {
      map.closePopup();
      rosterPanel?.remove();
      markers.remove();
    } else markers.addTo(map);
  });
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
    const members = byCoordinate.get(`${point.lat},${point.lon}`);
    if (members.length > 1) showRoster(members, { person: record, point });
    else {
      rosterPanel?.remove();
      L.popup({ maxWidth: 330 }).setLatLng(coordinates).setContent(personDetails(record, point)).openOn(map);
    }
  };
}

export function addTaiwanPeople(map, onGroup) {
  return addPersonMarkers(map, taiwanPeople, isTaiwan, 9, onGroup);
}

export function campusFor(map) {
  return createCampusView(map, departmentFor, personDetails);
}

export function createWorldMap(container, onGroup) {
  const overview = [[-57, -178], [82, 179]];
  const map = L.map(container, {
    minZoom: 0, maxZoom: 12, zoomSnap: 0, zoomDelta: 0.75, worldCopyJump: true, scrollWheelZoom: false,
  }).fitBounds(overview, { padding: [10, 10] });
  L.geoJSON(worldCountries, { interactive: false, className: 'world-country' }).addTo(map);
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/">Natural Earth</a>');
  const campus = campusFor(map);
  const locate = addPersonMarkers(map, overseasPeople, (point) => !isTaiwan(point), 4, onGroup);
  return {
    map,
    locate,
    campus,
    fitCountry(points) {
      campus.clear();
      map.fire('clearplaceroster');
      map.closePopup();
      map.fitBounds(points?.map(({ lat, lon }) => [lat, lon]) ?? overview,
        { padding: [24, 24], maxZoom: 6 });
    },
  };
}
