import L from 'leaflet';

function button(label, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

export function createCampusView(map, departmentFor, personDetails) {
  const container = map.getContainer();
  const pins = document.createElement('div');
  pins.className = 'campus-pins';
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  });
  const attribution = map.attributionControl ? null : L.control.attribution();
  const controls = document.createElement('div');
  controls.className = 'campus-controls';
  L.DomEvent.disableClickPropagation(controls);
  L.DomEvent.disableScrollPropagation(controls);
  const summary = document.createElement('span');
  summary.className = 'campus-controls__title';
  summary.setAttribute('aria-live', 'polite');
  const hint = document.createElement('small');
  hint.textContent = '依校區座標示意排列';
  const maxZoom = map.getMaxZoom();
  let school;
  let department;
  let page = 0;

  function draw() {
    if (!school) return;
    pins.replaceChildren();
    const entries = department?.entries ?? school.institutions ?? school.departments;
    const size = map.getSize();
    const cellWidth = department ? 86 : school.institutions ? 148 : 112;
    const cellHeight = department ? 77 : 64;
    const backLabel = department ? '← 返回學系' : school.backLabel ?? '← 返回機構';
    const back = button(backLabel, 'campus-control', () => {
      if (!department) { school.onBack(); return; }
      const previous = department;
      map.closePopup();
      department = null;
      school.onDepartment(null);
      page = school.departmentPage;
      draw();
      container.querySelector(`.campus-pin[data-index="${school.departments.indexOf(previous)}"]`)?.focus();
    });
    summary.textContent = department
      ? `${school.name}・${department.label}`
      : school.name;
    controls.replaceChildren(back, summary, hint);
    const cols = Math.max(1, Math.floor((size.x - 20) / cellWidth));
    const pinTop = () => controls.offsetTop + controls.offsetHeight + 12;
    const rows = () => Math.max(1, Math.floor((size.y - pinTop() - 25) / cellHeight));
    const pagination = entries.length > cols * rows();
    if (pagination) {
      const prev = button('上一頁', 'campus-control campus-prev', () => changePage(-1));
      const next = button('下一頁', 'campus-control campus-next', () => changePage(1));
      const position = document.createElement('span');
      position.className = 'campus-page-number';
      controls.append(prev, position, next);
    }

    const capacity = cols * rows();
    const pageCount = Math.max(1, Math.ceil(entries.length / capacity));
    page = Math.min(page, pageCount - 1);
    if (pagination) {
      controls.querySelector('.campus-prev').disabled = page === 0;
      controls.querySelector('.campus-next').disabled = page === pageCount - 1;
      controls.querySelector('.campus-page-number').textContent = `${page + 1} / ${pageCount}`;
    }
    const visible = entries.slice(page * capacity, (page + 1) * capacity);
    const totalRows = Math.ceil(visible.length / cols);
    const anchor = map.latLngToContainerPoint(school.anchor);
    const halfWidth = Math.min(cols, visible.length) * cellWidth / 2;
    const halfHeight = totalRows * cellHeight / 2;
    const centerX = Math.max(halfWidth, Math.min(size.x - halfWidth, anchor.x));
    const centerY = Math.max(pinTop() + halfHeight, Math.min(size.y - 25 - halfHeight, anchor.y));

    visible.forEach((item, index) => {
      const row = Math.floor(index / cols);
      const rowLength = Math.min(cols, visible.length - row * cols);
      const x = centerX + (index % cols - (rowLength - 1) / 2) * cellWidth;
      const y = centerY + (row - (totalRows - 1) / 2) * cellHeight;
      const latLng = map.containerPointToLatLng([x, y]);
      const label = department ? item.person.name : `${item.label}（${item.entries.length}）`;
      const markerButton = button(label, department ? 'campus-pin campus-pin--person' : 'campus-pin', () => {
        if (department) {
          L.popup({ className: 'campus-person-popup', maxWidth: 320,
            maxHeight: Math.max(100, size.y - 130), autoPanPadding: [24, 52] })
            .setLatLng(latLng).setContent(personDetails(item.person, item.point)).openOn(map);
        } else if (school.institutions) {
          school.onInstitution(item);
        } else {
          school.departmentPage = page;
          department = item;
          school.onDepartment(item);
          page = 0;
          draw();
          container.querySelector('.campus-controls button')?.focus();
        }
      });
      markerButton.dataset.index = String(page * capacity + index);
      markerButton.title = label;
      L.DomEvent.disableClickPropagation(markerButton);
      if (department && item.person.portrait) {
        const image = document.createElement('img');
        image.src = item.person.portrait.image;
        image.alt = '';
        markerButton.prepend(image);
      }
      markerButton.style.left = `${x}px`;
      markerButton.style.top = `${y}px`;
      markerButton.style.width = `${cellWidth - 8}px`;
      markerButton.style.height = `${cellHeight - 8}px`;
      pins.append(markerButton);
    });
  }

  function changePage(delta) {
    page += delta;
    draw();
    (controls.querySelector(delta > 0 ? '.campus-next:not(:disabled)' : '.campus-prev:not(:disabled)')
      || container.querySelector('.campus-pin'))?.focus();
  }

  map.on('moveend resize', draw);

  function clear() {
    if (!school) return;
    school = null;
    department = null;
    map.closePopup();
    pins.remove();
    pins.replaceChildren();
    tiles.remove();
    attribution?.remove();
    controls.remove();
    container.classList.remove('is-campus');
    map.setMaxZoom(maxZoom);
    map.fire('campusview', { active: false });
  }

  function activate(bounds) {
    page = 0;
    container.classList.add('is-campus');
    container.append(pins, controls);
    map.fire('campusview', { active: true });
    map.setMaxZoom(18);
    map.stop();
    map.invalidateSize({ animate: false });
    map.fitBounds(bounds, { padding: [32, 48], maxZoom: 16, animate: false });
    attribution?.addTo(map);
    tiles.addTo(map);
    draw();
  }

  function showGroup(members, onClose, onInstitution, onDepartment) {
    const viewport = { center: map.getCenter(), zoom: map.getZoom() };
    const groups = new Map();
    for (const member of members) {
      const label = member.point.institution;
      if (!groups.has(label)) groups.set(label, { label, entries: [] });
      const { entries } = groups.get(label);
      if (!entries.some(({ person }) => person === member.person)) entries.push(member);
    }
    const institutions = [...groups.values()].sort((a, b) =>
      b.entries.length - a.entries.length || a.label.localeCompare(b.label, 'zh-TW'));
    function leave() {
      clear();
      onClose();
      map.invalidateSize({ animate: false });
      map.setView(viewport.center, viewport.zoom, { animate: false });
      map.getContainer().focus({ preventScroll: true });
    }

    function openInstitution(item, onBack, backLabel) {
      onInstitution(item);
      show(item.label, item.entries, onBack, onDepartment, backLabel);
      controls.querySelector('button')?.focus({ preventScroll: true });
    }

    if (institutions.length === 1) {
      openInstitution(institutions[0], leave, '← 返回地圖');
      return;
    }

    function overview() {
      clear();
      onInstitution(null);
      const bounds = L.latLngBounds(members.map(({ point }) => [point.lat, point.lon]));
      school = { name: '鄰近機構', institutions, anchor: bounds.getCenter(), onBack: leave,
        backLabel: '← 返回地圖',
        onInstitution: (item) => openInstitution(item, overview, '← 返回鄰近機構') };
      activate(bounds);
      controls.querySelector('button')?.focus({ preventScroll: true });
    }
    overview();
  }

  function show(name, members, onBack, onDepartment, backLabel) {
    clear();
    const groups = new Map();
    for (const member of members) {
      const label = departmentFor(member.person, name);
      const key = label.replaceAll('學系', '系');
      if (!groups.has(key)) groups.set(key, { label, entries: [] });
      const { entries } = groups.get(key);
      if (!entries.some(({ person }) => person === member.person)) entries.push(member);
    }
    const departments = [...groups.values()].sort((a, b) =>
      Number(a.label === '系所未標明') - Number(b.label === '系所未標明')
      || b.entries.length - a.entries.length || a.label.localeCompare(b.label, 'zh-TW'));
    const bounds = L.latLngBounds(members.map(({ point }) => [point.lat, point.lon]));
    school = { name, departments, anchor: bounds.getCenter(), onBack, onDepartment, backLabel, departmentPage: 0 };
    activate(bounds);
  }

  return { clear, show, showGroup };
}
