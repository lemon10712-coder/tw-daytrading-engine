# NOTES

決策記錄與踩坑細節，不會自動載入對話 context，需要查細節時才讀。規則本身放 README.md 或 CLAUDE.md（若之後建立），這裡只放「為什麼這樣決定」跟「過程中的細節」。

## 2026-07-31：專案啟動，Phase 0 Task 1（repo 骨架＋族群分類設定檔）

**背景**：使用者提出完整的台股當沖決策輔助系統規格書（20 大區塊：盤前/開盤/盤中/族群/個股/評分/風控/交易日誌/回測），指定用「李股神」人格處理所有股市相關工作。確認這是全新專案，跟現有 `daily-trading-site`／CHARLES AGENT Firebase 版／Charles Trade 交易日誌都無關。完整規劃討論過程與 Phase 0-3 分階段規劃見 Claude Code 對話紀錄（未來若要重建可從 `charles-agent/對話紀錄/` 找當天記錄）。

**架構決策**：
- **儲存**：族群分類等「規則設定」用 JSON（git 版控，diff 可稽核），交易日誌/回測歷史/規則版本這類會持續累積查詢的資料，Phase 2 才建 SQLite（`db/journal.db`），不在 Phase 0 建。
- **自動化**：沿用 `daily-trading-site` 已驗證的模式——GitHub Actions（不是 Claude 雲端 AI routine，因為雲端 AI routine 連不到 TWSE/TAIFEX，Actions runner 可以）＋ cron-job.org 外部觸發（GitHub 原生 schedule 已知不準時，daily-trading-site 踩過兩次）＋ LINE Messaging API 推播（沿用同一個 LINE channel，但新 repo 要重新設定一份 secret，token 值需要使用者重新提供，GitHub secret 不能跨 repo 共用）。
- **資料來源**：Yahoo Finance chart API（`query1.finance.yahoo.com/v8/finance/chart/`）可以抓台股 1 分鐘K線（算VWAP用）跟國際指數/商品（^DJI/^GSPC/^IXIC/^SOX/NVDA/AMD/MU/TSM/DX-Y.NYB/^TNX/CL=F），這在 `daily-trading-site/scripts/backtest.js` 已驗證過。TWSE MIS／TAIFEX MIS 也已驗證可用（僅限 GitHub Actions 環境，雲端 AI routine 會被組織網域白名單擋）。

**族群分類設定檔（`config/sectors.json`）的資料查證狀況**：
- 2026-07-31 用 WebSearch 逐一查證過的族群（`verified: true`）：晶圓代工、記憶體、IC設計、化合物半導體、PCB／載板、被動元件、生技、電線電纜、機器人、重電、網通、光通訊、矽光子、車用電子——共 14 個族群的成分股代號有搜尋來源佐證。
- 查證過程中抓到並修正兩個原本記錯的代號：**宏捷科是 8086，不是 8046**（8046 其實是南電）；**全新（光電）是 2455，不是 6435**。這證明「既有知識」不能直接信，這類族群分類資料之後每次要新增/調整都應該比照這次做法先查證再寫入，不要憑記憶。
- 尚未逐一查證（`verified: false`）：AI伺服器、散熱、面板、航運、金融、塑化、鋼鐵、營建（尤其 2542 興富發代號未經這次搜尋核對）、軍工、觀光、內需消費、ETF權值——共 12 個族群，代號是憑一般知識整理，屬於「合理推測」而非「已查證事實」，需要使用者過目或之後任務裡另外查證。
- 每個族群都有 `verified` 欄位跟必要時的 `reliability_note`，方便之後一眼看出哪些需要優先複查。

**檔案分類設計**：呼應使用者「檔案要分類，不要一次要讀太多」的要求——`data/` 底下依「用途」分四個子資料夾（market-state／sector-radar／premarket／quotes），每個子資料夾內再依日期分檔（`YYYY-MM-DD.json`），任何一次讀取只需要載入當天或近期幾天的檔案，不會隨專案跑越久資料越多而拖慢讀取。`config/sectors.json` 獨立於 `data/`，因為它是規則設定不是歷史資料。

