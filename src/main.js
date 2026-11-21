import { emblemFor, emblemImage } from './emblems.js';
import { locatedUnit } from './unit-locations.js';
import roster from '../data/signatories.json';
import { createAtlas, pointKey } from './atlas.js';
import { mountDirectory } from './directory.js';
import { people } from './person-data.js';
import { personDetails } from './person-map.js';
import { commentBoardId } from './comment-board-id.js';
import { personComments } from './person-comments.js';
import { track } from './analytics.js';

const $ = (id) => document.getElementById(id);
const panel = $('map-panel');
const details = $('place-details');
const directoryElement = $('directory');
const overview = $('map-overview');
const about = $('about-map');
const publicComments = $('public-comments');
const publicList = $('public-comments-list');
const publicStatus = $('public-comments-status');
const publicMore = $('public-comments-more');
const panelToggle = $('panel-toggle');
const panelBack = $('panel-back');
const aboutButton = $('map-about');
const panelContent = $('panel-content');
const mapApp = panel.closest('.map-app');
const narrowLayout = matchMedia('(width < 720px)');
const toolbar = mapApp.querySelector('.map-toolbar');
const number = new Intl.NumberFormat('zh-TW');
let returnFocus;
let panelDetail;
let nextPublicCursor;
let loadingPublicComments = false;
let peopleByBoard;
let panelAncestors = [];
let panelView = 'directory';
let collapsedScrollTop = 0;
let pendingReveal;
let sheetDrag;
let sheetFrame;
let sheetSnap;
let suppressHandleClick = false;

function updateViewExpanded(expanded) {
  aboutButton.setAttribute('aria-expanded', String(expanded && panelView === 'about'));
}

function setPanelExpanded(expanded) {
  panel.hidden = !expanded;
  panel.inert = !expanded;
  mapApp.classList.toggle('is-panel-open', expanded);
  if (!expanded) pendingReveal = undefined;
  updateViewExpanded(expanded);
  panelToggle.setAttribute('aria-expanded', String(expanded));
  panelToggle.querySelector('.map-panel-toggle__arrow').textContent = expanded ? '‹' : '›';
  panelToggle.title = expanded ? '收合資訊面板' : '展開資訊面板';
  panelToggle.setAttribute('aria-label', panelToggle.title);
  atlas.resize();
}

