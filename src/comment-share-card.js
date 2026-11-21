import qrCode from 'qrcode-generator';
import campaignLogo from '../assets/puma-signature.webp';
import roster from '../data/signatories.json';
import { isTaiwan } from './person-data.js';

const formats = [
  { label: '貼文', ratio: '4:3', width: 1440, height: 1080, top: 0, bottom: 0 },
  { label: '限時動態', ratio: '9:16', width: 1080, height: 1920, top: 210, bottom: 240 },
];
const source = new URL(roster.source_url);
const dateFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeZone: 'Asia/Taipei' });
const palette = {
  paper: '#fff7ed', card: '#fffdf9', accent: '#df7e2c', soft: '#ffdfc4', ring: '#de935b3d',
  ink: '#3d2114', deep: '#72340f', speak: '#c9602c',
};

const font = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const words = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'word' });
const graphemes = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
const segments = (segmenter, text) => segmenter
  ? Array.from(segmenter.segment(text), ({ segment }) => segment)
  : Array.from(text);
// Closing punctuation stays with the line it ends instead of opening the next one.
const closing = /^[，。、；：！？）」』】〉》…,.!?;:)\]]+$/u;
const opening = /^[（「『【〈《(\[]+$/u;
const byWord = (text) => segments(words, text);
// Names break only between their parts: at spaces and where romanised and Han names meet.
// The closing 「說」 stays with the last part.
function byNamePart(text) {
  const parts = text.slice(0, -1).split(/(?<=\s)|(?<=[\p{Script=Latin}.])(?=\p{Script=Han})|(?<=\p{Script=Han})(?=\p{Script=Latin})/u);
  parts.push(parts.pop() + text.slice(-1));
  return parts;
}

function wrap(ctx, text, textWidth, split = byWord) {
  return text.split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    let held = '';
    for (const word of split(paragraph)) {
      const parts = ctx.measureText(word).width > textWidth ? segments(graphemes, word) : [word];
      for (let part of parts) {
        // An opening bracket moves to the next line together with what it opens.
        if (opening.test(part)) {
          held += part;
          continue;
        }
        part = held + part;
        held = '';
        if (line && !closing.test(part) && ctx.measureText(line + part).width > textWidth) {
          lines.push(line.trimEnd());
          line = '';
        }
        if (line || part.trim()) line += part;
      }
    }
    return [...lines, (line + held).trimEnd()];
  });
}

