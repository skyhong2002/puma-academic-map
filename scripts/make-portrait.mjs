// 把原圖轉成 256 × 256 WebP 頭像。
// 用法：node make-portrait.mjs <輸入圖> <輸出.webp> [left,top,width,height]
// 裁切座標以原圖像素計；省略時用 sharp 的視覺焦點（attention）自動裁切。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// sharp 安裝在專案之外（~/.cache/puma-img），可用 SHARP_FROM 指向其他安裝目錄。
const require = createRequire(process.env.SHARP_FROM || path.join(os.homedir(), '.cache/puma-img/'));
const sharp = require('sharp');

export async function makePortrait(input, output, crop) {
  let image = sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height || meta.width < 96 || meta.height < 96) {
    throw new Error(`圖片太小：${meta.width}×${meta.height}`);
  }
  if (crop) {
    const [left, top, width, height] = crop;
    if (left < 0 || top < 0 || width < 64 || height < 64 || left + width > meta.width || top + height > meta.height) {
      throw new Error(`裁切範圍超出原圖 ${meta.width}×${meta.height}`);
    }
    image = image.extract({ left, top, width, height });
  }
  await image
    .resize(256, 256, { fit: 'cover', position: crop ? 'centre' : 'attention' })
    .webp({ quality: 82 })
    .toFile(output);
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, output, cropText] = process.argv.slice(2);
  if (!input || !output) {
    console.error('用法：node make-portrait.mjs <輸入圖> <輸出.webp> [left,top,width,height]');
    process.exit(2);
  }
  const crop = cropText ? cropText.split(',').map(Number) : null;
  if (crop && (crop.length !== 4 || crop.some((value) => !Number.isInteger(value)))) {
    console.error('裁切格式須為 left,top,width,height（整數）');
    process.exit(2);
  }
  const meta = await makePortrait(input, output, crop);
  console.log(`原圖 ${meta.width}×${meta.height} → ${output}`);
}
