// 縣市 → 機構 → 校區目錄，以及公開署名搜尋。
// 只讀 data/*.json；所有文字以 textContent 寫入，不使用 innerHTML。
import './directory.css';
import { findUnits } from './unit-locations.js';
import roster from '../data/signatories.json';
import { affiliationSources, isTaiwan, people, portraitFor } from './person-data.js';
const institutionFiles = import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' });

const COUNTY_ORDER = [
  '基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市',
  '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣',
  '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
];
const COUNTY_CODES = {
  'TW-KEE': '基隆市', 'TW-TPE': '臺北市', 'TW-NWT': '新北市', 'TW-TAO': '桃園市',
  'TW-HSZ': '新竹市', 'TW-HSQ': '新竹縣', 'TW-MIA': '苗栗縣', 'TW-TXG': '臺中市',
  'TW-CHA': '彰化縣', 'TW-NAN': '南投縣', 'TW-YUN': '雲林縣', 'TW-CYI': '嘉義市',
  'TW-CYQ': '嘉義縣', 'TW-TNN': '臺南市', 'TW-KHH': '高雄市', 'TW-PIF': '屏東縣',
  'TW-ILA': '宜蘭縣', 'TW-HUA': '花蓮縣', 'TW-TTT': '臺東縣', 'TW-PEN': '澎湖縣',
  'TW-KIN': '金門縣', 'TW-LIE': '連江縣',
};
const TYPE_LABEL = { university: '大學', research: '研究機構', regional: '大學' };
const PAGE = 40;
const SEARCH_LIMIT = 30;
const MIN_QUERY = 1;

// ---------- 資料整理 ----------

const norm = (text) => String(text ?? '').replace(/\s+/g, '').replace(/台/g, '臺').toLowerCase();

function normalizeCounty(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (COUNTY_CODES[raw.toUpperCase()]) return COUNTY_CODES[raw.toUpperCase()];
  const name = raw.replace(/台/g, '臺');
  return COUNTY_ORDER.includes(name) ? name : null;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date);
}

const institutions = Object.entries(institutionFiles).flatMap(([path, items]) => {
  const type = path.split('/').pop().replace('.json', '');
  return items.map((item) => ({ ...item, type }));
}).map((item, index) => {
  const campuses = item.campuses.map((campus, campusIndex) => ({
    ...campus,
    id: `${index}-${campusIndex}`,
    county: normalizeCounty(campus.county),
  }));
  const terms = [...new Set([item.name, ...(item.aliases || [])])];
  return {
    ...item,
    id: `inst-${index}`,
    campuses,
    counties: [...new Set(campuses.map((campus) => campus.county))],
    aliasKeys: terms.map(norm).filter(Boolean),
    searchKey: norm([item.name, ...(item.aliases || []), ...campuses.flatMap((c) => [c.name, c.county, c.address])].join('|')),
    entries: [],
  };
});
const institutionById = new Map(institutions.map((item) => [item.id, item]));

const SOURCE_URL = safeUrl(roster.source_url);
const FETCHED_AT = formatDate(roster.fetched_at);

const entries = [];
for (const [section, data] of Object.entries(roster.sections || {})) {
  (data.entries || []).forEach((row, index) => {
    const affiliationKey = norm(row.affiliation_text);
    const candidates = institutions.filter((inst) => inst.aliasKeys.some((key) => affiliationKey.includes(key)));
    const entry = {
      id: `${section}-${index}`,
      section,
      name: row.name,
      affiliation: row.affiliation_text,
      raw: row.raw,
      candidates,
      nameKey: norm(row.name),
      textKey: norm(row.raw),
    };
    candidates.forEach((inst) => inst.entries.push(entry));
    entries.push(entry);
  });
  (data.unparsed || []).forEach((raw, index) => {
    entries.push({
      id: `${section}-unparsed-${index}`,
      section,
      name: '',
      affiliation: '',
      raw: String(raw),
      unparsed: true,
      candidates: [],
      nameKey: '',
      textKey: norm(raw),
    });
  });
}
function sourcesFor(entry) {
  return affiliationSources(entry.section, entry.raw).filter((source) => source.kind !== 'support');
}

const pointsBySection = new Map();
for (const person of people) {
  if (!pointsBySection.has(person.section)) pointsBySection.set(person.section, new Map());
  pointsBySection.get(person.section).set(person.raw, person.locations);
}

const sourcedCount = entries.filter((entry) => sourcesFor(entry).length).length;
const unlocated = entries.filter((entry) => !pointsBySection.get(entry.section)?.get(entry.raw)?.length);
const matchedCount = entries.filter((entry) => entry.candidates.length > 0).length;

