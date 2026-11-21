const width = 1080;
const height = 1350;
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

function draw(canvas, name, body) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#fff9f0';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#733511';
  ctx.fillRect(0, 0, width, 280);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffdbc0';
  ctx.font = `600 35px ${font}`;
  ctx.fillText('我想對', inset, 61);
  ctx.fillStyle = '#fff9f0';
  ctx.font = `700 78px ${font}`;
  ctx.fillText(`${name}說`, inset, 120, textWidth);

  ctx.fillStyle = '#232020';
  const contentTop = 345;
  const contentBottom = 1190;
  const layout = fit(ctx, body, contentBottom - contentTop);
  if (!layout) throw new Error('Share card text does not fit');
  const textTop = contentTop + Math.round((contentBottom - contentTop - layout.lines.length * layout.lineHeight) / 4);
  layout.lines.forEach((line, index) => ctx.fillText(line, inset, textTop + index * layout.lineHeight));

  ctx.fillStyle = '#c97a49';
  ctx.fillRect(inset, 1215, textWidth, 2);
  ctx.fillStyle = '#733511';
  ctx.font = `500 30px ${font}`;
  ctx.fillText('puma-academic.observe.tw', inset, 1250);
}

export function commentShareCard(name, body) {
  const panel = document.createElement('section');
  panel.className = 'comment-share';
  const title = document.createElement('h4');
  title.tabIndex = -1;
  title.textContent = '留言已公開';
  const hint = document.createElement('p');
  hint.textContent = '可以把字卡貼到 Instagram、Facebook 等平台。';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.hidden = true;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `我想對${name}說：${body}`);
  const actions = document.createElement('div');
  actions.className = 'comment-share__actions';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(title, hint, canvas, actions, status);

  function render() {
    actions.replaceChildren();
    status.textContent = '正在製作字卡…';
    try {
      draw(canvas, name, body);
      canvas.hidden = false;
      canvas.toBlob((blob) => {
        if (!blob) {
          showRetry();
          return;
        }
        const file = new File([blob], '我想對你說.png', { type: 'image/png' });
        const payload = { files: [file] };
        if (navigator.canShare?.(payload) && navigator.share) {
          const share = document.createElement('button');
          share.type = 'button';
          share.textContent = '分享字卡';
          share.addEventListener('click', async () => {
            status.textContent = '';
            try {
              await navigator.share(payload);
            } catch (error) {
              if (error.name !== 'AbortError') status.textContent = '無法開啟分享選單，請下載字卡。';
            }
          });
          actions.append(share);
        }
        const download = document.createElement('button');
        download.type = 'button';
        download.textContent = '下載字卡';
        download.addEventListener('click', () => {
          const url = URL.createObjectURL(file);
          const link = document.createElement('a');
          link.href = url;
          link.download = file.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        });
        actions.append(download);
        status.textContent = '';
      }, 'image/png');
    } catch {
      showRetry();
    }
  }

  function showRetry() {
    status.textContent = '字卡暫時無法製作。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重新製作字卡';
    retry.addEventListener('click', render);
    actions.append(retry);
  }

  render();
  return { panel, title };
}
