import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { commentBoardId } from '../src/comment-board-id.js';

const port = Number(process.env.COMMENTS_PORT ?? 4174);
const directory = process.env.COMMENTS_DATA_DIR ?? '.comments-data';
const allowedOrigins = new Set([
  process.env.COMMENTS_ORIGIN ?? 'http://localhost:5173',
  process.env.COMMENTS_PREVIEW_ORIGIN,
].filter(Boolean));
const behindProxy = process.env.COMMENTS_BEHIND_PROXY === '1';
const minute = 60_000;
const pageSize = 20;
const proofLifetime = 10 * minute;
const idPattern = '[a-f0-9]{32}';
const routePattern = new RegExp(`^/api/people/(${idPattern})/comments(?:/(${idPattern}|challenge))?$`);
const idValid = new RegExp(`^${idPattern}$`);
const tokenValid = /^[a-f0-9]{64}$/;
const roster = JSON.parse(readFileSync(new URL('../data/signatories.json', import.meta.url)));
const people = new Set(await Promise.all(Object.entries(roster.sections).flatMap(([section, group]) =>
  group.entries.map(({ raw }) => commentBoardId({ section, raw })))));

mkdirSync(directory, { recursive: true, mode: 0o700 });
const secretPath = join(directory, 'rate-secret');
try {
  writeFileSync(secretPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const rateSecret = readFileSync(secretPath);
const db = new DatabaseSync(join(directory, 'comments.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, person TEXT NOT NULL, body TEXT NOT NULL, fingerprint TEXT NOT NULL,
    owner TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS comments_board ON comments (person, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS comments_duplicates ON comments (person, fingerprint, created_at DESC);
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL,
    PRIMARY KEY (key, expires_at)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits (expires_at);
  CREATE TABLE IF NOT EXISTS comment_proofs (
    nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS proof_expiry ON comment_proofs (expires_at);
`);
const columns = new Set(db.prepare('PRAGMA table_info(comments)').all().map(({ name }) => name));
if (!columns.has('author_name')) db.exec('ALTER TABLE comments ADD COLUMN author_name TEXT');
if (!columns.has('author_website')) db.exec('ALTER TABLE comments ADD COLUMN author_website TEXT');
const select = `SELECT id, body, created_at AS createdAt, updated_at AS updatedAt,
  author_name AS authorName, author_website AS authorWebsite FROM comments`;
const boardTotals = db.prepare('SELECT person, COUNT(*) AS total FROM comments GROUP BY person');
const latest = db.prepare(`${select} WHERE person = ? ORDER BY created_at DESC, id DESC LIMIT ?`);
const older = db.prepare(`${select} WHERE person = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`);
const find = db.prepare(`${select} WHERE id = ? AND person = ? AND owner = ?`);
const duplicate = db.prepare('SELECT 1 FROM comments WHERE person = ? AND fingerprint = ? AND created_at >= ? AND id != ? LIMIT 1');
const insert = db.prepare('INSERT INTO comments (id, person, body, fingerprint, owner, created_at, author_name, author_website) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const edit = db.prepare('UPDATE comments SET body = ?, fingerprint = ?, updated_at = ?, author_name = ?, author_website = ? WHERE id = ?');
const remove = db.prepare('DELETE FROM comments WHERE id = ?');
const rateCount = db.prepare('SELECT hits FROM rate_limits WHERE key = ? AND expires_at = ?');
const rateHit = db.prepare(`INSERT INTO rate_limits (key, expires_at, hits) VALUES (?, ?, 1)
  ON CONFLICT (key, expires_at) DO UPDATE SET hits = hits + 1`);
const pruneRates = db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?');
const pruneProofs = db.prepare('DELETE FROM comment_proofs WHERE expires_at <= ?');
const useProof = db.prepare('INSERT OR IGNORE INTO comment_proofs (nonce, expires_at) VALUES (?, ?)');
function pruneExpired() {
  const now = Date.now();
  pruneRates.run(now);
  pruneProofs.run(now);
}
pruneExpired();
setInterval(pruneExpired, minute).unref();

function fail(status, message, retryAfter) {
  throw Object.assign(new Error(message), { status, retryAfter });
}

function limit(now, ...rules) {
  const windows = rules.map(([key, max, window]) => ({ key, max, expires: now - (now % window) + window }));
  for (const { key, max, expires } of windows) {
    if ((rateCount.get(key, expires)?.hits ?? 0) >= max) {
      fail(429, '留言操作太頻繁，請稍後再試。', Math.ceil((expires - now) / 1000));
    }
  }
  for (const { key, expires } of windows) rateHit.run(key, expires);
}

function sourceKey(request, now) {
  let address = behindProxy ? request.headers['x-comment-client-ip'] : request.socket.remoteAddress;
  if (!address || !isIP(address)) fail(400, '無法辨識連線，請重新整理後再試。');
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  if (isIP(address) === 6) {
    const [prefix, suffix] = new URL(`http://[${address}]/`).hostname.slice(1, -1).split('::');
    const left = prefix ? prefix.split(':') : [];
    const right = suffix ? suffix.split(':') : [];
    address = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].slice(0, 4).join(':');
  }
  // Only short-lived keyed digests are stored in the rate-limit table.
  return createHmac('sha256', rateSecret).update(`${Math.floor(now / (10 * minute))}:${address}`).digest('hex');
}

async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    fail(415, '請使用 JSON 格式。');
  }
  if (Number(request.headers['content-length']) > 4096) fail(413, '留言內容太長。');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 4096) {
      request.resume();
      fail(413, '留言內容太長。');
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, '無法讀取留言資料。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '無法讀取留言資料。');
  return value;
}

const hash = (value) => createHash('sha256').update(value).digest('hex');
function commentText(value) {
  if (typeof value !== 'string') fail(400, '請輸入留言。');
  const body = value.replace(/\r\n?/g, '\n').trim();
  if (!body || body.length > 500 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(body)) {
    fail(400, '留言需為 1 至 500 字的純文字。');
  }
  const normalized = body.normalize('NFKC').toLowerCase();
  if (/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/u.test(normalized)) {
    fail(400, '留言請勿包含網址或電子郵件地址。');
  }
  return { body, fingerprint: hash(normalized.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, '')) };
}

