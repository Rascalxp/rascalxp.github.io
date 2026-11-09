# 台股盤後看板

網址：https://rascalxp.github.io/
管理後台：https://rascalxp.github.io/admin.html

一頁式 RWD 網站，分四段：

1. **法人籌碼**：三大法人（外資、投信、自營商）買賣超金額，以及散戶微台口數增減與淨未平倉
2. **類股成交比重**：上市類股依「成交比重增減」或漲跌幅列 6 類，可切換看比重上升或下降（漲幅最大或跌幅最大），附成交金額與前一日比較；點類股可看漲幅前五或成交前五大
3. **每日大盤分析**：管理者從後台發文
4. **股市新聞**：左邊是 AI 產業新聞 10 則（附 AI 重點摘要），右邊是財經節目的最新 3 集（YouTube 頻道與 Podcast）

籌碼、類股、新聞和節目都由 GitHub Actions 自動抓取，不需要另外架主機。

---

## 一、第一次設定（只要做一次）

### 1. 讓自動更新跑第一次

1. 到 repo 的 **Actions** 分頁。如果看到「I understand my workflows, go ahead and enable them」，按下去啟用。
2. 左邊點「更新籌碼與新聞」，右邊按 **Run workflow** → **Run workflow**。
3. 等 1～2 分鐘，出現綠色勾勾就完成了，再過 1～2 分鐘網站就會出現資料。

> 如果出現紅色叉叉，點進去看是哪一步失敗，把畫面截圖給我。

### 2. 申請後台用的 GitHub 金鑰

後台發文要用這把金鑰，**只有拿到金鑰的人才能發文**，請勿外流。

1. 打開 https://github.com/settings/personal-access-tokens/new
2. **Token name**：隨便取，例如「大盤分析後台」
3. **Expiration**：選擇有效期限（最長可選一年，到期後要重新申請）
4. **Repository access**：選 **Only select repositories**，再選 `rascalxp/rascalxp.github.io`
5. **Permissions** → **Repository permissions** → 找到 **Contents**，改成 **Read and write**
6. 拉到最下面按 **Generate token**，複製那串 `github_pat_` 開頭的文字（只會顯示一次）
7. 打開 https://rascalxp.github.io/admin.html，貼上金鑰登入
8. 登入後，拉到後台最下面的「**密碼登入設定**」，設一組自己的密碼（至少 12 個字元）

設好密碼後，在任何電腦打開後台都只要輸入密碼，不用再貼金鑰。金鑰本身請另外存好（例如存在密碼管理員），換新或忘記密碼時會用到。

### 3. 開啟 AI 新聞摘要（選用，需付費）

沒做這一步，新聞照樣會更新，只是摘要會改成新聞原文的前幾句。

1. 到 https://console.anthropic.com/ 註冊，在 **Billing** 綁信用卡、儲值，再到 **API Keys** 建立一把金鑰（`sk-ant-` 開頭）
2. 回到 GitHub repo：**Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name：`ANTHROPIC_API_KEY`
   - Secret：貼上剛剛的金鑰
3. （選用）想省錢的話，在同一頁切到 **Variables** 分頁 → **New repository variable**
   - Name：`CLAUDE_MODEL`
   - Value：`claude-haiku-5-5`

   預設模型是 `claude-opus-5-5`，摘要品質較好，費用也較高。

---

## 二、日常使用：發布大盤分析

1. 打開 https://rascalxp.github.io/admin.html，輸入後台密碼（同一台電腦勾選「記住這台裝置」後，下次會自動登入）
2. 選日期、填標題、寫內容，右邊會即時預覽
3. 工具列可以加小標題、粗體、條列、編號、引言、紅字／綠字，或插入圖片（例如 K 線截圖）
   - 條列、編號、引言會加在游標所在的那一行；同一行再按一次就取消
   - 在條列或編號裡按 Enter 會自動接下一項（編號自動 +1），在空的項目按 Enter 就結束清單
4. 按 **發布**，約 1～2 分鐘後首頁就會更新
5. 下方「已發布的分析」可以點 **編輯** 修改舊文章，或刪除

小提醒：

- 同一天只會有一篇，同日期再發布會覆蓋舊內容
- 還沒發布的內容會自動暫存在這台裝置上，不小心關掉頁面也不會不見
- 在別人的電腦登入時，請取消勾選「記住這台裝置」，用完記得按 **登出**
- **忘記密碼**：在登入畫面點「改用 GitHub 金鑰登入」，貼金鑰登入後，到「密碼登入設定」重設密碼
- **金鑰到期**：GitHub 金鑰過期後，密碼登入會顯示「金鑰已過期」。請照第一段第 2 步申請新金鑰，用新金鑰登入一次，再重新設定密碼

---

## 三、自動更新時間（台灣時間）

| 時間 | 更新內容 |
|---|---|
| 週一至週五 15:13、15:37、16:07、16:27 | 籌碼、類股、新聞、節目 |
| 每天 07:07、12:07、20:07 | 新聞、節目（籌碼若沒有新資料就不變） |

