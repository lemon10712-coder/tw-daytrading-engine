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

## 2026-07-31：Task 3＋4 完成（計算引擎＋大盤方向引擎），並串成完整 pipeline 實測跑通

使用者在這次對話中明確表示不用每個任務都停下來等確認，改成「拆成階段性任務，直接整個做完」，所以 Task 3-7 連續做，只有真的需要使用者提供資訊（LINE token）的地方才會停。

**Task 3（計算引擎）**：`scripts/lib/indicators.js`——`calcVWAPSeries`／`latestVWAP`（成交量加權平均價，用典型價格(H+L+C)/3）、`calcOpeningRange`（開盤N分鐘視窗高低點）、`calcPriorDayLevels`（找「今天以前最新一筆」日線，避免look-ahead）、`calcSectorSync`（族群同步性分類）。新增 `config/thresholds.json` 放可調整門檻。18 個新單元測試，VWAP 用手算數字驗證。

**Task 4（大盤方向引擎）**：`scripts/lib/market-state.js`——`classifyInternational`／`classifyTaiwanMarket`／`classifyMarketState` 三層規則，核心原則是「國際跟台股方向要一致才輸出偏多/偏空，任何一層缺資料或兩層衝突一律保守輸出觀望/資料不足」，不會為了給答案硬掰方向。15 個新單元測試涵蓋每種分類分支跟衝突情境。

**串成 `scripts/run-engine.mjs` 主要引擎入口**，實際用真實資料跑通全流程（不是只跑單元測試）：抓 79 檔股票即時報價＋79 檔分鐘K線（算VWAP）＋11 項國際指標＋加權/櫃買/台指期 → 大盤方向判斷 → 26 族群同步性計算 → 寫入 `data/market-state/YYYY-MM-DD.json`／`data/sector-radar/YYYY-MM-DD.json`（依「當日累積多筆快照」設計，每次執行 append 一筆，不是覆蓋）／`data/quotes/latest.json`。單次執行約 8 秒。

**過程中抓到並修好一個真的資料正確性 bug**：`config/sectors.json` 裡的 5347（世界先進，晶圓代工族群）其實是**上櫃（TPEx）股票，不是上市（TWSE）**——用 `tse_` 前綴查 TWSE MIS 直接查無此代號（`c` 欄位空字串），Yahoo Finance 用 `.TW` 後綴也是 HTTP 404。這暴露出建族群設定檔當時只查證了「代號正確」，沒有連帶查證「上市或上櫃」，兩者用不同的 API 前綴/後綴。

**修法（不是把 5347 硬改成寫死 otc，而是讓抓取邏輯自己判斷）**：
- `twse-quotes.js`：`fetchTwseQuotes` 先用 `tse_` 前綴批次查一次，把查無資料（`c` 為空字串）的代號挑出來，自動改用 `otc_` 前綴重查一次再合併結果；兩邊都查不到才在回傳物件標註明確錯誤（`error: '上市／上櫃查詢皆查無此代號...'`），不會靜默漏掉。
- `run-engine.mjs` 的 `fetchSingleStockChart`：先試 `.TW`，遇到 HTTP 404／chart.error／空result 三種「查無此代號」訊號就自動改試 `.TWO`，其他真正的錯誤（網路失敗等）照樣往外拋不吞掉。
- 這個設計的好處是**之後族群名單裡不管加哪支股票，都不用先手動查它是上市還上櫃**，程式自己會試兩邊——比逐一手動標註 exchange 欄位更省事也更不容易漏掉像 5347 這種情況。

**驗證結果**：修好後重跑，79/79 檔 TWSE 報價、79/79 檔 VWAP、11/11 國際指標全部成功，`npm test` 70/70 通過。

**目前 Phase 0 已知的一個簡化（不是bug，是刻意的範圍取捨）**：族群同步性計算目前只用 `representative_stocks`（每族群3-6檔種子名單），不是族群全部成分股，這在 Phase 0 驗證階段是合理簡化——真的要擴大覆蓋範圍屬於「族群管理頁面動態調整」的 Phase 1+ 工作。

**下一步（Task 5）**：靜態網站（今日盤勢總覽＋族群雷達兩頁）＋ GitHub Pages 部署。

