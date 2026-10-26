# 詩歌目錄 — V1 前端原型（B）

華語基督教詩歌目錄原型：以「歌」為單位，出站連去 **YouTube Music**／**YouTube**／Apple Music／Spotify／KKBOX。**公開自助上架已暫停**；歌單由官方頻道白名單自動收錄（`source: "auto"`、`status: "published"`）。資料存瀏覽器 `localStorage`（各用戶／裝置互不同步）。

路由用 hash（`#/song/...`）。部署到 Vercel 時會多一個 serverless API 拉 YouTube 真觀看次數。

## 榜單（只跟 YouTube 頻道影片）

**冇跨平台總榜。** 排行數據一律來自 YouTube Data API（頻道影片 `viewCount`／`publishedAt`）。Apple Music／Spotify／KKBOX **只作出站聽歌連結**，唔入排行 tab。

| 榜單 | 排序規則 |
|------|----------|
| **最熱** | YouTube `viewCount`（總觀看）由高至低 |
| **新歌** | YouTube `publishedAt`（上傳日）由新至舊 |
| **日榜／周榜／月榜** | Data API **冇**時段增量；**暫以總觀看排序**（同最熱），UI 會標明「暫代」。要真日／周／月需自行存歷史快照 |

每首歌出站同時提供：

- `links.youtube` → `https://www.youtube.com/watch?v=…`
- `links.youtube_music` → `https://music.youtube.com/watch?v=…`（首頁主播放掣優先）

前端優先呼叫 `/api/youtube-stats?ids=…`（每批最多 50）；本機 `python -m http.server` 冇 serverless 時改讀靜態 `live-stats.json`。API 失敗則退回 seed 數字。

## 官方頻道白名單（V1）

只收以下機構官方 YouTube channel（唔收私人帳號；唔收 `streamofpraiseresources`／`HeavenlyMelody`／`ROLCCmedia`）：

| 機構 | Handle | Channel ID |
|------|--------|------------|
| 讚美之泉 | [@streamofpraise](https://www.youtube.com/@streamofpraise) | `UC00EceQGGCMucNvwOS-jQ7A` |
| 約書亞樂團 | [@joshuabandasia](https://www.youtube.com/@joshuabandasia) | `UC93m2yLo9G4-ZdFMgrdS2LA` |
| 基恩敬拜 | [@AmazingGraceWorship](https://www.youtube.com/@AmazingGraceWorship) | `UCGpiURDJzGW0KLobc_pQLpw` |
| 小羊詩歌 | [@lambmusic](https://www.youtube.com/@lambmusic) | `UCdbFFcLrcDtwHf0TumhFXnQ` |
| HKACM | [@hkacm_worship](https://www.youtube.com/@hkacm_worship) | `UCIGCKTWZFjtQB-zGylKGiXg` |
| 敬拜者使團 | [@theworshipers](https://www.youtube.com/@theworshipers) | `UCerdYoR_Ztc9U1xvch-0c9A` |
| 讚美之泉兒童 | [@StreamofPraiseKids](https://www.youtube.com/@StreamofPraiseKids) | `UC2KCkfsRUglpjc8tRM65DtQ` |

清單檔：`data/whitelist.json`（含已 resolve 嘅 `channelId`）。

### 重新抓取（ingest）

```bash
export YOUTUBE_API_KEY="你的key"   # 唔好 commit
node scripts/ingest-whitelist.mjs  # 掃白名單 uploads → 重寫 data.js（約 40–80 首）
node scripts/sync-youtube.mjs      # 刷新 live-stats.json + seed 觀看／上傳日
```

Ingest 會：解析 `forHandle` → uploads playlist → 過濾明顯非歌曲（直播／證道／預告等）→ 每頻道取新歌＋高觀看混合 → 寫入 `published` + `source: "auto"`，並為每首加 `youtube`＋`youtube_music` 連結。若舊 seed 已有同一 `videoId` 的 Apple／Spotify／KKBOX 連結會保留。

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
export YOUTUBE_API_KEY="你的key"
node scripts/ingest-whitelist.mjs   # 可選：重抓白名單
node scripts/sync-youtube.mjs       # 可選：刷新觀看
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

深色音樂平台風格：側欄／底部導航、精選 Hero、封面優先 `coverUrl`（YouTube thumbnail）、時段 tab（日／周／月／新歌／最熱）、榜單列含排名／封面／平台 icon／出站播放掣（優先 YouTube Music）。詳情頁同時顯示 YouTube Music 同 YouTube 出站掣。

## 功能一覽

| 頁面 | 內容 |
|------|------|
| 首頁 | YouTube 榜；日／周／月／新歌／最熱；搜尋；語言／機構篩選 |
| 詳情 | 大封面；YouTube Music＋YouTube（及其他平台）出站；觀看／上傳日；投票；相關推薦 |
| 上架 | **暫停開放**（`#/submit` 只顯示暫停頁） |
| 管理 | 密碼閘；審核既有 pending；通過／退回；重設示範數據 |

## 檔案

- `index.html` — 入口  
- `styles.css` — 樣式  
- `data.js` — 白名單 ingest 後嘅歌單（含 `youtube`／`youtube_music`）  
- `data/whitelist.json` — 官方頻道白名單＋channelId  
- `app.js` — SPA（hash 路由、YouTube 榜、live stats）  
- `api/youtube-stats.js` — Vercel serverless（`videos.list`，每請求最多 50 ids）  
- `scripts/ingest-whitelist.mjs` — 白名單抓取 → 重寫 `data.js`  
- `scripts/sync-youtube.mjs` — 本機刷新 `live-stats.json`  
- `live-stats.json` — 本機／靜態 fallback  
- `vercel.json` — 部署設定（SPA rewrite 避開 `/api`）  

## 注意

- Seed 只收**機構官方**白名單頻道；唔抓私人帳號。  
- Storage key：`hymn_directory_v8`（硬刷新或 Admin「重設」先見到新歌單）。  
- URL 舊參數 `platform=` 可忽略；`chart=最新` 仍當 `新歌`。  
