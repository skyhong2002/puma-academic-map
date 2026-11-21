import { commentVerification } from './comment-verification.js';
import { openCommentShareCard } from './comment-share-card.js';
import { commentBoardId } from './comment-board-id.js';
import './person-comments.css';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
const memoryTokens = new Map();

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, onClick) {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function tokenFor(id) {
  try {
    return memoryTokens.get(id) ?? localStorage.getItem(`puma-comment:${id}`);
  } catch {
    return memoryTokens.get(id);
  }
}

function saveToken(id, token) {
  memoryTokens.set(id, token);
  try {
    localStorage.setItem(`puma-comment:${id}`, token);
  } catch {
    // Editing remains available in the current tab when storage is unavailable.
  }
}

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request(url, { method = 'GET', data, token, signal } = {}) {
  const headers = {};
  if (data) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    method, headers, body: data ? JSON.stringify(data) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function commentInput(value = '') {
  const input = element('textarea');
  input.required = true;
  input.maxLength = 500;
  input.rows = 3;
  input.value = value;
  return input;
}

function authorInputs({ authorName = '', authorWebsite = '' } = {}) {
  const row = element('div');
  row.className = 'person-comments__authors';
  const name = element('input');
  name.type = 'text';
  name.maxLength = 50;
  name.value = authorName ?? '';
  name.placeholder = '名字／暱稱（選填）';
  name.setAttribute('aria-label', name.placeholder);
  const website = element('input');
  website.type = 'url';
  website.maxLength = 300;
  website.value = authorWebsite ?? '';
  website.placeholder = '個人網站（選填）';
  website.setAttribute('aria-label', website.placeholder);
  row.append(name, website);
  return { row, fields: () => ({ authorName: name.value, authorWebsite: website.value }) };
}

const errorText = (error) => error instanceof Error && error.constructor === Error
  ? error.message : '暫時無法連線到留言服務，請稍後再試。';

export function personComments(person) {
  const section = element('section');
  section.className = 'person-comments';
  section.setAttribute('aria-label', `${person.name}的留言板`);
  const heading = element('h3', '留言板');
  heading.tabIndex = -1;
  const form = element('form');
  const input = commentInput();
  input.placeholder = `我想對${person.name}說……`;
  input.setAttribute('aria-label', input.placeholder);
  const trap = element('label', '網站（請留空）');
  trap.className = 'person-comments__trap';
  trap.setAttribute('aria-hidden', 'true');
  const website = element('input');
  website.name = 'website';
  website.tabIndex = -1;
  website.autocomplete = 'off';
  trap.append(website);
  const submit = element('button', '送出留言');
  submit.type = 'submit';
  const status = element('p');
  status.setAttribute('role', 'status');
  const listStatus = element('p', '載入留言中…');
  listStatus.setAttribute('role', 'status');
  const list = element('ol');
  list.setAttribute('aria-label', '公開留言');
  list.setAttribute('role', 'list');
  const more = button('載入較早的留言', () => load());
  more.hidden = true;
  const retry = button('重新載入留言', () => load());
  retry.hidden = true;
  const authors = authorInputs();
  const boardId = commentBoardId(person);
  const endpoint = boardId.then((id) => `/api/people/${id}/comments`);
  const verification = commentVerification(async (signal) => request(`${await endpoint}/challenge`, { signal }));
  verification.checkbox.addEventListener('change', () => { status.textContent = ''; });
  form.append(authors.row, input, trap, verification.row, submit, status);
  section.append(heading, form, listStatus, list, more, retry);

  let next = null;
  let loaded = false;
  let loading = false;
  let pendingToken;
  const shown = new Map();

  function updateListStatus() {
    listStatus.textContent = shown.size ? '' : '目前還沒有留言。';
  }

  function renderComment(comment) {
    const item = element('li');
    const time = element('time', dateFormat.format(comment.createdAt));
    time.dateTime = new Date(comment.createdAt).toISOString();
    const meta = element('p');
    meta.className = 'person-comments__meta';
    if (!comment.authorWebsite || !comment.authorName) {
      meta.append(element('strong', comment.authorName || '匿名'), '・');
    }
    if (comment.authorWebsite) {
      const link = element('a', comment.authorName || '個人網站');
      link.href = comment.authorWebsite;
      link.target = '_blank';
      link.rel = 'ugc nofollow noopener noreferrer';
      meta.append(link, '・');
    }
    meta.append(time);
    if (comment.updatedAt !== null) meta.append('・已編輯');
    const body = element('p', comment.body);
    body.className = 'person-comments__body';
    const token = tokenFor(comment.id);
    item.append(meta, body);
    if (!token) return item;

    const actions = element('div');
    actions.className = 'person-comments__actions';
    const feedback = element('p');
    feedback.setAttribute('role', 'status');
    const change = button('編輯', () => {
      const editForm = element('form');
      const editLabel = element('label', '編輯你的留言（最多 500 字）');
      const editInput = commentInput(comment.body);
      editLabel.append(editInput);
      const save = element('button', '儲存');
      save.type = 'submit';
      const cancel = button('取消', () => {
        editForm.remove();
        body.hidden = actions.hidden = false;
        change.focus();
      });
      const authors = authorInputs(comment);
      editForm.append(authors.row, editLabel, save, cancel);
      actions.hidden = body.hidden = true;
      item.insertBefore(editForm, feedback);
      editInput.focus();
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (save.disabled || !editInput.reportValidity()) return;
        save.disabled = cancel.disabled = editInput.readOnly = true;
        feedback.textContent = '';
        try {
          const updated = await request(`${await endpoint}/${comment.id}`, {
            method: 'PATCH', token, data: { body: editInput.value, ...authors.fields() },
          });
          const replacement = renderComment(updated);
          shown.set(updated.id, replacement);
          item.replaceWith(replacement);
          replacement.querySelector('button').focus();
          status.textContent = '留言已更新。';
        } catch (error) {
          feedback.textContent = errorText(error);
        } finally {
          save.disabled = cancel.disabled = editInput.readOnly = false;
        }
      });
    });
    const share = button('分享字卡', () => openCommentShareCard(section, person.name, comment.body, boardId, share));
    actions.append(change, share);
    item.append(actions, feedback);
    return item;
  }

  async function load() {
    if (loading) return;
    loading = true;
    more.disabled = retry.disabled = true;
    listStatus.textContent = '載入留言中…';
    try {
      const url = await endpoint;
      const result = await request(next ? `${url}?before=${encodeURIComponent(next)}` : url);
      const hadFocus = [more, retry].includes(document.activeElement);
      let firstAdded;
      for (const comment of result.comments) {
        if (shown.has(comment.id)) continue;
        const item = renderComment(comment);
        shown.set(comment.id, item);
        list.append(item);
        firstAdded ??= item;
      }
      next = result.next;
      loaded = true;
      more.hidden = !next;
      retry.hidden = true;
      updateListStatus();
      if (hadFocus) {
        const target = firstAdded ?? listStatus;
        target.tabIndex = -1;
        target.focus();
      }
    } catch (error) {
      listStatus.textContent = errorText(error);
      retry.hidden = false;
    } finally {
      loading = false;
      more.disabled = retry.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled || !input.reportValidity()) return;
    const proof = verification.getProof();
    if (!proof) {
      status.textContent = '請先勾選「我不是機器人」，等驗證完成後再送出。';
      verification.checkbox.focus();
      return;
    }
    submit.disabled = input.readOnly = verification.checkbox.disabled = true;
    status.textContent = '送出中…';
    try {
      pendingToken ??= newToken();
      const comment = await request(await endpoint, {
        method: 'POST', data: { body: input.value, website: website.value, token: pendingToken, ...authors.fields(), ...proof },
      });
      saveToken(comment.id, pendingToken);
      pendingToken = undefined;
      form.reset();
      verification.reset();
      const item = renderComment(comment);
      shown.get(comment.id)?.remove();
      shown.set(comment.id, item);
      list.prepend(item);
      if (loaded) updateListStatus();
      const hasFocus = form.contains(document.activeElement) || document.activeElement === document.body;
      if (hasFocus && section.getClientRects().length) {
        status.textContent = '';
        openCommentShareCard(section, person.name, comment.body, boardId, input);
      } else status.textContent = '留言已公開。';
    } catch (error) {
      status.textContent = errorText(error);
      if (error.status === 428) verification.reset();
    } finally {
      submit.disabled = input.readOnly = verification.checkbox.disabled = false;
    }
  });
  load();
  return section;
}
