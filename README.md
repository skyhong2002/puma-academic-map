# 沈伯洋學界後援會署名地圖

[<img src="assets/puma-signature.webp" alt="署名地圖標誌" width="96" height="96">](https://puma-academic.observe.tw/)

[**開啟署名地圖**](https://puma-academic.observe.tw/) · [查看原始聯署名單](https://sites.google.com/view/academic-kouenkai-for-puma/)

這張地圖把沈伯洋學界後援會的公開署名，整理成可以按姓名查找、也可以從校區和系所瀏覽的名錄。點進一筆署名，就能看到原始名單怎麼寫，以及本站找到哪些公開資料可以核對。

本站是獨立製作的粉絲專案。學界後援會維護原始名單與登記表。[前往後援會登記表](https://forms.gle/joAmvcST4U4jUX137)

## 怎麼用

1. **想找一個人**，就在上方輸入姓名。也可以用學校或系所名稱搜尋。
2. **想看一個校區有哪些人署名**，就放大地圖，點選校區或系所，再點姓名。地圖也能瀏覽臺灣離島和海外機構。
3. **想看研究方向**，可在人物頁查看研究關鍵字。頁面下方的「相關研究者」會列出有共同研究主題的署名者，點姓名就能換到對方的頁面。展開「參考資料」可以看到關鍵字、任職或點位的公開來源。

每筆署名都有公開留言板。留言限 500 字純文字，名字和個人網站可以留空。送出後會公開顯示，也可以回到原本的瀏覽器編輯。

## 資料怎麼整理

- **姓名與身分**沿用原始聯署文字。名單的最後更新時間標在地圖首頁，沒有地圖點位的署名仍可在名錄搜尋。
- **地圖位置**依公開的校區、系所或機構地址查證。查到系館時會標在系館，只能確認到校區時就用校區點位。同一筆署名可能有多個任職地點。署名代表個人意見，校徽與機構名稱用於辨識地點。
- **研究關鍵字**整理自公開的校方或研究機構頁面、教育部師資資料、著作與學術個人檔案。每個人的資料量會因公開來源而異。相關研究者以共同關鍵字配對，例如「漫畫創作」與「漫畫史」會配對到共同主題「漫畫」。
- **更正資料**可以到 GitHub 開 issue，附上人物姓名、需要更正的內容和可核對的來源。署名原文的更新請以後援會名單為準。[回報地圖資料問題](https://github.com/skyhong2002/puma-academic-map/issues)

正式站使用 Google Analytics 統計瀏覽和功能使用次數。自訂事件記錄搜尋、開啟校區資料及點選登記表等操作的事件名稱。

## 分支與資料存放

資料和實作分開在不同分支，請不要整條合併資料分支。

| 分支 | 放什麼 | 說明 |
| --- | --- | --- |
| `main` | 網站程式與已發布的資料 | 正式站的基準，`data/` 是建置使用的資料。 |
| `data/professor-profiles` | **收集到的人物資料**：頭像（`data/portraits/enr-*`）、研究關鍵字（`data/person-research.json`、`data/research/enr-*.json`）、機構標誌（`data/emblems/enr-*`）、系所位置（`data/units/`、`data/institutions/`），以及收集紀錄 `profile-collection/` | 只放資料。收集、審核後先存在這裡，再依需要部署。 |
| `feature/unit-label-aliases` | **實作**：`src/departments.js`（把簡稱與全名歸為同一系所）、`data/unit-aliases.json`，和收集用的工具腳本與流程文件 | 資料分支的新資料需搭配它才能正確分組，兩者要一起合併。 |

- 要找某位人物新增的頭像或研究關鍵字，到 `data/professor-profiles`。
- 要改收集或合併的程式、頭像臉部統一、標誌轉檔，到 `feature/unit-label-aliases`（`scripts/` 與 `docs/professor-profile-collection.md`）。
- 資料分支的收集進度（任務檔、審核結果）在 `profile-collection/`；production 並不會從分支自動部署，部署流程見下方「正式站部署」。

## 圖資、照片與授權

- 底圖使用 OpenStreetMap，資料採 ODbL 授權。[OpenStreetMap 版權與授權](https://www.openstreetmap.org/copyright)
- 臺灣縣市界線來自內政部國土測繪中心，採政府資料開放授權。本站使用簡化後的界線作為瀏覽導覽。機構位置以公開校區資料及文教、醫療設施資料為主。[縣市界線](https://data.gov.tw/dataset/7442) · [GeoJSON 轉製來源](https://geo.maderaojen.me/datasets/tw-counties/releases/v1/2026-08-07.1/data.geojson) · [文教設施](https://data.gov.tw/dataset/139251) · [醫療設施](https://data.gov.tw/dataset/139250) · [政府資料開放授權條款](https://data.gov.tw/license)
- 世界國界來自 Natural Earth v5.1.2，地圖互動參考 taiwan-election-map。[Natural Earth 國界資料](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/) · [taiwan-election-map](https://github.com/twoheart1222/taiwan-election-map)
- 人物照片依個別來源和條件使用，程式碼採 MIT 授權。[照片來源與授權](data/portraits/README.md) · [MIT License](LICENSE)

Caro Shih、Sky Hong

<details>
<summary>開發與維護</summary>

### 在自己的電腦上執行

使用 Node.js 24。安裝套件並啟動開發伺服器後，開啟終端機顯示的網址。

```sh
npm ci
npm run dev
```

要測試留言，在另一個終端機執行 `npm run comments`。前端開發伺服器會把留言請求轉到本機的留言服務。執行 `npm run build` 可在 `dist/` 產生網站檔案。

### 更新名單與來源

```sh
python3 scripts/import_signatories.py
python3 scripts/check_institutions.py
python3 scripts/check_institutions.py --unmatched
```

- [名單快照](data/signatories.json)依原站段落保存署名原文。重新匯入會列出新增和移除的文字，改過的原文會以一筆移除和一筆新增呈現。
- [機構資料](data/institutions/)保存機構別名和校區地址。檢查工具會列出機構名稱的比對候選。確定校區時，請一起核對署名與機構公開資料。
- [任職來源](data/affiliation-sources.json)、[已核對的個別資料](data/research/)和[研究關鍵字](data/person-research.json)保存可追溯的來源。人物資料以原站段落和完整署名原文辨識，避免把資料接到同名者。
- 要用教育部師資資料補任職來源，執行 `python3 scripts/import_moe_affiliations.py 路徑.csv`。預設讀 114 學年度資料，使用 108 學年度檔案時在檔名後加上 `108`。[114 學年度下載專區](https://udb.moe.edu.tw/ulist/Resource) · [108 學年度資料集](https://data.gov.tw/dataset/27931)

### 正式站部署

正式站由 Cloudflare Tunnel 將流量轉到 `sky-server` 的 Nginx。Nginx 提供 `dist/` 的網站檔案，並把 `/api/people/` 轉到留言服務。正式環境的留言 API 使用 Cloudflare 提供的來源 IP 進行限速。

在同一份發布版本建置網站與留言服務。正式站沿用既有的 Compose project、主機設定與留言資料卷。

```sh
npm ci
npm run build
docker compose -p puma-comments-candidate -f deploy/compose.yml \
  -f ~/Projects/puma-academic-map/comments-production.yml up -d --build --wait
```

- 主機上的 `comments-production.yml` 保留 Tailscale 預覽設定。需要從預覽站送出留言時，將完整 HTTPS 來源設在 `COMMENTS_PREVIEW_ORIGIN`。
- 留言存在 SQLite，發布時保留 `puma-comments-candidate_comments` 資料卷，備份使用 SQLite 的線上備份功能。變更署名原文或原站段落會改變留言板 ID，已有留言時請同步遷移資料庫的 `comments.person`。
- 正式站的 GA4 評估 ID 由 `.env.production` 提供。自訂事件為 `view_academic_location`、`use_directory_search` 和 `click_signup_link`。發布後可在 GA4 即時報表確認事件，也請實際測試首頁、搜尋、校區和人物留言板。

</details>
