/**
 * Refresh live-stats.json + patch data.js youtube totals / released_at.
 * Usage: node scripts/sync-youtube.mjs
 * Requires YOUTUBE_API_KEY in env. Never logs the key.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data.js");
const outPath = path.join(root, "live-stats.json");

const key = process.env.YOUTUBE_API_KEY;
if (!key) {
  console.error("sync-youtube: YOUTUBE_API_KEY is not set");
  process.exit(1);
}

function extractYtId(url) {
  if (!url) return "";
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return m ? m[1] : "";
}

const dataSrc = fs.readFileSync(dataPath, "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataSrc, sandbox);
const seed = sandbox.window.HYMN_SEED;
if (!Array.isArray(seed)) {
  console.error("sync-youtube: HYMN_SEED not found in data.js");
  process.exit(1);
}

const idList = [];
const seen = new Set();
for (const song of seed) {
  const id = extractYtId(song.links && song.links.youtube);
  if (!id || seen.has(id)) continue;
  seen.add(id);
  idList.push(id);
}

if (!idList.length) {
  console.error("sync-youtube: no YouTube video ids in seed");
  process.exit(1);
}

const videos = {};
for (let i = 0; i < idList.length; i += 50) {
  const chunk = idList.slice(i, i + 50);
  const url =
    "https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=" +
    encodeURIComponent(chunk.join(",")) +
    "&key=" +
    encodeURIComponent(key);

  const res = await fetch(url);
  let body;
  try {
    body = await res.json();
  } catch (_) {
    console.error("sync-youtube: failed to parse YouTube response, HTTP", res.status);
    process.exit(1);
  }

  if (!res.ok) {
    const reason =
      (body && body.error && (body.error.status || body.error.message)) || "unknown";
    console.error("sync-youtube: YouTube API error", res.status, String(reason).slice(0, 180));
    process.exit(1);
  }

  for (const item of body.items || []) {
    const id = item.id;
    if (!id) continue;
    videos[id] = {
      viewCount: Number((item.statistics && item.statistics.viewCount) || 0),
      publishedAt: (item.snippet && item.snippet.publishedAt) || "",
      title: (item.snippet && item.snippet.title) || "",
      channelTitle: (item.snippet && item.snippet.channelTitle) || ""
    };
  }
}

const payload = {
  fetchedAt: new Date().toISOString(),
  source: "youtube-data-api",
  count: Object.keys(videos).length,
  videos
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

// Patch each song block in data.js by id
let next = dataSrc;
for (const song of seed) {
  const vid = extractYtId(song.links && song.links.youtube);
  const meta = vid && videos[vid];
  if (!meta) continue;

  const idMarker = `id: "${song.id}"`;
  const songStart = next.indexOf(idMarker);
  if (songStart < 0) continue;
  // Song objects end at "\n  },\n  {" or final "\n  }\n];"
  let songEnd = next.indexOf("\n  },\n  {", songStart);
  if (songEnd < 0) songEnd = next.indexOf("\n  }\n];", songStart);
  if (songEnd < 0) continue;

  let block = next.slice(songStart, songEnd);
  if (meta.publishedAt) {
    block = block.replace(
      /(released_at:\s*\{[\s\S]*?youtube:\s*)"[^"]*"/,
      `$1"${meta.publishedAt}"`
    );
  }
  if (Number.isFinite(meta.viewCount)) {
    block = block.replace(
      /(signals:\s*\{[\s\S]*?youtube:\s*\{\s*total:\s*)\d+/,
      `$1${meta.viewCount}`
    );
  }
  next = next.slice(0, songStart) + block + next.slice(songEnd);
}

fs.writeFileSync(dataPath, next, "utf8");
console.log(
  "sync-youtube: ok —",
  payload.count,
  "of",
  idList.length,
  "requested → live-stats.json + data.js"
);
