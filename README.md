# 支持沈伯洋的學術界公開署名地圖

規劃以互動地圖呈現[學術後援會公開名單](https://sites.google.com/view/academic-kouenkai-for-puma/)所列的機構分布。全臺視圖包含離島，放大後可查看當地機構與原站公開署名。地圖座標代表公開的機構或校區位置，署名和職稱均附來源與資料日期。

## 名單匯入與校區定位

1. 用 Python 解析 Google Sites 的公開 HTML，匯入共同領銜與會員名單，涵蓋教授、研究員、退休及海外學者。保留原文、原站段落、來源網址與擷取時間，另產生結構化 JSON。
2. 用原站段落逐一核對擷取筆數，保存無法解析的條目。保留同名但不同機構的記錄，並追蹤每次更新的新增、移除與修正。來源失效或版面變更時沿用上一份有效資料。
3. 建立機構及校區對照表，以機構公開地址及官方校區頁為定位依據，記錄縣市、校區、座標、來源與查核日期。同一機構的署名者共用校區標記。海外、退休或校區不明的條目保留在名單，只有可確認的臺灣機構列入地圖。
4. 將原站所列職稱與後續可查證的任職資訊分欄顯示。頁面標明統計口徑與覆蓋率，並提供原始名單連結與更正入口。

## 地圖介面

- 第一版採 Vite 與 Leaflet，使用靜態 JSON 和 GeoJSON。全臺視圖在機構座標上聚合署名者點位，放大後可查看個別署名、職稱、機構及來源。
- 提供姓名、機構與縣市搜尋，並保留可用鍵盤操作的清單。手機用下方清單呈現選取機構。
- 可加入縣市署名人數著色，圖例註明統計為可定位的署名人數。同名及多重任職的計數口徑須一致。

## 網域與部署

正式站使用 `puma-academic.observe.tw`，由 Cloudflare Tunnel 將流量轉送到 `sky-server` 的靜態網站服務。

部署時在 `main` 執行 `npm ci` 和 `npm run build`，並將 `dist/` 發布到主機。部署後確認首頁、靜態資源、搜尋與離島瀏覽。

### GA4 網站分析

在 GA4 為 `https://puma-academic.observe.tw/` 建立專用的網站資料串流，關閉該串流的「加強型評估」，並在建置環境設定 `VITE_GA_MEASUREMENT_ID`（`G-` 開頭）。本機建置可寫在 `.env.production.local`。重新執行 `npm run build` 並發布後，只有正式網域會載入 Google tag。

- `page_view`：瀏覽頁面，保留 `utm_*` 推廣參數及來源網站的網域。
- `view_academic_location`：開啟校區或系所資訊。
- `use_directory_search`：每次載入頁面，第一次輸入搜尋內容時計一次。
- `click_signup_link`：點選登記表連結。

自訂事件只傳事件名稱。發布後，在 GA4「即時」報表確認頁面瀏覽與自訂事件。

## 交付順序

1. 完成擷取器、原站筆數核對與資料更新差異。
2. 建立機構對照表，抽查跨縣市、多校區、離島與海外條目。
3. 完成全臺地圖、搜尋與名單，驗證聚合數量、放大與校區詳情。
4. 發布至 sky-server 並綁定子網域，完成正式站驗證。

目前已有靜態網站首版。地圖支援縣市下鑽與離島小地圖，名錄可搜尋姓名、機構及校區。

```sh
npm ci
npm run dev
npm run build
```

## 更新資料

```sh
python3 scripts/import_signatories.py
python3 scripts/check_institutions.py
python3 scripts/check_institutions.py 臺灣大學
python3 scripts/check_institutions.py --unmatched
```

- `data/signatories.json` 是公開名單快照，按原站段落保存。重新匯入會列出新增與移除的原文，修正會以一筆移除和一筆新增呈現。
- `data/institutions/` 保存可手動維護的機構清單。每筆列出機構正名、原站使用的別名、機構網址、官方校區地址與查核日期。新增別名前，先確認它指向同一機構。
- 別名比對只提供機構候選，供後續查核。遇到多個單位或多校區，需要根據署名原文與官方資料確認地圖點位。

## 地圖圖資

縣市界線由內政部國土測繪中心提供，依[政府資料開放授權條款第 1 版](https://data.gov.tw/license)使用。本站以 22 縣市為瀏覽入口，將圖形裁切到臺澎金馬周邊並簡化，供網頁互動顯示。圖形僅供導覽使用。[官方資料集](https://data.gov.tw/dataset/7442) · [GeoJSON 轉製來源](https://geo.maderaojen.me/datasets/tw-counties/releases/v1/2026-08-07.1/data.geojson)

互動流程參考 [taiwan-election-map](https://github.com/twoheart1222/taiwan-election-map) 的全臺視圖、點選縣市下鑽及區域詳情面板。本站以縣市連到機構和校區目錄，依官方資料列出校區地址。

### 個別署名的學術單位來源

在 `data/affiliation-sources.json` 以原站段落與完整署名原文索引每筆資料，避免只依姓名把來源套給同名者。每筆可以有多個來源，各自填寫 `label`（來源類型）、`description`（頁面實際支持的職稱、單位或學術經歷）與 `url`（直接連到可核對人名與學術關係的頁面）。原站更正署名時，重新核對後再將來源連到更新後的原文。

## 授權

本站程式碼採用 [MIT License](LICENSE)。縣市圖資依上方資料來源與授權說明使用。

可用[教育部下載專區](https://udb.moe.edu.tw/ulist/Resource)的 114 學年度教師學術專長 CSV 批次補資料。執行 `python3 scripts/import_moe_affiliations.py 路徑.csv`。程式以姓名、校名與系所交叉比對；原文只有校名與職級時，要求同校同職級只有一筆記錄。連結指向教育部原始名錄，說明中的校系與職級取自 2025 年 10 月 15 日調查資料。

[頭像檔案與授權](data/portraits/README.md)記錄照片歸屬、來源與使用條件。

114 學年度資料以外，也可用[教育部 108 學年度資料集](https://data.gov.tw/dataset/27931)補歷史任職資料。執行同一支匯入器時，在 CSV 檔名後加 `108`。

### 署名者地圖

地圖使用具有學術關係證據的機構座標。臺灣機構座標使用內政部國土測繪中心的[文教設施資料](https://data.gov.tw/dataset/139251)與[醫療設施資料](https://data.gov.tw/dataset/139250)，海外據點的地點來源與個別學術單位來源收錄在 `data/research/`，部分機構座標來自 [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)。世界底圖使用 [Natural Earth 1:110m Admin 0 國界](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/) v5.1.2，範圍略去南極洲。

每個點屬於一筆署名與一個有證據的機構。同一署名可以對應多個機構，地圖上的「已定位」計數排除同一段落內完全相同的重複原文。地圖放大後可逐人查看，重疊的點會在同一位置展開。點位代表機構所在位置；多校區機構的點可能位於代表校區。
