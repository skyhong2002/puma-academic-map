# 機構 logo 收集：子任務說明

任務檔 `profile-collection/logo-tasks/logo-NN.json` 列出缺 logo 的學術機構（`name` 為地圖上的機構名稱，`people` 為關聯署名人數）。工作目錄：`/home/deck/Projects/puma-profile-data`。

## 要做的事

1. 為每個機構找官方 logo／校徽（優先順序：Wikimedia Commons 的 SVG／高解析 PNG → 機構官網的標誌或識別系統頁）。**正方形最好；非正方形也要收**，轉檔工具會等比置中留白，不會變形。
2. 下載到 `/tmp/puma-logos/logo-NN/`（用 `curl -sL`，設 User-Agent，間隔至少 1 秒，單檔 ≤ 10 MB）。
3. 用 `node scripts/make-logo.mjs <原檔> /tmp/puma-logos/logo-NN/<slug>.webp` 預覽，並**用 Read 工具實際看過**確認是該機構（不是其他學校、不是舊版、不是整張網頁截圖、不是模糊縮圖）。
4. 寫成 `profile-collection/enrichment/logo-NN.json`（格式見下）。

## 注意

- 確認是**同一機構**：校名／研究機構名完全相符。名稱若只是別名（例如「台南應用科技大學」就是「臺南應用科技大學」、「國立交通大學」已併入陽明交大），在 `alias_of` 填現有的正式名稱，不要重複找 logo；不確定就留言於 `note`。
- 不要執行 git 指令、不要修改 `data/` 或 `src/`；只新增你的 enrichment JSON。
- WebSearch 次數有限且與其他代理共用，能直接 WebFetch 機構首頁或 Commons 檔案頁就不要搜尋；用完就改用直接抓取，不要繞過限制。
- `credit` 如實寫來源與授權：Commons 的 logo 常標示 PD-textlogo／公有領域或 CC，照頁面寫；官網取得者寫「機構官網標誌，版權屬該機構，用於地理識別」。`license_url` 填授權頁或 Commons 檔案頁。

## 輸出格式

```json
{"batch": 1, "institutions": [
  {"name": "（照抄任務檔）",
   "logo": {"image_path": "/tmp/puma-logos/logo-01/xxx.svg", "source_url": "https://…（logo 所在頁面）",
            "license_url": "https://…", "credit": "…", "usage": "以原始圖形作非商業地理識別，保留原色彩和比例。"},
   "alias_of": null, "note": "簡短說明"}
]}
```

找不到就只留 `name` 和 `note`。最後只回報：找到幾個、沒找到的原因、有疑慮的來源（200 字內）。
