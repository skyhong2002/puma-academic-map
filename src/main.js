import counties from './counties.json';
import signatories from '../data/signatories.json';
import { createCountyMap, normalizeCounty } from './map.js';
import { mountDirectory } from './directory.js';

const institutionFiles = import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' });

// 北 → 中 → 南 → 東 → 離島，清單照一般閱讀習慣排列。
const COUNTY_ORDER = [
  '基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
  '臺中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣',
  '宜蘭縣', '花蓮縣', '臺東縣',
  '澎湖縣', '金門縣', '連江縣',
];

// 色階：縣市內已建檔機構數，與名錄的縣市計數同一口徑。
const BINS = [
  { min: 0, max: 0, label: '0' },
  { min: 1, max: 1, label: '1' },
  { min: 2, max: 3, label: '2–3' },
  { min: 4, max: 7, label: '4–7' },
  { min: 8, max: Infinity, label: '8+' },
];

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('zh-TW');

/* ---------- 資料彙整：只算到縣市，不把署名者對應到校區 ---------- */

const institutions = Object.values(institutionFiles).flat();
const countyStats = new Map();
const statOf = (county) => {
  if (!countyStats.has(county)) countyStats.set(county, { campuses: 0, institutions: new Set() });
  return countyStats.get(county);
};
for (const institution of institutions) {
  for (const campus of institution.campuses ?? []) {
    const county = normalizeCounty(campus.county);
    if (!county) continue;
    const stat = statOf(county);
    stat.campuses += 1;
    stat.institutions.add(institution.name);
  }
}
const campusCount = (county) => countyStats.get(county)?.campuses ?? 0;
const institutionCount = (county) => countyStats.get(county)?.institutions.size ?? 0;
const binOf = (county) => BINS.findIndex((bin) => institutionCount(county) >= bin.min && institutionCount(county) <= bin.max);
const describe = (county) =>
  campusCount(county)
    ? `${number.format(institutionCount(county))} 所機構 · ${number.format(campusCount(county))} 處校區`
    : '尚無已建檔機構';

const totalCampuses = [...countyStats.values()].reduce((sum, stat) => sum + stat.campuses, 0);
const countiesWithData = [...countyStats.values()].filter((stat) => stat.campuses > 0).length;
const NATIONAL_META = `${number.format(institutions.length)} 所機構 · ${number.format(totalCampuses)} 處校區 · ${countiesWithData} 縣市`;

/* ---------- 頁首概況與來源 ---------- */

const sections = signatories.sections ?? {};
const sectionCount = (name) => sections[name]?.entries?.length ?? 0;
const stats = [
  [sectionCount('共同領銜'), '共同領銜'],
  [sectionCount('會員名單'), '會員署名'],
  [institutions.length, '已建檔機構'],
  [totalCampuses, '官方校區地址'],
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
    const count = institutionCount(county);
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
  button.addEventListener('click', () => setCounty(county));
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
  if (next === selected) return;
  selected = next;
  map.select(selected);
  renderCrumbs();
  renderCue();
  renderList();
  const button = listButtons.get(selected).getBoundingClientRect();
  const rail = list.getBoundingClientRect();
  list.scrollLeft += Math.min(0, button.left - rail.left - 16) + Math.max(0, button.right - rail.right + 16);
  $('status').textContent = selected ? `已選取${selected}，${describe(selected).replace(' · ', '、')}。` : '已回到全臺視圖。';
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

directory = mountDirectory($('directory'), { onSelectCounty: (county) => setCounty(county, { updateDirectory: false }) }) ?? null;