function authorFields(input, existing) {
  const { authorName = existing?.authorName ?? '', authorWebsite = existing?.authorWebsite ?? '' } = input;
  if (typeof authorName !== 'string' || authorName.length > 50 || /[\p{Cc}\p{Bidi_Control}]/u.test(authorName)) {
    fail(400, '名字或暱稱最多 50 字。');
  }
  if (typeof authorWebsite !== 'string' || authorWebsite.length > 300) fail(400, '請輸入有效的個人網站網址。');
  const value = authorWebsite.trim();
  const url = value ? URL.parse(value) : null;
  if (value && (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 300)) {
    fail(400, '請輸入以 https:// 或 http:// 開頭的個人網站網址。');
  }
  return [authorName.trim() || null, url?.href ?? null];
}

function signChallenge(person, challenge) {
  return createHmac('sha256', rateSecret).update(`comment-proof:${person}:${challenge}`).digest();
}

function issueChallenge(person, now) {
  const challenge = `${randomBytes(16).toString('hex')}.${now + proofLifetime}`;
  return { challenge: `${challenge}.${signChallenge(person, challenge).toString('hex')}` };
}

function verifyChallenge(person, input, now) {
  const { challenge, answer } = input;
  if (challenge === undefined) fail(428, '請重新整理頁面，勾選「我不是機器人」後再送出。');
  const parts = typeof challenge === 'string' && /^([a-f0-9]{32})\.(\d{13})\.([a-f0-9]{64})$/.exec(challenge);
  if (parts && typeof answer === 'string' && /^[0-9a-f]{1,8}$/.test(answer)) {
    const [, nonce, expiry, signature] = parts;
    const expires = Number(expiry);
    if (expires > now && timingSafeEqual(Buffer.from(signature, 'hex'), signChallenge(person, `${nonce}.${expiry}`))
      && hash(`${challenge}:${answer}`).startsWith('0000')) return [nonce, expires];
  }
  fail(428, '請勾選「我不是機器人」完成驗證後再送出。');
}