const countyStats = new Map();
for (const inst of institutions) {
  for (const county of inst.counties) {
    const stat = countyStats.get(county) || { institutions: new Set(), campuses: 0 };
    stat.institutions.add(inst.id);
    countyStats.set(county, stat);
  }
  for (const campus of inst.campuses) countyStats.get(campus.county).campuses += 1;
}

// ---------- DOM 小工具 ----------

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function extLink(url, label, className = 'pa-dir-link') {
  const href = safeUrl(url);
  if (!href) return h('span', { class: 'pa-dir-muted', text: `${label}（連結無效）` });
  return h('a', { class: className, href, target: '_blank', rel: 'noopener noreferrer' },
    label, h('span', { class: 'pa-dir-sr', text: '（另開新視窗）' }));
}

function highlight(text, query) {
  const value = String(text ?? '');
  const q = query.trim();
  if (!q) return value;
  const target = norm(q);
  // 逐字對照正規化後的位置，讓「台」可以命中「臺」。
  const map = [];
  let normalized = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = norm(value[i]);
    for (const c of ch) { normalized += c; map.push(i); }
  }
  const at = normalized.indexOf(target);
  if (at < 0 || !target) return value;
  const start = map[at];
  const end = map[at + target.length - 1] + 1;
  return h('span', {}, value.slice(0, start), h('mark', { text: value.slice(start, end) }), value.slice(end));
}

function searchIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'pa-dir-search-icon');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 8.5, cy: 8.5, r: 5.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 })
    .forEach(([k, v]) => circle.setAttribute(k, v));
  const path = document.createElementNS(NS, 'path');
  Object.entries({ d: 'M13 13l4.5 4.5', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })
    .forEach(([k, v]) => path.setAttribute(k, v));
  svg.append(circle, path);
  return svg;
}

function countBadge(count, unit) {
  return [
    h('span', { class: 'pa-dir-chip-count', 'aria-hidden': 'true', text: count }),
    h('span', { class: 'pa-dir-sr', text: `，${count} ${unit}` }),
  ];
}

// ---------- 主元件 ----------

