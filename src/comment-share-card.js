import qrCode from 'qrcode-generator';
import campaignLogo from '../assets/puma-signature.webp';
import roster from '../data/signatories.json';

const formats = [
  { label: '貼文', ratio: '1:1', width: 1080, height: 1080, top: 0, bottom: 0 },
  { label: '貼文', ratio: '16:9', width: 1920, height: 1080, top: 0, bottom: 0 },
  { label: '限時動態', ratio: '9:16', width: 1080, height: 1920, top: 210, bottom: 240 },
];
const source = new URL(roster.source_url);
const sourcePath = source.hostname + source.pathname;
const palette = { paper: '#fff7ed', accent: '#df7e2c', soft: '#ffdfc4', ink: '#3d2114', deep: '#72340f' };

const font = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const words = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'word' });
const graphemes = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
const segments = (segmenter, text) => segmenter
  ? Array.from(segmenter.segment(text), ({ segment }) => segment)
  : Array.from(text);

function wrap(ctx, text, textWidth) {
  return text.split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    for (const word of segments(words, paragraph)) {
      const parts = ctx.measureText(word).width > textWidth ? segments(graphemes, word) : [word];
      for (const part of parts) {
        if (line && ctx.measureText(line + part).width > textWidth) {
          lines.push(line.trimEnd());
          line = '';
        }
        if (line || part.trim()) line += part;
      }
    }
    return [...lines, line.trimEnd()];
  });
}

function fit(ctx, text, textWidth, availableHeight, maxSize) {
  const paragraphs = text.replace(/\n{3,}/g, '\n\n');
  const flattened = paragraphs.replace(/\s+/g, ' ');
  for (let size = maxSize; size >= 16; size -= 2) {
    ctx.font = `500 ${size}px ${font}`;
    const lineHeight = Math.round(size * 1.36);
    for (const value of size < 36 ? [paragraphs, flattened] : [paragraphs]) {
      const lines = wrap(ctx, value, textWidth);
      if (lines.length * lineHeight <= availableHeight) return { lines, lineHeight };
    }
  }
}

let logoPromise;
function loadLogo() {
  if (!logoPromise) {
    const image = new Image();
    image.src = campaignLogo;
    logoPromise = image.decode().then(() => image, () => null);
  }
  return logoPromise;
}

function drawQr(ctx, symbol, right, bottom, maxSize) {
  const count = symbol.getModuleCount();
  const module = Math.floor(maxSize / (count + 8));
  const size = (count + 8) * module;
  const x = right - size;
  const y = bottom - size;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#211b16';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (symbol.isDark(row, col)) ctx.fillRect(x + (col + 4) * module, y + (row + 4) * module, module, module);
    }
  }
  return x;
}

function draw(canvas, name, body, format, logo, symbol) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { width, height, top, bottom } = format;
  const wide = width > height;
  const inset = wide ? 86 : 66;
  const right = width - inset;
  const footerBottom = height - bottom - inset;
  const footerTop = footerBottom - 180;
  const quoteRight = wide ? 1218 : right;
  const quoteTop = top + (wide ? 350 : 336);
  const quoteBottom = wide ? footerBottom : footerTop - 38;

  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.soft;
  if (wide) ctx.fillRect(1270, 0, width - 1270, height);
  else ctx.fillRect(0, footerTop, width, height - footerTop);
  ctx.strokeStyle = '#de935b42';
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.ellipse(width - 40, top + 40, 160 + i * 54, 86 + i * 32, Math.PI / 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = palette.accent;
  ctx.fillRect(inset, top + 47, 46, 7);
  ctx.textBaseline = 'top';
  if (logo) {
    const logoWidth = Math.min(84, 68 * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, inset, top + 75, logoWidth, logoWidth * logo.naturalHeight / logo.naturalWidth);
  }
  const brandText = inset + (logo ? 104 : 0);
  ctx.fillStyle = palette.deep;
  ctx.font = `600 29px ${font}`;
  ctx.fillText('臺北市市長候選人沈伯洋先生', brandText, top + 70);
  ctx.font = `700 33px ${font}`;
  ctx.fillText('學界後援會・署名地圖', brandText, top + 105);

  ctx.fillStyle = palette.deep;
  ctx.font = `650 35px ${font}`;
  ctx.fillText('我想對', inset, top + 183);
  ctx.fillStyle = palette.ink;
  ctx.font = `750 ${wide ? 100 : 88}px ${font}`;
  ctx.fillText(`${name}說`, inset, top + 232, quoteRight - inset);

  ctx.fillStyle = '#fffefa';
  ctx.fillRect(inset, quoteTop, quoteRight - inset, quoteBottom - quoteTop);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(inset, quoteTop, 7, quoteBottom - quoteTop);
  const contentTop = quoteTop + 35;
  const available = quoteBottom - contentTop - 36;
  const layout = fit(ctx, body, quoteRight - inset - 86, available, wide ? 76 : 66);
  if (!layout) throw new Error('Share card text does not fit');
  const textTop = contentTop + Math.round((available - layout.lines.length * layout.lineHeight) / 2);
  ctx.fillStyle = palette.ink;
  layout.lines.forEach((line, index) => ctx.fillText(line, inset + 43, textTop + index * layout.lineHeight));

  const qrLeft = drawQr(ctx, symbol, right, footerBottom, wide ? 248 : 190);
  const footerTextRight = qrLeft - 24;
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.deep;
  ctx.font = `700 29px ${font}`;
  ctx.fillText('掃碼前往人物留言板', footerTextRight, footerBottom - (wide ? 195 : 152));
  ctx.font = `600 22px ${font}`;
  ctx.fillText('原始聯署網站', footerTextRight, footerBottom - 96);
  ctx.font = '500 19px sans-serif';
  const sourceWidth = wide ? Math.max(200, footerTextRight - 1294) : 370;
  const lineBreak = sourcePath.lastIndexOf('/', sourcePath.length - 2) + 1;
  ctx.fillText(sourcePath.slice(0, lineBreak), footerTextRight, footerBottom - 63, sourceWidth);
  ctx.fillText(sourcePath.slice(lineBreak), footerTextRight, footerBottom - 37, sourceWidth);
}

export function openCommentShareCard(parent, name, body, boardId, focusTarget) {
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
  canvas.setAttribute('aria-label', `我想對${name}說：${body}`);
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
  for (const link of [boardLink, sourceLink]) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  controls.append(formatButtons, actions, status, links);
  const artwork = Promise.all([boardId, loadLogo()]).then(([id, logo]) => {
    const url = new URL('https://puma-academic.observe.tw/');
    url.searchParams.set('person', id);
    boardLink.href = url.href;
    const symbol = qrCode(0, 'M');
    symbol.addData(url.href);
    symbol.make();
    return { logo, symbol };
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
      const { logo, symbol } = await artwork;
      if (version !== requested || !dialog.open) return;
      canvas.width = format.width;
      canvas.height = format.height;
      draw(canvas, name, body, format, logo, symbol);
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
