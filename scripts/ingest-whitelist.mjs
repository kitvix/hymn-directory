/**
 * Ingest ALL song videos from official YouTube channel whitelist into data.js.
 * Usage: node scripts/ingest-whitelist.mjs
 * Requires YOUTUBE_API_KEY in env. Never logs the key.
 *
 * Default: paginate each channel's uploads playlist until exhausted
 * (no per-channel / total caps). Filters out livestreams, sermons, etc.
 * On quota/API failure mid-way, writes whatever was collected so far.
 *
 * Also writes resolved channelIds back into data/whitelist.json
 * and regenerates window.HYMN_SEED in data.js (keeps PLATFORM_META etc.).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const whitelistPath = path.join(root, "data", "whitelist.json");
const dataPath = path.join(root, "data.js");
const liveStatsPath = path.join(root, "live-stats.json");

const key = process.env.YOUTUBE_API_KEY;
if (!key) {
  console.error("ingest-whitelist: YOUTUBE_API_KEY is not set");
  process.exit(1);
}

const SKIP_RE =
  /直播|證道|講道|預告|幕後|花絮|訪談|訪問|宣傳|廣告|回顧|崇拜全程|聚會全程|主日信息|報名|課程|事奉學校|School\s+of|trailer|behind\s*the\s*scenes|\bQ\s*&\s*A\b|podcast|播客|新聞|news\b|訂閱|subscribe\s+now|開幕|研討會|短片廣告/i;

const COVER_PALETTE = [
  ["#7c3aed", "#db2777"],
  ["#2563eb", "#06b6d4"],
  ["#ea580c", "#eab308"],
  ["#0d9488", "#4f46e5"],
  ["#be185d", "#7c3aed"],
  ["#1d4ed8", "#9333ea"],
  ["#b45309", "#dc2626"],
  ["#0891b2", "#22c55e"]
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isQuotaError(err) {
  const msg = String((err && err.message) || err || "");
  return /quota|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|403/i.test(msg);
}

async function ytGet(pathname, params) {
  const u = new URL("https://www.googleapis.com/youtube/v3/" + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  u.searchParams.set("key", key);
  const res = await fetch(u);
  let body;
  try {
    body = await res.json();
  } catch (_) {
    throw new Error(`YouTube ${pathname}: HTTP ${res.status} (bad JSON)`);
  }
  if (!res.ok) {
    const reason =
      (body && body.error && (body.error.message || body.error.status)) ||
      `HTTP ${res.status}`;
    const err = new Error(`YouTube ${pathname}: ${String(reason).slice(0, 280)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function cleanTitle(raw) {
  const original = String(raw || "").trim();
  let t = original;
  const bracket = t.match(/【([^】]+)】/);
  if (bracket) {
    t = bracket[1].trim();
  } else {
    const book = t.match(/《([^》]+)》/);
    if (book) t = book[1].trim();
    else {
      t = t.replace(/\s*[|｜].*$/, "");
      t = t.replace(/\s*[-–—]\s*(讚美之泉|約書亞|基恩|小羊|HKACM|Stream of Praise|Joshua|敬拜者|同心圓|兒童).*$/i, "");
    }
  }
  t = t.replace(/\s*\[[^\]]*\]\s*/g, " ");
  t = t.replace(
    /\s*(Official\s*)?(Music\s*)?Video|Lyric(s)?\s*Video|歌詞版|官方歌詞|官方MV|官方影片|現場敬拜MV|兒童敬拜MV|Worship\s*MV|Official\s*Audio|\bLive\b|現場/gi,
    ""
  );
  t = t.replace(/\s{2,}/g, " ").trim();
  if (!t || t.length < 2) t = original.split(/[|｜]/)[0].trim();
  return t;
}

