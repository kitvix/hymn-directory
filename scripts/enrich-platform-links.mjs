/**
 * Enrich song outbound links in data.js.
 * - Apple Music: iTunes Search API (no key)
 * - Spotify: only if SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET
 * - KKBOX: skipped
 *
 * Usage: node scripts/enrich-platform-links.mjs
 * Resume: data/enrich-cache.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data.js");
const cachePath = path.join(root, "data", "enrich-cache.json");
const CONCURRENCY = 8;

const ARTIST_ALIASES = {
  讚美之泉: ["讚美之泉", "stream of praise", "streamofpraise"],
  讚美之泉兒童: ["讚美之泉兒童", "stream of praise kids", "stream of praise", "讚美之泉"],
  約書亞樂團: ["約書亞樂團", "joshua band", "joshuaband", "約書亞"],
  基恩敬拜: ["基恩敬拜", "amazing grace worship", "基恩"],
  小羊詩歌: ["小羊詩歌", "lamb music", "小羊"],
  HKACM: ["hkacm", "香港基督徒音樂事工協會"],
  敬拜者使團: ["敬拜者使團", "the worshipers", "theworshipers", "同心圓"]
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadSongs() {
  const code = fs.readFileSync(dataPath, "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.HYMN_SEED;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (_) {
    return { apple: {}, appleByFp: {}, spotify: {}, meta: { started: new Date().toISOString() } };
  }
}

function saveCache(cache) {
  cache.meta = cache.meta || {};
  cache.meta.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache) + "\n", "utf8");
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[【】\[\]（）()「」『』《》<>]/g, " ")
    .replace(/[|｜／/·•\-–—_,.。!！?？:：;；"'`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreTitle(raw) {
  let t = String(raw || "").trim();
  t = t.split(/[|｜]/)[0].trim();
  t = t.split(/\s*\/\s*/)[0].trim(); // first medley segment
  t = t.replace(/\s*[【\[].*?[】\]]\s*/g, " ").trim();
  const cnOnly = t.match(/[\u4e00-\u9fff][\u4e00-\u9fff0-9\s\-']*/);
  if (cnOnly && cnOnly[0].replace(/\s/g, "").length >= 2) return cnOnly[0].trim();
  // strip trailing English phrase(s)
  while (/\s[A-Za-z]/.test(t)) {
    const next = t.replace(/\s+[A-Za-z][A-Za-z0-9'’ ,.!\-]*$/, "").trim();
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

function artistMatches(resultArtist, ministry) {
  const n = normalize(resultArtist);
  const aliases = ARTIST_ALIASES[ministry] || [normalize(ministry)];
  return aliases.some((a) => {
    const aa = normalize(a);
    return n.includes(aa) || aa.includes(n) || n === aa;
  });
}

function titleScore(songTitle, trackName) {
  const a = normalize(coreTitle(songTitle));
  const b = normalize(trackName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 85;
  const tokens = (s) => {
    const out = new Set();
    s.split(" ").filter(Boolean).forEach((w) => out.add(w));
    const cjk = s.replace(/[^\u4e00-\u9fff]/g, "");
    for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
    return out;
  };
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter || 1;
  return Math.round((inter / union) * 70);
}

function pickAppleResult(song, results) {
  let best = null;
  let bestScore = 0;
  for (const r of results || []) {
    if (!r.trackViewUrl || !r.trackName) continue;
    let score = titleScore(song.title, r.trackName);
    if (artistMatches(r.artistName, song.artist)) score += 40;
    else score -= 25;
    const tn = normalize(r.trackName);
    if (/karaoke|伴奏|純音樂|instrumental/.test(tn)) score -= 15;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best || bestScore < 85) return null;
  let url = String(best.trackViewUrl).replace(/[?&]uo=\d+/g, "").replace(/\?&/, "?").replace(/\?$/, "");
  return { url, trackName: best.trackName, artistName: best.artistName, score: bestScore, trackId: best.trackId };
}

async function itunesSearch(term, country) {
  const u = new URL("https://itunes.apple.com/search");
  u.searchParams.set("term", term);
  u.searchParams.set("entity", "song");
  u.searchParams.set("limit", "8");
  u.searchParams.set("country", country);
  const res = await fetch(u, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  return res.json();
}

async function findApple(song) {
  const core = coreTitle(song.title);
  if (!core || core.length < 2) return null;
  const terms = [`${core} ${song.artist}`, core].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const country of ["tw", "hk"]) {
    for (const term of terms) {
      try {
        const data = await itunesSearch(term, country);
        const hit = pickAppleResult(song, data.results);
        if (hit) return { ...hit, country, term };
      } catch (_) {
        await sleep(250);
        try {
          const data = await itunesSearch(term, country);
          const hit = pickAppleResult(song, data.results);
          if (hit) return { ...hit, country, term };
        } catch (_) {}
      }
    }
  }
  return null;
}

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

async function findSpotify(song, token) {
  if (!token) return null;
  const q = `track:${coreTitle(song.title)} artist:${song.artist}`;
  const u = new URL("https://api.spotify.com/v1/search");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "track");
  u.searchParams.set("limit", "5");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const items = (data.tracks && data.tracks.items) || [];
  let best = null;
  let bestScore = 0;
  for (const t of items) {
    let score = titleScore(song.title, t.name);
    const artists = (t.artists || []).map((a) => a.name).join(" ");
    if (artistMatches(artists, song.artist)) score += 40;
    else score -= 20;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (!best || bestScore < 90 || !best.external_urls?.spotify) return null;
  return { url: best.external_urls.spotify, name: best.name, score: bestScore };
}

function formatSongJs(song, isLast) {
  const linkKeys = ["youtube", "youtube_music", "apple_music", "spotify", "kkbox"];
  const linksEntries = linkKeys
    .filter((k) => song.links && song.links[k])
    .map((k) => `      ${k}: ${JSON.stringify(song.links[k])}`)
    .join(",\n");
  const releasedEntries = Object.entries(song.released_at || {})
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
    .join(",\n");
  const signalsEntries = Object.entries(song.signals || {})
    .map(([k, v]) => {
      const inner = Object.entries(v || {})
        .map(([kk, vv]) => `${kk}: ${Number(vv) || 0}`)
        .join(", ");
      return `      ${k}: { ${inner} }`;
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

function writeDataJs(songs) {
  const dataSrc = fs.readFileSync(dataPath, "utf8");
  const platformMetaBlock = `window.PLATFORM_META = {
  youtube_music: { key: "youtube_music", label: "YouTube Music", short: "YT Music", className: "ytm" },
  youtube: { key: "youtube", label: "YouTube", short: "YT", className: "yt" },
  apple_music: { key: "apple_music", label: "Apple Music", short: "Apple", className: "apple" },
  spotify: { key: "spotify", label: "Spotify", short: "Spotify", className: "spotify" },
  kkbox: { key: "kkbox", label: "KKBOX", short: "KKBOX", className: "kkbox" }
};`;
  const seedBody = songs.map((s, i) => formatSongJs(s, i === songs.length - 1)).join("\n");
  const seedBlock = `window.HYMN_SEED = [\n${seedBody}\n];`;
  const seedStart = dataSrc.indexOf("window.HYMN_SEED");
  const metaStart = dataSrc.indexOf("window.PLATFORM_META");
  if (seedStart < 0 || metaStart < 0) throw new Error("cannot find HYMN_SEED / PLATFORM_META");
  const adminStart = dataSrc.indexOf("window.ADMIN_DEMO_KEY");
  const afterMeta = adminStart >= 0 ? adminStart : dataSrc.length;
  const next =
    dataSrc.slice(0, seedStart) +
    seedBlock +
    "\n\n" +
    platformMetaBlock +
    "\n\n" +
    dataSrc.slice(afterMeta);
  fs.writeFileSync(dataPath, next, "utf8");
}

async function mapPool(items, concurrency, fn) {
  let i = 0;
  const results = new Array(items.length);
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  const songs = loadSongs();
  const cache = loadCache();
  cache.apple = cache.apple || {};
  cache.appleByFp = cache.appleByFp || {};
  cache.spotify = cache.spotify || {};

  let spotifyToken = null;
  try {
    spotifyToken = await getSpotifyToken();
  } catch (e) {
    console.warn("Spotify auth skipped:", String(e.message || e).slice(0, 120));
  }
  if (!spotifyToken) console.log("Spotify: no SPOTIFY_CLIENT_ID/SECRET — skipping");
  console.log("KKBOX: skipped (no public match API without secrets)");
  if (process.env.ENRICH_MISSES_ONLY === "1") {
    let cleared = 0;
    for (const song of songs) {
      if (song.links && song.links.apple_music) continue;
      const fp = normalize(coreTitle(song.title)) + "|" + normalize(song.artist);
      if (cache.apple[song.id] === null) { delete cache.apple[song.id]; cleared++; }
      if (cache.appleByFp[fp] === null) delete cache.appleByFp[fp];
    }
    console.log(`ENRICH_MISSES_ONLY: cleared ${cleared} negative apple cache entries`);
  }

  console.log(`Concurrency=${CONCURRENCY}; songs=${songs.length}; cached apple=${Object.keys(cache.apple).length}`);

  let appleHits = 0;
  let appleMiss = 0;
  let appleCached = 0;
  let spotifyHits = 0;
  let processed = 0;
  let apiCalls = 0;

  await mapPool(songs, CONCURRENCY, async (song) => {
    const cacheKey = song.id;
    const fp = normalize(coreTitle(song.title)) + "|" + normalize(song.artist);
    song.links = song.links || {};

    if (song.links.apple_music) {
      appleHits++;
    } else if (cache.apple[cacheKey] === null || cache.appleByFp[fp] === null) {
      cache.apple[cacheKey] = null;
      cache.appleByFp[fp] = null;
      appleMiss++;
      appleCached++;
    } else if (
      (cache.apple[cacheKey] && cache.apple[cacheKey].url) ||
      (cache.appleByFp[fp] && cache.appleByFp[fp].url)
    ) {
      const hit =
        cache.apple[cacheKey] && cache.apple[cacheKey].url
          ? cache.apple[cacheKey]
          : cache.appleByFp[fp];
      song.links.apple_music = hit.url;
      cache.apple[cacheKey] = hit;
      appleHits++;
      appleCached++;
    } else {
      apiCalls++;
      const hit = await findApple(song);
      if (hit) {
        song.links.apple_music = hit.url;
        cache.apple[cacheKey] = hit;
        cache.appleByFp[fp] = hit;
        appleHits++;
      } else {
        cache.apple[cacheKey] = null;
        cache.appleByFp[fp] = null;
        appleMiss++;
      }
    }

    if (spotifyToken) {
      if (song.links.spotify) spotifyHits++;
      else if (cache.spotify[cacheKey]?.url) {
        song.links.spotify = cache.spotify[cacheKey].url;
        spotifyHits++;
      } else if (cache.spotify[cacheKey] !== null) {
        const hit = await findSpotify(song, spotifyToken);
        if (hit) {
          song.links.spotify = hit.url;
          cache.spotify[cacheKey] = hit;
          spotifyHits++;
        } else cache.spotify[cacheKey] = null;
      }
    }

    processed++;
    if (processed % 100 === 0 || processed === songs.length) {
      saveCache(cache);
      const pct = ((appleHits / processed) * 100).toFixed(1);
      console.log(
        `[${processed}/${songs.length}] apple ${appleHits} (${pct}%) miss ${appleMiss} cacheReuse ${appleCached} api ${apiCalls}` +
          (spotifyToken ? ` | spotify ${spotifyHits}` : "")
      );
    }
  });

  writeDataJs(songs);

  const total = songs.length;
  const withApple = songs.filter((s) => s.links?.apple_music).length;
  const withSpotify = songs.filter((s) => s.links?.spotify).length;
  const withKk = songs.filter((s) => s.links?.kkbox).length;
  const report = {
    total,
    apple_music: { filled: withApple, rate: Number(((withApple / total) * 100).toFixed(2)) },
    spotify: {
      filled: withSpotify,
      rate: Number(((withSpotify / total) * 100).toFixed(2)),
      skipped: !spotifyToken
    },
    kkbox: { filled: withKk, rate: Number(((withKk / total) * 100).toFixed(2)), skipped: true },
    note: "Only deep links written; search-page URLs never stored. KKBOX skipped."
  };
  fs.writeFileSync(path.join(root, "data", "enrich-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Done.", JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