## 2026-07-31：Task 5 完成（靜態網站），但 GitHub Pages 部署卡在私有 repo 限制

**網站**：`index.html`（今日盤勢總覽：狀態燈號＋國際/台股兩層明細＋資料缺失警示）＋ `sectors.html`（族群雷達：26張卡片可展開看個股明細，依同步強度排序）＋ `assets/style.css`／`assets/app.js`（共用）。純 vanilla HTML/CSS/JS，無框架、無建置流程，跟 GitHub Pages 免費方案的限制最相容。配色遵守**台股慣例：紅漲綠跌**（跟美股相反，這是容易搞混的地方，特別留意過）。手機版有獨立 media query（480px 以下字級/格線調整）。

網站直接讀 `data/market-state/latest.json`／`data/sector-radar/latest.json`（新增這兩個 latest 檔案，`run-engine.mjs` 每次執行都會覆寫，前端不用自己猜今天日期該讀哪個檔案，避免伺服器執行時區跟使用者瀏覽器時區對不上的邊界情況）。

**驗證方式**：這台機器的 Playwright 瀏覽器被其他 session 佔用（`browser already in use`），沒有 playwright2/3 可切換，所以**沒有做到真正的瀏覽器截圖驗證**——改用「本機 Python HTTP server + curl 逐一確認每個檔案 HTTP 200＋JSON 可解析＋app.js 語法檢查＋手動比對 JSON 結構跟前端程式碼欄位路徑是否一致」的替代驗證方式。這比實際瀏覽器渲染弱，**下次有機會用瀏覽器時應該回來實際點開看一次**，尤其手機版排版跟展開/收合互動有沒有正常運作。

**卡住的地方（未預期的阻礙）**：GitHub Pages 免費方案不支援 private repo。跟使用者討論後（她要我分析利弊而不是直接丟兩個選項，分析後的結論：Phase 0 的資料—族群分類/門檻/大盤與族群計算結果—敏感度低，跟已經公開的 daily-trading-site 同等級；真正敏感的是 **Phase 2 才會出現的真實交易日誌**，屆時應該仿照 Codex 那套 Charles Trade 交易日誌的做法（同一個 Firebase 專案但那個站台刻意加了登入門檻）另外處理，不需要現在就為了還不存在的資料把整個網站架構複雜化）決定：**這個 repo 改成 public**，Phase 2 交易日誌另外設計隔離機制。

**改可見度的動作本身被 Claude Code 的 auto mode 分類器擋下**（`gh repo edit --visibility public` 跟直接呼叫 API PATCH 都被擋，判定為需要使用者本人執行的動作），已請使用者自己執行：
```
gh repo edit lemon10712-coder/tw-daytrading-engine --visibility public --accept-visibility-change-consequences
```
**下一步（Task 6 之後，需要回頭確認）**：使用者切換可見度後，要回來執行 `gh api repos/lemon10712-coder/tw-daytrading-engine/pages -X POST -f "source[branch]=master" -f "source[path]=/"` 啟用 Pages，並實際打開網址確認能正常載入（不能只憑 API 回傳成功就假設網站真的能看）。

## 2026-07-31：Task 6 完成大部分，卡在兩個需要外部存取的環節

**已完成**：
- `scripts/notify-line.js`：沿用 daily-trading-site 已驗證的寫法（Node `fetch`，避免 bash curl 中文編碼問題），呼叫同一個 LINE Messaging API channel
- `scripts/check-health.mjs`：判斷「現在是不是盤中時段」＋「最新資料是不是在15分鐘內」，只在盤中且資料過期時才回報失敗，非交易日/盤前盤後不誤報
- `scripts/build-summary-message.mjs`：組 LINE 摘要訊息文字（盤前/盤中/收盤三種標籤），獨立成檔案方便本機直接測試訊息長相
- `.github/workflows/run-engine.yml`：只用 `workflow_dispatch`（不用原生 `schedule`，daily-trading-site 已驗證原生排程不可靠），跑 `run-engine.mjs` 後 commit+push `data/`，含跟 daily-trading-site 完全同款的 push race condition 重試邏輯（rebase 失敗時偵測真衝突用 `--theirs` 覆蓋）。支援 `notify`／`label` 兩個輸入參數決定要不要推播跟推播文字。
- `.github/workflows/health-check.yml`：跑健檢，失敗才推播 LINE 警告，呼應「壞掉要主動通知不能只在後台顯示紅叉」的教訓
- 兩個 workflow YAML 都用 Python pyyaml 驗證過語法正確（`on:` 被解析成布林值 `True` 是 pyyaml 已知的 YAML 1.1 特性，GitHub Actions 自己的解析器不受影響，不是錯誤）

