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
  if (token) memoryTokens.set(id, token);
  else memoryTokens.delete(id);
  try {
    if (token) localStorage.setItem(`puma-comment:${id}`, token);
    else localStorage.removeItem(`puma-comment:${id}`);
  } catch {
    // Editing remains available in the current tab when storage is unavailable.
  }
}

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request(url, { method = 'GET', data, token } = {}) {
  const headers = {};
  if (data) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method, headers, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 204) return;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function editor(labelText, value = '') {
  const label = element('label', labelText);
  const input = element('textarea');
  input.required = true;
  input.maxLength = 500;
  input.rows = 3;
  input.value = value;
  label.append(input);
  return { label, input };
}

const errorText = (error) => error instanceof Error && error.constructor === Error
  ? error.message : '暫時無法連線到留言服務，請稍後再試。';

export function personComments(person) {
  const section = element('section');
  section.className = 'person-comments';
  section.setAttribute('aria-label', `${person.name}的匿名留言板`);
  const heading = element('h3', '匿名留言板');
  heading.tabIndex = -1;
  const guidance = element('p', '留言會公開。請針對希望對方採取的行動提出建議，避免人身攻擊、個資或網址。');
  const form = element('form');
  const { label, input } = editor('你的建議（最多 500 字）');
  const trap = element('label', '網站（請留空）');
  trap.className = 'person-comments__trap';
  trap.setAttribute('aria-hidden', 'true');
  const website = element('input');
  website.name = 'website';
  website.tabIndex = -1;
  website.autocomplete = 'off';
  trap.append(website);
  const submit = element('button', '送出匿名留言');
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
  form.append(label, trap, submit, status);
  section.append(heading, guidance, form, listStatus, list, more, retry);

  const endpoint = commentBoardId(person).then((id) => `/api/people/${id}/comments`);
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
    const meta = element('p', '匿名訪客・');
    meta.className = 'person-comments__meta';
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
      const { label: editLabel, input: editInput } = editor('編輯你的留言（最多 500 字）', comment.body);
      const save = element('button', '儲存');
      save.type = 'submit';
      const cancel = button('取消', () => {
        editForm.remove();
        body.hidden = actions.hidden = false;
        change.focus();
      });
      editForm.append(editLabel, save, cancel);
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
            method: 'PATCH', token, data: { body: editInput.value },
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
    const remove = button('刪除', async () => {
      if (!window.confirm('確定刪除這則匿名留言？')) return;
      change.disabled = remove.disabled = true;
      feedback.textContent = '';
      try {
        await request(`${await endpoint}/${comment.id}`, { method: 'DELETE', token });
        saveToken(comment.id, null);
        shown.delete(comment.id);
        item.remove();
        if (loaded) updateListStatus();
        input.focus();
        status.textContent = '留言已刪除。';
      } catch (error) {
        feedback.textContent = errorText(error);
      } finally {
        change.disabled = remove.disabled = false;
      }
    });
    actions.append(change, remove);
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
    submit.disabled = input.readOnly = true;
    status.textContent = '送出中…';
    try {
      pendingToken ??= newToken();
      const comment = await request(await endpoint, {
        method: 'POST', data: { body: input.value, website: website.value, token: pendingToken },
      });
      saveToken(comment.id, pendingToken);
      pendingToken = undefined;
      input.value = '';
      const item = renderComment(comment);
      shown.get(comment.id)?.remove();
      shown.set(comment.id, item);
      list.prepend(item);
      if (loaded) updateListStatus();
      status.textContent = '留言已公開。編輯或刪除請使用這個瀏覽器。';
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      submit.disabled = input.readOnly = false;
    }
  });
  load();
  return section;
}
