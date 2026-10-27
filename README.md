# 台股盤後看板

網址：https://rascalxp.github.io/
管理後台：https://rascalxp.github.io/admin.html

一頁式 RWD 網站，分三段：

1. **法人籌碼**：三大法人（外資、投信、自營商）買賣超金額，以及散戶微台口數增減與淨未平倉
2. **每日大盤分析**：管理者從後台發文
3. **股市新聞**：左邊是 AI 產業新聞 10 則（附 AI 重點摘要），右邊是財經節目的最新 3 集（YouTube 頻道與 Podcast）

籌碼、新聞和節目都由 GitHub Actions 自動抓取，不需要另外架主機。

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
3. 工具列可以加小標題、粗體、條列、紅字／綠字，或插入圖片（例如 K 線截圖）
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
| 週一至週五 15:40、17:30 | 籌碼、新聞、節目 |
| 每天 07:00、12:00、20:00 | 新聞、節目（籌碼若沒有新資料就不變） |

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
- **YouTube 頁面抓不到時（選用）**：到 Google Cloud 申請 YouTube Data API 金鑰，加一個名為 `YOUTUBE_API_KEY` 的 repository secret，程式會自動改用 API

## 檔案結構

```
index.html                  首頁
admin.html                  管理後台
assets/                     樣式與程式
data/                       自動更新的資料（chips / news / media / analysis / status）
uploads/                    後台上傳的圖片
scripts/                    抓資料的 Python 程式
.github/workflows/          自動排程設定
```
