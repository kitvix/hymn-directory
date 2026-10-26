# 詩歌目錄 — V1 前端原型（B）

華語基督教詩歌目錄原型：以「歌」為單位，出站連去 YouTube／Apple Music／Spotify／KKBOX。免登入上架，管理員審核後公開。**純前端**，資料存瀏覽器 `localStorage`（各用戶／裝置互不同步；適合 UI／流程測試，唔係正式後台）。

路由用 hash（`#/song/...`），部署為靜態站即可。

## 榜單（按平台分開）

**冇跨平台總榜／綜合分。** 首頁先揀平台，再揀時段：

| 平台 | 各自榜單 |
|------|----------|
| YouTube | 日榜／周榜／月榜／新歌／最熱 |
| Apple Music | 同上 |
| Spotify | 同上 |
| KKBOX | 同上 |

排序規則（示範數據）：

- **日榜／周榜／月榜**：按該平台 `signals[platform].day|week|month` 播放（或觀看）增量由高至低  
- **最熱**：按該平台 `signals[platform].total` 累計播放量  
- **新歌**：按該平台 `released_at[platform]`（平台發行／上傳日）由新至舊；缺該平台連結或缺 `released_at` → **唔入新歌榜**  
- 日／周／月／最熱：缺連結，或該平台對應播放指標為 0 → **唔入呢個平台榜**  
- URL 舊值 `chart=最新` 會當成 `新歌`（相容）

示範 `signals` 形狀：

```js
signals: {
  youtube: { total, day, week, month },
  apple_music: { total, day, week, month },
  spotify: { total, day, week, month },
  kkbox: { total, day, week, month }
}
```

`released_at`（新歌用；只寫有已知日期嘅平台）：

```js
released_at: {
  youtube: "ISO",       // YouTube 公開頁 uploadDate（已核實）
  apple_music: "ISO", // iTunes Lookup releaseDate
  spotify: "ISO",     // 無公開 API 時對齊同曲目 Apple／專輯發行日
  kkbox: "ISO"        // 頁面難抓時對齊同曲目 Apple／專輯發行日
}
```

### 示範日期來源（v5）

- **YouTube**：每條 `watch?v=` 頁面 schema.org `uploadDate`，與 seed 一對一核實。**新歌榜反映嘅係所連官方影片嘅上傳日**，唔係本站收錄日。  
- **Apple Music**：`itunes.apple.com/lookup` 嘅 `releaseDate`。  
- **Spotify／KKBOX**：公開頁唔穩定回傳發行日；有連結嘅舊曲對齊同曲目 Apple 發行日（見上）。未能核實嘅新曲暫唔放該平台連結。  
- `created_at` 仍係本站收錄日（Admin／目錄用）。  
- Seed 只收**機構官方頻道／官方上架**（例如讚美之泉、基恩敬拜、約書亞樂團、天韻）；唔收私人帳號上傳。

URL 會記住選擇，例如 `#/?platform=spotify&chart=日榜` 或 `#/?platform=youtube&chart=新歌`。

## UI

深色音樂平台風格（接近 Spotify／Apple Music）：側欄／底部導航、精選 Hero、封面優先用 `coverUrl`（多數為 YouTube thumbnail／平台專輯圖；壞圖會退回漸層＋歌名首字）、平台選擇 tab＋時段 tab、榜單列含排名／封面／平台 SVG icon／出站播放掣。

## 部署到 Vercel（測試）

### 方法一：CLI

```bash
npm i -g vercel
cd /path/to/hymn-directory
vercel
```

正式 production：`vercel --prod`

### 方法二：GitHub Import

1. 把本資料夾推上 GitHub repo  
2. 打開 [vercel.com/new](https://vercel.com/new) → Import  
3. Framework Preset 選 **Other**；Build／Output 留空  
4. Deploy  

部署後：`/` 首頁、`#/submit` 上架、`#/admin` 管理（密碼 `hymn-admin-demo`）。

### 測試時請知

- Frontend-only：提交／審核／投票只寫入該瀏覽器 `localStorage`  
- 管理員密碼喺前端，僅 demo  
- 示範平台連結係已核實嘅曲目／影片深層連結（唔係搜尋頁）；缺核實嘅平台會省略該 key  
- 播放量係 seed 示範數字，唔係即時 API  
- `released_at` 已按公開頁／iTunes 核實（見上）；Spotify／KKBOX 部分為對齊 Apple 嘅最佳公開證據  

## 本機預覽

```bash
cd /path/to/hymn-directory
python3 -m http.server 8765
```

- http://127.0.0.1:8765/  
- http://127.0.0.1:8765/#/submit  
- http://127.0.0.1:8765/#/admin  

## 功能一覽

| 頁面 | 內容 |
|------|------|
| 首頁 | 精選 Hero；平台 tab（YT／Apple／Spotify／KKBOX）；日／周／月／新歌／最熱；搜尋；語言／機構篩選；榜單封面＋出站掣 |
| 詳情 | 大封面；多平台「喺某某聽」掣；各平台播放量；有用／唔啱；相關推薦 |
| 上架 | 免登入表單；提交後 `pending`；每日每裝置約 3 首上限 |
| 管理 | 密碼閘；通過／退回；重設示範數據 |

## 檔案

- `index.html` — 入口  
- `styles.css` — 深色音樂平台樣式（響應式、繁中）  
- `data.js` — 12 首示範歌＋每平台播放量＋`released_at`（含 2025–2026 官方新歌）  
- `app.js` — SPA 邏輯（hash 路由、平台榜排序、封面／icon）  
- `vercel.json` — Vercel 靜態部署設定  
- `screenshots/` — UI 截圖參考  

## 注意

- Seed 出站連結應為官方／機構曲目頁（`watch?v=`、Apple／Spotify track、KKBOX song）。唔好再放搜尋頁。  
- 每首歌可有 `coverUrl`（https 圖）；優先 YouTube `i.ytimg.com/vi/<id>/hqdefault.jpg`，否則用 Apple／Spotify 專輯圖。`coverColor` 仍作 fallback。  
- Storage key 已升至 `hymn_directory_v5`（自動載入核實日期＋新歌 seed）。若仍見舊「新歌」頂部停喺 2024，Admin「重設為示範數據」或清該 key。  
- 上架提交只設 `created_at`；未填 `released_at` 嘅歌唔會出現喺各平台「新歌」榜，直至補上。  