function showPanel(view, { focus = true, restoreScroll = false } = {}) {
  if (panel.hidden && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
  panelView = view;
  directoryElement.hidden = view !== 'directory';
  overview.hidden = directoryElement.hidden;
  details.hidden = view !== 'detail';
  about.hidden = view !== 'about';
  publicComments.hidden = view !== 'comments';
  if (view === 'comments' && nextPublicCursor === undefined) loadPublicComments();
  if (panel.hidden) setPanelExpanded(true);
  else updateViewExpanded(true);
  if (restoreScroll) panelContent.scrollTop = collapsedScrollTop;
  if (focus) {
    if (!restoreScroll) panelContent.scrollTop = 0;
    panel.querySelector('#panel-content > section:not([hidden]) h2')?.focus({ preventScroll: true });
  }
}

function setSheetTall(tall) {
  mapApp.classList.toggle('is-sheet-tall', tall);
}

function closePanel({ focusTarget = returnFocus } = {}) {
  clearSheetDrag(narrowLayout.matches);
  if (panel.hidden) return;
  collapsedScrollTop = panelContent.scrollTop;
  setPanelExpanded(false);
  setSheetTall(false);
  (focusTarget?.isConnected && focusTarget.getClientRects().length ? focusTarget : panelToggle).focus({ preventScroll: true });
}

function locateAfterPanelResize(point, person) {
  const locate = () => atlas.locate(point, person);
  const request = {};
  pendingReveal = request;
  locate();
  const transitions = mapApp.getAnimations().filter(({ transitionProperty }) =>
    transitionProperty === 'grid-template-columns' || transitionProperty === 'grid-template-rows');
  if (!transitions.length) {
    pendingReveal = undefined;
    return;
  }
  Promise.allSettled(transitions.map((transition) => transition.finished)).then(() => {
    if (pendingReveal !== request || panel.hidden) return;
    pendingReveal = undefined;
    atlas.resize();
    locate();
  });
}

function detailTitle(text) {
  const title = document.createElement('h2');
  title.tabIndex = -1;
  title.textContent = text;
  return title;
}

function showCampus(campus, { restoring = false, fromParent = false } = {}) {
  if (campus.campusOnly && !campus.point.unit) campus = atlas.resolveCampus(campus.point) ?? campus;
  if (!restoring) rememberParent({ fromRoot: !fromParent });
  if (!restoring) track('view_academic_location');
  const { point, people, unit, campusOnly } = campus;
  panelDetail = { type: 'campus', point: pointKey(point), campusOnly };
  atlas.select(point);
  const school = [point.institution, point.campus].filter(Boolean).join('・');
  const title = detailTitle(unit ?? school);
  const sub = document.createElement('p');
  sub.className = 'map-detail__place';
  sub.textContent = [unit ? school : null, point.city, point.country, `${number.format(people.length)} 筆署名`].filter(Boolean).join('・');
  const members = document.createElement('ul');
  members.className = 'map-campus-people';
  for (const person of people) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => showPerson(person, point, { fromParent: true }));
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
    const affiliation = document.createElement('span');
    affiliation.className = 'map-campus-people__affiliation';
    affiliation.textContent = person.affiliation_text;
    label.append(name, affiliation);
    button.append(label);
    item.append(button);
    members.append(item);
  }
  details.replaceChildren(title, sub);
  const emblem = emblemFor(point.institution);
  if (emblem) {
    title.classList.add('map-detail__institution');
    title.prepend(emblemImage(emblem));
  }
  if (!unit) {
    const campuses = atlas.campusesFor(point.institution);
    if (campuses.length > 1) {
      const select = document.createElement('select');
      select.className = 'map-campus-select';
      select.setAttribute('aria-label', '切換校區');
      for (const campus of campuses) {
        const option = document.createElement('option');
        option.value = pointKey(campus.point);
        option.textContent = campus.point.campus || campus.point.city || campus.point.institution;
        option.selected = option.value === pointKey(point);
        select.append(option);
      }
      select.addEventListener('change', () => {
        const next = campuses.find((campus) => pointKey(campus.point) === select.value);
        if (next) showCampus(next, { fromParent: true });
      });
      details.append(select);
    }
  }
  if (unit || (campusOnly && people.length)) {
    const hint = document.createElement('p');
    hint.textContent = unit
      ? `${point.building}。人員標記以系館為依據，並在圖上錯開，方便點選。`
      : '這些署名目前只對應到校區，系館位置仍待查核。';
    details.append(hint);
  }
  if ((campusOnly || (unit && atlas.canExpandUnit(point))) && people.length) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'map-campus-zoom';
    expand.textContent = `在地圖展開 ${number.format(people.length)} 人`;
    expand.addEventListener('click', () => {
      closePanel({ focusTarget: panelToggle });
      atlas.expandCampus(point);
    });
    details.append(expand);
  }
  if (!people.length) {
    const empty = document.createElement('p');
    empty.textContent = '目前沒有署名資料可確認到這個校區。';
    details.append(empty);
  }
  details.append(members);
  showPanel('detail', { focus: !restoring });
  if (!restoring) {
    if (narrowLayout.matches) setSheetTall(false);
    locateAfterPanelResize(point);
  }
}

function primaryPersonPoint(person, county, institution) {
  const available = person.locations;
  const matching = available.filter((point) => (!county || point.city === county) && (!institution || point.institution === institution));
  const locations = matching.length ? matching : available;
  return locations.map((point) => locatedUnit(person, point)).find(Boolean) ?? locations[0];
}

