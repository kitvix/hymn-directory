(function () {
  const STORAGE_KEY = "hymn_directory_v8";
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

  /** Normalize chart query: legacy 「最新」 → 「新歌」; default 最熱. */
  function normalizeChart(chart) {
    if (chart === "最新") return "新歌";
    return chart || "最熱";
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

  function isPeriodChart(chart) {
    return chart === "日榜" || chart === "周榜" || chart === "月榜";
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
          message: source === "api" ? "YouTube 即時觀看" : "本機 live-stats.json"
        };
        return;
      }
      throw new Error("empty");
    } catch (_) {
      liveStats = null;
      liveStatsMeta = {
        status: "fallback",
        source: "seed",
        message: "YouTube API 暫時唔用得，顯示示範／快取數字"
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
    return LINK_PLATFORMS.filter((p) => song.links && song.links[p])
      .map((p) => platformIcon(p))
      .join("");
  }

  function langChips(langs) {
    return (langs || [])
      .map((l) => `<span class="chip chip-brand">${esc(l)}</span>`)
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
            V1 原型 · 榜單以 YouTube 頻道為準 · 出站含 YouTube Music／YouTube · Apple／Spotify／KKBOX 可選 · 自助上架暫停 · 唔託管音檔 ·
            <a href="#/admin">管理員</a>
          </footer>
        </div>
        <nav class="bottom-nav" aria-label="底部選單">
          <a class="${act === "home" ? "active" : ""}" href="#/">${iconSvg("home")}<span>目錄</span></a>
          <a class="${act === "admin" ? "active" : ""}" href="#/admin">${iconSvg("admin")}<span>管理</span></a>
        </nav>
      </div>
    `;
  }

  function sortSongs(list, chart) {
    const arr = list.slice();
    if (chart === "新歌") {
      return arr.sort(
        (a, b) => new Date(youtubePublishedAt(b)) - new Date(youtubePublishedAt(a))
      );
    }
    // 最熱 + 日／周／月（暫代）：總觀看
    return arr.sort((a, b) => youtubeViews(b) - youtubeViews(a));
  }

  function scoreLabel(song, chart) {
    if (chart === "新歌") {
      const iso = youtubePublishedAt(song);
      return iso ? new Date(iso).toLocaleDateString("zh-HK") : "";
    }
    const n = youtubeViews(song);
    if (isPeriodChart(chart)) return "暫代 · " + formatPlays(n);
    return "觀看 " + formatPlays(n);
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

  function renderHome() {
    const hash = location.hash;
    const qIdx = hash.indexOf("?");
    const qs = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)) : new URLSearchParams();
    const chart = normalizeChart(qs.get("chart") || "最熱");
    const q = (qs.get("q") || "").trim();
    const lang = qs.get("lang") || "";
    const ministry = qs.get("ministry") || "";
    const ytMeta = window.PLATFORM_META.youtube;

    let list = publishedSongs().filter((s) => onYoutubeChart(s, chart));
    if (q) {
      const qq = q.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(qq) ||
          s.artist.toLowerCase().includes(qq) ||
          (s.themes || []).some((t) => t.includes(q))
      );
    }
    if (lang) list = list.filter((s) => (s.languages || []).includes(lang));
    if (ministry) list = list.filter((s) => s.artist === ministry);

    list = sortSongs(list, chart);
    const ministries = [...new Set(publishedSongs().map((s) => s.artist))].sort();
    const featured = list[0] || null;

    const tabs = ["日榜", "周榜", "月榜", "新歌", "最熱"]
      .map(
        (t) =>
          `<button class="tab ${t === chart ? "active" : ""}" data-chart="${esc(t)}">${esc(t)}</button>`
      )
      .join("");

    const periodNote = isPeriodChart(chart)
      ? `<div class="alert alert-info" style="margin-bottom:14px">日／周／月榜需要歷史觀看快照先計增量；<strong>暫以總觀看排序</strong>（同最熱）。最熱／新歌已用 YouTube 真實數據。</div>`
      : "";

    const liveNote =
      liveStatsMeta.status === "ok"
        ? `<span class="muted" style="font-size:13px">${list.length} 首 · ${esc(liveStatsMeta.message || "YouTube")}</span>`
        : liveStatsMeta.status === "fallback"
          ? `<span class="muted" style="font-size:13px">${list.length} 首 · ${esc(liveStatsMeta.message)}</span>`
          : `<span class="muted" style="font-size:13px">${list.length} 首</span>`;

    const featureHtml = featured
      ? (() => {
          const listen = preferListen(featured);
          return `
          <section class="hero-feature">
            <a href="#/song/${esc(featured.id)}" style="display:block">${coverHtml(featured, "cover-lg hero-cover")}</a>
            <div>
              <p class="hero-kicker">${esc(ytMeta.label)} · ${esc(chart)}</p>
              <div class="hero-meta-row">
                ${langChips(featured.languages)}
                <span class="chip">${esc(featured.artist)}</span>
              </div>
              <h1><a href="#/song/${esc(featured.id)}">${esc(featured.title)}</a></h1>
              <p class="sub">${esc(featured.blurb || "一個目錄，聽齊華語詩歌。點掣跳去你慣用平台。")}</p>
              <div class="hero-actions">
                ${
                  listen
                    ? `<a class="btn btn-primary" href="${esc(listen.url)}" target="_blank" rel="noopener noreferrer" data-feature-out="${esc(featured.id)}">${iconSvg("play")} 喺 ${esc(window.PLATFORM_META[listen.platform].label)} 聽</a>`
                    : ""
                }
                <a class="btn" href="#/song/${esc(featured.id)}">睇詳情</a>
              </div>
            </div>
          </section>`;
        })()
      : "";

    const rows = list.length
      ? list
          .map((s, i) => {
            const rankClass = i < 3 ? "top" : "";
            const listen = preferListen(s);
            return `
            <article class="chart-row" data-id="${esc(s.id)}" role="link" tabindex="0">
              <div class="rank-num ${rankClass}">${i + 1}</div>
              ${coverHtml(s, "cover-sm")}
              <div class="chart-meta">
                <h3>${esc(s.title)}</h3>
                <div class="artist">${esc(s.artist)} · ${(s.languages || []).map(esc).join("／")}</div>
              </div>
              <div class="platform-icons">${platformDots(s)}</div>
              <div class="row-actions">
                <span class="score mono">${esc(scoreLabel(s, chart))}</span>
                ${
                  listen
                    ? `<a class="play-out" href="${esc(listen.url)}" target="_blank" rel="noopener noreferrer" title="出站收聽" data-row-out="${esc(s.id)}" onclick="event.stopPropagation()">${iconSvg("play")}</a>`
                    : `<span class="play-out play-out-ghost" title="暫無連結">${iconSvg("play")}</span>`
                }
              </div>
            </article>`;
          })
          .join("")
      : `<div class="empty">暫時冇符合條件嘅 YouTube 詩歌。試下換榜單或清篩選。</div>`;

    return shell(
      `
      ${featureHtml}

      <div class="section-head">
        <h2>YouTube · ${esc(chart)}</h2>
        ${liveNote}
      </div>

      ${periodNote}

      <div class="toolbar">
        <div class="tabs" id="chart-tabs" aria-label="榜單時段">${tabs}</div>
        <div class="toolbar-row">
          <div class="search-box">
            <span class="icon">${iconSvg("search")}</span>
            <input id="search-input" type="search" placeholder="搜歌名、事工、主題…" value="${esc(q)}" />
          </div>
          <select class="select" id="filter-lang">
            <option value="">全部語言</option>
            <option value="粵語" ${lang === "粵語" ? "selected" : ""}>粵語</option>
            <option value="普通話" ${lang === "普通話" ? "selected" : ""}>普通話</option>
          </select>
          <select class="select" id="filter-ministry">
            <option value="">全部機構</option>
            ${ministries
              .map(
                (m) =>
                  `<option value="${esc(m)}" ${ministry === m ? "selected" : ""}>${esc(m)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="chart-list">${rows}</div>
    `,
      "home"
    );
  }

  function renderSong(id) {
    const song = getSong(id);
    if (!song || song.status !== "published") {
      return shell(
        `
        <a class="back-link" href="#/">${iconSvg("back")} 返回目錄</a>
        <div class="empty">搵唔到呢首歌，可能尚未通過審核。</div>
      `,
        "home"
      );
    }

    const [c1] = coverColors(song);
    const listenBtns = LINK_PLATFORMS.filter((p) => song.links && song.links[p])
      .map((p) => {
        const m = window.PLATFORM_META[p];
        if (!m) return "";
        const url = song.links[p];
        const iconName = p === "apple_music" ? "apple" : p === "youtube_music" ? "youtube" : p;
        return `
          <a class="listen-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-click="${esc(song.id)}" data-platform="${p}">
            <span class="logo ${m.className}">${iconSvg(iconName)}</span>
            <span>喺 ${esc(m.label)} 聽</span>
            <span class="go">出站 →</span>
          </a>`;
      })
      .join("");

    const related = publishedSongs()
      .filter(
        (s) =>
          s.id !== song.id &&
          (s.artist === song.artist ||
            (s.languages || []).some((l) => (song.languages || []).includes(l)))
      )
      .slice(0, 5);

    const voteUseful = (state.votes[song.id] || {}).useful || 0;
    const voteBad = (state.votes[song.id] || {}).bad || 0;

    return shell(
      `
      <a class="back-link" href="#/">${iconSvg("back")} 返回目錄</a>
      <section class="detail-hero" style="--hero-glow:${esc(c1)}55">
        ${coverHtml(song, "cover-xl")}
        <div class="detail-info">
          <div class="hero-meta-row">${langChips(song.languages)} ${(song.themes || [])
            .map((t) => `<span class="chip">${esc(t)}</span>`)
            .join("")}</div>
          <h1>${esc(song.title)}</h1>
          <p class="sub"><strong>${esc(song.artist)}</strong> · 來源：${esc(
            song.source === "auto" ? "自動收錄" : song.source === "creator" ? "創作者上架" : "混合"
          )}</p>
          <p class="blurb">${esc(song.blurb || "")}</p>
          <div class="listen-row">${listenBtns || `<div class="alert alert-warn">暫時未有平台連結。</div>`}</div>
          <div class="vote-row">
            <button class="btn btn-sm" id="vote-useful">有用（${voteUseful}）</button>
            <button class="btn btn-sm" id="vote-bad">連結唔啱（${voteBad}）</button>
          </div>
        </div>
      </section>

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
                  ? "示範／快取"
                  : "";
            return `<div class="prop prop-stack"><span class="k">觀看次數</span><span class="v mono">${esc(formatPlays(views))}${src ? ` · ${esc(src)}` : ""}</span></div>
            <div class="prop"><span class="k">上傳日</span><span class="v mono">${esc(pub ? new Date(pub).toLocaleDateString("zh-HK") : "—")}</span></div>`;
          })()}
        </div>
        <p class="muted" style="font-size:13px;margin-top:10px">YouTube Music／YouTube 均可出站；Apple Music／Spotify／KKBOX 只作出站聽歌連結，唔計入榜單。</p>
      </section>

      ${
        related.length
          ? `<section class="panel"><h2>相關推薦</h2><div class="related-grid">${related
              .map(
                (s) => `
            <a class="related-item" href="#/song/${esc(s.id)}">
              ${coverHtml(s, "cover-tiny")}
              <div>
                <strong>${esc(s.title)}</strong>
                <div class="muted" style="font-size:13px">${esc(s.artist)}</div>
              </div>
              <div class="platform-icons">${platformDots(s)}</div>
            </a>`
              )
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
                  <p style="font-size:13px;margin:8px 0 0">${esc(s.blurb || "")}</p>
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

  function bindHome() {
    document.querySelectorAll("#chart-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => setHomeQuery({ chart: btn.dataset.chart, platform: null }));
    });
    const search = document.getElementById("search-input");
    let t;
    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => setHomeQuery({ q: search.value.trim() }), 220);
      });
    }
    ["filter-lang", "filter-ministry"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        const key = id.replace("filter-", "");
        const map = { lang: "lang", ministry: "ministry" };
        setHomeQuery({ [map[key]]: el.value });
      });
    });
    document.querySelectorAll(".chart-row").forEach((card) => {
      const go = () => navigate("song/" + card.dataset.id);
      card.addEventListener("click", (e) => {
        if (e.target.closest("a.play-out")) return;
        go();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  function bindSong(id) {
    document.querySelectorAll("a.listen-btn").forEach((a) => {
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
          render();
        }
      });
    }
  }

  function render() {
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
    document.title =
      r.name === "submit"
        ? "上架暫停 — 詩歌目錄"
        : r.name === "admin"
          ? "管理 — 詩歌目錄"
          : r.name === "song"
            ? "詩歌詳情 — 詩歌目錄"
            : "詩歌目錄 — 華語敬拜發現平台";
  }

  window.addEventListener("hashchange", render);

  (async function boot() {
    render(); // first paint with seed
    await loadLiveStats();
    render(); // refresh with live views when available
  })();
})();
