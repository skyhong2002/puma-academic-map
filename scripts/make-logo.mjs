// 把機構 logo 轉成 256 × 256 透明底 WebP：等比縮放置中，不裁切、不變形（非正方形者上下或左右留白）。
// 用法：node make-logo.mjs <輸入圖(png/jpg/svg/webp)> <輸出.webp>
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(process.env.SHARP_FROM || path.join(os.homedir(), '.cache/puma-img/'));
const sharp = require('sharp');
const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('用法：node make-logo.mjs <輸入> <輸出.webp>'); process.exit(2); }
const meta = await sharp(input, { density: 300, limitInputPixels: 80_000_000 }).metadata();
if (!meta.width || !meta.height || Math.max(meta.width, meta.height) < 64) { console.error('圖片太小'); process.exit(1); }
await sharp(input, { density: 300 })
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(output);
console.log(`原圖 ${meta.width}×${meta.height}（${meta.format}）→ ${output}；${meta.width === meta.height ? '正方形' : '非正方形，已置中留白'}`);