function showPerson(person, point, { restoring = false, tall = false, fromParent = false, replace = false } = {}) {
  if (!restoring) {
    if (!replace) rememberParent({ fromRoot: !fromParent });
    point = point ? locatedUnit(person, point) ?? point : primaryPersonPoint(person);
  }
  panelDetail = { type: 'person', point: point && pointKey(point), person: personRef(person) };
  atlas.select(point, person);
  const body = personDetails(person, point, {
    heading: true,
    onLocate: point && (() => {
      if (narrowLayout.matches) setSheetTall(false);
      locateAfterPanelResize(point, person);
    }),
  });
  const verifiedLocations = new Map(person.locations.map((location) => {
    const precise = locatedUnit(person, location) ?? location;
    return [pointKey(precise), precise];
  }));
  if (point) verifiedLocations.set(pointKey(point), point);
  if (verifiedLocations.size > 1) {
    const select = document.createElement('select');
    select.className = 'map-campus-select';
    select.setAttribute('aria-label', '切換定位地點');
    for (const [key, location] of verifiedLocations) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = [location.institution, location.campus, location.building, location.city].filter(Boolean).join('・');
      option.selected = Boolean(point && key === pointKey(point));
      select.append(option);
    }
    select.addEventListener('change', () => {
      const selected = verifiedLocations.get(select.value);
      if (!selected) return;
      showPerson(person, selected, { replace: true });
      details.querySelector('.map-campus-select')?.focus({ preventScroll: true });
    });
    body.querySelector('.map-detail__place')?.after(select);
  }
  const references = document.createElement('details');
  references.className = 'map-detail__references';
  const summary = document.createElement('summary');
  summary.textContent = '參考資料';
  references.append(summary);
  const sources = body.querySelector('.map-detail__sources');
  if (sources) references.append(sources);
  if (roster.source_url) {
    const link = document.createElement('a');
    link.href = roster.source_url;
    link.textContent = '原站署名名單';
    link.target = '_blank';
    link.rel = 'noopener';
    references.append(link);
  }
  details.replaceChildren(body, personComments(person, point));
  if (references.childElementCount > 1) details.append(references);
  showPanel('detail', { focus: !restoring });
  if (tall) setSheetTall(true);
  if (!restoring && point) locateAfterPanelResize(point, person);
}

const atlas = createAtlas($('map'), people, {
  onCampus: showCampus,
  onCampusZoom: dismissDetails,
  onPerson: showPerson,
  preserveResizeOrigin: () => Boolean(sheetSnap),
});
const findPerson = (entry) => people.find((person) => person.section === entry.section && person.raw === entry.raw);
let searchTracked = false;
const directory = mountDirectory(directoryElement, {
  onBeforeNavigate({ fromRoot, home, replace } = {}) {
    if (home) clearAncestors();
    else if (!replace) rememberParent({ fromRoot });
  },
  onSearchClear: () => showHomePanel({ focus: false }),
  onSearchChange(query) {
    atlas.select();
    if (!searchTracked && query.trim()) {
      searchTracked = true;
      track('use_directory_search');
    }
    showPanel('directory', { focus: false });
  },
  onSearchOpen() {
    if (panelView === 'directory') return;
    if (directory.searchInput.value.trim()) {
      rememberParent({ fromRoot: true });
      showPanel('directory', { focus: false });
    } else {
      showHomePanel({ focus: false });
    }
  },
  onOpenInstitution(institution, county) {
    const campuses = atlas.campusesFor(institution);
    const campus = (county && campuses.find(({ point }) => point.city === county)) || campuses[0];
    if (!campus) return false;
    if (!campuses.some(({ people }) => people.length)) {
      locateAfterPanelResize(campus.point);
      return false;
    }
    showCampus(campus, { fromParent: true });
    return true;
  },
  onOpenPerson(entry, county, institution) {
    const person = findPerson(entry);
    if (!person) return;
    showPerson(person, primaryPersonPoint(person, county, institution), { fromParent: true });
  },
  onLocateUnit(point) {
    showCampus({ point, unit: point.unit, people: atlas.peopleAt(point) }, { fromParent: true });
  },
});
const homeDirectory = directory.snapshot();
directoryElement.querySelector('h2').tabIndex = -1;
directory.geoList.closest('nav').hidden = true;
directory.searchInput.placeholder = '搜尋姓名、機構或系所';
$('map-search').append(directory.searchForm);
panelToggle.addEventListener('click', (event) => {
  if (event.detail && suppressHandleClick) return;
  if (panel.hidden) showPanel(panelView, { focus: narrowLayout.matches || event.detail === 0, restoreScroll: true });
  else closePanel({ focusTarget: panelToggle });
});
panelToggle.addEventListener('keydown', (event) => {
  if (!narrowLayout.matches || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowUp') {
    if (panel.hidden) showPanel(panelView, { focus: false, restoreScroll: true });
    else setSheetTall(true);
  } else if (mapApp.classList.contains('is-sheet-tall')) {
    setSheetTall(false);
  } else closePanel({ focusTarget: panelToggle });
});
panelToggle.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  suppressHandleClick = false;
  if (!narrowLayout.matches) return;
  sheetDrag = {
    id: event.pointerId, start: event.clientY, closed: panel.hidden,
    height: panel.offsetHeight, delta: 0,
  };
  panelToggle.setPointerCapture(event.pointerId);
});
panelToggle.addEventListener('pointermove', (event) => {
  if (sheetDrag?.id !== event.pointerId) return;
  sheetDrag.delta = sheetDrag.start - event.clientY;
  if (!suppressHandleClick && Math.abs(sheetDrag.delta) < 8) return;
  suppressHandleClick = true;
  if (sheetDrag.closed && panel.hidden && sheetDrag.delta <= 0) return;
  if (!mapApp.classList.contains('is-sheet-dragging')) {
    mapApp.style.setProperty('--sheet-fixed-height', '0px');
    updateSheetDrag();
    mapApp.classList.add('is-sheet-dragging');
    // Keep the full map behind the sheet and preserve its visible origin.
    atlas.resize({ pan: false, debounceMoveend: true });
    if (panel.hidden) showPanel(panelView, { focus: false, restoreScroll: true });
    return;
  }
  if (sheetFrame === undefined) sheetFrame = requestAnimationFrame(updateSheetDrag);
});