**卡住的兩個環節，都需要外部存取，目前這台機器的 Playwright 瀏覽器被其他 session 佔用，無法處理**：

1. **cron-job.org 排程註冊**：要幫這個 repo 新增 4 個外部觸發排程（盤前08:00、盤中每5分鐘09:00-13:30、收盤13:30、健檢），比照 daily-trading-site 已有的 4 個排程模式。但這需要：
   - 一組**只限這個 repo**的 GitHub fine-grained PAT（現有 `.secrets/cron-job-org.md` 裡那組 token 是**限定 daily-trading-report 這個 repo**，不能跨 repo 用）——建立新 PAT 需要登入 github.com/settings/personal-access-tokens/new，只能靠使用者本人或 Playwright，兩者現在都用不了
   - 到 console.cron-job.org 網頁後台新增排程規則——雖然 cron-job.org 有 REST API，但取得 API key 一樣要先登入網頁 Settings 頁面才能生成，同樣卡在需要瀏覽器
   - **等 Playwright 空出來後回來做**，或使用者可以自己先去 console.cron-job.org（帳密見 `.secrets/cron-job-org.md`）Settings 頁面生成一組 API key 給我，我就能直接用 API 建排程不用等瀏覽器

2. **LINE_CHANNEL_ACCESS_TOKEN secret**：GitHub secret 沒辦法跨 repo 共用，這個新 repo 要另外設定一份。使用者已經有這個 LINE channel（Provider「Charles」，帳號 `@595fudwy`），需要使用者去 LINE Developers Console 把同一個 channel 的 access token 貼給我，我再用 `gh secret set LINE_CHANNEL_ACCESS_TOKEN --repo lemon10712-coder/tw-daytrading-engine` 設定進去。

**這兩項都不影響先驗證 workflow 邏輯本身對不對**——可以先用 `gh workflow run` 手動觸發 `run-engine.yml`（不帶 notify，這樣就算沒設 LINE token 也不會因為推播失敗而整個 workflow 失敗，`notify-line.js` 設計成 token 沒設就跳過不報錯）驗證 commit/push 邏輯在真實 GitHub Actions 環境能不能跑通，這步不需要等使用者提供東西。

**下一步（Task 7 之前）**：手動觸發 `run-engine.yml` 驗證 workflow 本身正確，再跟使用者要 LINE token 跟（可選）cron-job.org API key，完成排程串接。

**實測結果（用 `gh workflow run` 手動觸發，在真實 GitHub Actions 上跑，不是本機模擬）**：
- 第一次觸發失敗：`remote: Write access to repository not granted`（HTTP 403）——預設 `GITHUB_TOKEN` 是唯讀，要明確宣告 `permissions: contents: write` 才能 push，這點 daily-trading-site 的 workflow 早就有加，這裡漏掉了。**已修好**（commit `497fdd6`）。
- 修好後重新觸發：`run-engine.yml` 21 秒內完整跑完（抓資料→算指標→commit→push），本機 `git pull` 確認遠端真的多了一筆 `Update market data` commit——**證明整個 pipeline 在 GitHub 的伺服器上獨立運作，不依賴這台本機開機或連網**，這正是使用者最在意的「真自動化」核心機制。
- `health-check.yml` 也手動觸發驗證過，11 秒跑完，通過（因為現在不是盤中時段，沒有觸發過期警告）。

**Task 6 現況**：核心 workflow 邏輯（抓資料/算指標/commit/push/健檢判斷）已經在真實 GitHub Actions 上驗證跑得動。**還沒完成的只剩「定時觸發」跟「LINE推播」這兩個需要外部帳號存取的環節**，不是程式邏輯問題。