function guessThemes(title) {
  const themes = [];
  const map = [
    [/愛|奇妙/, "神的愛"],
    [/讚美|和散那|榮耀/, "讚美"],
    [/敬拜/, "敬拜"],
    [/恩典/, "恩典"],
    [/信靠|信實|幫助|力量/, "信靠"],
    [/聖靈|復興/, "聖靈"],
    [/十架|寶血|為我/, "十架"],
    [/平安|安慰/, "安慰"],
    [/兒童|孩子|小朋友/, "兒童"]
  ];
  for (const [re, theme] of map) {
    if (re.test(title) && !themes.includes(theme)) themes.push(theme);
  }
  if (!themes.length) themes.push("敬拜");
  return themes.slice(0, 3);
}

function isMultiTitle(title) {
  const parts = String(title || "")
    .replace(/\d\s*[/／]\s*\d/g, " ")
    .split(/[/／]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  const cjkParts = parts.filter(
    (part) => (part.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length >= 2
  );
  return cjkParts.length >= 2;
}

/** Keep 伴奏／字幕／Shorts／串燒 in the catalogue; tag them instead of dropping. */
function inferTags(title, meta) {
  const rawTitle = String(title || "");
  const extra = (meta && (meta.description || meta.originalTitle || "")) || "";
  const text = rawTitle + "\n" + String(extra);
  const tags = [];
  if (/(?<!無)伴奏|伴唱|karaoke|卡拉\s*ok|off\s*vocal|純音樂/i.test(text)) {
    tags.push("accompaniment");
  }
  if (/中英字幕|字幕|lyric\s*video|歌詞版/i.test(text)) tags.push("subtitle");
  if (/#\s*shorts|(?:^|[^a-z0-9])shorts(?:[^a-z0-9]|$)/i.test(text)) tags.push("shorts");
  if (/串燒|medley/i.test(text) || isMultiTitle(rawTitle)) tags.push("medley");
  return tags;
}

function extractYtId(url) {
  if (!url) return "";
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return m ? m[1] : "";
}

function bestThumb(videoId, thumbnails) {
  const t = thumbnails || {};
  return (
    (t.maxres && t.maxres.url) ||
    (t.standard && t.standard.url) ||
    (t.high && t.high.url) ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  );
}

async function resolveChannel(ch) {
  if (ch.channelId) {
    try {
      const body = await ytGet("channels", {
        part: "id,snippet,contentDetails",
        id: ch.channelId
      });
      if (body.items && body.items[0]) return body.items[0];
    } catch (e) {
      console.warn(`  id lookup failed for ${ch.channelId}: ${e.message}`);
    }
  }
  const handle = String(ch.handle || "").replace(/^@/, "");
  try {
    const body = await ytGet("channels", {
      part: "id,snippet,contentDetails",
      forHandle: handle
    });
    if (body.items && body.items[0]) return body.items[0];
  } catch (e) {
    console.warn(`  forHandle failed for @${handle}: ${e.message}`);
  }
  try {
    const body = await ytGet("search", {
      part: "snippet",
      q: handle,
      type: "channel",
      maxResults: 5
    });
    const hit = (body.items || []).find((it) => {
      const custom = (it.snippet && it.snippet.customUrl) || "";
      const title = (it.snippet && it.snippet.channelTitle) || "";
      return (
        custom.toLowerCase().includes(handle.toLowerCase()) ||
        title.includes(ch.ministry)
      );
    });
    if (hit && hit.snippet && hit.snippet.channelId) {
      const full = await ytGet("channels", {
        part: "id,snippet,contentDetails",
        id: hit.snippet.channelId
      });
      if (full.items && full.items[0]) return full.items[0];
    }
  } catch (e) {
    console.warn(`  search fallback failed for @${handle}: ${e.message}`);
  }
  return null;
}

/** Paginate entire uploads playlist until exhausted (or quota). */
async function fetchUploadsAll(uploadsPlaylistId) {
  const items = [];
  let pageToken = "";
  let pages = 0;
  for (;;) {
    const body = await ytGet("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: pageToken || undefined
    });
    pages++;
    for (const it of body.items || []) {
      const vid =
        (it.contentDetails && it.contentDetails.videoId) ||
        (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId);
      if (!vid) continue;
      items.push({
        videoId: vid,
        title: (it.snippet && it.snippet.title) || "",
        publishedAt:
          (it.contentDetails && it.contentDetails.videoPublishedAt) ||
          (it.snippet && it.snippet.publishedAt) ||
          "",
        thumbnails: (it.snippet && it.snippet.thumbnails) || {}
      });
    }
    pageToken = body.nextPageToken || "";
    if (!pageToken) break;
    await sleep(40);
  }
  return { items, pages };
}

async function fetchVideoStats(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const body = await ytGet("videos", {
      part: "statistics,snippet,contentDetails",
      id: chunk.join(",")
    });
    for (const it of body.items || []) {
      out[it.id] = {
        viewCount: Number((it.statistics && it.statistics.viewCount) || 0),
        publishedAt: (it.snippet && it.snippet.publishedAt) || "",
        title: (it.snippet && it.snippet.title) || "",
        description: (it.snippet && it.snippet.description) || "",
        channelTitle: (it.snippet && it.snippet.channelTitle) || "",
        duration: (it.contentDetails && it.contentDetails.duration) || "",
        thumbnails: (it.snippet && it.snippet.thumbnails) || {}
      };
    }
    await sleep(40);
  }
  return out;
}

function durationSeconds(iso) {
  if (!iso) return 0;
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (
    (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)
  );
}

function isLikelySong(title, meta) {
  if (SKIP_RE.test(title)) return false;
  const desc = (meta && meta.description) || "";
  if (/^#{0,2}\s*(直播|證道|講道)/m.test(desc.slice(0, 200))) return false;
  const sec = durationSeconds(meta && meta.duration);
  if (sec > 0 && sec < 45) return false;
  if (sec > 25 * 60 && !/歌詞|lyric|mv|official|敬拜|詩歌|讚美/i.test(title)) {
    return false;
  }
  return true;
}

function loadOldLinksByVideoId() {
  const map = {};
  try {
    const dataSrc = fs.readFileSync(dataPath, "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(dataSrc, sandbox);
    const seed = sandbox.window.HYMN_SEED || [];
    for (const song of seed) {
      const id = extractYtId(song.links && song.links.youtube);
      if (!id) continue;
      map[id] = song.links || {};
    }
  } catch (_) {}
  return map;
}

function formatSongJs(song, isLast) {
  const linksEntries = Object.entries(song.links)
    .filter(([, v]) => v)
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
    .join(",\n");
  const releasedEntries = Object.entries(song.released_at)
    .filter(([, v]) => v)
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
    .join(",\n");
  const signalsEntries = Object.entries(song.signals)
    .map(([k, v]) => {
      return `      ${k}: { total: ${Number(v.total) || 0}, day: ${Number(v.day) || 0}, week: ${Number(v.week) || 0}, month: ${Number(v.month) || 0} }`;
    })
    .join(",\n");
  const comma = isLast ? "" : ",";
  return `  {
    id: ${JSON.stringify(song.id)},
    title: ${JSON.stringify(song.title)},
    artist: ${JSON.stringify(song.artist)},
    languages: ${JSON.stringify(song.languages)},
    themes: ${JSON.stringify(song.themes)},
    tags: ${JSON.stringify(song.tags || [])},
    coverColor: ${JSON.stringify(song.coverColor)},
    coverUrl: ${JSON.stringify(song.coverUrl)},
    links: {
${linksEntries}
    },
    source: ${JSON.stringify(song.source)},
    status: ${JSON.stringify(song.status)},
    channelId: ${JSON.stringify(song.channelId || "")},
    videoId: ${JSON.stringify(song.videoId || "")},
    blurb: ${JSON.stringify(song.blurb)},
    created_at: ${JSON.stringify(song.created_at)},
    released_at: {
${releasedEntries}
    },
    signals: {
${signalsEntries}
    }
  }${comma}`;
}

function writeOutputs(finalSongs, whitelist) {
  finalSongs.sort(
    (a, b) => (b.signals.youtube.total || 0) - (a.signals.youtube.total || 0)
  );

  fs.writeFileSync(whitelistPath, JSON.stringify(whitelist, null, 2) + "\n", "utf8");

  const dataSrc = fs.readFileSync(dataPath, "utf8");
  const platformMetaBlock = `window.PLATFORM_META = {
  youtube_music: { key: "youtube_music", label: "YouTube Music", short: "YT Music", className: "ytm" },
  youtube: { key: "youtube", label: "YouTube", short: "YT", className: "yt" },
  apple_music: { key: "apple_music", label: "Apple Music", short: "Apple", className: "apple" },
  spotify: { key: "spotify", label: "Spotify", short: "Spotify", className: "spotify" },
  kkbox: { key: "kkbox", label: "KKBOX", short: "KKBOX", className: "kkbox" }
};`;

  const seedBody = finalSongs
    .map((s, i) => formatSongJs(s, i === finalSongs.length - 1))
    .join("\n");
  const seedBlock = `window.HYMN_SEED = [\n${seedBody}\n];`;

  let next = dataSrc;
  const seedStart = next.indexOf("window.HYMN_SEED");
  const metaStart = next.indexOf("window.PLATFORM_META");
  if (seedStart < 0 || metaStart < 0) {
    console.error("ingest-whitelist: cannot find HYMN_SEED / PLATFORM_META markers");
    process.exit(1);
  }
  const adminStart = next.indexOf("window.ADMIN_DEMO_KEY");
  const afterMeta = adminStart >= 0 ? adminStart : next.length;
  next =
    next.slice(0, seedStart) +
    seedBlock +
    "\n\n" +
    platformMetaBlock +
    "\n\n" +
    next.slice(afterMeta);
  fs.writeFileSync(dataPath, next, "utf8");

  // live-stats.json from ingested songs
  const videos = {};
  for (const s of finalSongs) {
    const vid = s.videoId || extractYtId(s.links && s.links.youtube);
    if (!vid) continue;
    videos[vid] = {
      viewCount: Number((s.signals && s.signals.youtube && s.signals.youtube.total) || 0),
      publishedAt: (s.released_at && s.released_at.youtube) || "",
      title: s.title || "",
      channelTitle: s.artist || ""
    };
  }
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: "youtube-data-api",
    count: Object.keys(videos).length,
    videos
  };
  fs.writeFileSync(liveStatsPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf8"));
const oldLinks = loadOldLinksByVideoId();
const report = { channels: [], failures: [], total: 0, partial: false, stoppedAt: null };

const allSongs = [];
let colorIdx = 0;
const nowIso = new Date().toISOString();
let abortQuota = false;

console.log("ingest-whitelist: full-channel ingest for", whitelist.channels.length, "channels…");

for (const ch of whitelist.channels) {
  if (abortQuota) {
    report.channels.push({
      ministry: ch.ministry,
      handle: ch.handle,
      channelId: ch.channelId || null,
      fetched: 0,
      kept: 0,
      skipped: 0,
      error: "skipped_after_quota"
    });
    continue;
  }

  const row = {
    ministry: ch.ministry,
    handle: ch.handle,
    channelId: null,
    fetched: 0,
    kept: 0,
    skipped: 0,
    pages: 0,
    error: null
  };

  try {
    const resolved = await resolveChannel(ch);
    if (!resolved) {
      row.error = "channel_not_found";
      report.failures.push(`@${ch.handle}: channel not found`);
      report.channels.push(row);
      console.warn(`FAIL @${ch.handle}: not found`);
      continue;
    }
    const channelId = resolved.id;
    ch.channelId = channelId;
    row.channelId = channelId;
    const uploadsId =
      resolved.contentDetails &&
      resolved.contentDetails.relatedPlaylists &&
      resolved.contentDetails.relatedPlaylists.uploads;
    if (!uploadsId) {
      row.error = "no_uploads_playlist";
      report.failures.push(`@${ch.handle}: no uploads playlist`);
      report.channels.push(row);
      console.warn(`FAIL @${ch.handle}: no uploads playlist`);
      continue;
    }
    console.log(`OK @${ch.handle} → ${channelId} (full uploads)`);

    const { items: uploads, pages } = await fetchUploadsAll(uploadsId);
    row.fetched = uploads.length;
    row.pages = pages;
    console.log(`  playlist items: ${uploads.length} (${pages} pages)`);

    const stats = await fetchVideoStats(uploads.map((u) => u.videoId));
    const keptSongs = [];
    for (const u of uploads) {
      const meta = stats[u.videoId];
      if (!meta) {
        row.skipped++;
        continue;
      }
      const title = meta.title || u.title;
      if (!isLikelySong(title, meta)) {
        row.skipped++;
        continue;
      }
      const thumb = bestThumb(u.videoId, meta.thumbnails || u.thumbnails);
      const prev = oldLinks[u.videoId] || {};
      const links = {
        youtube: `https://www.youtube.com/watch?v=${u.videoId}`,
        youtube_music: `https://music.youtube.com/watch?v=${u.videoId}`
      };
      if (prev.apple_music) links.apple_music = prev.apple_music;
      if (prev.spotify) links.spotify = prev.spotify;
      if (prev.kkbox) links.kkbox = prev.kkbox;

      const views = meta.viewCount || 0;
      const song = {
        id: "yt-" + u.videoId,
        title: cleanTitle(title),
        artist: ch.ministry,
        languages: ch.languages.slice(),
        themes: guessThemes(title),
        tags: inferTags(title, meta),
        coverColor: COVER_PALETTE[colorIdx++ % COVER_PALETTE.length],
        coverUrl: thumb,
        links,
        source: "auto",
        status: "published",
        channelId,
        videoId: u.videoId,
        blurb: `${ch.ministry} 官方頻道自動收錄。`,
        created_at: nowIso,
        released_at: { youtube: meta.publishedAt || u.publishedAt },
        signals: {
          youtube: {
            total: views,
            day: Math.max(0, Math.round(views * 0.002)),
            week: Math.max(0, Math.round(views * 0.01)),
            month: Math.max(0, Math.round(views * 0.04))
          }
        }
      };
      keptSongs.push(song);
      allSongs.push(song);
    }
    row.kept = keptSongs.length;
    console.log(`  kept ${row.kept}, skipped ${row.skipped}`);
  } catch (e) {
    row.error = String(e.message || e).slice(0, 220);
    report.failures.push(`@${ch.handle}: ${row.error}`);
    console.warn(`FAIL @${ch.handle}:`, row.error);
    if (isQuotaError(e)) {
      abortQuota = true;
      report.partial = true;
      report.stoppedAt = ch.handle;
      console.warn("ingest-whitelist: quota/rate limit hit — saving partial results");
    }
  }
  report.channels.push(row);
  await sleep(80);
}

report.total = allSongs.length;
writeOutputs(allSongs, whitelist);

console.log("\ningest-whitelist: summary" + (report.partial ? " (PARTIAL — quota)" : ""));
for (const c of report.channels) {
  console.log(
    `  ${c.ministry} (@${c.handle}) id=${c.channelId || "—"} fetched=${c.fetched} kept=${c.kept} skipped=${c.skipped}${c.pages != null ? " pages=" + c.pages : ""}${c.error ? " ERR=" + c.error : ""}`
  );
}
console.log("  TOTAL published:", report.total);
if (report.failures.length) {
  console.log("  failures:");
  for (const f of report.failures) console.log("   -", f);
}
console.log("ingest-whitelist: wrote data.js + live-stats.json + data/whitelist.json");
