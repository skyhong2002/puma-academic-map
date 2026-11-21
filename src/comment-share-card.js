const width = 1080;
const formats = [
  { label: '貼文', ratio: '4:5', height: 1350, top: 0, bottom: 0 },
  { label: '限時動態', ratio: '9:16', height: 1920, top: 250, bottom: 270 },
];
const inset = 88;
const textWidth = width - inset * 2;
const font = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const words = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'word' });
const graphemes = Intl.Segmenter && new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
const segments = (segmenter, text) => segmenter
  ? Array.from(segmenter.segment(text), ({ segment }) => segment)
  : Array.from(text);

function wrap(ctx, text) {
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

function fit(ctx, text, availableHeight) {
  const paragraphs = text.replace(/\n{3,}/g, '\n\n');
  const flattened = paragraphs.replace(/\s+/g, ' ');
  for (let size = 62; size >= 18; size -= 2) {
    ctx.font = `500 ${size}px ${font}`;
    const lineHeight = Math.round(size * 1.36);
    for (const value of size < 36 ? [paragraphs, flattened] : [paragraphs]) {
      const lines = wrap(ctx, value);
      if (lines.length * lineHeight <= availableHeight) return { lines, lineHeight };
    }
  }
}

function draw(canvas, name, body, { height, top, bottom }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#fff9f0';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#733511';
  ctx.fillRect(0, 0, width, top + 280);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffdbc0';
  ctx.font = `600 35px ${font}`;
  ctx.fillText('我想對', inset, top + 61);
  ctx.fillStyle = '#fff9f0';
  ctx.font = `700 78px ${font}`;
  ctx.fillText(`${name}說`, inset, top + 120, textWidth);

  ctx.fillStyle = '#232020';
  const contentTop = top + 345;
  const contentBottom = height - bottom - 160;
  const layout = fit(ctx, body, contentBottom - contentTop);
  if (!layout) throw new Error('Share card text does not fit');
  const textTop = contentTop + Math.round((contentBottom - contentTop - layout.lines.length * layout.lineHeight) / 4);
  layout.lines.forEach((line, index) => ctx.fillText(line, inset, textTop + index * layout.lineHeight));

  ctx.fillStyle = '#c97a49';
  ctx.fillRect(inset, contentBottom + 25, textWidth, 2);
  ctx.fillStyle = '#733511';
  ctx.font = `500 30px ${font}`;
  ctx.fillText('puma-academic.observe.tw', inset, contentBottom + 60);
}

export function openCommentShareCard(parent, name, body, focusTarget) {
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
  canvas.width = width;
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
  controls.append(formatButtons, actions, status);
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

  function render(format) {
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
      canvas.height = format.height;
      draw(canvas, name, body, format);
      canvas.toBlob((blob) => {
        if (version !== requested || !dialog.open) return;
        if (!blob) {
          retry();
          return;
        }
        file = new File([blob], `我想對${name}說－${format.label}.png`, { type: 'image/png' });
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
      retry();
    }
  }

  parent.append(dialog);
  dialog.showModal();
  render(formats[0]);
}