function updateSheetDrag() {
  sheetFrame = undefined;
  const height = `clamp(var(--sheet-closed-height), ${sheetDrag.height + sheetDrag.delta}px, var(--sheet-max-height))`;
  mapApp.style.setProperty('--sheet-drag-height', height);
}

function clearSheetDrag(settle = false) {
  if (!sheetDrag) return;
  const { id } = sheetDrag;
  cancelAnimationFrame(sheetFrame);
  sheetFrame = undefined;
  const settling = settle && mapApp.classList.contains('is-sheet-dragging');
  if (settling) {
    updateSheetDrag();
    // Match the real grid row to the overlay before animating to a snap point.
    mapApp.style.setProperty('--sheet-fixed-height', `${panel.offsetHeight}px`);
    mapApp.classList.add('is-sheet-settling');
  }
  sheetDrag = undefined;
  mapApp.classList.remove('is-sheet-dragging');
  mapApp.style.removeProperty('--sheet-drag-height');
  if (settling) {
    const snap = {};
    sheetSnap = snap;
    atlas.resize({ debounceMoveend: true });
    mapApp.classList.remove('is-sheet-settling');
    requestAnimationFrame(async () => {
      const transition = mapApp.getAnimations().find((animation) => animation.transitionProperty === 'grid-template-rows');
      if (transition) await transition.finished.catch(() => {});
      if (sheetSnap === snap) sheetSnap = undefined;
    });
  }
  mapApp.style.removeProperty('--sheet-fixed-height');
  if (panelToggle.hasPointerCapture(id)) panelToggle.releasePointerCapture(id);
}
function endSheetDrag(event) {
  if (sheetDrag?.id !== event.pointerId) return;
  const { closed, delta, height } = sheetDrag;
  const dropped = event.type === 'pointerup' && narrowLayout.matches;
  clearSheetDrag(narrowLayout.matches);
  if (!suppressHandleClick || panel.hidden) return;
  if (closed) {
    if (!dropped || delta < 32) closePanel({ focusTarget: panelToggle });
    else if (delta > mapApp.clientHeight * 0.55) setSheetTall(true);
    return;
  }
  if (!dropped) return;
  if (delta > 32) setSheetTall(true);
  if (delta < -32) {
    if (mapApp.classList.contains('is-sheet-tall') && height + delta > height * 0.4) setSheetTall(false);
    else closePanel({ focusTarget: panelToggle });
  }
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  panelToggle.addEventListener(type, endSheetDrag);
}
function updateHandleShortcuts() {
  if (narrowLayout.matches) panelToggle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
  else panelToggle.removeAttribute('aria-keyshortcuts');
}
updateHandleShortcuts();
narrowLayout.addEventListener('change', () => {
  updateHandleShortcuts();
  if (!sheetDrag) return;
  if (sheetDrag.closed) closePanel({ focusTarget: panelToggle });
  else clearSheetDrag();
});
new ResizeObserver(() => {
  mapApp.style.setProperty('--sheet-toolbar-height', `${toolbar.offsetHeight}px`);
}).observe(toolbar);
function dismissDetails() {
  if (panelView !== 'detail') return;
  closePanel({ focusTarget: panelToggle });
  panelView = 'directory';
  directory.restore(homeDirectory);
  clearAncestors();
  collapsedScrollTop = 0;
}
$('reset-map').addEventListener('click', () => {
  dismissDetails();
  pendingReveal = undefined;
  atlas.reset();
});
aboutButton.addEventListener('click', () => {
  if (!panel.hidden && !about.hidden) closePanel({ focusTarget: aboutButton });
  else {
    rememberParent({ fromRoot: true });
    showPanel('about');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented && !directory.isComposingSearch(event)) closePanel();
});