- GitHub 的排程常會延遲 5～30 分鐘，屬正常現象
- 想立刻更新，可以到 Actions 手動按 **Run workflow**
- 公開 repo 如果連續 60 天沒有任何更新，GitHub 會自動暫停排程。Actions 頁面會出現提示，按一下重新啟用即可

---

## 四、資料說明

- **三大法人**：臺灣證券交易所「三大法人買賣金額統計表」。外資含外資自營商，自營商含自行買賣與避險，單位換算成億元
- **散戶微台**：臺灣期貨交易所「三大法人－區分各期貨契約」的微型臺指期貨（TMF）
  - 散戶淨未平倉 = −（三大法人多空未平倉淨額）
  - 口數增減 = 今日散戶淨未平倉 − 前一交易日散戶淨未平倉
  - 顯示格式：`+5,000（-12,000）`，散戶是反指標，所以增加為綠、減少為紅
- **類股成交比重**：臺灣證券交易所，只含上市股票
  - 漲跌幅：證交所各類股價格指數（每日收盤行情）
  - 成交金額：證交所「各類指數日成交量值」；摘要的「類股成交合計」是所有類股加總，不含 ETF 等，和官方上市成交金額不同
  - 成交比重 = 該類股成交金額 ÷ 類股成交合計；比重增減 = 今日比重 − 前一交易日比重（百分點）。代表成交往哪裡集中，不是買賣超
  - 排序依據（比重增減／漲跌幅）、方向（上升／下降）和個股清單的選擇都會記在瀏覽器；同分時成交金額大的排前面
  - 符合方向的類股不到 6 類時（例如大跌日只有 2 類上漲），清單中間會加分隔說明
  - 顏色：紅綠只用在漲跌，比重和成交金額的增減用中性色
  - 漲幅前五：該類股當天漲跌幅前五名，只看成交 1,000 萬元以上的股票（`scripts/fetch_sectors.py` 的 `MIN_VALUE`），同漲幅時成交金額大的排前面
  - 成交前五大：該類股當天成交金額前五名
  - 成交金額最大的個股占類股成交一半以上時，類股名稱下會標「台玻占 96%」這類標籤
  - 類股指數漲跌 0.3% 以上、但多數個股方向相反時，會加一句說明；成交金額最大的個股占一半以上且方向相同時會點名
  - 個股所屬類股：證交所 OpenAPI「上市公司基本資料」的產業別，抓不到時用 `data/industry.json` 的快取
- **AI 新聞**：從鉅亨網、Yahoo 股市、Google 新聞抓最近 48 小時的新聞，篩出 AI 相關的，再請 AI 挑 10 則寫摘要
- **YouTube**：讀取頻道「影片」與「直播」分頁，抓最新 3 支（不含 Shorts）。YouTube 的 RSS 會擋 GitHub 的主機，所以沒有用 RSS
- **Podcast**：用 Apple Podcasts 公開查詢 API 抓最新 3 集
- **除錯**：每次自動更新的結果記在 `data/status.json`，哪個來源失敗會寫在 `errors` 裡

---

## 五、常見修改

- **增減節目**：修改 `scripts/fetch_media.py` 最上面的 `SOURCES`
  - YouTube 頻道要填頻道 ID（`UC` 開頭），只有 Shorts 的頻道抓不到
  - 加上 `"title_contains": "完整版"` 就只抓標題含有這幾個字的影片（目前理財達人秀、錢線百分百有用）
  - 加上 `"one_per_day": True` 就是同一天只留最新上傳的一支
  - Podcast 填 Apple Podcasts 網址最後的數字 id，例如 `.../id1500839292` 就填 `1500839292`
- **調整新聞關鍵字**：修改 `scripts/fetch_news.py` 裡的 `AI_PATTERN`
- **修改網站名稱**：修改 `index.html` 裡的「台股盤後看板」
- **開頭動畫**：影片在 `assets/intro/intro.mp4`，每次進站都會播，可按「略過」或點畫面跳過；系統有開「減少動態效果」的使用者會自動跳過
- **YouTube 頁面抓不到時（選用）**：到 Google Cloud 申請 YouTube Data API 金鑰，加一個名為 `YOUTUBE_API_KEY` 的 repository secret，程式會自動改用 API

## 六、AI 設計技能（Claude Code）

repo 的 `.claude/skills/` 裝了 7 個做網站用的技能（來自 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)，MIT 授權）。在這個 repo 開 Claude Code（電腦或雲端都可以）就會自動載入，不用另外設定。

### 怎麼用

- **直接講需求**：Claude 會依內容自己挑技能，例如「幫我檢查類股區塊的配色和字體」。
- **指定技能**：在需求前面加技能名稱，例如「用 ui-ux-pro-max 檢查首頁的無障礙」。
- **斜線指令**：輸入 `/技能名稱 需求`，例如 `/banner-design YouTube 封面 極簡風`。
- 輸入 `/skills` 可以看目前載入了哪些技能。

### 技能清單

