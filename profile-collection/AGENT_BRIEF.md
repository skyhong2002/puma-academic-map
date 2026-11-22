# 教授資料收集：子任務說明

你負責一個任務檔（`profile-collection/tasks/batch-NNN.json`，約 30 人）。目標是替每個人補上**頭像**與**研究主題**（任務檔的 `need` 欄列出缺哪些）。工作目錄：`/home/deck/Projects/puma-profile-data`。

## 你可以做的事

- 用 WebSearch / WebFetch / `curl` 查公開網頁。對同一網站請求間隔至少 1 秒，單次下載限 10 MB、逾時 30 秒，請設 User-Agent（例如 `PumaAcademicProfiles/1.0`）。
- 把下載的原圖放在 `/tmp/puma-enrich/batch-NNN/`（自行建立）。
- 把結果寫成**一個** JSON 檔：`profile-collection/enrichment/batch-NNN.json`（格式見下）。
- 用 `node scripts/make-portrait.mjs <原圖> <預覽.webp> [left,top,width,height]` 預覽 256×256 成果，預覽也放在 `/tmp/puma-enrich/batch-NNN/`，再用 Read 工具**看過預覽圖**。

## 你不可以做的事

- 不要執行任何 git 指令，不要修改 `data/`、`src/` 或其他任何現有檔案；只新增你自己的 enrichment JSON。
- 不要蒐集私人資訊（電子郵件、電話、住址、社群帳號）。不要登入任何網站、不要繞過付費牆或存取限制。

## 身分確認（最重要）

署名原文（`raw`）寫著人名與機構／系所／職稱。只有在**網頁上的姓名、機構、系所都與 `affiliation_text` 一致**時，才採用該人的資料。同名同姓、機構不符、無法確定是同一人 → 一律略過，寧缺勿錯。教育部資料與舊職稱可能與現職不同：若頁面顯示是同一人但已轉任他校，只要能確定是同一人（例如同一研究領域、同一履歷），可採用並在 `note` 說明。

## 研究主題

- 優先來源：機構官網的個人頁或系所教師頁、本人研究室網站、Google Scholar 個人頁、ORCID、OpenAlex、系所「研究領域／專長」欄位。
- 每人 2–6 個關鍵詞，用頁面上的原字詞（中文或英文皆可，不要自己翻譯或總結），每個關鍵詞附上**實際看到該詞的網頁 URL**（https）。不要杜撰、不要用泛稱（如「教育」「研究」）。
- 若找到 Google Scholar 個人頁，填 `scholar`（`https://scholar.google.com/citations?user=...`）。

## 頭像

- 只用該人**官方人物頁**（機構、系所、研究室、本人個人網站）上、頁面明確標示為該人的單人照片。不要用群體照、活動照、校徽、預設佔位圖、卡通圖、過小（短邊 < 150 px）的圖。
- 下載原圖後預覽並**實際查看**：臉要清楚、居中、單人；需要時給 `crop`（原圖像素 left,top,width,height），讓頭肩落在正方形中。看不出是正常人像就放棄。
- `source_url` 填照片所在的**網頁**（不是圖檔網址）。`credit` 格式：`來源：<機構／單位>官網人物頁，版權屬原權利人，未取得開放授權；縮圖與 WebP 轉檔；頭肩方形裁切`（若頁面標示 CC 或政府開放授權，改寫實際授權）。

## 任職來源（只在 `need` 含 `affiliation` 時；通常不用）

任務檔沒有此需求就不用填 `sources`。

## 輸出格式

```json
{
  "batch": 1,
  "people": [
    {
      "section": "（照抄任務檔）",
      "raw": "（照抄任務檔，逐字相同）",
      "research": {"keywords": [{"label": "Semantic memory", "source": "https://..."}], "scholar": null},
      "portrait": {"image_path": "/tmp/puma-enrich/batch-001/xxx.jpg", "crop": null,
                   "source_url": "https://...", "credit": "來源：…"},
      "note": "簡短說明：找到什麼、為何略過"
    }
  ]
}
```

- 沒找到的欄位直接省略（例如只有研究、沒有頭像就不放 `portrait`）。每個任務檔裡的人都要有一筆（找不到任何資料的人只留 `section`、`raw`、`note`）。
- `raw` 必須與任務檔逐字相同，否則會被拒收。
- 寫完用 `python3 -c "import json;json.load(open('profile-collection/enrichment/batch-NNN.json'))"` 確認 JSON 合法。

## 提高命中率的做法

- 任務檔內的人已**依機構排序**。先找出該機構的教師名錄頁（例如 `site:機構網域 師資`、系所「師資陣容」頁），一次抓整份名錄，再一次比對同機構的多位署名者；比逐人搜尋有效率得多。
- 學校官網的教師頁通常同時有「研究領域／專長」和照片，兩者一次取得。照片網址常在頁面 HTML 的 `<img src>` 或 `og:image`；用 `curl -sL` 取回 HTML 再解析。
- 若網站被 Cloudflare 擋（403），不要繞過，換其他來源即可。
- 預覽圖要實際查看。頭像品質判定寫進 `note`：只放「正式或半正式單人肖像、臉部清楚」的；**生活照、側面、背景雜亂、臉太小、被截斷、身分不確定的一律不放 `portrait`**（可在 `note` 說明）。
- 研究關鍵詞只採用頁面明列的專長／研究領域／研究興趣；不要用 OpenAlex 的自動主題標籤、課程名稱或單篇新聞。

## 回報

最後只回報：處理人數、找到研究主題的人數、找到頭像的人數、找不到的主要原因（一兩句），以及任何你覺得有問題的來源。不要貼出整份 JSON。時間有限，先處理有機會找到的人，再回頭處理難找的；不要在單一個人身上花超過 6–7 次搜尋。