function fit(ctx, text, textWidth, availableHeight, maxSize) {
  const paragraphs = text.replace(/\n{3,}/g, '\n\n');
  const flattened = paragraphs.replace(/\s+/g, ' ');
  const at = (size) => {
    ctx.font = `500 ${size}px ${font}`;
    const lineHeight = Math.round(size * 1.36);
    for (const value of size < 36 ? [paragraphs, flattened] : [paragraphs]) {
      const lines = wrap(ctx, value, textWidth);
      if (lines.length * lineHeight <= availableHeight) return { lines, lineHeight, size };
    }
  };
  // Larger type never needs less room, so the largest size that fits is found by bisection.
  let best = at(maxSize);
  if (best) return best;
  let low = 8;
  let high = maxSize / 2 - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const layout = at(middle * 2);
    if (layout) {
      best = layout;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

// Picks the largest size that keeps a label within its line budget; each attempt is
// [maxLines, ...sizes]. A custom split marks parts that should shrink before they break.
// Text that still overflows is cut with an ellipsis.
function block(ctx, text, textWidth, weight, leading, attempts, split) {
  let lines;
  let size;
  let maxLines;
  search: for (const [limit, ...sizes] of attempts) {
    maxLines = limit;
    for (size of sizes) {
      ctx.font = `${weight} ${size}px ${font}`;
      lines = wrap(ctx, text, textWidth, split);
      const whole = !split || split(text).every((part) => ctx.measureText(part.trimEnd()).width <= textWidth);
      if (lines.length <= maxLines && whole) break search;
    }
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const tail = segments(graphemes, lines.pop());
    while (tail.length && ctx.measureText(`${tail.join('')}…`).width > textWidth) tail.pop();
    lines.push(`${tail.join('').trimEnd()}…`);
  }
  const lineHeight = Math.round(size * leading);
  return { lines, size, lineHeight, height: lines.length * lineHeight, font: ctx.font };
}

function fillBlock(ctx, { lines, lineHeight, font: blockFont }, x, y, color) {
  ctx.font = blockFont;
  ctx.fillStyle = color;
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function rounded(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const images = new Map();
function loadImage(url) {
  if (!images.has(url)) {
    const image = new Image();
    // A portrait that cannot be read back is left out instead of tainting the canvas.
    image.crossOrigin = 'anonymous';
    image.src = url;
    images.set(url, image.decode().then(() => image, () => null));
  }
  return images.get(url);
}

function placeText(person, point) {
  if (!point?.institution) return [];
  const unit = point.unit && !person.affiliation_text.includes(point.unit) ? point.unit : null;
  return [
    [point.institution, point.campus].filter(Boolean).join('・'),
    [unit, point.building, point.city, isTaiwan(point) ? null : point.country].filter(Boolean).join('・'),
  ].filter(Boolean);
}

// Whole-pixel modules with a four-module quiet zone keep the code crisp for scanners.
function qrSide(symbol, maxSize) {
  const cells = symbol.getModuleCount() + 8;
  return Math.floor(maxSize / cells) * cells;
}

function drawQr(ctx, symbol, x, y, size) {
  const count = symbol.getModuleCount();
  const module = size / (count + 8);
  ctx.fillStyle = '#fff';
  rounded(ctx, x, y, size, size, module * 2);
  ctx.fill();
  ctx.fillStyle = '#211b16';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (symbol.isDark(row, col)) ctx.fillRect(x + (col + 4) * module, y + (row + 4) * module, module, module);
    }
  }
}

function drawRings(ctx, x, y, clip) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(...clip);
  ctx.clip();
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 3;
  for (let radius = 150; radius <= 690; radius += 60) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBrand(ctx, logo, x, y) {
  if (logo) {
    const logoWidth = Math.min(84, 68 * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, x, y + 5, logoWidth, logoWidth * logo.naturalHeight / logo.naturalWidth);
  }
  const text = x + (logo ? 104 : 0);
  ctx.fillStyle = palette.deep;
  ctx.font = `600 29px ${font}`;
  ctx.fillText('臺北市市長候選人沈伯洋先生', text, y);
  ctx.font = `700 33px ${font}`;
  ctx.fillText('學界後援會・署名地圖', text, y + 35);
}

function drawPortrait(ctx, image, x, y, size) {
  const radius = Math.round(size * 0.14);
  ctx.save();
  ctx.shadowColor = '#72340f38';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#fff';
  rounded(ctx, x - 7, y - 7, size + 14, size + 14, radius + 7);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rounded(ctx, x, y, size, size, radius);
  ctx.clip();
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, x, y, size, size);
  ctx.restore();
}

function drawPin(ctx, x, y, size) {
  const radius = size * 0.36;
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, Math.PI * 5 / 6, Math.PI / 6);
  ctx.lineTo(x + radius, y + size);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.soft;
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

// Name, signed affiliation and selected location, measured before they are placed so
// the portrait can give way to longer text.
function personText(ctx, person, place, textWidth, compact = false) {
  const items = [];
  const lead = person.section === '共同領銜';
  const name = block(ctx, `${person.name}說`, textWidth, 700, 1.16,
    compact ? [[1, 64, 56], [2, 48, 40], [3, 40, 34]] : [[1, 88, 80, 72, 64], [2, 64, 56, 48, 40], [3, 48, 40, 34]], byNamePart);
  const role = block(ctx, person.affiliation_text, textWidth, 600, 1.38,
    [[1, 30, 28, 26], [2, 30, 28, 26], [3, 26, 24], [4, 24, 22], [7, 22, 20]]);
  // The place reads as one line when it fits; otherwise the school and the spot within it split.
  let where = place.length ? block(ctx, place.join('・'), textWidth - 36, 500, 1.36, [[1, 25, 23]]) : null;
  if (where?.lines.at(-1).endsWith('…')) {
    where = block(ctx, place.join('\n'), textWidth - 36, 500, 1.36, [[2, 25, 23], [3, 23, 21], [4, 21]]);
  }
  items.push({ height: compact ? 38 : 44, draw(x, y) {
    ctx.font = `600 ${compact ? 28 : 32}px ${font}`;
    ctx.fillStyle = palette.deep;
    ctx.fillText('我想對', x, y);
  } });
  items.push({ height: name.height + 14, draw(x, y) {
    fillBlock(ctx, name, x, y, palette.ink);
    const last = name.lines.at(-1);
    if (!last.endsWith('說')) return;
    // 「說」 hands over to the message, so it takes the accent colour.
    const lastTop = y + (name.lines.length - 1) * name.lineHeight;
    const nameWidth = ctx.measureText(last.slice(0, -1)).width;
    ctx.fillStyle = palette.speak;
    ctx.fillText('說', x + nameWidth, lastTop);
  } });
  if (lead) items.push({ height: 54, draw(x, y) {
    ctx.font = `700 22px ${font}`;
    const width = ctx.measureText(person.section).width + 32;
    ctx.fillStyle = palette.deep;
    rounded(ctx, x, y, width, 40, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(person.section, x + 16, y + 8);
  } });
  items.push({ height: role.height + (where ? 16 : 0), draw: (x, y) => fillBlock(ctx, role, x, y, palette.ink) });
  if (where) items.push({ height: where.height, draw(x, y) {
    drawPin(ctx, x, y + Math.round(where.size * 0.12), Math.round(where.size * 1.08));
    fillBlock(ctx, where, x + 36, y, palette.deep);
  } });
  return {
    height: items.reduce((sum, item) => sum + item.height, 0),
    draw(x, y) {
      for (const item of items) {
        item.draw(x, y);
        y += item.height;
      }
    },
  };
}

// Long messages trade the roomy margin for a larger type size.
function messageLayout(ctx, body, width, height, maxSize) {
  let result;
  for (const [padX, padY] of [[78, 70], [58, 62]]) {
    const layout = fit(ctx, body, width - padX * 2, height - padY * 2, maxSize);
    if (!layout) continue;
    result = { ...layout, padX, padY };
    if (layout.size >= 40) break;
  }
  if (!result) throw new Error('Share card text does not fit');
  return result;
}

function drawMessage(ctx, body, x, y, width, height, maxSize, layout = messageLayout(ctx, body, width, height, maxSize)) {
  ctx.fillStyle = palette.card;
  rounded(ctx, x, y, width, height, 36);
  ctx.fill();
  const mark = 46;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 9;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(x + 36, y + 36 + mark);
  ctx.lineTo(x + 36, y + 36);
  ctx.lineTo(x + 36 + mark, y + 36);
  ctx.moveTo(x + width - 36, y + height - 36 - mark);
  ctx.lineTo(x + width - 36, y + height - 36);
  ctx.lineTo(x + width - 36 - mark, y + height - 36);
  ctx.stroke();
  const { padX, padY, lines, lineHeight, size } = layout;
  ctx.font = `500 ${size}px ${font}`;
  const available = height - padY * 2;
  const textTop = y + padY + Math.round((available - lines.length * lineHeight) / 2 + (lineHeight - size) / 2);
  // Short messages sit in the middle of the card; full lines still start at the left margin.
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const textLeft = x + padX + Math.max(0, Math.round((width - padX * 2 - widest) / 2));
  ctx.fillStyle = palette.ink;
  lines.forEach((line, index) => ctx.fillText(line, textLeft, textTop + index * lineHeight));
}

function drawFooter(ctx, symbol, right, qrTop, qrSize, date) {
  const qrLeft = right - qrSize;
  drawQr(ctx, symbol, qrLeft, qrTop, qrSize);
  const labelRight = qrLeft - 24;
  const center = qrTop + qrSize / 2;
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.deep;
  ctx.font = `700 29px ${font}`;
  ctx.fillText('掃碼前往人物留言板', labelRight, center - (date ? 40 : 16));
  if (date) {
    ctx.font = `500 22px ${font}`;
    ctx.fillText(`留言於 ${date}`, labelRight, center + 8);
  }
  ctx.textAlign = 'left';
}

function draw(canvas, person, place, body, date, format, { logo, portrait, symbol }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { width, height, top, bottom } = format;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.soft;

  if (width > height) {
    const pane = 468;
    const left = 64;
    const textWidth = pane - left - 40;
    const edge = height - 56;
    ctx.fillRect(0, 0, pane, height);
    drawRings(ctx, pane, 0, [0, 0, pane, height]);

    const qrSize = qrSide(symbol, 248);
    const qrTop = edge - qrSize;
    const text = personText(ctx, person, place, textWidth);
    const room = qrTop - 40 - 56;
    // The portrait gives way to long names and titles, and steps aside if they need the whole pane.
    const size = portrait ? Math.min(288, room - text.height - 30) : 0;
    if (size >= 140) {
      drawPortrait(ctx, portrait, left, 63, size);
      text.draw(left, 63 + size + 30);
    } else {
      text.draw(left, 172);
    }

    const content = pane + 48;
    const right = width - 64;
    drawBrand(ctx, logo, content, 56);
    drawFooter(ctx, symbol, right, qrTop, qrSize, date);
    const cardTop = 168;
    drawMessage(ctx, body, content, cardTop, right - content, qrTop - 30 - cardTop, 88);
    return;
  }

  const left = 64;
  const right = width - left;
  const edge = height - bottom - 40;
  const qrSize = qrSide(symbol, 248);
  const qrTop = edge - qrSize;
  const rowTop = top + 150;
  // A long message gets the room back from the portrait row before its type shrinks.
  let size;
  let text;
  let rowHeight;
  let paneBottom;
  let message;
  for (const [option, compact] of portrait ? [[264], [208], [168, true]] : [[0], [0, true]]) {
    size = option;
    text = personText(ctx, person, place, right - left - (size ? size + 40 : 0), compact);
    rowHeight = Math.max(size, text.height);
    paneBottom = rowTop + rowHeight + (compact ? 44 : 56);
    message = messageLayout(ctx, body, right - left, qrTop - 32 - 36 - paneBottom - 36, 80);
    if (message.size >= 36) break;
  }
  ctx.fillStyle = palette.soft;
  ctx.fillRect(0, 0, width, paneBottom);
  drawRings(ctx, width, top, [0, 0, width, paneBottom]);
  drawBrand(ctx, logo, left, top + 36);
  if (size) drawPortrait(ctx, portrait, left, rowTop + Math.round((rowHeight - size) / 2), size);
  text.draw(size ? left + size + 40 : left, rowTop + Math.round((rowHeight - text.height) / 2));

  ctx.fillStyle = palette.soft;
  ctx.fillRect(0, qrTop - 32, width, height - qrTop + 32);
  drawFooter(ctx, symbol, right, qrTop, qrSize, date);
  drawMessage(ctx, body, left, paneBottom + 36, right - left, qrTop - 32 - 36 - paneBottom - 36, 80, message);
}

export function openCommentShareCard(parent, person, point, comment, boardId, focusTarget) {
  const { name } = person;
  const { body, createdAt } = comment;
  const date = Number.isFinite(createdAt) ? dateFormat.format(createdAt) : '';
  const place = placeText(person, point);
  const dialog = document.createElement('dialog');
  dialog.className = 'comment-share';
  dialog.setAttribute('aria-labelledby', 'comment-share-title');
  const title = document.createElement('h2');
  title.id = 'comment-share-title';
  title.textContent = '留言已公開';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'comment-share__close';
  close.textContent = '×';
  close.setAttribute('aria-label', '關閉分享視窗');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    focusTarget?.focus({ preventScroll: true });
  });

  const hint = document.createElement('p');
  hint.textContent = `分享你對${name}說的話。`;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `我想對${name}（${[person.affiliation_text, ...place, date].filter(Boolean).join('，')}）說：${body}`);
  const preview = document.createElement('div');
  preview.className = 'comment-share__preview';
  preview.append(canvas);
  const formatButtons = document.createElement('div');
  formatButtons.className = 'comment-share__formats';
  formatButtons.setAttribute('role', 'group');
  formatButtons.setAttribute('aria-label', '字卡版型');
  const actions = document.createElement('div');
  actions.className = 'comment-share__actions';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'comment-share__primary';
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = '下載字卡';
  const status = document.createElement('p');
  status.className = 'comment-share__status';
  status.setAttribute('role', 'status');
  const controls = document.createElement('div');
  controls.className = 'comment-share__controls';
  actions.append(share, download);
  const links = document.createElement('div');
  links.className = 'comment-share__links';
  const boardLink = document.createElement('a');
  boardLink.textContent = '開啟人物留言板';
  const sourceLink = document.createElement('a');
  sourceLink.textContent = '原始聯署網站';
  sourceLink.href = source.href;
  const shownLinks = [boardLink, sourceLink];
  if (person.portrait && /^https?:\/\//i.test(person.portrait.source_url)) {
    const photoLink = document.createElement('a');
    photoLink.textContent = '照片來源';
    photoLink.href = person.portrait.source_url;
    photoLink.title = person.portrait.credit;
    shownLinks.push(photoLink);
  }
  for (const link of shownLinks) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  controls.append(formatButtons, actions, status, links);
  const portraitImage = person.portrait ? loadImage(person.portrait.image) : null;
  const artwork = Promise.all([boardId, loadImage(campaignLogo), portraitImage]).then(([id, logo, portrait]) => {
    const url = new URL('https://puma-academic.observe.tw/');
    url.searchParams.set('person', id);
    boardLink.href = url.href;
    const symbol = qrCode(0, 'M');
    symbol.addData(url.href);
    symbol.make();
    return { logo, portrait, symbol };
  });
  const header = document.createElement('header');
  header.append(title, hint, close);
  dialog.append(header, preview, controls);

  let file;
  let requested = 0;
  let currentFormat = formats[0];
  const choices = formats.map((format) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.textContent = `${format.label} ${format.ratio}`;
    choice.addEventListener('click', () => {
      if (currentFormat !== format) render(format);
    });
    formatButtons.append(choice);
    return choice;
  });
  download.addEventListener('click', () => {
    if (!file) {
      render(currentFormat);
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  share.addEventListener('click', async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = '無法開啟分享選單，請下載字卡後上傳。';
    }
  });

  async function render(format) {
    currentFormat = format;
    choices.forEach((choice, index) => choice.setAttribute('aria-pressed', String(formats[index] === format)));
    const version = ++requested;
    file = undefined;
    share.hidden = true;
    download.disabled = true;
    status.textContent = '正在製作字卡…';
    const retry = () => {
      status.textContent = '字卡暫時無法製作。';
      download.disabled = false;
      download.textContent = '重新製作字卡';
    };
    try {
      const art = await artwork;
      if (version !== requested || !dialog.open) return;
      canvas.width = format.width;
      canvas.height = format.height;
      draw(canvas, person, place, body, date, format, art);
      canvas.toBlob((blob) => {
        if (version !== requested || !dialog.open) return;
        if (!blob) {
          retry();
          return;
        }
        file = new File([blob], `我想對${name}說－${format.label}-${format.ratio.replace(':', 'x')}.png`, { type: 'image/png' });
        const canShare = Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
        share.hidden = !canShare;
        share.textContent = `分享${format.label}圖片`;
        download.disabled = false;
        download.textContent = '下載字卡';
        status.textContent = canShare
          ? '從系統分享選單選擇 Instagram 或 Facebook。'
          : '下載字卡後，可上傳到 Instagram 或 Facebook。';
      }, 'image/png');
    } catch {
      if (version === requested && dialog.open) retry();
    }
  }

  parent.append(dialog);
  dialog.showModal();
  render(formats[0]);
}