| 技能 | 用途 | 這個網站可以怎麼用 |
|---|---|---|
| `ui-ux-pro-max` | 主技能。內建 80 種風格、192 組配色、74 組字體搭配、120 條 UX 規則、25 種圖表的資料庫，可產生整套設計規範 | 「用 ui-ux-pro-max 檢查首頁的配色、字體和手機版」「幫籌碼區塊挑適合的圖表」 |
| `design` | 綜合設計：logo、icon、橫幅、社群圖片、企業識別、簡報，會自動分派給其他技能 | 「幫網站設計一個 logo」「把今天的類股排行做成 IG 貼文圖」 |
| `banner-design` | 社群、廣告、網站主視覺橫幅，一次給多種風格 | 「做一張 YouTube 頻道封面，風格俐落、深色」 |
| `brand` | 品牌語氣、視覺識別、品牌規範文件 | 「幫台股盤後看板整理一份品牌規範」 |
| `design-system` | 設計變數（顏色、字級、間距）三層架構、元件規格、品牌簡報 | 「把 `assets/style.css` 的顏色整理成設計變數」 |
| `slides` | 用 HTML 和 Chart.js 做簡報 | 「把本週大盤重點做成 8 頁簡報」 |
| `ui-styling` | shadcn/ui 元件和 Tailwind CSS | 這個網站是純 HTML/CSS，沒有用 Tailwind，大多用不到；之後若改用 React 或 Tailwind 才派得上用場 |

### 注意事項

- **需要 Python 3**：技能的搜尋工具用 Python 執行，雲端環境已內建；Windows 電腦沒有的話到 python.org 安裝。
- **AI 產圖要金鑰**：`design` 的 logo、icon 產生功能要另外設定 Gemini 等圖片 AI 的 API 金鑰（例如環境變數 `GEMINI_API_KEY`）；沒有金鑰也能用它的設計建議和 HTML 版面。
- **會產生的檔案**：技能可能在 repo 裡新增 `design-system/`、`assets/banners/`、`plans/reports/`、`docs/brand-guidelines.md`、`assets/design-tokens.*` 等檔案。這個 repo 是公開網站，commit 之後別人也看得到。
- **另一個帳號層級的技能**：`impeccable`（設計評估與修飾，例如 `/impeccable critique`）不在 repo 裡，是帳號本身就有的技能，評估紀錄存在 `.impeccable/critique/`。
- **更新技能**：在電腦上的專案資料夾執行 `npx ui-ux-pro-max-cli update --ai claude`（加 `--ai claude` 就不會跳出選單；沒加的話選「Claude Code」）；repo 這一份可以請 Claude 重新從原始 repo 複製。

### Chrome DevTools MCP（讓 Claude 操作瀏覽器）

[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)（Apache-2.0）讓 Claude 開瀏覽器打開網站，實際截圖、看 console 錯誤、查網路請求、跑 Lighthouse 和效能分析、檢查無障礙。

- **雲端（這個 repo）**：設定在根目錄的 `.mcp.json`，用雲端環境內建的 Chromium、無畫面模式執行，版本固定 1.12.0。第一次在新的工作階段使用時，Claude Code 會詢問要不要啟用 `chrome-devtools`，按同意即可。這份設定只適用雲端環境，不要複製到 Windows 電腦用。
- **搭配的技能**（放在 `.claude/skills/`）：

| 技能 | 用途 |
|---|---|
| `chrome-devtools` | 基本操作：開網頁、截圖、點擊、讀 console、看網路請求 |
| `a11y-debugging` | 無障礙檢查：語意、ARIA、焦點、鍵盤操作、點擊範圍、對比 |
| `debug-optimize-lcp` | 載入速度：找出最大內容繪製（LCP）慢的原因並改善 |
| `cookie-debugging` | Cookie、登入狀態相關問題 |
| `memory-leak-debugging` | 記憶體外洩 |
| `troubleshooting` | MCP 連不上、開不了頁面時的排除 |

- **使用範例**：「用 Chrome DevTools 打開首頁，檢查 console 有沒有錯誤」「跑一次 Lighthouse，看手機版效能分數」「檢查類股區塊的鍵盤操作和對比」。
- **自己的電腦（Windows）**：在 Claude Code 輸入下面兩行，用官方外掛安裝（含 MCP 和技能），裝完重開 Claude Code：
  ```
  /plugin marketplace add ChromeDevTools/chrome-devtools-mcp
  /plugin install chrome-devtools-mcp@chrome-devtools-plugins
  ```
  只要 MCP 的話，也可以在 PowerShell 執行 `claude mcp add chrome-devtools --scope user -- cmd /c npx -y chrome-devtools-mcp@latest`。電腦上要先裝好 Chrome 和 Node.js。

## 檔案結構

```
index.html                  首頁
admin.html                  管理後台
assets/                     樣式與程式
data/                       自動更新的資料（chips / sectors / news / media / analysis / status）
uploads/                    後台上傳的圖片
scripts/                    抓資料的 Python 程式
.github/workflows/          自動排程設定
.claude/skills/             Claude Code 技能（設計、Chrome DevTools）
.mcp.json                   Chrome DevTools MCP 設定（雲端用）
.impeccable/critique/       impeccable 設計評估紀錄
```