if (roster.source_url) $('source-link').href = roster.source_url;
for (const link of document.querySelectorAll('#about-map a[href^="https://forms.gle/"]')) {
  link.addEventListener('click', () => track('click_signup_link'));
}
const locatedCount = people.filter((person) => person.locations.length).length;
$('map-totals').textContent = `${number.format(locatedCount)} 位已定位署名者`;
$('overview-leads').textContent = number.format(roster.sections['共同領銜'].source_rows);
$('overview-members').textContent = number.format(roster.sections['會員名單'].source_rows);
$('overview-located').textContent = number.format(locatedCount);
const commentTotal = $('overview-comments');
fetch('/api/people/comment-count', { signal: AbortSignal.timeout(5000) })
  .then((response) => {
    if (!response.ok) throw new Error('Comment count unavailable');
    return response.json();
  })
  .then(({ total }) => {
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid comment count');
    commentTotal.textContent = number.format(total);
    commentTotal.removeAttribute('aria-label');
  })
  .catch(() => { commentTotal.setAttribute('aria-label', '暫時無法讀取留言數'); });

overview.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-overview]');
  if (!button) return;
  const view = button.dataset.overview;
  if (view === 'comments') {
    rememberParent({ fromRoot: true });
    showPanel('comments');
  } else if (directory.snapshot().view !== view || directory.searchInput.value) {
    rememberParent({ fromRoot: true });
    directory.showOverviewList(view);
    panelContent.scrollTop = 0;
  }
});
publicMore.addEventListener('click', loadPublicComments);

function boardPeople() {
  peopleByBoard ??= Promise.all(people.map(async (person) => [await commentBoardId(person), person]))
    .then((entries) => new Map(entries));
  return peopleByBoard;
}

function publicCommentAvatar(person) {
  const avatar = document.createElement('span');
  avatar.className = 'map-public-comments__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const emblem = !person.portrait && person.locations.map(({ institution }) => emblemFor(institution)).find(Boolean);
  if (person.portrait) {
    const image = document.createElement('img');
    image.className = 'map-public-comments__portrait';
    image.src = person.portrait.image;
    image.alt = '';
    image.loading = 'lazy';
    avatar.append(image);
  } else if (emblem) {
    avatar.append(emblemImage(emblem));
  } else {
    avatar.textContent = [...person.name].at(0);
  }
  return avatar;
}