export function mountDirectory(element, {
  onSelectCounty, onLocate, onLocateUnit, onSearchPerson, onSearchChange, onSearchOpen, onSearchClear, onOpenPerson,
} = {}) {
  if (!element) throw new Error('mountDirectory 需要容器元素');
  const uid = `pa-dir-${Math.random().toString(36).slice(2, 8)}`;
  const state = {
    county: null,
    overseas: false,
    overseasCountry: null,
    mapInstitution: null,
    mapInstitutionMembers: null,
    mapDepartment: null,
    groupBy: 'people',
    institution: null,
    view: 'browse', // browse | unlocated
    query: '',
    entryLimit: PAGE,
    searchLimit: SEARCH_LIMIT,
  };

  element.classList.add('pa-directory');
  element.replaceChildren();

  const header = h('h2', { class: 'pa-dir-title', id: `${uid}-title`, text: '署名者名錄' });

  // 搜尋
  const searchInput = h('input', {
    class: 'pa-dir-search-input',
    id: `${uid}-search`,
    type: 'search',
    inputmode: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '姓名、機構、別名、縣市或校區',
    'aria-describedby': `${uid}-search-hint`,
    'aria-controls': `${uid}-main`,
  });
  const clearButton = h('button', {
    type: 'button', class: 'pa-dir-search-clear', hidden: true, 'aria-label': '清除搜尋', text: '清除',
  });
  const searchForm = h('form', { class: 'pa-dir-search', role: 'search', 'aria-label': '搜尋目錄' },
    h('label', { class: 'pa-dir-sr', for: searchInput.id, text: '搜尋' }),
    h('div', { class: 'pa-dir-search-field' },
      searchIcon(), searchInput, clearButton),
    h('p', { class: 'pa-dir-sr', id: `${uid}-search-hint`, text: '可搜尋原站署名原文；按 ↓ 移到第一筆結果，Esc 清除。' }),
  );

  const geoTitle = h('h3', { class: 'rail__heading', id: 'directory-geo-heading' });
  const geoList = h('ul', { class: 'rail__list', id: 'directory-geo-list' });
  const geoRail = h('nav', { class: 'rail directory-geo', 'aria-labelledby': geoTitle.id }, geoTitle, geoList);
  const unlocatedButton = h('button', {
    type: 'button',
    class: 'pa-dir-chip pa-dir-chip-alt',
    onClick: () => {
      if (state.view === 'unlocated') selectCounty(state.county);
      else showUnlocated();
    },
  }, '尚未定位', countBadge(unlocated.length, '筆署名'));
  const live = h('p', { class: 'pa-dir-sr', role: 'status', 'aria-live': 'polite' });
  const main = h('div', { class: 'pa-dir-main', id: `${uid}-main` });
  const footer = h('footer', { class: 'pa-dir-footer' },
    h('p', {},
      '名單來源：', extLink(roster.source_url, '原始名錄'), `，擷取於 ${FETCHED_AT}。`),
    h('p', { class: 'pa-dir-muted', text: '地點為機構公開的校區地址，不代表署名者任職於該校區，也不代表機構本身表態。' }),
  );

  const peopleMode = h('button', { type: 'button', class: 'pa-dir-chip', text: '署名者',
    onClick: () => selectMode('people') });
  const institutionMode = h('button', { type: 'button', class: 'pa-dir-chip', text: '機構',
    onClick: () => selectMode('institutions') });
  const modes = h('div', { class: 'map-switch', role: 'group', 'aria-label': '名錄分類' }, peopleMode, institutionMode);
  const filters = h('div', { class: 'pa-dir-filters' }, modes, unlocatedButton);
  element.append(header, searchForm, filters, geoRail, live, main, footer);

  // ---- 事件 ----
  let searchTimer = 0;
  let compositionTimer;
  let composing = false;
  const isComposingSearch = (event) => composing || event.isComposing || event.keyCode === 229;

  function scheduleSearch() {
    onSearchChange?.(searchInput.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = searchInput.value;
      state.searchLimit = SEARCH_LIMIT;
      render({ focus: null });
    }, 120);
  }

  searchInput.addEventListener('compositionstart', () => {
    clearTimeout(compositionTimer);
    clearTimeout(searchTimer);
    composing = true;
  });
  searchInput.addEventListener('compositionend', () => {
    // Some browsers dispatch the key that confirmed the candidate after compositionend.
    compositionTimer = setTimeout(() => { composing = false; }, 0);
    scheduleSearch();
  });
  searchInput.addEventListener('input', (event) => {
    if (!isComposingSearch(event)) scheduleSearch();
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isComposingSearch(event)) return;
    onSearchOpen?.();
    clearTimeout(searchTimer);
    state.query = searchInput.value;
    render({ focus: 'first-result' });
  });
  searchInput.addEventListener('keydown', (event) => {
    if (isComposingSearch(event)) return;
    if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault();
      clearSearch();
    } else if (event.key === 'ArrowDown') {
      onSearchOpen?.();
      const first = main.querySelector('[data-result]');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  clearButton.addEventListener('click', () => { clearSearch(); searchInput.focus(); });
  main.addEventListener('keydown', (event) => {
    if (!state.query.trim()) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Escape') return;
    const items = [...main.querySelectorAll('[data-result]')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); searchInput.focus(); return; }
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) { searchInput.focus(); return; }
    const next = items[Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
  });

  function resetSearch() {
    clearTimeout(searchTimer);
    searchInput.value = '';
    state.query = '';
  }

  function clearSearch() {
    resetSearch();
    onSearchClear?.();
    render({ focus: null });
  }

  // ---- 導覽動作 ----
  function selectMode(groupBy) {
    state.groupBy = groupBy;
    state.institution = null;
    state.view = 'browse';
    state.entryLimit = PAGE;
    resetSearch();
    render({ focus: 'heading' });
  }

  function selectCounty(county, { notify = true, focus = 'heading' } = {}) {
    state.county = county;
    state.mapInstitution = null;
    state.mapDepartment = null;
    state.institution = null;
    state.view = 'browse';
    state.entryLimit = PAGE;
    resetSearch();
    render({ focus });
    if (notify && typeof onSelectCounty === 'function') onSelectCounty(county);
  }

  function selectInstitution(inst, { fromCounty } = {}) {
    const keepCounty = fromCounty ?? (state.county && inst.counties.includes(state.county) ? state.county : null);
    const countyChanged = keepCounty !== state.county;
    state.county = keepCounty;
    state.institution = inst.id;
    state.view = 'browse';
    state.entryLimit = PAGE;
    resetSearch();
    render({ focus: 'heading' });
    if (countyChanged && typeof onSelectCounty === 'function') onSelectCounty(state.county);
  }

  function showUnlocated() {
    state.view = 'unlocated';
    state.institution = null;
    state.entryLimit = PAGE;
    resetSearch();
    render({ focus: 'heading' });
  }

  // ---- 繪製 ----
  function render({ focus } = {}) {
    clearButton.hidden = !searchInput.value;
    filters.hidden = state.overseas;
    unlocatedButton.setAttribute('aria-pressed', String(state.view === 'unlocated'));
    peopleMode.setAttribute('aria-pressed', String(state.groupBy === 'people'));
    institutionMode.setAttribute('aria-pressed', String(state.groupBy === 'institutions'));
    const query = state.query.trim();
    if (query.length >= MIN_QUERY) renderSearch(query);
    else if (state.view === 'unlocated') renderUnlocated();
    else if (state.institution) renderInstitution(institutionById.get(state.institution));
    else if (state.overseas || state.groupBy === 'people') renderPeople();
    else if (state.county) renderCounty(state.county);
    else renderOverview();

    if (focus === 'heading') main.querySelector('.pa-dir-view-title')?.focus({ preventScroll: false });
    else if (focus === 'first-result') (main.querySelector('[data-result]') || searchInput).focus();
  }

  function breadcrumb(items) {
    return h('nav', { class: 'pa-dir-crumbs', 'aria-label': '目前位置' },
      h('ol', {}, items.map((item, index) => {
        const last = index === items.length - 1;
        return h('li', {}, last
          ? h('span', { 'aria-current': 'page', text: item.label })
          : h('button', { type: 'button', class: 'pa-dir-crumb', onClick: item.action, text: item.label }));
      })));
  }

  function viewTitle(text, sub) {
    return h('div', { class: 'pa-dir-view-head' },
      h('h3', { class: 'pa-dir-view-title', tabindex: '-1', text }),
      sub ? h('p', { class: 'pa-dir-view-sub', text: sub }) : null);
  }

  function institutionCard(inst, county) {
    const campuses = county ? inst.campuses.filter((c) => c.county === county) : inst.campuses;
    const others = inst.campuses.length - campuses.length;
    return h('li', { class: 'pa-dir-card' },
      h('button', {
        type: 'button',
        class: 'pa-dir-card-button',
        onClick: () => selectInstitution(inst, { fromCounty: county ?? null }),
        'aria-label': `${inst.name}，${campuses.length} 個校區${county ? `位於${county}` : ''}，${inst.entries.length} 筆署名原文提及`,
      },
      h('span', { class: 'pa-dir-card-type', text: TYPE_LABEL[inst.type] }),
      h('span', { class: 'pa-dir-card-name', text: inst.name }),
      h('span', { class: 'pa-dir-card-meta' },
        h('span', { text: campuses.map((c) => c.name).join('、') }),
        others > 0 ? h('span', { class: 'pa-dir-muted', text: ` ＋其他縣市 ${others} 處` }) : null),
      h('span', { class: 'pa-dir-card-count' },
        h('strong', { text: inst.entries.length }), ' 筆署名提及'),
      h('span', { class: 'pa-dir-card-arrow', 'aria-hidden': 'true', text: '›' })));
  }

  function locationsFor(entry) {
    const places = pointsBySection.get(entry.section)?.get(entry.raw) ?? [];
    return places.filter((place) => state.overseas ? !isTaiwan(place) : isTaiwan(place));
  }

  function renderPeople() {
    const scope = state.mapInstitution ?? (state.overseas ? state.overseasCountry ?? '海外' : state.county ?? '全部');
    const title = `${scope}${state.mapDepartment ? `・${state.mapDepartment.label}` : ''}署名者`;
    const list = entries.filter((entry) => {
      if (state.mapDepartment) return state.mapDepartment.keys.has(`${entry.section}\0${entry.raw}`);
      if (state.mapInstitution && state.mapInstitutionMembers) return state.mapInstitutionMembers.has(`${entry.section}\0${entry.raw}`);
      if (state.mapInstitution) return locationsFor(entry).some((place) =>
        place.institution === state.mapInstitution && (state.overseas
          ? place.country === state.overseasCountry
          : norm(place.city).startsWith(norm(state.county))));
      if (state.overseas) return locationsFor(entry).some((place) => !state.overseasCountry || place.country === state.overseasCountry);
      if (state.county) return locationsFor(entry).some((place) => norm(place.city).startsWith(norm(state.county)));
      return true;
    });
    main.replaceChildren(
      viewTitle(title, `共 ${list.length} 筆署名`),
      list.length ? entryList(list) : h('p', { class: 'pa-dir-muted', text: '此範圍尚無已定位的署名。可用姓名搜尋完整名單。' }),
      coverageNote(),
    );
    live.textContent = `${title}，共 ${list.length} 筆`;
  }

  function renderOverview() {
    const sorted = [...institutions].sort((a, b) => b.entries.length - a.entries.length);
    main.replaceChildren(
      viewTitle('全部機構', `已收錄 ${institutions.length} 所機構、${institutions.reduce((n, i) => n + i.campuses.length, 0)} 處校區。點選縣市或機構查看校區地址與署名原文。`),
      h('ul', { class: 'pa-dir-cards', role: 'list' }, sorted.map((inst) => institutionCard(inst, null))),
      coverageNote(),
    );
    live.textContent = `顯示全部 ${institutions.length} 所機構`;
  }

  function renderCounty(county) {
    const list = institutions
      .filter((inst) => inst.counties.includes(county))
      .sort((a, b) => b.entries.length - a.entries.length);
    const crumbs = breadcrumb([{ label: '全部縣市', action: () => selectCounty(null) }, { label: county }]);
    if (!list.length) {
      main.replaceChildren(crumbs, viewTitle(county),
        h('div', { class: 'pa-dir-empty' },
          h('p', { text: '這個縣市目前沒有已查核的機構校區。' }),
          h('p', { class: 'pa-dir-muted', text: '名單中仍可能有在此任職的署名者，可用上方搜尋查找原文。' })));
      live.textContent = `${county}尚無已收錄機構`;
      return;
    }
    const campusCount = list.reduce((n, inst) => n + inst.campuses.filter((c) => c.county === county).length, 0);
    main.replaceChildren(crumbs,
      viewTitle(county, `${list.length} 所機構、${campusCount} 處校區位於${county}。署名數為原文提及該機構的筆數，不分校區。`),
      h('ul', { class: 'pa-dir-cards', role: 'list' }, list.map((inst) => institutionCard(inst, county))));
    live.textContent = `${county}：${list.length} 所機構`;
  }

  function renderInstitution(inst) {
    if (!inst) { state.institution = null; renderOverview(); return; }
    const county = state.county;
    const crumbs = [{ label: '全部縣市', action: () => selectCounty(null) }];
    if (county) crumbs.push({ label: county, action: () => selectCounty(county) });
    crumbs.push({ label: inst.name });

    const campusList = h('ul', { class: 'pa-dir-campuses', role: 'list' },
      [...inst.campuses]
        .sort((a, b) => (b.county === county) - (a.county === county))
        .map((campus) => h('li', { class: `pa-dir-campus${county && campus.county !== county ? ' is-elsewhere' : ''}` },
          h('div', { class: 'pa-dir-campus-head' },
            h('span', { class: 'pa-dir-campus-name', text: campus.name }),
            h('button', {
              type: 'button',
              class: 'pa-dir-tag',
              onClick: () => selectCounty(campus.county),
              'aria-label': `查看${campus.county}的機構`,
              text: campus.county,
            })),
          h('p', { class: 'pa-dir-address' }, h('span', { class: 'pa-dir-sr', text: '地址：' }), campus.address),
          h('p', { class: 'pa-dir-campus-source' }, extLink(campus.source_url, '官方地址來源')))));

    const aliasBlock = (inst.aliases || []).length
      ? h('div', { class: 'pa-dir-aliases' },
        h('h4', { text: '比對用別名' }),
        h('p', { class: 'pa-dir-muted', text: '署名原文出現以下寫法時，會列為此機構的候選；別名不等於確認任職。' }),
        h('ul', { class: 'pa-dir-alias-list', role: 'list' }, inst.aliases.map((alias) => h('li', { text: alias }))))
      : null;

    main.replaceChildren(
      breadcrumb(crumbs),
      viewTitle(inst.name, `${TYPE_LABEL[inst.type]} · ${inst.campuses.length} 處校區 · 資料查核於 ${inst.checked_on}`),
      h('p', { class: 'pa-dir-links' }, extLink(inst.official_url, '機構官方網站')),
      h('section', { class: 'pa-dir-section', 'aria-labelledby': `${uid}-campus-h` },
        h('h4', { id: `${uid}-campus-h`, text: '校區與官方地址' }),
        campusList),
      aliasBlock,
      h('section', { class: 'pa-dir-section', 'aria-labelledby': `${uid}-entries-h` },
        h('h4', { id: `${uid}-entries-h`, text: `原文提及此機構的署名（${inst.entries.length} 筆）` }),
        h('p', { class: 'pa-dir-notice' },
          h('strong', { text: '機構候選，未經查核。' }),
          '以下依名稱比對列出，原文可能是兼任、前任或其他單位；署名者沒有對應到特定校區，也不代表機構表態。'),
        entryList(inst.entries, { exclude: inst.id })),
    );
    live.textContent = `${inst.name}：${inst.campuses.length} 處校區、${inst.entries.length} 筆署名提及`;
  }

  function renderUnlocated() {
    main.replaceChildren(
      breadcrumb([{ label: '全部縣市', action: () => selectCounty(null) }, { label: '尚未定位' }]),
      viewTitle('尚未定位的署名', `${unlocated.length} 筆署名目前尚無可用的機構座標。條目仍可搜尋，已有的學術關係來源也可查閱。`),
      entryList(unlocated),
    );
    live.textContent = `${unlocated.length} 筆尚未定位的署名`;
  }

  function entryList(list, { exclude, query = '' } = {}) {
    const shown = list.slice(0, state.entryLimit);
    const wrap = h('div', { class: 'pa-dir-entries-wrap' },
      h('ol', { class: 'pa-dir-entries', role: 'list' }, shown.map((entry) => entryItem(entry, { exclude, query }))));
    if (list.length > shown.length) {
      wrap.append(h('button', {
        type: 'button',
        class: 'pa-dir-more',
        onClick: (event) => {
          const nextIndex = shown.length;
          state.entryLimit += PAGE;
          const fresh = entryList(list, { exclude, query });
          event.currentTarget.closest('.pa-dir-entries-wrap').replaceWith(fresh);
          fresh.querySelectorAll('.pa-dir-entry-head')[nextIndex]?.focus();
        },
        text: `再顯示 ${Math.min(PAGE, list.length - shown.length)} 筆（共 ${list.length} 筆）`,
      }));
    }
    return wrap;
  }

  function entryItem(entry, { exclude, query = '', result = false } = {}) {
    const candidates = entry.candidates.filter((inst) => inst.id !== exclude);
    const sources = sourcesFor(entry);
    const support = affiliationSources(entry.section, entry.raw).filter((source) => source.kind === 'support');
    const portrait = portraitFor(entry.section, entry.raw);
    const places = pointsBySection.get(entry.section)?.get(entry.raw) ?? [];
    const name = entry.name || '（未解析條目）';
    return h('li', { class: 'pa-dir-entry' },
      h('details', {},
        h('summary', {
          class: 'pa-dir-entry-head',
          dataset: result ? { result: '' } : {},
          onClick: result && places.length ? () => onSearchPerson?.(entry) : null,
        },
          portrait ? h('img', { class: 'pa-dir-portrait', src: portrait.image, alt: '', loading: 'lazy', width: '28', height: '28' }) : null,
          h('span', { class: 'pa-dir-entry-name', title: name }, highlight(name, query)),
          entry.affiliation ? h('span', { class: 'pa-dir-entry-affiliation' }, highlight(entry.affiliation, query)) : null,
          h('span', { class: `pa-dir-section-tag${entry.section === '共同領銜' ? ' is-lead' : ''}`, text: entry.section })),
        h('div', { class: 'pa-dir-entry-body' },
          h('p', { class: 'pa-dir-entry-raw' }, highlight(entry.affiliation || entry.raw, query)),
          onOpenPerson ? h('button', { type: 'button', class: 'pa-dir-cand',
            onClick: (event) => onOpenPerson(entry, event.currentTarget), text: '開啟人物與留言板',
            'aria-label': `開啟 ${name} 的人物資料與留言板`,
          }) : null,
          places.length ? h('ul', { class: 'pa-dir-entry-places' }, places.map((place) => h('li', {},
            h('button', { type: 'button', class: 'pa-dir-cand',
              onClick: () => onLocate?.(entry, place),
              text: [place.institution, place.campus, place.city, place.country].filter(Boolean).join(' · '),
              'aria-label': `在地圖定位 ${entry.name}，${[place.institution, place.campus, place.city].filter(Boolean).join(' · ')}`,
            })))) : null,
          !places.length ? h('p', { class: 'pa-dir-entry-note', text: '尚未取得可對應的機構座標。' }) : null,
          candidates.length
            ? h('div', { class: 'pa-dir-entry-cands' },
              h('span', { class: 'pa-dir-muted', text: exclude ? '其他機構候選：' : '機構候選（未查核）：' }),
              candidates.map((inst) => h('button', {
                type: 'button',
                class: 'pa-dir-cand',
                onClick: () => selectInstitution(inst),
                text: inst.name,
              })))
            : null,
          h('div', { class: 'pa-dir-affiliation-sources' },
            h('strong', { text: `學術單位查核來源${sources.length ? `（${sources.length}）` : ''}` }),
            sources.length
              ? h('ul', {}, sources.map((source) => h('li', {},
                extLink(source.url, source.label), '，', source.description)))
              : h('p', { class: 'pa-dir-muted', text: '待補可核對此人的公開來源。' })),
          support.length ? h('div', { class: 'pa-dir-affiliation-sources' },
            h('strong', { text: '相關公開活動' }),
            h('ul', {}, support.map((source) => h('li', {},
              extLink(source.url, source.label), '，', source.description)))) : null,
          portrait ? h('p', { class: 'pa-dir-entry-source' },
            extLink(portrait.source_url, '照片來源'), '，', portrait.credit,
            portrait.license_url ? [' · ', extLink(portrait.license_url, '授權條款')] : null) : null,
          SOURCE_URL ? h('p', { class: 'pa-dir-entry-source' }, extLink(SOURCE_URL, '原站名單')) : null)));
  }

  function renderSearch(query) {
    const q = norm(query);
    const instHits = institutions
      .map((inst) => {
        const nameHit = inst.aliasKeys.some((key) => key.includes(q));
        const placeHit = !nameHit && inst.searchKey.includes(q);
        return { inst, score: nameHit ? 2 : placeHit ? 1 : 0 };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.inst.entries.length - a.inst.entries.length);

    const countyHits = COUNTY_ORDER.filter((county) => norm(county).includes(q));

    // 署名：姓名命中優先，再來是原文命中。不依縣市或校區推論個人位置。
    const nameHits = [];
    const textHits = [];
    for (const entry of entries) {
      if (entry.nameKey && entry.nameKey.includes(q)) nameHits.push(entry);
      else if (entry.textKey.includes(q)) textHits.push(entry);
    }
    nameHits.sort((a, b) => (a.nameKey === q ? -1 : 0) - (b.nameKey === q ? -1 : 0));
    const people = [...nameHits, ...textHits];
    const shownPeople = people.slice(0, state.searchLimit);

    const unitHits = findUnits(query);
    const total = unitHits.length + instHits.length + countyHits.length + people.length;
    const nodes = [viewTitle(`「${query}」的搜尋結果`, total ? `${unitHits.length} 個系所、${countyHits.length} 個縣市、${instHits.length} 所機構、${people.length} 筆署名` : null)];

    if (!total) {
      nodes.push(h('div', { class: 'pa-dir-empty' },
        h('p', { text: '找不到符合的縣市、機構、系所或署名。' }),
        h('p', { class: 'pa-dir-muted', text: '可試著只輸入姓名的一部分，或改用機構簡稱（例如「臺大」「中研院」）。' })));
    }

    if (unitHits.length) {
      nodes.push(h('section', { class: 'pa-dir-section', 'aria-label': '已查核位置的系所' },
        h('h4', { text: '已查核位置的系所' }),
        h('ul', { class: 'pa-dir-results', role: 'list' }, unitHits.map((point) => h('li', {},
          h('button', { type: 'button', class: 'pa-dir-result', dataset: { result: '' },
            onClick: () => onLocateUnit?.(point) },
            h('span', { class: 'pa-dir-result-name', text: point.unit }),
            h('span', { class: 'pa-dir-muted', text: `${point.institution}・${point.building}` })))))));
    }

    if (countyHits.length) {
      nodes.push(h('section', { class: 'pa-dir-section', 'aria-label': '縣市' },
        h('h4', { text: '縣市' }),
        h('ul', { class: 'pa-dir-result-chips', role: 'list' }, countyHits.map((county) => h('li', {},
          h('button', {
            type: 'button',
            class: 'pa-dir-chip',
            dataset: { result: '' },
            onClick: () => selectCounty(county),
          }, county, countBadge(countyStats.get(county)?.institutions.size ?? 0, '所機構')))))));
    }

    if (instHits.length) {
      nodes.push(h('section', { class: 'pa-dir-section', 'aria-label': '機構' },
        h('h4', { text: '機構' }),
        h('ul', { class: 'pa-dir-results', role: 'list' }, instHits.map(({ inst, score }) => {
          const matchedAlias = (inst.aliases || []).find((alias) => norm(alias).includes(q));
          const matchedCampus = score === 1 ? inst.campuses.find((c) => norm([c.name, c.county, c.address].join('|')).includes(q)) : null;
          return h('li', {}, h('button', {
            type: 'button',
            class: 'pa-dir-result',
            dataset: { result: '' },
            onClick: () => selectInstitution(inst),
          },
          h('span', { class: 'pa-dir-result-name' }, highlight(inst.name, query)),
          h('span', { class: 'pa-dir-result-meta' },
            matchedAlias && !norm(inst.name).includes(q) ? h('span', {}, '別名：', highlight(matchedAlias, query), ' · ') : null,
            matchedCampus
              ? h('span', {}, highlight(`${matchedCampus.name}｜${matchedCampus.address}`, query))
              : h('span', { text: inst.counties.join('、') }),
            h('span', { text: ` · ${inst.entries.length} 筆署名提及` }))));
        }))));
    }

    if (people.length) {
      const section = h('section', { class: 'pa-dir-section', 'aria-label': '署名' },
        h('h4', { text: `署名（${people.length} 筆）` }),
        h('p', { class: 'pa-dir-muted pa-dir-small', text: '搜尋姓名與原站署名原文；機構候選由名稱比對產生，未經查核，也不代表任職校區。' }),
        h('ol', { class: 'pa-dir-entries', role: 'list' }, shownPeople.map((entry) => entryItem(entry, { query, result: true }))));
      if (people.length > shownPeople.length) {
        section.append(h('button', {
          type: 'button',
          class: 'pa-dir-more',
          onClick: () => {
            const nextIndex = shownPeople.length;
            state.searchLimit += SEARCH_LIMIT;
            render();
            main.querySelectorAll('.pa-dir-entry-head')[nextIndex]?.focus();
          },
          text: `再顯示 ${Math.min(SEARCH_LIMIT, people.length - shownPeople.length)} 筆`,
        }));
      }
      nodes.push(section);
    }

    main.replaceChildren(...nodes);
    live.textContent = total ? `找到 ${unitHits.length} 個系所、${countyHits.length} 個縣市、${instHits.length} 所機構、${people.length} 筆署名` : '沒有符合的結果';
  }

  function coverageNote() {
    return h('aside', { class: 'pa-dir-coverage' },
      h('h4', { text: '統計口徑' }),
      h('ul', {},
        h('li', { text: `原站共 ${entries.length} 筆署名，其中 ${matchedCount} 筆的原文含已收錄機構名稱或別名。` }),
        h('li', { text: '同一筆署名可能同時提及多個機構，因此各機構的提及數相加會超過署名總數。' }),
        h('li', { text: `${unlocated.length} 筆尚未加入地圖，可在「尚未定位」查看。` }),
        h('li', { text: `已有 ${sourcedCount} / ${entries.length} 筆附學術單位查核來源。每則來源的查核範圍見連結說明。` }),
        h('li', { text: '同名署名者分開列出，不合併。' })));
  }

  render();

  return {
    geoTitle,
    geoList,
    searchForm,
    searchInput,
    isComposingSearch,
    setMapInstitution(institution, members) {
      state.mapInstitution = institution;
      state.mapInstitutionMembers = members
        ? new Set(members.map(({ person }) => `${person.section}\0${person.raw}`)) : null;
      state.mapDepartment = null;
      state.groupBy = 'people';
      state.institution = null;
      state.view = 'browse';
      state.entryLimit = PAGE;
      resetSearch();
      render();
    },
    setMapDepartment(department) {
      state.mapDepartment = department ? {
        label: department.label,
        keys: new Set(department.entries.map(({ person }) => `${person.section}\0${person.raw}`)),
      } : null;
      state.groupBy = 'people';
      state.institution = null;
      state.view = 'browse';
      state.entryLimit = PAGE;
      resetSearch();
      render();
    },
    setOverseasCountry(country) {
      state.mapInstitution = null;
      state.mapDepartment = null;
      state.overseasCountry = country;
      state.entryLimit = PAGE;
      resetSearch();
      render();
    },
    setOverseas(value) {
      if (value === state.overseas) return;
      state.overseas = value;
      state.mapInstitution = null;
      state.mapDepartment = null;
      state.overseasCountry = null;
      state.institution = null;
      state.view = 'browse';
      state.entryLimit = PAGE;
      resetSearch();
      render({ focus: null });
    },
    setCounty(countyOrNull) {
      const county = normalizeCounty(countyOrNull);
      if (county === state.county && state.view === 'browse' && !state.institution && !state.mapInstitution && !searchInput.value && !state.query) return;
      selectCounty(county, { notify: false, focus: null });
    },
  };
}
