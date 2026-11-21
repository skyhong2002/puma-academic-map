import counties from './counties.json';
import signatories from '../data/signatories.json';
import { createCountyMap, normalizeCounty } from './map.js';
import { mountDirectory } from './directory.js';
import { createWorldMap, overseasPeople, taiwanPeople } from './person-map.js';
import { isTaiwan, people } from './person-data.js';

// 北 → 中 → 南 → 東 → 離島，清單照一般閱讀習慣排列。
const COUNTY_ORDER = [
  '基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
  '臺中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣',
  '宜蘭縣', '花蓮縣', '臺東縣',
  '澎湖縣', '金門縣', '連江縣',
];

// 色階：縣市內可定位的署名者數。
const BINS = [
  { min: 0, max: 0, label: '0' },
  { min: 1, max: 9, label: '1–9' },
  { min: 10, max: 29, label: '10–29' },
  { min: 30, max: 59, label: '30–59' },
  { min: 60, max: Infinity, label: '60+' },
];

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('zh-TW');

/* ---------- 依機構位置計算各縣市的署名者 ---------- */

const countyCounts = new Map();
for (const person of taiwanPeople) {
  const countiesOfPerson = new Set(person.locations.filter(isTaiwan).map((place) =>
    COUNTY_ORDER.find((county) => normalizeCounty(place.city).startsWith(county))).filter(Boolean));
  for (const county of countiesOfPerson) countyCounts.set(county, (countyCounts.get(county) ?? 0) + 1);
}
const personCount = (county) => countyCounts.get(county) ?? 0;
const binOf = (county) => BINS.findIndex((bin) => personCount(county) >= bin.min && personCount(county) <= bin.max);
const describe = (county) => `${number.format(personCount(county))} 筆已定位署名`;
const NATIONAL_META = `${number.format(taiwanPeople.length)} 筆已定位署名 · ${countyCounts.size} 縣市`;

function addLocation(groups, name, person, point) {
  if (!groups.has(name)) groups.set(name, { people: new Set(), points: [] });
  const group = groups.get(name);
  group.people.add(person);
  group.points.push(point);
}

function sortedLocations(groups) {
  return [...groups].sort(([a, x], [b, y]) => y.people.size - x.people.size || a.localeCompare(b, 'zh-TW'));
}

const taiwanInstitutions = new Map();
for (const person of taiwanPeople) {
  for (const point of person.locations.filter(isTaiwan)) {
    const county = COUNTY_ORDER.find((name) => normalizeCounty(point.city).startsWith(name));
    if (!county) continue;
    if (!taiwanInstitutions.has(county)) taiwanInstitutions.set(county, new Map());
    addLocation(taiwanInstitutions.get(county), point.institution, person, point);
  }
}

function locationChip(label, count, onClick) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.className = 'chip';
  button.type = 'button';
  button.textContent = label;
  if (count != null) {
    const badge = document.createElement('span');
    badge.className = 'chip__count bin-2';
    badge.textContent = number.format(count);
    button.append(badge);
    button.setAttribute('aria-label', `${label}，${count} 筆署名`);
    button.setAttribute('aria-pressed', 'false');
  }
  button.addEventListener('click', onClick);
  item.append(button);
  return item;
}

function renderInstitutions(rail, groups, backLabel, onBack, onSelect) {
  rail.replaceChildren(locationChip(backLabel, null, onBack));
  for (const [name, group] of sortedLocations(groups)) {
    const item = locationChip(name, group.people.size, (event) => {
      for (const button of rail.querySelectorAll('[aria-pressed]')) {
        button.setAttribute('aria-pressed', String(button === event.currentTarget));
      }
      directory.setMapInstitution(name);
      onSelect(group.points);
    });
    rail.append(item);
  }
  if (!groups.size) {
    const empty = document.createElement('li');
    empty.className = 'rail__empty';
    empty.textContent = '此範圍尚無已定位機構';
    rail.append(empty);
  }
}

/* ---------- 頁首概況與來源 ---------- */

const sections = signatories.sections ?? {};
const sectionCount = (name) => sections[name]?.entries?.length ?? 0;
const stats = [
  [sectionCount('共同領銜'), '共同領銜'],
  [sectionCount('會員名單'), '會員署名'],
  [people.filter((person) => person.locations.length).length, '已定位署名者'],
  [people.filter((person) => person.portrait).length, '已收錄頭像'],
];
$('stats').replaceChildren(
  ...stats.map(([value, label]) => {
    const item = document.createElement('div');
    item.className = 'stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = number.format(value);
    item.append(dd, dt);
    return item;
  }),
);