function publicCommentRow(comment, person) {
  const row = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'map-public-comments__meta';
  const name = comment.authorName?.trim();
  const url = typeof comment.authorWebsite === 'string' && URL.parse(comment.authorWebsite);
  const link = url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  const author = document.createElement('strong');
  if (link) {
    const website = document.createElement('a');
    website.href = url.href;
    website.target = '_blank';
    website.rel = 'ugc nofollow noopener noreferrer';
    website.textContent = name || '個人網站';
    if (!name) author.append('匿名 ');
    author.append(website);
  } else {
    author.textContent = name || '匿名';
  }
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = ' → ';
  const board = document.createElement('button');
  board.type = 'button';
  board.className = 'map-public-comments__board';
  board.textContent = person.name;
  board.setAttribute('aria-label', `開啟${person.name}的留言板`);
  board.addEventListener('click', () => openPersonBoard(person, { fromParent: true }));
  meta.append(author, arrow, board);
  const affiliation = person.affiliation_text?.trim();
  if (affiliation) {
    const title = document.createElement('span');
    title.className = 'map-public-comments__affiliation';
    title.textContent = `（${affiliation}）`;
    meta.append(title);
  }

  const content = document.createElement('div');
  content.className = 'map-public-comments__content';
  const body = document.createElement('div');
  body.className = 'map-public-comments__body';
  body.textContent = comment.body;
  content.append(meta, body);
  const chevron = document.createElement('span');
  chevron.className = 'map-public-comments__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  row.append(publicCommentAvatar(person), content, chevron);
  return row;
}

async function loadPublicComments() {
  if (loadingPublicComments) return;
  loadingPublicComments = true;
  publicMore.disabled = true;
  publicStatus.textContent = '正在載入留言…';
  const query = nextPublicCursor ? `?before=${encodeURIComponent(nextPublicCursor)}` : '';
  try {
    const [response, boards] = await Promise.all([
      fetch(`/api/people/public-comments${query}`, { signal: AbortSignal.timeout(5000) }),
      boardPeople(),
    ]);
    if (!response.ok) throw new Error('Public comments unavailable');
    const { comments, next } = await response.json();
    const rows = document.createDocumentFragment();
    for (const comment of comments) {
      const person = boards.get(comment.person);
      if (!person) continue;
      rows.append(publicCommentRow(comment, person));
    }
    publicList.append(rows);
    nextPublicCursor = next;
    publicStatus.textContent = publicList.childElementCount ? '' : '目前沒有公開留言。';
    publicMore.textContent = '載入更多留言';
    publicMore.hidden = !next;
  } catch {
    publicStatus.textContent = '暫時無法載入留言。';
    publicMore.textContent = '重新載入';
    publicMore.hidden = false;
  } finally {
    loadingPublicComments = false;
    publicMore.disabled = false;
  }
}

const SESSION_KEY = 'puma-atlas-view-v1';

function personRef(person) {
  return person && { section: person.section, raw: person.raw };
}

function panelSnapshot() {
  const { selection, focusedUnit, ...camera } = atlas.snapshot();
  return {
    camera,
    selection: selection && { point: pointKey(selection.point), person: personRef(selection.person) },
    focusedUnit: focusedUnit && pointKey(focusedUnit),
    panel: {
      view: panelView,
      detail: panelView === 'detail' ? panelDetail : undefined,
      open: !panel.hidden,
      tall: mapApp.classList.contains('is-sheet-tall'),
      scrollTop: panel.hidden ? collapsedScrollTop : panelContent.scrollTop,
    },
    directory: directory.snapshot(),
  };
}

function updatePanelBack() {
  const previous = panelAncestors.at(-1);
  panelBack.hidden = !previous;
  $('panel-back-title').textContent = previous?.title ?? '';
  panelBack.setAttribute('aria-label', previous ? `上一層：${previous.title}` : '上一層');
}

function homeSnapshot() {
  const { lat, lng, zoom } = atlas.snapshot();
  return {
    camera: { lat, lng, zoom },
    directory: homeDirectory,
    panel: { view: 'directory', open: true, scrollTop: 0 },
    title: '全部署名者',
  };
}

function clearAncestors() {
  panelAncestors = [];
  updatePanelBack();
}

function isHomeDirectory(saved) {
  return saved?.view === 'browse' && saved.groupBy === 'people' &&
    !saved.institution && !saved.county && !saved.query?.trim();
}

function rememberParent({ fromRoot = false } = {}) {
  const state = fromRoot ? null : panelSnapshot();
  if (!state || (panelView === 'directory' && isHomeDirectory(state.directory))) {
    panelAncestors = [homeSnapshot()];
  } else {
    const title = panelView === 'directory'
      ? directoryElement.querySelector('.pa-dir-view-title')?.textContent
      : panelContent.querySelector('section:not([hidden]) h2')?.textContent;
    panelAncestors.push({ ...state, title: title || '署名者名錄' });
  }
  updatePanelBack();
}

