(function () {
  const STORAGE_KEY = "hymn_directory_v5";
  const ADMIN_SESSION = "hymn_admin_ok";
  const PLATFORMS = ["youtube", "apple_music", "spotify", "kkbox"];

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

  /** Normalize chart query: legacy 「最新」 → 「新歌」. */
  function normalizeChart(chart) {
    if (chart === "最新") return "新歌";
    return chart || "周榜";
  }

  /** Platform release/upload ISO for 新歌 chart. */
  function platformReleasedAt(song, platform) {
    const ra = song.released_at && song.released_at[platform];
    return ra ? String(ra) : "";
  }

  /** Read play count for platform + metric (total|day|week|month). */
  function platformPlays(song, platform, metric) {
    const sig = song.signals && song.signals[platform];
    if (!sig || typeof sig !== "object") return 0;
    return Number(sig[metric]) || 0;
  }

  /** Song qualifies for a platform chart: has link; 新歌 also needs released_at; play charts need positive signal. */
  function onPlatformChart(song, platform, chart) {
    if (!(song.links && song.links[platform])) return false;
    if (chart === "新歌") return !!platformReleasedAt(song, platform);
    const metric = chartMetric(chart);
    return platformPlays(song, platform, metric) > 0;
  }

  function chartMetric(chart) {
    if (chart === "日榜") return "day";
    if (chart === "周榜") return "week";
    if (chart === "月榜") return "month";
    if (chart === "最熱") return "total";
    return "total";
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
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
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
    const iconName = p === "apple_music" ? "apple" : p;
    return `<span class="p-icon ${m.className} ${classExtra || ""}" title="${esc(m.label)}">${iconSvg(iconName)}</span>`;
  }

  function platformDots(song) {
    return PLATFORMS.filter((p) => song.links && song.links[p])
      .map((p) => platformIcon(p))
      .join("");
  }

  function langChips(langs) {
    return (langs || [])
      .map((l) => `<span class="chip chip-brand">${esc(l)}</span>`)
      .join("");
  }

  function firstListenUrl(song) {
    for (const p of PLATFORMS) {
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
          <a class="nav-item ${act === "submit" ? "active" : ""}" href="#/submit">${iconSvg("plus")}<span class="nav-label">上架</span></a>
          <div class="side-spacer"></div>
          <a class="nav-item ${act === "admin" ? "active" : ""}" href="#/admin">${iconSvg("admin")}<span class="nav-label">管理</span></a>
        </nav>
        <div class="content-wrap">
          <div class="mobile-top">
            <a class="mobile-brand" href="#/">
              <span class="mark">詩</span>
              <span>詩歌目錄</span>
            </a>
            <div class="mobile-actions">
              <a class="btn btn-sm btn-primary" href="#/submit">上架</a>
            </div>
          </div>
          <main class="main">${content}</main>
          <footer class="footer">
            V1 原型 · 深色音樂平台 UI · 只連 YouTube／Apple Music／Spotify／KKBOX · 唔託管音檔 ·
            <a href="#/admin">管理員</a>
          </footer>
        </div>
        <nav class="bottom-nav" aria-label="底部選單">
          <a class="${act === "home" ? "active" : ""}" href="#/">${iconSvg("home")}<span>目錄</span></a>
          <a class="${act === "submit" ? "active" : ""}" href="#/submit">${iconSvg("plus")}<span>上架</span></a>
          <a class="${act === "admin" ? "active" : ""}" href="#/admin">${iconSvg("admin")}<span>管理</span></a>
        </nav>
      </div>
    `;
  }

  function sortSongs(list, chart, platform) {
    const arr = list.slice();
    if (chart === "新歌") {
      return arr.sort(
        (a, b) =>
          new Date(platformReleasedAt(b, platform)) -
          new Date(platformReleasedAt(a, platform))
      );
    }
    const metric = chartMetric(chart);
    return arr.sort(
      (a, b) => platformPlays(b, platform, metric) - platformPlays(a, platform, metric)
    );
  }

  function scoreLabel(song, chart, platform) {
    if (chart === "新歌") {
      const iso = platformReleasedAt(song, platform);
      return iso ? new Date(iso).toLocaleDateString("zh-HK") : "";
    }
    const metric = chartMetric(chart);
    const n = platformPlays(song, platform, metric);
    if (chart === "日榜") return "今日 " + formatPlays(n);
    if (chart === "周榜") return "本周 " + formatPlays(n);
    if (chart === "月榜") return "本月 " + formatPlays(n);
    return "播放 " + formatPlays(n);
  }

  function listenForPlatform(song, platform) {
    if (song.links && song.links[platform]) {
      return { url: song.links[platform], platform };
    }
    return firstListenUrl(song);
  }

  function renderHome() {
    const hash = location.hash;
    const qIdx = hash.indexOf("?");
    const qs = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)) : new URLSearchParams();
    const chart = normalizeChart(qs.get("chart") || "周榜");
    const platformRaw = qs.get("platform") || "youtube";
    const platform = PLATFORMS.includes(platformRaw) ? platformRaw : "youtube";
    const q = (qs.get("q") || "").trim();
    const lang = qs.get("lang") || "";
    const ministry = qs.get("ministry") || "";
    const pMeta = window.PLATFORM_META[platform];

    let list = publishedSongs().filter((s) => onPlatformChart(s, platform, chart));
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

    list = sortSongs(list, chart, platform);
    const ministries = [...new Set(publishedSongs().map((s) => s.artist))].sort();
    const featured = list[0] || null;

    const platformTabs = PLATFORMS.map((p) => {
      const m = window.PLATFORM_META[p];
      return `<button class="tab ${p === platform ? "active" : ""}" data-platform="${p}">${esc(m.label)}</button>`;
    }).join("");

    const tabs = ["日榜", "周榜", "月榜", "新歌", "最熱"]
      .map(
        (t) =>
          `<button class="tab ${t === chart ? "active" : ""}" data-chart="${esc(t)}">${esc(t)}</button>`
      )
      .join("");

    const featureHtml = featured
      ? (() => {
          const listen = listenForPlatform(featured, platform);
          return `
          <section class="hero-feature">
            <a href="#/song/${esc(featured.id)}" style="display:block">${coverHtml(featured, "cover-lg hero-cover")}</a>
            <div>
              <p class="hero-kicker">${esc(pMeta.label)} · ${esc(chart)}</p>
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
            const listen = listenForPlatform(s, platform);
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
                <span class="score mono">${esc(scoreLabel(s, chart, platform))}</span>
                ${
                  listen
                    ? `<a class="play-out" href="${esc(listen.url)}" target="_blank" rel="noopener noreferrer" title="出站收聽" data-row-out="${esc(s.id)}" onclick="event.stopPropagation()">${iconSvg("play")}</a>`
                    : `<span class="play-out play-out-ghost" title="暫無連結">${iconSvg("play")}</span>`
                }
              </div>
            </article>`;
          })
          .join("")
      : `<div class="empty">呢個平台暫時冇符合條件嘅詩歌。試下換平台、榜單或清篩選。</div>`;

    return shell(
      `
      ${featureHtml}

      <div class="section-head">
        <h2>${esc(pMeta.label)} · ${esc(chart)}</h2>
        <span class="muted" style="font-size:13px">${list.length} 首 · 純播放量</span>
      </div>

      <div class="toolbar">
        <div class="tabs platform-tabs" id="platform-tabs" aria-label="平台榜">${platformTabs}</div>
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
    const listenBtns = PLATFORMS.filter((p) => song.links && song.links[p])
      .map((p) => {
        const m = window.PLATFORM_META[p];
        const url = song.links[p];
        const iconName = p === "apple_music" ? "apple" : p;
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
        <h2>各平台播放量（示範）</h2>
        <div class="props platform-play-props">
          ${PLATFORMS.map((p) => {
            const m = window.PLATFORM_META[p];
            const has = song.links && song.links[p];
            const sig = (song.signals && song.signals[p]) || {};
            if (!has) {
              return `<div class="prop"><span class="k">${esc(m.label)}</span><span class="v muted">未連結</span></div>`;
            }
            return `<div class="prop prop-stack"><span class="k">${esc(m.label)}</span><span class="v mono">總 ${esc(formatPlays(sig.total || 0))} · 日 ${esc(formatPlays(sig.day || 0))} · 周 ${esc(formatPlays(sig.week || 0))} · 月 ${esc(formatPlays(sig.month || 0))}</span></div>`;
          }).join("")}
        </div>
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

  function renderSubmit(msg) {
    return shell(
      `
      <a class="back-link" href="#/">${iconSvg("back")} 返回目錄</a>
      <h1 class="page-title">自助上架詩歌</h1>
      <p class="page-desc">免登入提交。提交後進入待審，管理員通過先公開。鼓勵一次填齊已知平台連結。</p>
      <section class="panel">
        ${msg || ""}
        <div class="form-grid" id="submit-form">
          <div class="field">
            <label for="f-title">歌名 *</label>
            <input id="f-title" required placeholder="例如：奇妙的愛" />
          </div>
          <div class="field">
            <label for="f-artist">機構／藝人 *</label>
            <input id="f-artist" required placeholder="例如：讚美之泉" />
          </div>
          <div class="field">
            <label for="f-lang">語言 *</label>
            <select id="f-lang">
              <option value="粵語">粵語</option>
              <option value="普通話">普通話</option>
              <option value="粵語,普通話">粵語＋普通話</option>
            </select>
          </div>
          <div class="field">
            <label for="f-themes">主題（逗號分隔）</label>
            <input id="f-themes" placeholder="敬拜, 感恩" />
          </div>
          <div class="field">
            <label for="f-yt">YouTube 連結</label>
            <input id="f-yt" type="url" placeholder="https://www.youtube.com/..." />
          </div>
          <div class="field">
            <label for="f-apple">Apple Music 連結</label>
            <input id="f-apple" type="url" placeholder="https://music.apple.com/..." />
          </div>
          <div class="field">
            <label for="f-spotify">Spotify 連結</label>
            <input id="f-spotify" type="url" placeholder="https://open.spotify.com/..." />
          </div>
          <div class="field">
            <label for="f-kkbox">KKBOX 連結</label>
            <input id="f-kkbox" type="url" placeholder="https://www.kkbox.com/..." />
          </div>
          <div class="field">
            <label for="f-cover">封面圖 URL（選填）</label>
            <input id="f-cover" type="url" placeholder="https://… 或留空：有 YouTube 會用其縮圖" />
            <div class="cover-preview-wrap" id="cover-preview-wrap" hidden>
              <img id="cover-preview" class="cover-preview" alt="封面預覽" />
            </div>
          </div>
          <div class="field">
            <label for="f-blurb">簡介</label>
            <textarea id="f-blurb" placeholder="一句話介紹呢首歌…"></textarea>
          </div>
          <div class="field">
            <label for="f-email">聯絡電郵（選填）</label>
            <input id="f-email" type="email" placeholder="you@example.com" />
          </div>
          <label class="check">
            <input type="checkbox" id="f-declare" />
            <span>我聲明本人係權利人／已獲授權分享以上官方連結，並明白本站只做目錄出站，唔託管音檔。</span>
          </label>
          <button class="btn btn-primary btn-block" id="submit-btn" type="button">提交審核</button>
          <p class="field-hint">每日建議上限：每裝置約 3 首（原型以瀏覽器記錄示意）。</p>
        </div>
      </section>
    `,
      "submit"
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
            const links = PLATFORMS.filter((p) => s.links && s.links[p])
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
      : `<div class="empty">暫時冇待審項目。可去「上架詩歌」提交一條測試。</div>`;

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
    document.querySelectorAll("#platform-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => setHomeQuery({ platform: btn.dataset.platform }));
    });
    document.querySelectorAll("#chart-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => setHomeQuery({ chart: btn.dataset.chart }));
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

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function canSubmit() {
    const key = "hymn_submit_" + todayKey();
    const n = Number(localStorage.getItem(key) || "0");
    return n < 3;
  }

  function bumpSubmit() {
    const key = "hymn_submit_" + todayKey();
    const n = Number(localStorage.getItem(key) || "0");
    localStorage.setItem(key, String(n + 1));
  }

  function bindSubmit() {
    const btn = document.getElementById("submit-btn");
    if (!btn) return;
    function showSubmitMsg(html) {
      const app = document.getElementById("app");
      app.innerHTML = renderSubmit(html);
      bindSubmit();
    }

    function refreshCoverPreview() {
      const wrap = document.getElementById("cover-preview-wrap");
      const img = document.getElementById("cover-preview");
      if (!wrap || !img) return;
      const manual = (document.getElementById("f-cover")?.value || "").trim();
      const ytVal = (document.getElementById("f-yt")?.value || "").trim();
      const src = manual || ytThumbFromUrl(ytVal);
      if (src) {
        img.onerror = () => { wrap.hidden = true; };
        img.src = src;
        wrap.hidden = false;
      } else {
        img.removeAttribute("src");
        wrap.hidden = true;
      }
    }
    ["f-cover", "f-yt"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", refreshCoverPreview);
        el.addEventListener("change", refreshCoverPreview);
      }
    });
    refreshCoverPreview();

    btn.addEventListener("click", () => {
      const title = document.getElementById("f-title").value.trim();
      const artist = document.getElementById("f-artist").value.trim();
      const langRaw = document.getElementById("f-lang").value;
      const themes = document
        .getElementById("f-themes")
        .value.split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const blurb = document.getElementById("f-blurb").value.trim();
      const email = document.getElementById("f-email").value.trim();
      const declare = document.getElementById("f-declare").checked;
      const links = {};
      const yt = document.getElementById("f-yt").value.trim();
      const apple = document.getElementById("f-apple").value.trim();
      const spotify = document.getElementById("f-spotify").value.trim();
      const kkbox = document.getElementById("f-kkbox").value.trim();
      if (yt) links.youtube = yt;
      if (apple) links.apple_music = apple;
      if (spotify) links.spotify = spotify;
      if (kkbox) links.kkbox = kkbox;

      if (!title || !artist) {
        showSubmitMsg(`<div class="alert alert-err">請填歌名同機構／藝人。</div>`);
        return;
      }
      if (!Object.keys(links).length) {
        showSubmitMsg(
          `<div class="alert alert-err">請至少填一個平台官方連結（YouTube／Apple／Spotify／KKBOX）。</div>`
        );
        return;
      }
      if (!declare) {
        showSubmitMsg(`<div class="alert alert-err">請勾選權利／授權聲明。</div>`);
        return;
      }
      if (!canSubmit()) {
        showSubmitMsg(
          `<div class="alert alert-warn">今日已達提交上限（3 首）。請明日再試，或聯絡管理員。</div>`
        );
        return;
      }

      const palette = window.COVER_PALETTE || [["#7c3aed", "#db2777"]];
      const coverManual = (document.getElementById("f-cover")?.value || "").trim();
      const coverUrl = coverManual || ytThumbFromUrl(yt) || undefined;
      const song = {
        id: "u" + Date.now().toString(36),
        title,
        artist,
        languages: langRaw.split(","),
        themes,
        coverColor: palette[Math.floor(Math.random() * palette.length)],
        coverUrl,
        links,
        source: "creator",
        status: "pending",
        blurb,
        submitter_email: email || undefined,
        created_at: new Date().toISOString(),
        signals: emptySignals()
      };
      state.songs.unshift(song);
      saveState(state);
      bumpSubmit();
      showSubmitMsg(
        `<div class="alert alert-ok">已提交「${esc(title)}」，狀態為待審。管理員通過後先會出現喺目錄。</div>`
      );
    });
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
      bindSubmit();
    } else if (r.name === "admin") {
      app.innerHTML = renderAdmin();
      bindAdmin();
    }
    document.title =
      r.name === "submit"
        ? "上架詩歌 — 詩歌目錄"
        : r.name === "admin"
          ? "管理 — 詩歌目錄"
          : r.name === "song"
            ? "詩歌詳情 — 詩歌目錄"
            : "詩歌目錄 — 華語敬拜發現平台";
  }

  window.addEventListener("hashchange", render);
  render();
})();