if (signatories.source_url) $('source-link').href = signatories.source_url;
if (signatories.fetched_at) {
  const fetched = new Date(signatories.fetched_at);
  if (!Number.isNaN(fetched.getTime())) {
    const date = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }).format(fetched);
    $('source-date').textContent = `（${date} 擷取）`;
  }
}

$('legend').replaceChildren(
  ...BINS.map((bin, index) => {
    const item = document.createElement('li');
    item.className = `legend__step bin-${index}`;
    item.textContent = bin.label;
    return item;
  }),
);

/* ---------- 狀態：地圖、清單、名錄共用同一個選取縣市 ---------- */

let selected = null;
let hovered = null;

const map = createCountyMap({
  container: $('map'),
  insetContainer: $('insets'),
  geojson: counties,
  binOf,
  onHover(county) {
    hovered = county;
    renderCue();
    renderList();
  },
  onSelect: (county) => setCounty(county),
});

const known = new Set(map.counties);
const orderedCounties = [
  ...COUNTY_ORDER.filter((county) => known.has(county)),
  ...map.counties.filter((county) => !COUNTY_ORDER.includes(county)),
];

const listButtons = new Map();
const list = $('county-list');
const makeListButton = (county) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  const name = document.createElement('span');
  name.className = 'chip__name';
  name.textContent = county ?? '全臺';
  button.append(name);
  if (county) {
    const count = personCount(county);
    const badge = document.createElement('span');
    badge.className = `chip__count bin-${binOf(county)}`;
    badge.textContent = number.format(count);
    badge.setAttribute('aria-hidden', 'true');
    button.append(badge);
    button.setAttribute('aria-label', `${county}，${describe(county).replace(' · ', '、')}`);
    if (!count) button.classList.add('chip--empty');
    const enter = () => {
      hovered = county;
      map.highlight(county);
      renderCue();
    };
    const leave = () => {
      if (hovered !== county) return;
      hovered = null;
      map.highlight(null);
      renderCue();
    };
    button.addEventListener('pointerenter', enter);
    button.addEventListener('pointerleave', leave);
    button.addEventListener('focus', enter);
    button.addEventListener('blur', leave);
  } else {
    button.classList.add('chip--home');
  }
  button.addEventListener('click', () => {
    setCounty(county);
    if (county) $('county-institution-list').querySelector('button').focus({ preventScroll: true });
  });
  item.append(button);
  listButtons.set(county, button);
  return item;
};
list.replaceChildren(makeListButton(null), ...orderedCounties.map(makeListButton));

function renderList() {
  for (const [county, button] of listButtons) {
    button.setAttribute('aria-pressed', String(county === selected));
    button.classList.toggle('is-hover', county !== null && county === hovered);
  }
}

function renderCue() {
  const shown = hovered ?? selected;
  $('cue-name').textContent = shown ?? '全臺灣';
  $('cue-meta').textContent = shown ? describe(shown) : NATIONAL_META;
  $('cue').classList.toggle('is-preview', hovered !== null && hovered !== selected);
  $('cue-jump').hidden = !selected || (hovered !== null && hovered !== selected);
}

function renderCrumbs() {
  const home = $('crumb-home');
  const county = $('crumb-county');
  if (selected) home.removeAttribute('aria-current');
  else home.setAttribute('aria-current', 'true');
  home.disabled = !selected;
  $('crumb-sep').hidden = !selected;
  county.hidden = !selected;
  county.textContent = selected ?? '';
  if (selected) county.setAttribute('aria-current', 'true');
  $('reset').hidden = !selected;
  $('atlas').classList.toggle('is-drilled', Boolean(selected));
}

let directory = null;