**尚未完成（Task 1 範圍內但還沒做）**：
- `config/thresholds.json`（可調整門檻）尚未建立，README 已預告但留給後續任務

**下一步（Task 2，需使用者確認 Task 1 內容後才開始）**：資料擷取模組——台股 5 分鐘報價＋國際指標＋台指期夜盤抓取程式，含單元測試。

## 2026-07-31：Task 2（資料擷取模組）完成

**做法**：寫程式前先用 `curl` 實際打過四個資料來源確認真實回應格式（不是憑記憶猜欄位名），確認可行後才寫 fetcher 程式：
- TWSE MIS 即時報價（`mis.twse.com.tw/stock/api/getStockInfo.jsp`，支援 `|` 分隔一次查多檔）
- Yahoo Finance chart API（`query1.finance.yahoo.com/v8/finance/chart/`，個股分鐘K線跟國際指標同一支 API）
- TAIFEX MIS 台指期（`mis.taifex.com.tw/futures/api/getQuoteList`，POST 帶 `CID`／`SymbolType` 等參數）
- **新發現**：TWSE OpenAPI 有官方假日行事曆 JSON（`openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`，民國年格式如 `1150101`），比 daily-trading-site 當初的做法（沒有交易日曆檢查、直接被 2026-07-10 颱風休市燒到）更進一步——這裡改成**執行時即時查證**，不寫死年度假日清單在程式碼裡（每年都要手動更新、容易漏），查詢失敗時明確回傳 `isTradingDay: null`（無法驗證），不會誤判成交易日。

**檔案**：
- `scripts/lib/util.js`：共用小工具（數字轉換、五檔字串解析、日期格式轉換）
- `scripts/lib/time.js`：台北時間／交易日曆判斷
- `scripts/lib/twse-quotes.js`：台股即時報價批次查詢
- `scripts/lib/yahoo-finance.js`：分鐘K線／國際指標查詢
- `scripts/lib/taifex-futures.js`：台指期報價查詢
- `scripts/test/*.test.js`：34 個單元測試，全部用真實 API 回應節錄成的 fixture（不依賴即時網路，跑 `npm test` = `node --test`），涵蓋正常解析／HTTP錯誤／API層錯誤（rtcode非0000等）／邊界值（空字串轉null不是0、null分鐘要過濾掉）
- `scripts/dev-check.mjs`：手動即時健檢工具（`npm run dev-check`），不是自動化的一部分，開發時想確認四個來源目前正常再跑

**踩到的坑**：這台機器的 `node --test scripts/test/`（目錄形式）在 Windows 環境下會報 `MODULE_NOT_FOUND`，改成不帶路徑的 `node --test`（讓 Node 自動探索 `*.test.js`）就正常，改用這個寫法比 glob pattern 更簡單也更不依賴 shell 展開行為。

**成交量欄位的誠實標註**：TWSE MIS 回傳的 `tv`／`v`／`ov` 三個欄位語意沒有把握逐一確認（可能是成交量／成交筆數／其他統計量，命名不夠明確），程式裡**沒有假裝知道**，原樣保留在 `rawVolumeFields` 但註明「語意未確認」，VWAP 之類真正需要準確成交量的計算（Task 3）改用 Yahoo 分鐘K線的 `volume`（語意明確：該分鐘成交量）。這是刻意的「不確定就老實標示」而非猜測。

**驗收**：`npm test` 34/34 通過；`npm run dev-check` 實際打過四個真實 API 都成功回應（結果顯示現在是台北時間 07-31 盤前，資料自然是 7/30 收盤快照，交易日曆正確判斷 7/31 為交易日）。

**下一步（Task 3，需使用者確認 Task 2 內容後才開始）**：計算引擎——VWAP／開盤高低點／昨日高低點／族群同步性分數，含單元測試（驗證無 look-ahead）。
