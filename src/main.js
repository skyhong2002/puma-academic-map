import { emblemFor, emblemImage } from './emblems.js';
import { locatedUnit } from './unit-locations.js';
import roster from '../data/signatories.json';
import { createAtlas } from './atlas.js';
import { mountDirectory } from './directory.js';
import { people } from './person-data.js';
import { personDetails } from './person-map.js';

const $ = (id) => document.getElementById(id);
const panel = $('map-panel');
const details = $('place-details');
const directoryElement = $('directory');
const about = $('about-map');
const back = $('panel-back');
const open = $('open-directory');
const number = new Intl.NumberFormat('zh-TW');
let activeCampus;
let returnFocus;

function showPanel(view, { focus = true } = {}) {
  if (panel.hidden && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
  panel.hidden = false;
  open.setAttribute('aria-expanded', 'true');
  directoryElement.hidden = view !== 'directory';
  details.hidden = view !== 'detail';
  about.hidden = view !== 'about';
  back.hidden = view !== 'detail';
  if (focus) {
    $('panel-content').scrollTop = 0;
    panel.querySelector('#panel-content > section:not([hidden]) h2')?.focus({ preventScroll: true });
  }
}

function closePanel() {
  if (panel.hidden) return;
  panel.hidden = true;
  open.setAttribute('aria-expanded', 'false');
  activeCampus = null;
  (returnFocus?.isConnected ? returnFocus : open).focus({ preventScroll: true });
}

function detailTitle(text) {
  const title = document.createElement('h2');
  title.tabIndex = -1;
  title.textContent = text;
  return title;
}

function showCampus(campus) {
  activeCampus = campus;
  const { point, people, unit, campusOnly } = campus;
  const school = [point.institution, point.campus].filter(Boolean).join('・');
  const title = detailTitle(unit ?? school);
  const sub = document.createElement('p');
  sub.textContent = [unit ? school : null, point.city, point.country, `${number.format(people.length)} 筆署名`].filter(Boolean).join('・');
  const members = document.createElement('ul');
  members.className = 'map-campus-people';
  for (const person of people) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => showPerson(person, unit ? locatedUnit(person, point) ?? point : point, campus));
    if (person.portrait) {
      const image = document.createElement('img');
      image.src = person.portrait.image;
      image.alt = '';
      image.loading = 'lazy';
      button.append(image);
    }
    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = person.name;
    label.append(name, document.createElement('br'), person.affiliation_text);
    button.append(label);
    item.append(button);
    members.append(item);
  }
  details.replaceChildren(title, sub);
  const emblem = emblemFor(point.institution);
  if (emblem) {
    title.classList.add('map-detail__institution');
    title.prepend(emblemImage(emblem));
    const credit = document.createElement('p');
    credit.className = 'map-detail__emblem-credit';
    const sources = [[emblem.credit, emblem.source_url], ['使用條件', emblem.license_url]];
    if (emblem.usage_url) sources.push(['校方識別規範', emblem.usage_url]);
    for (const [label, url] of sources) {
      if (!/^https?:\/\//i.test(url)) continue;
      const link = document.createElement('a');
      link.href = url;
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener';
      if (credit.childNodes.length) credit.append(' · ');
      credit.append(link);
    }
    details.append(credit);
  }
  if (unit || (campusOnly && people.length)) {
    const hint = document.createElement('p');
    hint.textContent = unit
      ? `${point.building}。人員標記以系館為依據，並在圖上錯開，方便點選。`
      : '這些署名目前只對應到校區，系館位置仍待查核。';
    details.append(hint);
  }
  if (!people.length) {
    const empty = document.createElement('p');
    empty.textContent = '目前沒有署名資料可確認到這個校區。';
    details.append(empty);
  }
  if (point.address) {
    const address = document.createElement('p');
    address.textContent = point.address;
    details.append(address);
  }
  if (point.address_source_url) {
    const link = document.createElement('a');
    link.href = point.address_source_url;
    link.textContent = unit ? '系所位置來源' : '校方校區資料';
    link.target = '_blank';
    link.rel = 'noopener';
    details.append(link);
  }
  details.append(members);
  showPanel('detail');
  atlas.reveal(point, panel.getBoundingClientRect().right);
}

function showPerson(person, point, campus = null) {
  activeCampus = campus;
  const title = detailTitle(person.name);
  const body = personDetails(person, point, { showName: false });
  details.replaceChildren(title, body);
  if (roster.source_url) {
    const link = document.createElement('a');
    link.href = roster.source_url;
    link.textContent = '原站署名名單';
    link.target = '_blank';
    link.rel = 'noopener';
    details.append(link);
  }
  showPanel('detail');
  atlas.reveal(point, panel.getBoundingClientRect().right);
}

const atlas = createAtlas($('map'), people, { onCampus: showCampus, onPerson: showPerson });
const directory = mountDirectory(directoryElement, {
  onLocateUnit(point) {
    showCampus({ point, unit: point.unit, people: atlas.peopleAt(point) });
    const inset = matchMedia('(min-width: 600px)').matches ? panel.getBoundingClientRect().right / 2 : 0;
    atlas.locate(point, inset);
  },
  onLocate(entry, point) {
    const person = people.find((person) => person.section === entry.section && person.raw === entry.raw);
    if (!person) return;
    const location = locatedUnit(person, point) ?? point;
    showPerson(person, location);
    const offset = matchMedia('(min-width: 600px)').matches ? panel.getBoundingClientRect().right / 2 : 0;
    atlas.locate(location, offset);
  },
});
directory.geoList.closest('nav').hidden = true;
$('map-search').append(directory.searchForm);
directory.searchForm.addEventListener('submit', () => showPanel('directory', { focus: false }), { capture: true });
directory.searchInput.addEventListener('input', () => showPanel('directory', { focus: false }));
directory.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') showPanel('directory', { focus: false });
}, { capture: true });
open.addEventListener('click', () => {
  if (!panel.hidden && !directoryElement.hidden) closePanel();
  else showPanel('directory');
});
$('panel-close').addEventListener('click', closePanel);
back.addEventListener('click', () => {
  if (activeCampus && details.querySelector('.map-campus-people') === null) showCampus(activeCampus);
  else showPanel('directory');
});
$('reset-map').addEventListener('click', atlas.reset);
$('map-about').addEventListener('click', () => showPanel('about'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented) closePanel();
});

if (roster.source_url) $('source-link').href = roster.source_url;
$('map-totals').textContent = [
  `${number.format(people.filter((person) => person.locations.length).length)} 位已定位署名者`,
  `${number.format(people.filter((person) => person.portrait).length)} 張頭像`,
].join('・');