function setCounty(value, { updateDirectory = true } = {}) {
  const normalized = value ? normalizeCounty(value) : null;
  const next = normalized && known.has(normalized) ? normalized : null;
  if (updateDirectory) directory?.setCounty(next);
  if (next === selected) {
    if (next) {
      map.refocus();
      for (const button of $('county-institution-list').querySelectorAll('[aria-pressed]')) {
        button.setAttribute('aria-pressed', 'false');
      }
    }
    return;
  }
  selected = next;
  hovered = null;
  map.select(selected);
  renderCrumbs();
  renderCue();
  renderList();

  const institutions = $('county-institution-list');
  list.hidden = Boolean(selected);
  institutions.hidden = !selected;
  $('rail-heading').textContent = selected ? `${selected}・大學與機構` : '縣市清單';
  if (selected) {
    renderInstitutions(institutions, taiwanInstitutions.get(selected) ?? new Map(), '← 全臺縣市', () => {
      const previous = selected;
      setCounty(null);
      listButtons.get(previous)?.focus();
    }, map.fitInstitution);
    institutions.scrollLeft = 0;
  }
  $('status').textContent = selected ? `已選取${selected}，${describe(selected)}。` : '已回到全臺視圖。';
}

$('crumb-home').addEventListener('click', () => setCounty(null));
$('reset').addEventListener('click', () => {
  setCounty(null);
  listButtons.get(null)?.focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !selected) return;
  // 名錄裡的搜尋框等輸入元件可能自己用 Esc，不搶。
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  setCounty(null);
});

renderCrumbs();
renderCue();
renderList();

directory = mountDirectory($('directory'), {
  onSelectCounty: (county) => setCounty(county, { updateDirectory: false }),
  onLocate(person, point) {
    const overseas = !isTaiwan(point);
    showWorld(overseas);
    $(overseas ? 'world-atlas' : 'atlas').scrollIntoView({ block: 'nearest' });
    (overseas ? worldMap : map).locate(person, point);
  },
});

let worldMap;
const overseasCountries = new Map();
const overseasInstitutions = new Map();
for (const person of overseasPeople) {
  for (const point of person.locations.filter((location) => !isTaiwan(location))) {
    addLocation(overseasCountries, point.country, person, point);
    if (!overseasInstitutions.has(point.country)) overseasInstitutions.set(point.country, new Map());
    addLocation(overseasInstitutions.get(point.country), point.institution, person, point);
  }
}

function renderWorldRail(country = null, focus = false) {
  const rail = $('world-country-list');
  $('world-rail-heading').textContent = country
    ? `${country}・大學與機構`
    : '國家與地區・依署名人數排序';
  if (country) {
    renderInstitutions(rail, overseasInstitutions.get(country), '← 全部國家與地區', () => {
      directory.setOverseasCountry(null);
      worldMap.fitCountry();
      renderWorldRail();
      [...rail.querySelectorAll('button')].find((button) => button.textContent.startsWith(country))?.focus();
    }, worldMap.fitInstitution);
    if (focus) rail.querySelector('button').focus({ preventScroll: true });
    return;
  }
  const all = locationChip('全部地區', overseasPeople.length, () => worldMap.fitCountry());
  all.firstElementChild.setAttribute('aria-pressed', 'true');
  rail.replaceChildren(all, ...sortedLocations(overseasCountries).map(([name, group]) =>
    locationChip(name, group.people.size, () => {
      directory.setOverseasCountry(name);
      worldMap.fitCountry(group.points);
      renderWorldRail(name, true);
    })));
}

function showWorld(show) {
  const wasVisible = !$('world-atlas').hidden;
  directory?.setOverseas(show);
  $('atlas').hidden = show;
  $('world-atlas').hidden = !show;
  $('world-rail').hidden = !show;
  $('atlas').parentElement.classList.toggle('atlas-column--world', show);
  list.closest('nav').hidden = show;
  $('show-taiwan').setAttribute('aria-pressed', String(!show));
  $('show-world').setAttribute('aria-pressed', String(show));
  const count = show ? overseasPeople.length : taiwanPeople.length;
  $('mapped-count').textContent = `已定位 ${number.format(count)} 筆署名`;
  if (show) {
    worldMap ??= createWorldMap($('world-map'));
    worldMap.map.invalidateSize();
    if (!wasVisible) {
      worldMap.fitCountry();
      renderWorldRail();
    }
  } else if (wasVisible) {
    const institution = $('county-institution-list').querySelector('[aria-pressed="true"]');
    if (institution) directory.setMapInstitution(institution.firstChild.textContent);
  }
}
$('show-taiwan').addEventListener('click', () => showWorld(false));
$('show-world').addEventListener('click', () => showWorld(true));
showWorld(false);