function cursor(params) {
  if (!params.has('before')) return null;
  const [time, id, extra] = params.get('before').split('.');
  if (extra !== undefined || !/^\d{1,16}$/.test(time) || !idValid.test(id) || !Number.isSafeInteger(Number(time))) {
    fail(400, '留言分頁無效。');
  }
  return [Number(time), id];
}

function send(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
  });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, async (request, response) => {
  try {
    const url = new URL(request.url, 'http://api.internal');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      latest.all('', 1);
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/people/comment-count') {
      const total = boardTotals.all().reduce((sum, board) => sum + (people.has(board.person) ? board.total : 0), 0);
      send(response, 200, { total });
      return;
    }
    const route = url.pathname.match(routePattern);
    if (!route || !people.has(route[1])) fail(404, '找不到留言板。');
    const [, person, id] = route;
    const method = request.method;
    if (id === 'challenge') {
      if (method !== 'GET') {
        response.setHeader('Allow', 'GET');
        fail(405, '不支援這個留言操作。');
      }
      const now = Date.now();
      limit(now, [`challenge:${sourceKey(request, now)}`, 15, minute]);
      send(response, 200, issueChallenge(person, now));
      return;
    }
    if (method === 'GET' && !id) {
      const before = cursor(url.searchParams);
      const comments = before ? older.all(person, ...before, pageSize + 1) : latest.all(person, pageSize + 1);
      const hasMore = comments.length > pageSize;
      if (hasMore) comments.pop();
      const last = comments.at(-1);
      send(response, 200, { comments, next: hasMore ? `${last.createdAt}.${last.id}` : null });
      return;
    }
    const posting = method === 'POST' && !id;
    if (!posting && !(id && (method === 'PATCH' || method === 'DELETE'))) {
      response.setHeader('Allow', id ? 'PATCH, DELETE' : 'GET, POST');
      fail(405, '不支援這個留言操作。');
    }
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) fail(403, '請從本站操作留言。');
    const now = Date.now();
    const source = sourceKey(request, now);
    limit(now, [`attempt:${source}`, 15, minute]);
    const input = method === 'DELETE' ? null : await jsonBody(request);
    const token = posting ? input.token : request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (typeof token !== 'string' || !tokenValid.test(token)) fail(403, '找不到這則留言的編輯權限。');
    const owner = hash(`owner:${token}`);
    const commentId = id ?? hash(`comment:${person}:${token}`).slice(0, 32);
    const existing = find.get(commentId, person, owner);
    if (posting && existing) {
      send(response, 200, existing);
      return;
    }
    if (!posting && !existing) fail(404, '找不到你可以操作的留言。');
    if (method === 'DELETE') {
      remove.run(commentId);
      send(response, 204);
      return;
    }
    if (posting && input.website !== '') fail(422, '無法送出這則留言，請重新整理後再試。');
    const { body, fingerprint } = commentText(input.body);
    if (duplicate.get(person, fingerprint, now - 60 * minute, commentId)) fail(409, '這個留言板近期已有相同內容。');
    const [authorName, authorWebsite] = authorFields(input, existing);
    if (posting) {
      const proof = verifyChallenge(person, input, now);
      db.exec('BEGIN IMMEDIATE');
      try {
        limit(now, [`post:${source}`, 5, 10 * minute], [`person:${person}:${source}`, 2, 10 * minute],
          [`board:${person}`, 80, minute], ['site', 300, minute]);
        if (!useProof.run(...proof).changes) fail(428, '驗證已使用，請重新勾選「我不是機器人」。');
        insert.run(commentId, person, body, fingerprint, owner, now, authorName, authorWebsite);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else {
      edit.run(body, fingerprint, now, authorName, authorWebsite, commentId);
    }
    send(response, posting ? 201 : 200, find.get(commentId, person, owner));
  } catch (error) {
    if (!error.status) console.error('Comment request failed', error.code ?? error.name);
    if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
    send(response, error.status ?? 500, { error: error.status ? error.message : '留言服務暫時無法使用，請稍後再試。' });
  }
});
server.listen(port, process.env.COMMENTS_HOST ?? '127.0.0.1', () => console.log(`Comments API listening on ${port}`));
