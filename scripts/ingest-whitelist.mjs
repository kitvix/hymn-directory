/**
 * Ingest songs from official YouTube channel whitelist into data.js.
 * Usage: node scripts/ingest-whitelist.mjs
 * Requires YOUTUBE_API_KEY in env. Never logs the key.
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

const key = process.env.YOUTUBE_API_KEY;
if (!key) {
  console.error("ingest-whitelist: YOUTUBE_API_KEY is not set");
  process.exit(1);
}

const PER_CHANNEL_FETCH = 40; // playlist items to scan per channel
const PER_CHANNEL_KEEP = 12; // max songs kept per channel after mix
const TOTAL_CAP = 80;

const SKIP_RE =
  /直播|證道|講道|預告|幕後|花絮|訪談|訪問|宣傳|廣告|回顧|崇拜全程|聚會全程|主日信息|報名|課程|事奉學校|School\s+of|trailer|behind\s*the\s*scenes|\bQ\s*&\s*A\b|podcast|播客|新聞|news\b|訂閱|subscribe\s+now|開幕|研討會/i;

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
    throw new Error(`YouTube ${pathname}: ${String(reason).slice(0, 220)}`);
  }
  return body;
}

function cleanTitle(raw) {
  const original = String(raw || "").trim();
  let t = original;
  // Prefer song name inside 【…】 (common for SOP / HKACM / Joshua)
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
  // If cleaning wiped the title, fall back
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

function extractYtId(url) {
  if (!url) return "";
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return m ? m[1] : "";
}

async function resolveChannel(ch) {
  // Prefer forHandle (without @)
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
  // Fallback: search
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

async function fetchUploads(uploadsPlaylistId, maxItems) {
  const items = [];
  let pageToken = "";
  while (items.length < maxItems) {
    const body = await ytGet("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, maxItems - items.length),
      pageToken: pageToken || undefined
    });
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
    await sleep(50);
  }
  return items;
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
    await sleep(50);
  }
  return out;
}

/** Parse ISO 8601 duration; skip very short (<45s) and very long (>20min) unless labeled lyric/MV. */
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
  if (sec > 0 && sec < 45) return false; // shorts / clips
  if (sec > 25 * 60 && !/歌詞|lyric|mv|official|敬拜|詩歌|讚美/i.test(title)) {
    return false; // long non-music
  }
  return true;
}

