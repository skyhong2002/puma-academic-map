import { emblemFor, emblemImage } from './emblems.js';
import { locatedUnit } from './unit-locations.js';
import roster from '../data/signatories.json';
import { createAtlas } from './atlas.js';
import { mountDirectory } from './directory.js';
import { people } from './person-data.js';
import { personDetails } from './person-map.js';
import { personComments } from './person-comments.js';
import { track } from './analytics.js';

const $ = (id) => document.getElementById(id);
const panel = $('map-panel');
const details = $('place-details');
const directoryElement = $('directory');
const about = $('about-map');
const panelToggle = $('panel-toggle');
const aboutButton = $('map-about');
const panelContent = $('panel-content');
const mapApp = panel.closest('.map-app');
const narrowLayout = matchMedia('(width < 720px)');
const toolbar = mapApp.querySelector('.map-toolbar');
const number = new Intl.NumberFormat('zh-TW');
let returnFocus;
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
  panelToggle.querySelector('.map-panel-toggle__label').textContent = expanded ? '收合資訊' : '展開資訊';
  panelToggle.title = expanded ? '收合資訊面板' : '展開資訊面板';
  panelToggle.setAttribute('aria-label', panelToggle.title);
  atlas.resize();
}

function showPanel(view, { focus = true, restoreScroll = false } = {}) {
  if (panel.hidden && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
  panelView = view;
  directoryElement.hidden = view !== 'directory';
  details.hidden = view !== 'detail';
  about.hidden = view !== 'about';
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

function revealAfterPanelResize(point) {
  const request = {};
  pendingReveal = request;
  atlas.reveal(point);
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
    atlas.reveal(point);
  });
}

function locateOnMap(point, person) {
  pendingReveal = undefined;
  atlas.locate(point, person);
}

function detailTitle(text) {
  const title = document.createElement('h2');
  title.tabIndex = -1;
  title.textContent = text;
  return title;
}

function showCampus(campus, restore) {
  let returnButton;
  track('view_academic_location');
  const { point, people, unit, campusOnly } = campus;
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
    if (restore?.person === person) returnButton = button;
    button.addEventListener('click', () => {
      const scrollTop = panelContent.scrollTop;
      const location = locatedUnit(person, point) ?? point;
      showPerson(person, location, () => showCampus(campus, { person, scrollTop }));
    });
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
  showPanel('detail', { focus: !returnButton });
  if (returnButton) {
    panelContent.scrollTop = restore.scrollTop;
    returnButton.scrollIntoView({ block: 'nearest' });
    returnButton.focus({ preventScroll: true });
  }
  revealAfterPanelResize(point);
}

function showPerson(person, point, returnToList, returnLabel = '回到校區名單') {
  atlas.select(point, person);
  const body = personDetails(person, point, { heading: true });
  if (returnToList) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'map-detail__close-person';
    close.textContent = '×';
    close.setAttribute('aria-label', returnLabel);
    close.addEventListener('click', returnToList);
    body.classList.add('has-return');
    body.querySelector('.map-detail__identity').append(close);
  }
  const board = personComments(person);
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'person-comments-jump';
  jump.textContent = '跳到匿名留言板';
  jump.addEventListener('click', () => {
    const heading = board.querySelector('h3');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start' });
  });
  body.querySelector('.map-detail__claim').after(jump);
  details.replaceChildren(body);
  if (roster.source_url) {
    const link = document.createElement('a');
    link.href = roster.source_url;
    link.textContent = '原站署名名單';
    link.className = 'map-detail__source-link';
    link.target = '_blank';
    link.rel = 'noopener';
    details.append(link);
  }
  details.append(board);
  showPanel('detail');
  if (point) revealAfterPanelResize(point);
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
  onSearchClear: () => atlas.select(),
  onSearchChange(query) {
    atlas.select();
    if (!searchTracked && query.trim()) {
      searchTracked = true;
      track('use_directory_search');
    }
    showPanel('directory', { focus: false });
  },
  onSearchOpen() {
    showPanel('directory', { focus: false });
  },
  onSearchPerson(entry) {
    const person = findPerson(entry);
    if (!person?.locations.length) return;
    const unit = person.locations.map((point) => locatedUnit(person, point)).find(Boolean);
    locateOnMap(unit ?? person.locations[0], person);
  },
  onOpenPerson(entry, target) {
    const person = findPerson(entry);
    if (!person) return;
    const scrollTop = panelContent.scrollTop;
    showPerson(person, person.locations[0], () => {
      showPanel('directory', { focus: !target.isConnected });
      panelContent.scrollTop = scrollTop;
      target.focus({ preventScroll: true });
    }, '回到署名者名錄');
  },
  onLocateUnit(point) {
    showCampus({ point, unit: point.unit, people: atlas.peopleAt(point) });
    locateOnMap(point);
  },
  onLocate(entry, point) {
    const person = findPerson(entry);
    if (!person) return;
    const location = locatedUnit(person, point) ?? point;
    showPerson(person, location);
    locateOnMap(location, person);
  },
});
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
    height: panel.hidden ? 0 : panel.offsetHeight, delta: 0,
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
    mapApp.classList.add('is-sheet-dragging');
    // Keep the full map behind the sheet and preserve its visible origin.
    atlas.resize({ pan: false, debounceMoveend: true });
    if (panel.hidden) showPanel(panelView, { focus: false, restoreScroll: true });
  }
  if (sheetFrame === undefined) sheetFrame = requestAnimationFrame(updateSheetDrag);
});

function updateSheetDrag() {
  sheetFrame = undefined;
  const height = `clamp(0px, ${sheetDrag.height + sheetDrag.delta}px, var(--sheet-max-height))`;
  panel.style.setProperty('--sheet-drag-height', height);
  panelToggle.style.setProperty('--sheet-drag-height', height);
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
  panel.style.removeProperty('--sheet-drag-height');
  panelToggle.style.removeProperty('--sheet-drag-height');
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
  collapsedScrollTop = 0;
}
$('reset-map').addEventListener('click', () => {
  dismissDetails();
  pendingReveal = undefined;
  atlas.reset();
});
aboutButton.addEventListener('click', () => {
  if (!panel.hidden && !about.hidden) closePanel({ focusTarget: aboutButton });
  else showPanel('about');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented && !directory.isComposingSearch(event)) closePanel();
});

if (roster.source_url) $('source-link').href = roster.source_url;
for (const link of document.querySelectorAll('#about-map a[href^="https://forms.gle/"]')) {
  link.addEventListener('click', () => track('click_signup_link'));
}
$('map-totals').textContent = [
  `${number.format(people.filter((person) => person.locations.length).length)} 位已定位署名者`,
  `${number.format(people.filter((person) => person.portrait).length)} 張頭像`,
].join('・');
