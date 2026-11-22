# 教授資料收集與審核

- 預設分支的 `data/` 是網站建置使用的資料，並非 production 留言資料庫的備份。
- `data/professor-profiles` 分支只接收 `profile-collection/runs/*.json` 候選報告和 `profile-collection/state.json` 收集進度。不要部署或整條合併這個分支。
- 由助理接到收集任務後執行，預設每批 20 筆。優先處理缺欄較多者，走完會重新從開頭巡查；來源查詢失敗時不推進進度。
- 正式收集時，先同步 `data/professor-profiles` 的獨立 checkout，再從網站資料所在的 checkout 執行腳本，將 `--output` 指向資料分支 checkout 裡的 `profile-collection/`。核對新報告與進度後，只把這兩個檔案提交到資料分支；下次從相同的進度繼續。試跑則用 `/tmp/`，不寫分支。
- GitHub Actions 只保留手動備用，沒有排程。即使工作流程合併到預設分支，也不會自行執行；手動試跑預設只提供 JSON artifact，勾選 `publish` 才會寫入資料分支。

## 本機試跑

```sh
python3 scripts/collect_professor_profiles.py --inventory > /tmp/professor-profile-inventory.json
python3 scripts/collect_professor_profiles.py --output /tmp/puma-professor-profiles --limit 20
```

`--inventory` 不連網；收集模式可用 `--moe-csv 路徑` 讀取已下載的教育部 114 學年度教師學術專長 CSV。教育部換版時須核對新欄位、調查日期和來源，再更新程式。無法與 CSV 唯一比對時，報告會標為 `no_exact_match` 或 `ambiguous`，並保留已知連結供人工追查。這批來源不涵蓋所有海外、退休或非大專教師，也不保證 Commons 的圖片搜尋有結果。

## 發布前審核

1. 以 `section` 和 `raw` 找到署名紀錄，再用校系、職稱與官方人物頁確認身分。教育部資料是指定日期的快照，不能直接當成現職。查不到就留空，不用姓名單獨認定。
2. 新研究詞與任職來源分別整理進 `data/person-research.json` 和 `data/affiliation-sources.json` 或 `data/research/`。保留對應的公開來源，不改人物 ID，不蒐集私人聯絡資訊。
3. Commons 結果只是候選，未下載圖檔。確認照片主角、授權、署名及是否允許裁切後，才依 `data/portraits/README.md` 的格式新增；不確定就不要進網站資料。
4. 從預設分支另開發布 PR，只帶已核對的 `data/` 變更。檢查來源與人物對應，執行 `npm ci`、`npm run build`，確認署名、研究領域與頭像沒有接錯再合併。

## 目前採用的流程（2026-11）

- 工作分支 `data/professor-profiles` 直接存放已審核的資料：`data/person-research.json`、`data/portraits/`（`enr-*`）、`data/research/enr-*.json`、`data/emblems/`（`enr-*`），以及 `profile-collection/` 內的任務檔與子代理原始輸出。
- 子代理依 `profile-collection/AGENT_BRIEF.md`（人物）與 `LOGO_BRIEF.md`（機構 logo）作業，輸出到 `profile-collection/enrichment/`；由 `scripts/merge_profile_enrichment.py`、`scripts/merge_logo_enrichment.py` 驗證後合併。人物審核規則：官方人物頁、同一人才採用；生活照、太小、身分推定者剔除。
- 頭像用 `scripts/portrait_normalize.py`（OpenCV YuNet 臉部偵測）統一臉寬約畫面 44%；只放大不補邊。Logo 用 `scripts/make-logo.mjs` 等比置中成 256 × 256 透明底 WebP。這些工具需要 sharp 與 opencv（安裝在 `~/.cache/puma-img/`，不在 repo）。
- 頭像授權：官網照片標註「版權屬原權利人，未取得開放授權」，是專案擁有者明確決定的取捨。
- WebSearch 每個回合上限 200 次（所有子代理共用），超過就等下一個回合。