function pickMix(candidates, keep) {
  // candidates: {videoId, title, publishedAt, viewCount, ...}
  const byViews = candidates.slice().sort((a, b) => b.viewCount - a.viewCount);
  const byNew = candidates.slice().sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const half = Math.ceil(keep / 2);
  const chosen = new Map();
  for (const c of byNew.slice(0, half)) chosen.set(c.videoId, c);
  for (const c of byViews) {
    if (chosen.size >= keep) break;
    chosen.set(c.videoId, c);
  }
  return [...chosen.values()];
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

const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf8"));
const oldLinks = loadOldLinksByVideoId();
const report = { channels: [], failures: [], total: 0 };

const allSongs = [];
let colorIdx = 0;
const nowIso = new Date().toISOString();

console.log("ingest-whitelist: resolving", whitelist.channels.length, "channels…");

for (const ch of whitelist.channels) {
  const row = {
    ministry: ch.ministry,
    handle: ch.handle,
    channelId: null,
    fetched: 0,
    kept: 0,
    skipped: 0,
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
    console.log(`OK @${ch.handle} → ${channelId}`);
    const uploads = await fetchUploads(uploadsId, PER_CHANNEL_FETCH);
    row.fetched = uploads.length;
    const stats = await fetchVideoStats(uploads.map((u) => u.videoId));
    const candidates = [];
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
      candidates.push({
        videoId: u.videoId,
        title,
        publishedAt: meta.publishedAt || u.publishedAt,
        viewCount: meta.viewCount,
        thumbnails: meta.thumbnails || u.thumbnails,
        channelTitle: meta.channelTitle
      });
    }
    const picked = pickMix(candidates, PER_CHANNEL_KEEP);
    row.kept = picked.length;
    for (const p of picked) {
      const thumb =
        (p.thumbnails.maxres && p.thumbnails.maxres.url) ||
        (p.thumbnails.standard && p.thumbnails.standard.url) ||
        (p.thumbnails.high && p.thumbnails.high.url) ||
        `https://i.ytimg.com/vi/${p.videoId}/hqdefault.jpg`;
      const prev = oldLinks[p.videoId] || {};
      const links = {
        youtube: `https://www.youtube.com/watch?v=${p.videoId}`,
        youtube_music: `https://music.youtube.com/watch?v=${p.videoId}`
      };
      if (prev.apple_music) links.apple_music = prev.apple_music;
      if (prev.spotify) links.spotify = prev.spotify;
      if (prev.kkbox) links.kkbox = prev.kkbox;

      const views = p.viewCount || 0;
      const song = {
        id: "yt-" + p.videoId,
        title: cleanTitle(p.title),
        artist: ch.ministry,
        languages: ch.languages.slice(),
        themes: guessThemes(p.title),
        coverColor: COVER_PALETTE[colorIdx++ % COVER_PALETTE.length],
        coverUrl: thumb,
        links,
        source: "auto",
        status: "published",
        channelId,
        videoId: p.videoId,
        blurb: `${ch.ministry} 官方頻道自動收錄。`,
        created_at: nowIso,
        released_at: { youtube: p.publishedAt },
        signals: {
          youtube: {
            total: views,
            day: Math.max(0, Math.round(views * 0.002)),
            week: Math.max(0, Math.round(views * 0.01)),
            month: Math.max(0, Math.round(views * 0.04))
          }
        }
      };
      allSongs.push(song);
    }
  } catch (e) {
    row.error = String(e.message || e).slice(0, 200);
    report.failures.push(`@${ch.handle}: ${row.error}`);
    console.warn(`FAIL @${ch.handle}:`, row.error);
  }
  report.channels.push(row);
  await sleep(100);
}

// Cap total: prefer higher views overall while keeping per-channel representation
let finalSongs = allSongs;
if (allSongs.length > TOTAL_CAP) {
  // Keep at least 4 per channel if available, then fill by views
  const byChannel = new Map();
  for (const s of allSongs) {
    const k = s.artist;
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k).push(s);
  }
  const kept = new Map();
  for (const [, list] of byChannel) {
    const sorted = list.slice().sort(
      (a, b) => (b.signals.youtube.total || 0) - (a.signals.youtube.total || 0)
    );
    for (const s of sorted.slice(0, 4)) kept.set(s.id, s);
  }
  const rest = allSongs
    .filter((s) => !kept.has(s.id))
    .sort((a, b) => (b.signals.youtube.total || 0) - (a.signals.youtube.total || 0));
  for (const s of rest) {
    if (kept.size >= TOTAL_CAP) break;
    kept.set(s.id, s);
  }
  finalSongs = [...kept.values()];
}

// Sort: views desc for stable data.js
finalSongs.sort(
  (a, b) => (b.signals.youtube.total || 0) - (a.signals.youtube.total || 0)
);
report.total = finalSongs.length;

// Write channelIds back
fs.writeFileSync(whitelistPath, JSON.stringify(whitelist, null, 2) + "\n", "utf8");

// Rebuild data.js: replace HYMN_SEED array, update PLATFORM_META
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

console.log("\ningest-whitelist: summary");
for (const c of report.channels) {
  console.log(
    `  ${c.ministry} (@${c.handle}) id=${c.channelId || "—"} fetched=${c.fetched} kept=${c.kept} skipped=${c.skipped}${c.error ? " ERR=" + c.error : ""}`
  );
}
console.log("  TOTAL published:", report.total);
if (report.failures.length) {
  console.log("  failures:");
  for (const f of report.failures) console.log("   -", f);
}
console.log("ingest-whitelist: wrote data.js + data/whitelist.json");
