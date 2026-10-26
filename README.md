# 詩歌目錄 — V1 前端原型（B）

華語基督教詩歌目錄原型：以「歌」為單位，出站連去 YouTube／Apple Music／Spotify／KKBOX。**公開自助上架已暫停**；之後以官方頻道白名單＋管理員審核收錄。資料存瀏覽器 `localStorage`（各用戶／裝置互不同步）。

路由用 hash（`#/song/...`）。部署到 Vercel 時會多一個 serverless API 拉 YouTube 真觀看次數。

## 榜單（只跟 YouTube）

**冇跨平台總榜。** Apple Music／Spotify／KKBOX **只作出站聽歌連結**，唔入排行 tab。

| 榜單 | 排序規則 |
|------|----------|
| **最熱** | YouTube `viewCount`（總觀看）由高至低 |
| **新歌** | YouTube `publishedAt`（上傳日）由新至舊 |
| **日榜／周榜／月榜** | Data API **冇**時段增量；**暫以總觀看排序**（同最熱），UI 會標明「暫代」。要真日／周／月需自行存歷史快照 |

歌要有 YouTube 官方連結先入榜；新歌仲要有上傳日。

前端優先呼叫 `/api/youtube-stats?ids=…`；本機 `python -m http.server` 冇 serverless 時改讀靜態 `live-stats.json`（用下面 sync 腳本產生）。API 失敗則退回 seed 示範數字。

## YouTube API（Vercel）

1. Google Cloud 開專案 → Enable **YouTube Data API v3** → 建立 API key  
2. Vercel 專案 → **Settings → Environment Variables** → 新增：
   - Name：`YOUTUBE_API_KEY`
   - Value：你的 key（Production／Preview 都要）
3. Redeploy  

**唔好**把 key 寫進前端 JS、Git、README。本 repo 只係用環境變數。

免費配額大約每日 10,000 units（`videos.list` 多數 1 unit／次）；爆額當日 call 唔到，唔會自動扣 call 費。

## 本機預覽

```bash
cd /path/to/hymn-directory
# 可選：刷新 live-stats.json + seed 嘅 youtube total／上傳日
export YOUTUBE_API_KEY="你的key"
node scripts/sync-youtube.mjs

python3 -m http.server 8765
```

- http://127.0.0.1:8765/  
- 本機無 `/api/` 時會用 `live-stats.json`

## 部署到 Vercel

### 方法一：CLI

```bash
npm i -g vercel
cd /path/to/hymn-directory
vercel
# 記得喺 Dashboard 加 YOUTUBE_API_KEY 後 vercel --prod
```

### 方法二：GitHub Import

1. 推上 GitHub  
2. [vercel.com/new](https://vercel.com/new) → Import  
3. Framework **Other**；Build／Output 留空  
4. 加環境變數 `YOUTUBE_API_KEY` → Deploy  

部署後：`/` 首頁、`#/admin` 管理（密碼 `hymn-admin-demo`）。`#/submit` 顯示「暫停開放」，唔再接受公開提交。

## UI

深色音樂平台風格：側欄／底部導航、精選 Hero、封面優先 `coverUrl`（多數 YouTube thumbnail）、時段 tab（日／周／月／新歌／最熱）、榜單列含排名／封面／平台 icon／出站播放掣。詳情頁仍可跳去 Apple／Spotify／KKBOX。

## 功能一覽

| 頁面 | 內容 |
|------|------|
| 首頁 | YouTube 榜；日／周／月／新歌／最熱；搜尋；語言／機構篩選 |
| 詳情 | 大封面；多平台出站掣；YouTube 觀看／上傳日；投票；相關推薦 |
| 上架 | **暫停開放**（`#/submit` 只顯示暫停頁） |
| 管理 | 密碼閘；審核既有 pending；通過／退回；重設示範數據 |

## 檔案

- `index.html` — 入口  
- `styles.css` — 樣式  
- `data.js` — 示範歌（含已核實官方連結；youtube total／上傳日可由 sync 刷新）  
- `app.js` — SPA（hash 路由、YouTube 榜、live stats）  
- `api/youtube-stats.js` — Vercel serverless（`videos.list`）  
- `scripts/sync-youtube.mjs` — 本機刷新 `live-stats.json`  
- `live-stats.json` — 本機／靜態 fallback  
- `vercel.json` — 部署設定（SPA rewrite 避開 `/api`）  

## 收錄方向（暫）

公開自助上架已關。下一階段建議：維護機構官方 YouTube 頻道白名單 → 定時掃描 → pending → 管理員審核後公開。

## 注意

- Seed 只收**機構官方**連結；唔抓私人帳號。  
- Storage key：`hymn_directory_v7`（硬刷新或 Admin「重設」先見到新邏輯；自助上架已關）。  
- URL 舊參數 `platform=` 可忽略；`chart=最新` 仍當 `新歌`。  
