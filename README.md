# 詩歌目錄 — V1 前端原型（B）

華語基督教詩歌目錄原型：以「歌」為單位，出站連去 YouTube／Apple Music／Spotify／KKBOX。免登入上架，管理員審核後公開。**純前端**，資料存瀏覽器 `localStorage`（各用戶／裝置互不同步；適合 UI／流程測試，唔係正式後台）。

路由用 hash（`#/song/...`），部署為靜態站即可。

## 榜單（按平台分開）

**冇跨平台總榜／綜合分。** 首頁先揀平台，再揀時段：

| 平台 | 各自榜單 |
|------|----------|
| YouTube | 日榜／周榜／月榜／最新／最熱 |
| Apple Music | 同上 |
| Spotify | 同上 |
| KKBOX | 同上 |

排序規則（示範數據）：

- **日榜／周榜／月榜**：按該平台 `signals[platform].day|week|month` 播放（或觀看）增量由高至低  
- **最熱**：按該平台 `signals[platform].total` 累計播放量  
- **最新**：按 `created_at` 由新至舊（仍只顯示該平台有連結嘅歌）  
- 缺連結，或該平台對應指標為 0 → **唔入呢個平台榜**

示範 `signals` 形狀：

```js
signals: {
  youtube: { total, day, week, month },
  apple_music: { total, day, week, month },
  spotify: { total, day, week, month },
  kkbox: { total, day, week, month }
}
```

URL 會記住選擇，例如 `#/?platform=spotify&chart=日榜`。

## UI

深色音樂平台風格（接近 Spotify／Apple Music）：側欄／底部導航、精選 Hero、封面漸層（歌名首字＋`coverColor`）、平台選擇 tab＋時段 tab、榜單列含排名／封面／平台 SVG icon／出站播放掣。唔依賴外部圖片 CDN。

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
- 示範平台連結多數係搜尋頁  
- 播放量係 seed 示範數字，唔係即時 API  

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
| 首頁 | 精選 Hero；平台 tab（YT／Apple／Spotify／KKBOX）；日／周／月／最新／最熱；搜尋；語言／機構篩選；榜單封面＋出站掣 |
| 詳情 | 大封面；多平台「喺某某聽」掣；各平台播放量；有用／唔啱；相關推薦 |
| 上架 | 免登入表單；提交後 `pending`；每日每裝置約 3 首上限 |
| 管理 | 密碼閘；通過／退回；重設示範數據 |

## 檔案

- `index.html` — 入口  
- `styles.css` — 深色音樂平台樣式（響應式、繁中）  
- `data.js` — 12 首示範歌＋每平台 `{ total, day, week, month }` 播放量  
- `app.js` — SPA 邏輯（hash 路由、平台榜排序、封面／icon）  
- `vercel.json` — Vercel 靜態部署設定  
- `screenshots/` — UI 截圖參考  

## 注意

- 示範連結多數係平台搜尋頁；正式版應換成官方曲目深層連結。  
- 若本機曾開過舊版（綜合分），Admin「重設為示範數據」或清 `localStorage` key `hymn_directory_v2` 可刷新 seed。  
- 封面暫時仍用漸層＋首字；平台頭圖未接。  