function showHomePanel({ focus = true } = {}) {
  clearAncestors();
  pendingReveal = undefined;
  directory.restore(homeDirectory);
  atlas.select();
  collapsedScrollTop = 0;
  showPanel('directory', { focus });
  panelContent.scrollTop = 0;
}

$('atlas-home').addEventListener('click', () => {
  if (linkedPerson) {
    const url = new URL(location.href);
    url.searchParams.delete('person');
    history.replaceState(history.state, '', url);
    linkedPerson = null;
  }
  showHomePanel();
});

function saveView() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...panelSnapshot(), ancestors: panelAncestors, linkedPerson }));
  } catch {
    // The atlas still works when browser storage is unavailable.
  }
}

function restoreDetail(saved) {
  const point = atlas.resolvePoint(saved?.point);
  if (!saved) return false;
  if (saved.type === 'campus') {
    if (!point) return false;
    const campus = atlas.resolveCampus(point, saved.campusOnly);
    if (!campus) return false;
    showCampus(campus, { restoring: true });
    return true;
  }
  if (saved.type !== 'person' || !saved.person) return false;
  const person = findPerson(saved.person);
  if (!person) return false;
  showPerson(person, point, { restoring: true });
  return true;
}

function restorePanel(state, { back = false } = {}) {
  if (!state?.camera || !state.panel) return;
  pendingReveal = undefined;
  directory.restore(state.directory);
  mapApp.style.setProperty('--panel-duration', '0ms');
  const { view, detail, open, tall, scrollTop } = state.panel;
  if (view !== 'detail' || !restoreDetail(detail)) {
    showPanel(['about', 'comments'].includes(view) ? view : 'directory', { focus: false });
  }
  const expanded = back || open === true;
  setPanelExpanded(expanded);
  setSheetTall((back ? tall || mapApp.classList.contains('is-sheet-tall') : tall) && expanded);
  mapApp.style.setProperty('--sheet-toolbar-height', `${toolbar.offsetHeight}px`);
  collapsedScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  if (expanded) panelContent.scrollTop = collapsedScrollTop;
  atlas.resize({ pan: false });
  const selectedPoint = atlas.resolvePoint(state.selection?.point);
  atlas.select(selectedPoint, state.selection?.person && findPerson(state.selection.person));
  atlas.restoreView(state.camera, atlas.resolvePoint(state.focusedUnit));
  mapApp.style.removeProperty('--panel-duration');
  if (back) {
    const heading = panelContent.querySelector('section:not([hidden]) h2');
    heading?.focus({ preventScroll: true });
  }
}

panelBack.addEventListener('click', () => {
  const previous = panelAncestors.pop();
  updatePanelBack();
  if (previous) restorePanel(previous, { back: true });
});

function restoreView(expectedLinkedPerson) {
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
  if (!state?.camera || !state.panel || (expectedLinkedPerson && state.linkedPerson !== expectedLinkedPerson)) return false;
  panelAncestors = Array.isArray(state.ancestors) ? state.ancestors.slice(-20) : [];
  const saved = state.directory;
  if (!panelAncestors.length && (state.panel.view !== 'directory' || (saved && !isHomeDirectory(saved)))) {
    panelAncestors = [{ ...homeSnapshot(), camera: state.camera }];
  }
  updatePanelBack();
  restorePanel(state);
  return true;
}

async function openLinkedBoard(id) {
  const person = (await boardPeople()).get(id);
  if (id !== linkedPerson) return;
  if (person) openPersonBoard(person);
  else restoreView();
}

function openPersonBoard(person, { fromParent = false } = {}) {
  showPerson(person, undefined, { tall: narrowLayout.matches, fromParent });
  const heading = details.querySelector('.person-comments h3');
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: 'start' });
}

let linkedPerson = new URLSearchParams(location.search).get('person');
if (/^[a-f0-9]{32}$/.test(linkedPerson ?? '')) {
  const reloading = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  if (!reloading || !restoreView(linkedPerson)) openLinkedBoard(linkedPerson).catch(() => restoreView());
} else restoreView();
window.addEventListener('pagehide', saveView);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveView();
});
