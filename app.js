(function () {
  const STORAGE_KEY = "hymn_directory_v11";
  const ADMIN_SESSION = "hymn_admin_ok";
  const PLATFORMS = ["youtube", "apple_music", "spotify", "kkbox"];
  /** Outbound listen order: YouTube Music first, then YouTube, then others */
  const LINK_PLATFORMS = ["youtube_music", "youtube", "apple_music", "spotify", "kkbox"];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      songs: JSON.parse(JSON.stringify(window.HYMN_SEED)),
      votes: {},
      clicks: {}
    };
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  /** Empty per-platform play metrics for user submissions */
  function emptySignals() {
    const out = {};
    PLATFORMS.forEach((p) => {
      out[p] = { total: 0, day: 0, week: 0, month: 0 };
    });
    return out;
  }

  /** Normalize chart query: legacy 最新→新歌; 日/周/月→最熱; default 最熱. */
  function normalizeChart(chart) {
    if (chart === "最新") return "新歌";
    if (chart === "日榜" || chart === "周榜" || chart === "月榜") return "最熱";
    if (chart === "新歌" || chart === "最熱") return chart;
    return "最熱";
  }

  const CHART_PLATFORM = "youtube";
  let liveStats = null; // { [videoId]: { viewCount, publishedAt, title, channelTitle } }
  let liveStatsMeta = { status: "idle", source: "", message: "" };

  function extractYtId(url) {
    if (!url) return "";
    const m = String(url).match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? m[1] : "";
  }

  /** YouTube upload / published ISO for 新歌. Prefer live API. */
  function youtubePublishedAt(song) {
    const id = extractYtId(song.links && song.links.youtube);
    if (id && liveStats && liveStats[id] && liveStats[id].publishedAt) {
      return String(liveStats[id].publishedAt);
    }
    const ra = song.released_at && song.released_at.youtube;
    return ra ? String(ra) : "";
  }

  /** YouTube view count: live API preferred, else seed signals.youtube.total */
  function youtubeViews(song) {
    const id = extractYtId(song.links && song.links.youtube);
    if (id && liveStats && liveStats[id] && liveStats[id].viewCount != null) {
      return Number(liveStats[id].viewCount) || 0;
    }
    const sig = song.signals && song.signals.youtube;
    return sig ? Number(sig.total) || 0 : 0;
  }

  /** Song on YouTube chart: needs youtube link; 新歌 also needs publishedAt; play charts need views > 0. */
  function onYoutubeChart(song, chart) {
    if (!(song.links && song.links.youtube)) return false;
    if (chart === "新歌") return !!youtubePublishedAt(song);
    return youtubeViews(song) > 0;
  }

  function applyLiveStatsToSongs(videos) {
    if (!videos) return;
    state.songs.forEach((song) => {
      const id = extractYtId(song.links && song.links.youtube);
      if (!id || !videos[id]) return;
      const v = videos[id];
      song.signals = song.signals || {};
      song.signals.youtube = song.signals.youtube || { total: 0, day: 0, week: 0, month: 0 };
      if (v.viewCount != null) song.signals.youtube.total = Number(v.viewCount) || 0;
      song.released_at = song.released_at || {};
      if (v.publishedAt) song.released_at.youtube = v.publishedAt;
    });
  }

  async function loadLiveStats() {
    const ids = [
      ...new Set(
        publishedSongs()
          .map((s) => extractYtId(s.links && s.links.youtube))
          .filter(Boolean)
      )
    ];
    if (!ids.length) {
      liveStatsMeta = { status: "fallback", source: "seed", message: "無 YouTube 連結" };
      return;
    }

    async function tryFetch(url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json();
    }

    try {
      let videos = null;
      let source = "";
      try {
        videos = {};
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          const data = await tryFetch(
            "/api/youtube-stats?ids=" + encodeURIComponent(chunk.join(","))
          );
          if (data && data.videos) Object.assign(videos, data.videos);
        }
        source = "api";
      } catch (_) {
        const data = await tryFetch("live-stats.json");
        videos = data && data.videos;
        source = "live-stats.json";
      }
      if (videos && typeof videos === "object" && Object.keys(videos).length) {
        liveStats = videos;
        applyLiveStatsToSongs(liveStats);
        saveState(state);
        liveStatsMeta = {
          status: "ok",
          source,
          message: source === "api" ? "YouTube 即時觀看次數" : "暫存觀看次數"
        };
        return;
      }
      throw new Error("empty");
    } catch (_) {
      liveStats = null;
      liveStatsMeta = {
        status: "fallback",
        source: "seed",
        message: "暫時未能更新觀看次數，顯示暫存數字"
      };
    }
  }

  function formatPlays(n) {
    const v = Number(n) || 0;
    if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, "") + "億 次";
    if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, "") + "萬 次";
    return v.toLocaleString("zh-HK") + " 次";
  }

  function publishedSongs() {
    return state.songs.filter((s) => s.status === "published");
  }

  function pendingSongs() {
    return state.songs.filter((s) => s.status === "pending");
  }

  function getSong(id) {
    return state.songs.find((s) => s.id === id);
  }

  function route() {
    const hash = location.hash.replace(/^#\/?/, "") || "home";
    const [path, ...rest] = hash.split("/");
    if (path === "song" && rest[0]) return { name: "song", id: rest[0].split("?")[0] };
    if (path === "submit") return { name: "submit" };
    if (path === "admin") return { name: "admin" };
    return { name: "home" };
  }

  function navigate(to) {
    location.hash = to.startsWith("#") ? to : "#/" + to.replace(/^\//, "");
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function coverColors(song) {
    if (song.coverColor && song.coverColor.length >= 2) return song.coverColor;
    const palette = window.COVER_PALETTE || [["#7c3aed", "#db2777"]];
    let h = 0;
    const key = song.id || song.title || "";
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function coverInitials(song) {
    const t = (song.title || "?").trim();
    return t.slice(0, 1);
  }

  function ytThumbFromUrl(url) {
    if (!url) return "";
    const m = String(url).match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|music\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : "";
  }

  function coverHtml(song, sizeClass) {
    const [c1, c2] = coverColors(song);
    const initials = coverInitials(song);
    const grad = `linear-gradient(145deg,${esc(c1)},${esc(c2)})`;
    const url = (song.coverUrl || "").trim();
    if (url) {
      return `<div class="cover cover-has-img ${sizeClass}" style="background:${grad}" aria-hidden="true"><img class="cover-img" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement&&this.parentElement.classList.remove('cover-has-img');"/><span class="cover-fallback-letter">${esc(initials)}</span></div>`;
    }
    return `<div class="cover ${sizeClass}" style="background:${grad}" aria-hidden="true"><span>${esc(initials)}</span></div>`;
  }

  function iconSvg(name) {
    const icons = {
      home: '<svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 3.5 10.2V21h6.2v-6.5h4.6V21H20.5V10.2L12 3.2z"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
      plus: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
      admin: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 4 7v5c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V7l-8-4z"/></svg>',
      play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>',
      external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M10 14 20 4M20 14v6H4V4h6"/></svg>',
      back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 6 9 12l6 6"/></svg>',
      youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 7.2a3 3 0 0 0-2.1-2.1C19.5 4.6 12 4.6 12 4.6s-7.5 0-9.4.5A3 3 0 0 0 .5 7.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-4.8zM9.6 15.5v-7l6.3 3.5-6.3 3.5z"/></svg>',
      apple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.7 12.7c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.6 0-1.6-.8-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.3.7 1 1.5 2.1 2.6 2 1-.05 1.4-.7 2.7-.7s1.6.7 2.7.6c1.1-.03 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.02 0-2.2-.8-2.2-3.2zM15.8 6.3c.6-.7 1-1.7.9-2.7-1 .05-2.1.7-2.7 1.5-.6.7-1.1 1.7-.9 2.7 1 .1 2.1-.5 2.7-1.5z"/></svg>',
      spotify: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5A10.5 10.5 0 1 0 22.5 12 10.51 10.51 0 0 0 12 1.5zm4.8 15.1a.66.66 0 0 1-.9.22c-2.47-1.51-5.58-1.85-9.24-1.01a.66.66 0 1 1-.29-1.29c4.02-.91 7.45-.52 10.2 1.17a.66.66 0 0 1 .23.91zm1.28-2.85a.82.82 0 0 1-1.13.27c-2.83-1.74-7.14-2.24-10.49-1.23a.82.82 0 1 1-.48-1.57c3.82-1.16 8.55-.6 11.82 1.41a.82.82 0 0 1 .28 1.12zm.11-2.97c-3.39-2.01-8.99-2.2-12.23-1.21a.99.99 0 0 1-.58-1.89c3.72-1.14 9.9-.92 13.8 1.4a.99.99 0 1 1-.99 1.7z"/></svg>',
      kkbox: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 4.5h3.2l3.4 5.4 3.4-5.4h3.2l-5 7.4 5.2 7.6h-3.3l-3.5-5.5-3.5 5.5H6.4l5.2-7.6-5.1-7.4z"/></svg>'
    };
    return icons[name] || "";
  }

  function platformIcon(p, classExtra) {
    const m = window.PLATFORM_META[p];
    if (!m) return "";
    const iconName = p === "apple_music" ? "apple" : p === "youtube_music" ? "youtube" : p;
    return `<span class="p-icon ${m.className} ${classExtra || ""}" title="${esc(m.label)}">${iconSvg(iconName)}</span>`;
  }

  function platformDots(song) {
    const list = LINK_PLATFORMS.filter((p) => song.links && song.links[p]);
    const max = 3;
    const shown = list.slice(0, max).map((p) => platformIcon(p)).join("");
    const more =
      list.length > max
        ? '<span class="p-icon p-more" aria-hidden="true">+' + (list.length - max) + "</span>"
        : "";
    return shown + more;
  }

  /** Display-only. Filter values stay on the data language (普通話). */
  function displayLang(lang) {
    if (lang === "普通話") return "國語";
    return lang || "";
  }

  function langChips(langs) {
    return (langs || [])
      .map((l) => `<span class="chip chip-brand">${esc(displayLang(l))}</span>`)
      .join("");
  }

  function firstListenUrl(song) {
    for (const p of LINK_PLATFORMS) {
      if (song.links && song.links[p]) return { url: song.links[p], platform: p };
    }
    return null;
  }

  function shell(content, active) {
    const act = active || "home";
    return `
      <div class="app-shell">
        <nav class="side-nav" aria-label="主選單">
          <a class="side-brand" href="#/" title="詩歌目錄">詩</a>
          <a class="nav-item ${act === "home" ? "active" : ""}" href="#/">${iconSvg("home")}<span class="nav-label">目錄</span></a>
          <div class="side-spacer"></div>
          <a class="nav-item ${act === "admin" ? "active" : ""}" href="#/admin">${iconSvg("admin")}<span class="nav-label">管理</span></a>
        </nav>
        <div class="content-wrap">
          <div class="mobile-top">
            <a class="mobile-brand" href="#/">
              <span class="mark">詩</span>
              <span>詩歌目錄</span>
            </a>
          </div>
          <main class="main">${content}</main>
          <footer class="footer">
            榜單按官方 YouTube 頻道觀看次數排序。本站提供各平台收聽連結，不託管音檔。公開上架暫未開放。
            <a href="#/admin">管理</a>
          </footer>
        </div>
        <nav class="bottom-nav" aria-label="底部選單">
          <a class="${act === "home" ? "active" : ""}" href="#/">${iconSvg("home")}<span>目錄</span></a>
          <a class="${act === "admin" ? "active" : ""}" href="#/admin">${iconSvg("admin")}<span>管理</span></a>
        </nav>
      </div>
    `;
  }

  const HOME_QUERY_KEYS = ["q", "lang", "ministry", "chart", "tag", "theme"];
  const TAG_DEFS = [
    { id: "accompaniment", label: "伴奏" },
    { id: "subtitle", label: "字幕" },
    { id: "shorts", label: "Shorts" },
    { id: "medley", label: "串燒" }
  ];
  const TAG_LABEL = {
    accompaniment: "伴奏",
    subtitle: "字幕",
    shorts: "Shorts",
    medley: "串燒"
  };
  const TAG_RANK = { exact: 6, start: 5, boundary: 4, artist: 3, theme: 2, substring: 1 };

  function hashQuery() {
    const hash = location.hash || "";
    const i = hash.indexOf("?");
    return i >= 0 ? new URLSearchParams(hash.slice(i + 1)) : new URLSearchParams();
  }

  function preservedHomeQuery() {
    const qs = hashQuery();
    const out = new URLSearchParams();
    HOME_QUERY_KEYS.forEach((key) => {
      const value = qs.get(key);
      if (value) out.set(key, value);
    });
    return out;
  }

  function withQuery(path, params) {
    const qstr = params.toString();
    return path + (qstr ? "?" + qstr : "");
  }

  function directoryHref() {
    return withQuery("#/", preservedHomeQuery());
  }

  function songHref(id) {
    return withQuery("#/song/" + id, preservedHomeQuery());
  }

  function visibleBlurb(text) {
    const value = String(text || "").trim();
    if (!value || /官方頻道自動收錄/.test(value)) return "";
    return value;
  }

  function isCjkChar(ch) {
    if (!ch) return false;
    const code = ch.codePointAt(0);
    return (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff);
  }

  function isAlnumChar(ch) {
    return !!ch && /[A-Za-z0-9]/.test(ch);
  }

  function isBoundaryChar(ch) {
    return !ch || (!isCjkChar(ch) && !isAlnumChar(ch));
  }

  function hasBoundary(text, index, len) {
    const prev = index > 0 ? text[index - 1] : "";
    const next = index + len < text.length ? text[index + len] : "";
    return isBoundaryChar(prev) && isBoundaryChar(next);
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function queryAllowsBroad(query) {
    let cjk = 0;
    let latin = 0;
    for (const ch of query) {
      if (isCjkChar(ch)) cjk += 1;
      else if (isAlnumChar(ch)) latin += 1;
    }
    if (cjk >= 2) return true;
    return cjk === 0 && latin >= 3;
  }

  function findBounded(text, query) {
    if (!query) return false;
    let index = 0;
    while ((index = text.indexOf(query, index)) !== -1) {
      if (hasBoundary(text, index, query.length)) return true;
      index += query.length;
    }
    return false;
  }

  /** Title may start with a single CJK char; Latin prefixes must end on a boundary. */
  function startsAsTitle(text, query) {
    if (!text.startsWith(query)) return false;
    if (query.length === 1 && isCjkChar(query)) return true;
    const next = text[query.length] || "";
    if (!next) return true;
    if (isAlnumChar(query[query.length - 1]) && isAlnumChar(next)) return false;
    return true;
  }

  function titleSegments(text) {
    const chunks = text.split(/[/／|｜·•・]+|\s+[-–—－]\s+|[（(]|[)）【】\[\]]/);
    const segments = [];
    chunks.forEach((chunk) => {
      const piece = chunk.replace(/^[-–—－\s]+|[-–—－\s]+$/g, "").trim();
      if (!piece) return;
      const bilingual = piece.match(
        /^([\u3400-\u9fff\uf900-\ufaff]+)\s+([a-z0-9].*)$/i
      );
      if (bilingual) {
        segments.push(bilingual[1].trim(), bilingual[2].trim());
      } else {
        segments.push(piece);
      }
    });
    return segments;
  }

  function titleLevel(text, query) {
    const normalized = normalizeText(text);
    if (!normalized || !query) return 0;
    if (normalized === query) return TAG_RANK.exact;
    if (titleSegments(normalized).some((segment) => segment === query)) return TAG_RANK.start;
    if (startsAsTitle(normalized, query)) return TAG_RANK.start;
    if (findBounded(normalized, query)) return TAG_RANK.boundary;
    if (queryAllowsBroad(query) && normalized.includes(query)) return TAG_RANK.substring;
    return 0;
  }

  function fieldLevel(text, query, mode) {
    const normalized = normalizeText(text);
    if (!normalized || !query) return 0;
    const rank = mode === "artist" ? TAG_RANK.artist : TAG_RANK.theme;
    if (normalized === query) return rank;
    if (titleSegments(normalized).some((segment) => segment === query)) return rank;
    if (query.length === 1 && isCjkChar(query)) {
      return findBounded(normalized, query) ? rank : 0;
    }
    if (startsAsTitle(normalized, query) || findBounded(normalized, query)) return rank;
    if (mode === "artist" && queryAllowsBroad(query) && normalized.includes(query)) {
      return TAG_RANK.substring;
    }
    return 0;
  }

  function titleCandidates(song) {
    const titles = [];
    if (song.title) titles.push(song.title);
    if (Array.isArray(song.aliases)) titles.push(...song.aliases.filter(Boolean));
    else if (typeof song.aliases === "string" && song.aliases) titles.push(song.aliases);
    if (typeof song.alias === "string" && song.alias) titles.push(song.alias);
    return titles;
  }

  function relevanceScore(song, rawQuery) {
    const query = normalizeText(rawQuery);
    if (!query) return 0;
    let best = 0;
    titleCandidates(song).forEach((title) => {
      best = Math.max(best, titleLevel(title, query));
    });
    if (song.artist) best = Math.max(best, fieldLevel(song.artist, query, "artist"));
    (song.themes || []).forEach((theme) => {
      best = Math.max(best, fieldLevel(theme, query, "theme"));
    });
    return best;
  }

  function chartCompare(a, b, chart) {
    if (chart === "新歌") {
      return new Date(youtubePublishedAt(b)) - new Date(youtubePublishedAt(a));
    }
    return youtubeViews(b) - youtubeViews(a);
  }

  function sortSongs(list, chart, query) {
    const arr = list.slice();
    if (query) {
      return arr.sort((a, b) => {
        const byRelevance = relevanceScore(b, query) - relevanceScore(a, query);
        if (byRelevance) return byRelevance;
        return chartCompare(a, b, chart);
      });
    }
    return arr.sort((a, b) => chartCompare(a, b, chart));
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

  function inferTags(title, meta) {
    const rawTitle = String(title || "");
    const extra =
      (meta && (meta.description || meta.originalTitle || "")) || "";
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

  function assignInferredTags() {
    state.songs.forEach((song) => {
      if (Array.isArray(song.tags)) return;
      song.tags = inferTags(song.title, song);
    });
  }

  function orderedTags(song) {
    const have = new Set(song.tags || []);
    return TAG_DEFS.map((tag) => tag.id).filter((id) => have.has(id));
  }

  function tagChipSpans(song) {
    return orderedTags(song)
      .map((id) => `<span class="chip chip-tag">${esc(TAG_LABEL[id])}</span>`)
      .join("");
  }

  function tagChipsHtml(song, shifted) {
    const tags = orderedTags(song);
    if (!tags.length) return "";
    const max = 2;
    const shown = tags.slice(0, max);
    const extra = tags.length - shown.length;
    return (
      '<div class="song-card-tags' +
      (shifted ? " has-rank" : "") +
      '">' +
      shown.map((id) => '<span class="tag-chip">' + esc(TAG_LABEL[id]) + "</span>").join("") +
      (extra > 0 ? '<span class="tag-chip tag-more">+' + extra + "</span>" : "") +
      "</div>"
    );
  }

  function scoreLabel(song, chart) {
    if (chart === "新歌") {
      const iso = youtubePublishedAt(song);
      return iso ? new Date(iso).toLocaleDateString("zh-HK") : "";
    }
    return "觀看 " + formatPlays(youtubeViews(song));
  }

  function preferListen(song) {
    if (song.links && song.links.youtube_music) {
      return { url: song.links.youtube_music, platform: "youtube_music" };
    }
    if (song.links && song.links.youtube) {
      return { url: song.links.youtube, platform: "youtube" };
    }
    return firstListenUrl(song);
  }

  let virtualCleanup = null;
  let homeGrid = null;
  let searchTimer = null;
  let suggestSticky = { suppress: false, active: -1 };
  let reopenSuggest = null;

  function teardownVirtual() {
    if (virtualCleanup) {
      virtualCleanup();
      virtualCleanup = null;
    }
  }

  /** Image-forward chart / related card. Rank and outbound play sit on the cover. */
  function songCardHtml(song, index, chart, opts) {
    opts = opts || {};
    const showRank = !!opts.showRank;
    const rank = index + 1;
    const listen = preferListen(song);
    const [c1, c2] = coverColors(song);
    const grad = "linear-gradient(145deg," + esc(c1) + "," + esc(c2) + ")";
    const url = (song.coverUrl || "").trim();
    const langs = (song.languages || [])
      .filter(Boolean)
      .map((l) => esc(displayLang(l)))
      .join("／");
    const score = chart ? scoreLabel(song, chart) : "";
    const dots = platformDots(song);
    const label =
      (showRank ? rank + " " : "") + (song.title || "") + "，" + (song.artist || "");
    const styleAttr = opts.style ? ' style="' + opts.style + '"' : "";
    const img = url
      ? '<img class="media-img" src="' +
        esc(url) +
        '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"/>'
      : "";
    const rankHtml = showRank
      ? '<div class="song-card-rank' + (rank <= 3 ? " top" : "") + '">' + rank + "</div>"
      : "";
    const play = listen
      ? '<a class="play-out song-card-play" href="' +
        esc(listen.url) +
        '" target="_blank" rel="noopener noreferrer" title="前往收聽" aria-label="' +
        esc("前往收聽：" + (song.title || "")) +
        '" data-row-out="' +
        esc(song.id) +
        '">' +
        iconSvg("play") +
        "</a>"
      : "";
    const meta =
      score || dots
        ? '<div class="song-card-meta">' +
          (score ? '<span class="score mono">' + esc(score) + "</span>" : "<span></span>") +
          (dots ? '<span class="platform-icons">' + dots + "</span>" : "") +
          "</div>"
        : "";
    return (
      '<article class="song-card' +
      (opts.flow ? " in-flow" : "") +
      '" role="listitem" data-id="' +
      esc(song.id) +
      '"' +
      styleAttr +
      ">" +
      '<a class="song-card-open" href="' +
      esc(songHref(song.id)) +
      '" aria-label="' +
      esc(label) +
      '">' +
      '<div class="media-frame" style="background:' +
      grad +
      '">' +
      img +
      '<span class="media-fallback" aria-hidden="true">' +
      esc(coverInitials(song)) +
      "</span></div>" +
      '<div class="song-card-scrim" aria-hidden="true"></div>' +
      '<div class="song-card-copy"><h3>' +
      esc(song.title) +
      "</h3><p>" +
      esc(song.artist) +
      (langs ? " · " + langs : "") +
      "</p>" +
      meta +
      "</div></a>" +
      tagChipsHtml(song, showRank) +
      rankHtml +
      play +
      "</article>"
    );
  }

  /**
   * Keep only the visible chart rows in the DOM. The full list is thousands of
   * songs; mounting every cover freezes the page.
   * Card size is measured once and reused until the grid width changes, and
   * scroll only adds or removes rows outside the window.
   */
  function mountVirtualGrid(songs, chart) {
    teardownVirtual();
    const root = document.getElementById("chart-grid");
    if (!root) return;
    if (!songs.length) {
      root.style.height = "auto";
      root.innerHTML = "";
      return;
    }

    const GAP = 14;
    const pool = new Map();
    let geom = null;
    let gridTop = 0;
    let lastStart = -1;
    let lastEnd = -1;
    let lastCols = 0;
    let lastCardW = 0;
    let lastCardH = 0;
    let lastScrollY = window.scrollY || 0;
    let raf = 0;
    let retries = 0;
    root.style.overflowAnchor = "none";

    function colsFor(width) {
      if (width < 520) return 1;
      if (width < 860) return 2;
      return 3;
    }

    function documentTop(el) {
      let y = 0;
      let node = el;
      while (node) {
        y += node.offsetTop || 0;
        node = node.offsetParent;
      }
      return y;
    }

    function computeGeom(width) {
      const cols = colsFor(width);
      const cardW = Math.max(1, Math.floor((width - GAP * (cols - 1)) / cols));
      const cardH = Math.max(120, Math.round((cardW * 9) / 16));
      const stride = cardH + GAP;
      const totalRows = Math.ceil(songs.length / cols);
      const totalH = totalRows > 0 ? totalRows * stride - GAP : 0;
      return { width, cols, cardW, cardH, stride, totalRows, totalH };
    }

    function measure() {
      let width = root.clientWidth;
      if (width < 8) return null;
      let next = computeGeom(width);
      const applyHeight = (g) => {
        const px = g.totalH + "px";
        if (root.style.height !== px) root.style.height = px;
      };
      applyHeight(next);
      const widthAfter = root.clientWidth;
      if (widthAfter >= 8 && widthAfter !== width) {
        next = computeGeom(widthAfter);
        applyHeight(next);
      }
      gridTop = documentTop(root);
      return next;
    }

    function overscanPx(g) {
      const viewH = window.innerHeight || g.cardH;
      return Math.max(g.stride * 6, Math.round(viewH * 3 + g.stride));
    }

    function renderWindow() {
      if (!geom) {
        geom = measure();
        if (!geom) {
          if (retries < 8) {
            retries += 1;
            raf = requestAnimationFrame(() => {
              raf = 0;
              renderWindow();
            });
          }
          return;
        }
        retries = 0;
      }

      const { cols, cardW, cardH, stride, totalRows } = geom;
      const viewH = window.innerHeight || cardH;
      const viewTop = (window.scrollY || 0) - gridTop;
      const overscan = overscanPx(geom);
      let startRow = Math.floor((viewTop - overscan) / stride);
      let endRow = Math.ceil((viewTop + viewH + overscan) / stride);
      if (startRow < 0) startRow = 0;
      if (endRow > totalRows) endRow = totalRows;
      if (endRow < startRow) endRow = startRow;
      const maxRows = Math.ceil((viewH + overscan * 2) / stride) + 1;
      if (endRow - startRow > maxRows) endRow = Math.min(totalRows, startRow + maxRows);

      const start = startRow * cols;
      const end = Math.min(songs.length, endRow * cols);
      if (
        start === lastStart &&
        end === lastEnd &&
        cols === lastCols &&
        cardW === lastCardW &&
        cardH === lastCardH
      ) {
        lastScrollY = window.scrollY || 0;
        return;
      }

      const reposition = cols !== lastCols || cardW !== lastCardW || cardH !== lastCardH;
      const keep = new Set();
      for (let i = start; i < end; i++) keep.add(songs[i].id);
      const drop = [];
      pool.forEach((el, id) => {
        if (!keep.has(id)) drop.push(id);
      });
      for (let i = 0; i < drop.length; i++) {
        const el = pool.get(drop[i]);
        if (el) el.remove();
        pool.delete(drop[i]);
      }

      const frag = document.createDocumentFragment();
      let pending = 0;
      for (let i = start; i < end; i++) {
        const song = songs[i];
        const col = i % cols;
        const row = (i / cols) | 0;
        const top = row * stride;
        const left = col * (cardW + GAP);
        let el = pool.get(song.id);
        if (!el) {
          const pos =
            "top:" + top + "px;left:" + left + "px;width:" + cardW + "px;height:" + cardH + "px";
          const holder = document.createElement("template");
          holder.innerHTML = songCardHtml(song, i, chart, { showRank: true, style: pos }).trim();
          el = holder.content.firstElementChild;
          if (!el) continue;
          pool.set(song.id, el);
          frag.appendChild(el);
          pending += 1;
        } else if (reposition) {
          el.style.top = top + "px";
          el.style.left = left + "px";
          el.style.width = cardW + "px";
          el.style.height = cardH + "px";
        }
      }
      if (pending) root.appendChild(frag);

      lastStart = start;
      lastEnd = end;
      lastCols = cols;
      lastCardW = cardW;
      lastCardH = cardH;
      lastScrollY = window.scrollY || 0;
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        renderWindow();
      });
    }

    function onScroll() {
      if (!geom) {
        schedule();
        return;
      }
      const y = window.scrollY || 0;
      if (Math.abs(y - lastScrollY) > overscanPx(geom)) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        renderWindow();
        return;
      }
      schedule();
    }

    function onResize() {
      const width = root.clientWidth;
      if (!geom || Math.abs(width - geom.width) >= 1) geom = null;
      else gridTop = documentTop(root);
      schedule();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
            if (geom && Math.abs(w - geom.width) < 1) return;
            geom = null;
            schedule();
          })
        : null;
    if (ro) ro.observe(root);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!root.isConnected) return;
        const nextTop = documentTop(root);
        if (nextTop === gridTop) return;
        gridTop = nextTop;
        schedule();
      });
    }
    virtualCleanup = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    renderWindow();
  }

  function sourceLabel(source) {
    if (source === "auto") return "官方頻道";
    if (source === "creator") return "投稿";
    return "多方來源";
  }

  function themeOptions() {
    const counts = new Map();
    publishedSongs().forEach((song) => {
      (song.themes || []).forEach((theme) => {
        if (!theme) return;
        counts.set(theme, (counts.get(theme) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
      .map(([name]) => name);
  }

  function suggestionQueryReady(query) {
    const text = normalizeText(query);
    let cjk = 0;
    let latin = 0;
    for (const ch of text) {
      if (isCjkChar(ch)) cjk += 1;
      else if (isAlnumChar(ch)) latin += 1;
    }
    return cjk >= 1 || latin >= 2;
  }

  function collectSuggestions(rawQuery, pool) {
    const query = normalizeText(rawQuery);
    if (!suggestionQueryReady(query)) return [];
    const items = [];
    const seenTitle = new Map();
    (pool || []).forEach((song) => {
      let titleScore = 0;
      titleCandidates(song).forEach((title) => {
        titleScore = Math.max(titleScore, titleLevel(title, query));
      });
      if (titleScore > 0 && song.title) {
        const key = normalizeText(song.title);
        const prev = seenTitle.get(key);
        if (!prev || youtubeViews(song) > youtubeViews(prev.song)) {
          seenTitle.set(key, { song, score: titleScore });
        }
      }
    });
    seenTitle.forEach(({ song, score }) => {
      items.push({
        kind: "title",
        label: song.title,
        hint: song.artist || "",
        score,
        views: youtubeViews(song)
      });
    });
    const seenArtist = new Set();
    (pool || []).forEach((song) => {
      if (!song.artist || seenArtist.has(song.artist)) return;
      const score = fieldLevel(song.artist, query, "artist");
      if (score <= 0) return;
      seenArtist.add(song.artist);
      items.push({ kind: "artist", label: song.artist, hint: "機構", score, views: 0 });
    });
    const seenTheme = new Set();
    (pool || []).forEach((song) => {
      (song.themes || []).forEach((theme) => {
        if (!theme || seenTheme.has(theme)) return;
        const score = fieldLevel(theme, query, "theme");
        if (score <= 0) return;
        seenTheme.add(theme);
        items.push({ kind: "theme", label: theme, hint: "主題", score, views: 0 });
      });
    });
    const kindRank = { title: 0, artist: 1, theme: 2 };
    items.sort((a, b) => {
      if (kindRank[a.kind] !== kindRank[b.kind]) return kindRank[a.kind] - kindRank[b.kind];
      if (b.score !== a.score) return b.score - a.score;
      return b.views - a.views;
    });
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
      const key = normalizeText(item.label);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out.slice(0, 8);
  }

  function normalizeTitleKey(title) {
    let text = normalizeText(title).replace(/\s+/g, "");
    if (!text) return "";
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(/[（(【\[][^）)】\]]{0,32}[）)】\]]$/, "");
      text = text.replace(/[-–—－_:|｜]+$/, "");
    }
    const stripped = text.replace(
      /(officialmusicvideo|officialmv|lyricvideo|karaoke|offvocal|acoustic|1080p|720p|現場版|歌詞版|純音樂|伴奏版|中英字幕|字幕版|官方版|4k|hd|hq|live|mv)+$/i,
      ""
    );
    if ([...stripped].length >= 2) text = stripped;
    return text;
  }

  function titlesSimilar(a, b) {
    const left = normalizeTitleKey(a);
    const right = normalizeTitleKey(b);
    if (!left || !right || left === right) return false;
    const aa = [...left];
    const bb = [...right];
    const shorter = aa.length <= bb.length ? aa : bb;
    const longer = aa.length <= bb.length ? bb : aa;
    if (shorter.length >= 2 && longer.join("").includes(shorter.join(""))) return true;
    let i = 0;
    while (i < aa.length && i < bb.length && aa[i] === bb[i]) i += 1;
    return i >= 2;
  }

  function linkCount(song) {
    return LINK_PLATFORMS.filter((p) => song.links && song.links[p]).length;
  }

  function preferRelatedDup(current, candidate, incumbent) {
    const rank = (item) => {
      let score = 0;
      if (current.artist && item.artist === current.artist) score += 100;
      score += linkCount(item) * 10;
      if ((item.tags || []).includes("accompaniment")) score -= 5;
      return score;
    };
    const next = rank(candidate);
    const prev = rank(incumbent);
    if (next !== prev) return next > prev;
    return youtubeViews(candidate) > youtubeViews(incumbent);
  }

  const GENERIC_THEMES = new Set(["敬拜", "讚美"]);

  function specificSharedThemes(song, other) {
    return (other.themes || []).filter(
      (theme) => (song.themes || []).includes(theme) && !GENERIC_THEMES.has(theme)
    );
  }

  function pickRelated(song) {
    const groups = new Map();
    publishedSongs().forEach((other) => {
      if (!other || other.id === song.id) return;
      const key = normalizeTitleKey(other.title) || "id:" + other.id;
      const prev = groups.get(key);
      if (!prev || preferRelatedDup(song, other, prev)) groups.set(key, other);
    });
    const similar = [];
    const topical = [];
    const sameArtist = [];
    const sameLang = [];
    groups.forEach((other) => {
      const artistMatch = !!(song.artist && other.artist === song.artist);
      const themeMatch = specificSharedThemes(song, other).length > 0;
      const langMatch = (other.languages || []).some((lang) =>
        (song.languages || []).includes(lang)
      );
      if (artistMatch && titlesSimilar(song.title, other.title)) similar.push(other);
      else if (themeMatch) topical.push(other);
      else if (artistMatch) sameArtist.push(other);
      else if (langMatch) sameLang.push(other);
    });
    const byHeat = (a, b) => {
      const aArtist = song.artist && a.artist === song.artist ? 1 : 0;
      const bArtist = song.artist && b.artist === song.artist ? 1 : 0;
      if (aArtist !== bArtist) return bArtist - aArtist;
      const aSpec = specificSharedThemes(song, a).length;
      const bSpec = specificSharedThemes(song, b).length;
      if (aSpec !== bSpec) return bSpec - aSpec;
      return youtubeViews(b) - youtubeViews(a);
    };
    [similar, topical, sameArtist, sameLang].forEach((list) => list.sort(byHeat));
    const out = [];
    similar.forEach((item) => {
      if (out.length < 8) out.push(item);
    });
    let otherTopical = 0;
    topical.forEach((item) => {
      if (out.length >= 8) return;
      const artistMatch = !!(song.artist && item.artist === song.artist);
      if (!artistMatch) {
        if (otherTopical >= 4) return;
        otherTopical += 1;
      }
      out.push(item);
    });
    sameArtist.forEach((item) => {
      if (out.length < 8) out.push(item);
    });
    const langCap = out.length >= 6 ? 8 - out.length : Math.min(4, 8 - out.length);
    for (let i = 0; i < sameLang.length && i < langCap && out.length < 8; i++) out.push(sameLang[i]);
    return out;
  }

  function themeHomeHref(theme) {
    const params = preservedHomeQuery();
    params.delete("q");
    if (theme) params.set("theme", theme);
    else params.delete("theme");
    return withQuery("#/", params);
  }

  function songShareUrl(id) {
    return location.origin + location.pathname + "#/song/" + encodeURIComponent(id);
  }

  function formatSongTitle(song) {
    const raw = String((song && song.title) || "").trim() || "詩歌";
    const chars = [...raw];
    const head = chars.length > 42 ? chars.slice(0, 42).join("") + "…" : raw;
    return head + " — 詩歌目錄";
  }

  function listenBtnHtml(song, platform) {
    const meta = window.PLATFORM_META[platform];
    if (!meta || !(song.links && song.links[platform])) return "";
    const iconName =
      platform === "apple_music" ? "apple" : platform === "youtube_music" ? "youtube" : platform;
    return `
      <a class="listen-btn" href="${esc(song.links[platform])}" target="_blank" rel="noopener noreferrer" data-click="${esc(song.id)}" data-platform="${platform}">
        <span class="logo ${meta.className}">${iconSvg(iconName)}</span>
        <span>於 ${esc(meta.label)} 收聽</span>
      </a>`;
  }

  function fallbackCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) return true;
    } catch (_) {}
    window.prompt("請手動複製連結", text);
    return false;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => fallbackCopy(text)
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function flashCopy(btn, ok) {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = ok ? "已複製連結" : "請手動複製";
    window.setTimeout(() => {
      if (btn.isConnected) btn.textContent = prev;
    }, 1600);
  }

  function renderHome() {
    const hash = location.hash;
    const qIdx = hash.indexOf("?");
    const qs = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)) : new URLSearchParams();
    const chart = normalizeChart(qs.get("chart") || "最熱");
    const q = (qs.get("q") || "").trim();
    const lang = qs.get("lang") || "";
    const ministry = qs.get("ministry") || "";
    const tag = qs.get("tag") || "";
    const theme = qs.get("theme") || "";
    const searching = !!q;

    let list = publishedSongs().filter((s) => onYoutubeChart(s, chart));
    if (lang) list = list.filter((s) => (s.languages || []).includes(lang));
    if (ministry) list = list.filter((s) => s.artist === ministry);
    if (tag) list = list.filter((s) => (s.tags || []).includes(tag));
    if (theme) list = list.filter((s) => (s.themes || []).includes(theme));
    const suggestPool = list.slice();
    if (q) list = list.filter((s) => relevanceScore(s, q) > 0);

    list = sortSongs(list, chart, q);
    const ministryOrder = ["讚美之泉", "讚美之泉兒童", "約書亞樂團", "基恩敬拜", "小羊詩歌", "HKACM", "敬拜者使團"];
    const ministrySet = new Set(publishedSongs().map((s) => s.artist));
    const ministries = [
      ...ministryOrder.filter((m) => ministrySet.has(m)),
      ...[...ministrySet].filter((m) => !ministryOrder.includes(m)).sort()
    ];
    const themes = themeOptions();
    const featured = !searching ? list[0] || null : null;
    homeGrid = { songs: list, chart, suggestPool };

    const tabs = ["新歌", "最熱"]
      .map(
        (t) =>
          `<button class="tab ${t === chart ? "active" : ""}" data-chart="${esc(t)}">${esc(t)}</button>`
      )
      .join("");

    const liveSuffix =
      liveStatsMeta.status === "ok" || liveStatsMeta.status === "fallback"
        ? liveStatsMeta.message
          ? " · " + liveStatsMeta.message
          : ""
        : "";
    const countLabel = searching
      ? "按相關度 · 共 " + list.length + " 首" + liveSuffix
      : list.length + " 首" + liveSuffix;
    const liveNote = `<span class="muted section-count" style="font-size:13px">${esc(countLabel)}</span>`;

    const featureHtml = featured
      ? (() => {
          const listen = preferListen(featured);
          const [c1, c2] = coverColors(featured);
          const cover = (featured.coverUrl || "").trim();
          const kicker = chart + " · 第 1 名";
          const action = listen
            ? `<a class="btn btn-play" href="${esc(listen.url)}" target="_blank" rel="noopener noreferrer" data-feature-out="${esc(featured.id)}">${iconSvg("play")} 於 ${esc(window.PLATFORM_META[listen.platform].label)} 收聽</a>`
            : `<a class="btn btn-glass" href="${esc(songHref(featured.id))}">查看詳情</a>`;
          return `
          <section class="poster hero-feature" style="--hero-a:${esc(c1)};--hero-b:${esc(c2)}">
            <div class="hero-visual">
              ${
                cover
                  ? `<img class="hero-bg-img" src="${esc(cover)}" alt="" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"/>`
                  : ""
              }
            </div>
            <div class="hero-scrim" aria-hidden="true"></div>
            <a class="hero-hit" href="${esc(songHref(featured.id))}" tabindex="-1" aria-hidden="true"></a>
            <div class="hero-content">
              <p class="hero-kicker"><span class="glass-pill">${esc(kicker)}</span></p>
              <h1><a href="${esc(songHref(featured.id))}">${esc(featured.title)}</a></h1>
              <p class="hero-artist">${esc(featured.artist || "")}</p>
              <div class="hero-actions">${action}</div>
            </div>
          </section>`;
        })()
      : "";

    const heading = searching ? "搜尋結果" : chart;
    const grid = list.length
      ? `<div class="chart-grid" id="chart-grid" role="list" aria-label="${esc(heading)}"></div>`
      : `<div class="empty"><p>沒有符合條件的詩歌。</p><button type="button" class="btn btn-primary" id="clear-all-filters">清除全部條件</button></div>`;

    return shell(
      `
      ${featureHtml}

      <div class="section-head">
        <h2>${esc(heading)}</h2>
        <div class="section-tools">
          ${liveNote}
          <button type="button" class="btn btn-sm btn-ghost" id="copy-home-link">複製連結</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="tabs" id="chart-tabs" aria-label="榜單">${tabs}</div>
        <div class="toolbar-row">
          <div class="search-box">
            <span class="icon">${iconSvg("search")}</span>
            <input id="search-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-suggest" placeholder="搜尋歌名、機構、主題…" value="${esc(q)}" autocomplete="off" />
            <ul id="search-suggest" class="search-suggest" role="listbox" hidden></ul>
          </div>
        </div>
        <div class="filter-menus" aria-label="篩選">
          <div class="filter-group">
            <span class="filter-label">語言</span>
            <div class="chip-bar" id="filter-lang-bar" role="list">
              <button type="button" class="filter-chip ${!lang ? "active" : ""}" data-filter="lang" data-value="" role="listitem">全部</button>
              ${[...new Set(publishedSongs().flatMap((s) => s.languages || []))]
                .sort()
                .map(
                  (l) =>
                    `<button type="button" class="filter-chip ${lang === l ? "active" : ""}" data-filter="lang" data-value="${esc(l)}" role="listitem">${esc(displayLang(l))}</button>`
                )
                .join("")}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">機構</span>
            <div class="chip-bar" id="filter-ministry-bar" role="list">
              <button type="button" class="filter-chip ${!ministry ? "active" : ""}" data-filter="ministry" data-value="" role="listitem">全部</button>
              ${ministries
                .map(
                  (m) =>
                    `<button type="button" class="filter-chip ${ministry === m ? "active" : ""}" data-filter="ministry" data-value="${esc(m)}" role="listitem">${esc(m)}</button>`
                )
                .join("")}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">類型</span>
            <div class="chip-bar" id="filter-tag-bar" role="list">
              <button type="button" class="filter-chip ${!tag ? "active" : ""}" data-filter="tag" data-value="" role="listitem">全部</button>
              ${TAG_DEFS.map(
                (item) =>
                  `<button type="button" class="filter-chip ${tag === item.id ? "active" : ""}" data-filter="tag" data-value="${esc(item.id)}" role="listitem">${esc(item.label)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label">主題</span>
            <div class="chip-bar" id="filter-theme-bar" role="list">
              <button type="button" class="filter-chip ${!theme ? "active" : ""}" data-filter="theme" data-value="" role="listitem">全部</button>
              ${themes
                .map(
                  (item) =>
                    `<button type="button" class="filter-chip ${theme === item ? "active" : ""}" data-filter="theme" data-value="${esc(item)}" role="listitem">${esc(item)}</button>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>

      ${grid}
    `,
      "home"
    );
  }

  function renderSong(id) {
    const song = getSong(id);
    if (!song || song.status !== "published") {
      return shell(
        `
        <a class="back-link" href="${esc(directoryHref())}">${iconSvg("back")} 返回目錄</a>
        <div class="empty">搵唔到呢首歌，可能尚未通過審核。</div>
      `,
        "home"
      );
    }

    const [c1, c2] = coverColors(song);
    const cover = (song.coverUrl || "").trim();
    const primary = preferListen(song);
    const otherPlatforms = LINK_PLATFORMS.filter(
      (p) => song.links && song.links[p] && (!primary || p !== primary.platform)
    );
    const hasAnyLink = LINK_PLATFORMS.some((p) => song.links && song.links[p]);
    const listenBtns = otherPlatforms.map((p) => listenBtnHtml(song, p)).join("");
    const blurb = visibleBlurb(song.blurb);
    const related = pickRelated(song);

    const voteUseful = (state.votes[song.id] || {}).useful || 0;
    const voteBad = (state.votes[song.id] || {}).bad || 0;

    const themeChips = (song.themes || [])
      .map(
        (item) =>
          `<a class="chip" href="${esc(themeHomeHref(item))}">${esc(item)}</a>`
      )
      .join("");
    const voteRow = `
        <div class="vote-row">
          <button class="btn btn-sm" id="vote-useful" type="button">連結正確（${voteUseful}）</button>
          <button class="btn btn-sm" id="vote-bad" type="button">連結錯誤（${voteBad}）</button>
        </div>`;
    let listenPanel = "";
    if (!hasAnyLink) {
      listenPanel = `
      <section class="panel glass-panel">
        <h2>收聽連結</h2>
        ${blurb ? `<p class="muted" style="margin:0 0 12px;font-size:14px">${esc(blurb)}</p>` : ""}
        <div class="listen-row"><div class="alert alert-warn">暫時未有平台連結。</div></div>
        ${voteRow}
      </section>`;
    } else if (listenBtns) {
      listenPanel = `
      <section class="panel glass-panel">
        <h2>其他收聽方式</h2>
        ${blurb ? `<p class="muted" style="margin:0 0 12px;font-size:14px">${esc(blurb)}</p>` : ""}
        <div class="listen-row">${listenBtns}</div>
        ${voteRow}
      </section>`;
    } else {
      listenPanel = `
      <section class="panel glass-panel">
        ${blurb ? `<p class="muted" style="margin:0 0 12px;font-size:14px">${esc(blurb)}</p>` : ""}
        ${voteRow}
      </section>`;
    }

    return shell(
      `
      <div class="detail-toolbar">
        <a class="back-link" href="${esc(directoryHref())}">${iconSvg("back")} 返回目錄</a>
        <button type="button" class="btn btn-sm btn-ghost" id="copy-song-link">複製連結</button>
      </div>
      <section class="poster detail-poster" style="--hero-a:${esc(c1)};--hero-b:${esc(c2)};--hero-glow:${esc(c1)}55">
        <div class="hero-visual">
          ${
            cover
              ? `<img class="hero-bg-img" src="${esc(cover)}" alt="" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"/>`
              : ""
          }
        </div>
        <div class="hero-scrim" aria-hidden="true"></div>
        <div class="hero-content">
          <div class="hero-meta-row">${langChips(song.languages)} ${tagChipSpans(song)} ${themeChips}</div>
          <h1>${esc(song.title)}</h1>
          <p class="sub"><strong>${esc(song.artist)}</strong> · 來源：${esc(sourceLabel(song.source))}</p>
          ${
            primary
              ? `<div class="hero-actions"><a class="btn btn-play" href="${esc(primary.url)}" target="_blank" rel="noopener noreferrer" data-click="${esc(song.id)}" data-platform="${esc(primary.platform)}">${iconSvg("play")} 於 ${esc(window.PLATFORM_META[primary.platform].label)} 收聽</a></div>`
              : ""
          }
        </div>
      </section>

      ${listenPanel}

      <section class="panel">
        <h2>YouTube 觀看</h2>
        <div class="props platform-play-props">
          ${(() => {
            const hasYt = song.links && song.links.youtube;
            if (!hasYt) {
              return `<div class="prop"><span class="k">YouTube</span><span class="v muted">未連結</span></div>`;
            }
            const views = youtubeViews(song);
            const pub = youtubePublishedAt(song);
            const src =
              liveStatsMeta.status === "ok"
                ? liveStatsMeta.message
                : liveStatsMeta.status === "fallback"
                  ? "暫存"
                  : "";
            return `<div class="prop prop-stack"><span class="k">觀看次數</span><span class="v mono">${esc(formatPlays(views))}${src ? ` · ${esc(src)}` : ""}</span></div>
            <div class="prop"><span class="k">上傳日</span><span class="v mono">${esc(pub ? new Date(pub).toLocaleDateString("zh-HK") : "—")}</span></div>`;
          })()}
        </div>
        <p class="muted" style="font-size:13px;margin-top:10px">可前往 YouTube Music 或 YouTube；Apple Music、Spotify、KKBOX 僅提供收聽連結，不計入榜單。</p>
      </section>

      ${
        related.length
          ? `<section class="related-section"><div class="section-head"><h2>相關推薦</h2></div><div class="related-grid" role="list">${related
              .map((s, i) => songCardHtml(s, i, "", { flow: true, showRank: false }))
              .join("")}</div></section>`
          : ""
      }
    `,
      "home"
    );
  }

  function renderSubmit() {
    return shell(
      `
      <a class="back-link" href="#/">${iconSvg("back")} 返回目錄</a>
      <h1 class="page-title">自助上架暫停開放</h1>
      <p class="page-desc">公開自助上架暫時關閉。目錄改由官方頻道白名單＋管理員審核收錄。</p>
      <section class="panel">
        <div class="alert alert-info">如需上架機構官方詩歌，請聯絡管理員（示範後台仍可審核既有 pending）。</div>
        <a class="btn btn-primary" href="#/">返回目錄</a>
      </section>
    `,
      "home"
    );
  }

  function renderAdmin() {
    const ok = sessionStorage.getItem(ADMIN_SESSION) === "1";
    if (!ok) {
      return shell(
        `
        <div class="login-box">
          <h1>管理員審核</h1>
          <p>輸入示範密碼進入。密碼：<code>hymn-admin-demo</code></p>
          <div class="field" style="margin-bottom:12px">
            <label for="admin-key">密碼</label>
            <input id="admin-key" type="password" autocomplete="current-password" />
          </div>
          <button class="btn btn-primary btn-block" id="admin-login" type="button">進入後台</button>
          <p class="field-hint" style="margin-top:12px">此為前端原型，密碼僅存在瀏覽器 session，唔適合正式環境。</p>
        </div>
      `,
        "admin"
      );
    }

    const pending = pendingSongs();
    const published = publishedSongs();

    const pendingHtml = pending.length
      ? pending
          .map((s) => {
            const links = LINK_PLATFORMS.filter((p) => s.links && s.links[p])
              .map((p) => window.PLATFORM_META[p].short)
              .join(" · ");
            return `
            <div class="admin-card" data-id="${esc(s.id)}">
              <div style="display:flex;gap:12px;align-items:flex-start">
                ${coverHtml(s, "cover-sm")}
                <div style="flex:1;min-width:0">
                  <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                    <h3>${esc(s.title)}</h3>
                    <span class="status-pill status-pending">pending</span>
                  </div>
                  <div class="muted" style="font-size:13px">${esc(s.artist)} · ${(s.languages || []).map(esc).join("／")} · ${esc(links || "無連結")}</div>
                  ${visibleBlurb(s.blurb) ? `<p style="font-size:13px;margin:8px 0 0">${esc(visibleBlurb(s.blurb))}</p>` : ""}
                  ${s.submitter_email ? `<p class="muted" style="font-size:12px;margin:6px 0 0">聯絡：${esc(s.submitter_email)}</p>` : ""}
                  <div class="admin-actions">
                    <button class="btn btn-sm btn-primary" data-action="approve">通過</button>
                    <button class="btn btn-sm" data-action="reject">退回</button>
                  </div>
                </div>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="empty">暫時冇待審項目。公開自助上架已暫停；之後可由白名單掃描／管理員匯入。</div>`;

    return shell(
      `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <a class="back-link" href="#/" style="margin:0">${iconSvg("back")} 返回目錄</a>
          <h1 class="page-title" style="margin-top:8px">審核後台</h1>
        </div>
        <button class="btn btn-sm" id="admin-logout" type="button">登出</button>
      </div>
      <div class="alert alert-info">待審 ${pending.length} · 已公開 ${published.length} · 數據存於本機 localStorage</div>
      <section class="panel">
        <h2>待審列表</h2>
        <div class="admin-list" id="admin-pending">${pendingHtml}</div>
      </section>
      <section class="panel">
        <h2>危險操作</h2>
        <button class="btn btn-sm" id="reset-data" type="button">重設為示範數據</button>
      </section>
    `,
      "admin"
    );
  }

  function setHomeQuery(patch) {
    const hash = location.hash;
    const qIdx = hash.indexOf("?");
    const qs = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)) : new URLSearchParams();
    Object.keys(patch).forEach((k) => {
      if (patch[k] == null || patch[k] === "") qs.delete(k);
      else qs.set(k, patch[k]);
    });
    const qstr = qs.toString();
    location.hash = "#/" + (qstr ? "?" + qstr : "");
  }

  function currentHomeQuery() {
    const hash = location.hash || "";
    const i = hash.indexOf("?");
    const qs = i >= 0 ? new URLSearchParams(hash.slice(i + 1)) : new URLSearchParams();
    return (qs.get("q") || "").trim();
  }

  function bindSuggest(input, pool) {
    const list = document.getElementById("search-suggest");
    reopenSuggest = null;
    if (!input || !list) return;
    let items = [];
    let active = suggestSticky.suppress ? -1 : suggestSticky.active;

    function close() {
      items = [];
      active = -1;
      suggestSticky.active = -1;
      list.hidden = true;
      list.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function paint() {
      const query = input.value.trim();
      if (suggestSticky.suppress || !suggestionQueryReady(query)) {
        close();
        return;
      }
      items = collectSuggestions(query, pool);
      if (!items.length) {
        close();
        return;
      }
      if (active >= items.length) active = items.length - 1;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      list.innerHTML = items
        .map((item, i) => {
          const selected = i === active;
          return (
            '<li role="option" id="suggest-opt-' +
            i +
            '" class="suggest-opt' +
            (selected ? " is-active" : "") +
            '" aria-selected="' +
            (selected ? "true" : "false") +
            '" data-label="' +
            esc(item.label) +
            '"><span class="suggest-label">' +
            esc(item.label) +
            "</span>" +
            (item.hint ? '<span class="suggest-hint">' + esc(item.hint) + "</span>" : "") +
            "</li>"
          );
        })
        .join("");
      if (active >= 0) input.setAttribute("aria-activedescendant", "suggest-opt-" + active);
      else input.removeAttribute("aria-activedescendant");
      suggestSticky.active = active;
    }

    function apply(label) {
      clearTimeout(searchTimer);
      suggestSticky.suppress = true;
      suggestSticky.active = -1;
      if (currentHomeQuery() === label) {
        input.value = label;
        close();
        return;
      }
      setHomeQuery({ q: label });
    }

    input.addEventListener("input", () => {
      suggestSticky.suppress = false;
      active = -1;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        if (!list.hidden) {
          e.preventDefault();
          suggestSticky.suppress = true;
          close();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        suggestSticky.suppress = false;
        if (!items.length || list.hidden) paint();
        if (!items.length) return;
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        if (active < 0) active = dir > 0 ? 0 : items.length - 1;
        else active = (active + dir + items.length) % items.length;
        paint();
        const el = document.getElementById("suggest-opt-" + active);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && active >= 0 && items[active]) {
        e.preventDefault();
        apply(items[active].label);
      }
    });
    list.addEventListener("mousedown", (e) => {
      if (e.target.closest("[data-label]")) e.preventDefault();
    });
    list.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-label]");
      if (!opt) return;
      apply(opt.getAttribute("data-label") || "");
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!input.isConnected) return;
        if (document.activeElement === input) return;
        close();
      }, 150);
    });
    input.addEventListener("focus", () => {
      if (suggestSticky.suppress) return;
      paint();
    });
    reopenSuggest = () => {
      if (!input.isConnected || suggestSticky.suppress) return;
      paint();
    };
  }

  function bindHome() {
    document.querySelectorAll("#chart-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => setHomeQuery({ chart: btn.dataset.chart, platform: null }));
    });
    const search = document.getElementById("search-input");
    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const value = search.value.trim();
        searchTimer = setTimeout(() => {
          if (!search.isConnected) return;
          setHomeQuery({ q: value });
        }, 220);
      });
      bindSuggest(search, (homeGrid && homeGrid.suggestPool) || []);
    }
    document.querySelectorAll(".filter-chip[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.filter;
        const val = btn.dataset.value || "";
        if (key === "lang" || key === "ministry" || key === "tag" || key === "theme") {
          setHomeQuery({ [key]: val });
        }
      });
    });
    const clearFilters = document.getElementById("clear-all-filters");
    if (clearFilters) {
      clearFilters.addEventListener("click", () => {
        setHomeQuery({ q: "", lang: "", ministry: "", tag: "", theme: "" });
      });
    }
    const copyHome = document.getElementById("copy-home-link");
    if (copyHome) {
      copyHome.addEventListener("click", () => {
        copyText(location.href).then((ok) => flashCopy(copyHome, ok));
      });
    }
    if (homeGrid && document.getElementById("chart-grid")) {
      mountVirtualGrid(homeGrid.songs, homeGrid.chart);
    }
  }

  function bindSong(id) {
    document.querySelectorAll("a[data-click]").forEach((a) => {
      a.addEventListener("click", () => {
        state.clicks[id] = (state.clicks[id] || 0) + 1;
        saveState(state);
      });
    });
    const useful = document.getElementById("vote-useful");
    const bad = document.getElementById("vote-bad");
    if (useful) {
      useful.addEventListener("click", () => {
        state.votes[id] = state.votes[id] || { useful: 0, bad: 0 };
        state.votes[id].useful += 1;
        saveState(state);
        render();
      });
    }
    if (bad) {
      bad.addEventListener("click", () => {
        state.votes[id] = state.votes[id] || { useful: 0, bad: 0 };
        state.votes[id].bad += 1;
        saveState(state);
        render();
      });
    }
    const copySong = document.getElementById("copy-song-link");
    if (copySong) {
      copySong.addEventListener("click", () => {
        copyText(songShareUrl(id)).then((ok) => flashCopy(copySong, ok));
      });
    }
  }

  function bindAdmin() {
    const login = document.getElementById("admin-login");
    if (login) {
      login.addEventListener("click", () => {
        const key = document.getElementById("admin-key").value;
        if (key === window.ADMIN_DEMO_KEY) {
          sessionStorage.setItem(ADMIN_SESSION, "1");
          render();
        } else {
          alert("密碼唔啱。請用 hymn-admin-demo");
        }
      });
      document.getElementById("admin-key").addEventListener("keydown", (e) => {
        if (e.key === "Enter") login.click();
      });
      return;
    }
    const logout = document.getElementById("admin-logout");
    if (logout) {
      logout.addEventListener("click", () => {
        sessionStorage.removeItem(ADMIN_SESSION);
        render();
      });
    }
    document.querySelectorAll("#admin-pending .admin-card").forEach((card) => {
      card.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const song = getSong(card.dataset.id);
          if (!song) return;
          if (btn.dataset.action === "approve") {
            song.status = "published";
            song.created_at = new Date().toISOString();
            if (!song.coverColor) {
              const palette = window.COVER_PALETTE || [["#7c3aed", "#db2777"]];
              song.coverColor = palette[Math.floor(Math.random() * palette.length)];
            }
          } else {
            song.status = "rejected";
          }
          saveState(state);
          render();
        });
      });
    });
    const reset = document.getElementById("reset-data");
    if (reset) {
      reset.addEventListener("click", () => {
        if (confirm("確定重設為示範數據？本地待審／投票會清除。")) {
          localStorage.removeItem(STORAGE_KEY);
          state = loadState();
          assignInferredTags();
          render();
        }
      });
    }
  }

  function render() {
    assignInferredTags();
    teardownVirtual();
    const searchEl = document.getElementById("search-input");
    const restoreSearch = !!(searchEl && document.activeElement === searchEl);
    const caret = restoreSearch ? searchEl.selectionStart : null;
    const r = route();
    const app = document.getElementById("app");
    if (r.name === "home") {
      app.innerHTML = renderHome();
      bindHome();
    } else if (r.name === "song") {
      app.innerHTML = renderSong(r.id);
      bindSong(r.id);
    } else if (r.name === "submit") {
      app.innerHTML = renderSubmit();
    } else if (r.name === "admin") {
      app.innerHTML = renderAdmin();
      bindAdmin();
    }
    if (r.name === "submit") document.title = "上架暫停 — 詩歌目錄";
    else if (r.name === "admin") document.title = "管理 — 詩歌目錄";
    else if (r.name === "song") {
      const song = getSong(r.id);
      document.title =
        song && song.status === "published" ? formatSongTitle(song) : "詩歌詳情 — 詩歌目錄";
    } else document.title = "詩歌目錄 — 華語基督教詩歌";
    if (restoreSearch) {
      const input = document.getElementById("search-input");
      if (input) {
        input.focus();
        const pos = caret == null ? input.value.length : caret;
        try { input.setSelectionRange(pos, pos); } catch (_) {}
        if (reopenSuggest) reopenSuggest();
      }
    }
  }

  window.addEventListener("hashchange", render);

  (async function boot() {
    render(); // first paint with seed
    await loadLiveStats();
    render(); // refresh with live views when available
  })();
})();
