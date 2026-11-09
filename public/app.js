const $ = (s, el = document) => el.querySelector(s);
const feedEl = $("#feed");
const state = { mode: "daily", topic: "", items: [], meta: null, seenSent: new Set() };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (path, body) => {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

// ---------- Data layer ----------
// Local app: talks to server.js. Public site (GitHub Pages): reads a prebuilt
// data/feed.json and keeps each visitor's feedback in their own browser.
const STATIC = window.SHORTSIGNAL_STATIC ?? null;

async function makeStaticStore() {
  const [{ buildFeed, applyFeedback, DAILY_SIZE }, data] = await Promise.all([
    import(`./rank.js${new URL(import.meta.url).search}`), // same ?v= as app.js
    fetch("data/feed.json", { cache: "no-cache" }).then((r) => r.json()),
  ]);
  const KEY = "ss-state-v1";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const lib = {
    videos: Object.fromEntries(data.videos.map((v) => [v.id, v])),
    feedback: saved.feedback || {},
    seen: saved.seen || {},
    topicWeights: saved.topicWeights || {},
    daily: saved.daily || null,
  };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ feedback: lib.feedback, seen: lib.seen, topicWeights: lib.topicWeights, daily: lib.daily })); } catch {}
  };
  return {
    meta: () => ({
      topics: data.topics.map((t) => ({ ...t, weight: lib.topicWeights[t.id] ?? 0 })),
      dailySize: DAILY_SIZE,
      claude: data.videos.some((v) => v.score.by === "claude"),
      generatedAt: data.generatedAt,
      counts: { total: data.videos.length, relevant: data.videos.length, saved: Object.values(lib.feedback).filter((f) => f.action === "save").length },
    }),
    feed: (mode, topic) => {
      const items = buildFeed(lib, { mode, topic });
      persist();
      return { items: items.map((v) => ({ ...v, feedback: lib.feedback[v.id]?.action ?? null })) };
    },
    feedback: (id, action) => {
      applyFeedback(lib, id, action);
      persist();
      return { ok: true };
    },
  };
}

const store = STATIC ? await makeStaticStore() : null;
const backend = {
  meta: async () => (store ? store.meta() : api("/api/meta")),
  feed: async (mode, topic) => (store ? store.feed(mode, topic) : api(`/api/feed?${new URLSearchParams({ mode, topic })}`)),
  feedback: async (id, action) => (store ? store.feedback(id, action) : api("/api/feedback", { id, action })),
};

function ago(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 86400e3;
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
const fmtViews = (n) => (n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : `${n} views`);
const topicName = (id) => state.meta?.topics.find((t) => t.id === id)?.name ?? (id === "your-saves" ? "Your saves" : "Other");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// ---------- Rendering ----------

function dots(n, label) {
  return `<span class="dots" title="${label} ${n}/5" aria-label="${label} ${n} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
}

function deeperUrl(v) {
  const q = `${topicName(v.score.topic)} ${v.title.replace(/#\w+/g, "")} explained`;
  // sp=EgIYAg%3D%3D is YouTube's "Over 20 minutes" filter
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q.trim())}&sp=EgIYAg%3D%3D`;
}

// Small line icons for the phone action rail (SVG, so they never turn into emoji).
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  more: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  knew: svg('<path d="M20 6 9 17l-5-5"/>'),
  save: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  skip: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  deeper: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  muted: svg('<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>'),
  sound: svg('<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
};

function railHtml(v) {
  const btn = (act, label) =>
    `<button data-act="${act}" class="act ${v.feedback === act ? "on" : ""}" aria-label="${label}">${ICON[act]}<span>${label}</span></button>`;
  return `<nav class="rail" aria-label="Actions">
      ${btn("more", "More")}${btn("knew", "Knew it")}${btn("save", "Save")}${btn("skip", "Skip")}
      <a class="rail-link" href="${esc(deeperUrl(v))}" target="_blank" rel="noopener" aria-label="Go deeper: long videos">${ICON.deeper}<span>Deeper</span></a>
    </nav>`;
}

function cardHtml(v, i) {
  const s = v.score;
  const hypeLabel = s.hype <= 2 ? "Low hype" : s.hype === 3 ? "Some hype" : "High hype";
  const thumb = v.thumbnail
    ? `<img class="thumb" src="${esc(v.thumbnail)}" alt="" loading="${i < 2 ? "eager" : "lazy"}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(v.videoId)}/hqdefault.jpg'">`
    : `<div class="thumb ig-thumb"><span>Instagram reel</span>${v.author ? `<b>@${esc(v.author)}</b>` : ""}</div>`;
  return `
  <section class="card" data-id="${esc(v.id)}" data-index="${i}" tabindex="-1" aria-label="${esc(v.title)}">
    <div class="media">
      ${thumb}
      <button class="play" aria-label="Play">▶</button>
      ${v.platform === "youtube" ? `
      <div class="tapzone" aria-hidden="true"></div>
      <div class="paused-icon" aria-hidden="true">▶</div>
      <button class="sound" aria-label="${state.sound ? "Mute" : "Turn sound on"}">${state.sound ? ICON.sound : ICON.muted}</button>` : ""}
      ${i === 0 && showHint() ? `<div class="hint">Tap for sound · Swipe up for next</div>` : ""}
    </div>
    ${railHtml(v)}
    <aside class="info">
      <div class="meta">
        <span class="platform ${v.platform}">${v.platform === "youtube" ? "YouTube" : "Instagram"}</span>
        ${v.author ? `<span>${esc(v.author)}</span>` : ""}
        ${v.publishedAt ? `<span>· ${ago(v.publishedAt)}</span>` : ""}
        ${v.views ? `<span>· ${fmtViews(v.views)}</span>` : ""}
      </div>
      <h2 class="title">${esc(v.title)}</h2>
      <div class="badges">
        <span class="chip topic">${esc(topicName(s.topic))}</span>
        <span class="chip">Depth ${dots(s.depth, "Depth")}</span>
        <span class="chip hype-${s.hype <= 2 ? "low" : s.hype === 3 ? "mid" : "high"}">${hypeLabel}</span>
        <span class="chip fresh-${s.freshness}">${s.freshness === "current" ? "Current" : s.freshness === "aging" ? "Aging" : "Probably outdated"}</span>
        ${v.similar ? `<span class="chip" title="Near-duplicates hidden">+${v.similar} similar</span>` : ""}
      </div>
      ${s.takeaway ? `<p class="takeaway"><b>Takeaway</b>${esc(s.takeaway)}</p>` : ""}
      ${s.takeaway || s.tryThis ? `<span class="expand-hint" aria-hidden="true">more</span>` : ""}
      ${s.tryThis ? `<div class="try"><b>Try this</b>${esc(s.tryThis)}</div>` : ""}
      <p class="scored muted">${s.by === "claude" ? "Scored by Claude" : STATIC ? "Keyword score" : "Quick keyword score. Run <code>npm run score</code> for Claude's take."}</p>
      <div class="actions">
        <button data-act="more" class="act ${v.feedback === "more" ? "on" : ""}" title="More like this (M)">↑ Teach me more</button>
        <button data-act="knew" class="act ${v.feedback === "knew" ? "on" : ""}" title="I knew this, hide it (X)">✓ Knew this</button>
        <button data-act="save" class="act ${v.feedback === "save" ? "on" : ""}" title="Save (S)">★ Save</button>
        <button data-act="skip" class="act ${v.feedback === "skip" ? "on" : ""}" title="Not for me">Skip</button>
      </div>
      <div class="links">
        <a href="${esc(deeperUrl(v))}" target="_blank" rel="noopener">Go deeper: long videos ↗</a>
        <a href="${esc(v.url)}" target="_blank" rel="noopener">Open on ${v.platform === "youtube" ? "YouTube" : "Instagram"} ↗</a>
      </div>
    </aside>
  </section>`;
}

function endCardHtml() {
  if (state.mode !== "daily") return "";
  return `
  <section class="card end" data-end="1">
    <div class="end-inner">
      <div class="big">🎓</div>
      <h2>That's your ${state.items.length} for today.</h2>
      <p class="muted">Stopping here is the point. Come back tomorrow for a new set, or keep going in Explore.</p>
      <button class="btn-primary" data-goto="explore">Explore more</button>
      ${creditHtml()}
    </div>
  </section>`;
}

function creditHtml() {
  if (!STATIC) return "";
  const updated = state.meta?.generatedAt ? ` · Updated ${ago(state.meta.generatedAt)}` : "";
  return `<p class="credit muted">${state.meta?.counts.total ?? 0} videos${updated} · Inspired by Karpathy's
    <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> ·
    <a href="${esc(STATIC.repo)}" target="_blank" rel="noopener">Code on GitHub</a></p>`;
}

function emptyHtml() {
  const c = state.meta?.counts ?? {};
  const msg = {
    daily: STATIC
      ? "You've seen everything for now. New videos arrive every morning, or keep going in Explore."
      : c.total ? "You've seen everything relevant. Run <code>npm run fetch</code> for new videos." : "Your library is empty. Run <code>npm run fetch</code> to pull Shorts from AI channels.",
    explore: "Nothing here for this topic yet.",
    saves: "No Instagram saves yet. Export your data from Instagram and run <code>npm run import:instagram -- &lt;folder&gt;</code>, or paste a reel with <b>+ Add</b>.",
    saved: "Nothing saved yet. Tap ★ Save on a video to keep it here.",
  }[state.mode];
  return `<section class="card end"><div class="end-inner"><div class="big">📭</div><p>${msg}</p>${creditHtml()}</div></section>`;
}

async function load() {
  feedEl.innerHTML = `<section class="card end"><div class="end-inner muted">Loading…</div></section>`;
  const { items } = await backend.feed(state.mode, state.topic);
  state.items = items;
  feedEl.innerHTML = items.length ? items.map(cardHtml).join("") + endCardHtml() : emptyHtml();
  feedEl.scrollTop = 0;
  observe();
  updateProgress();
}

// ---------- Playback: only the card in view gets a live player ----------
// YouTube videos use the official IFrame Player API. Phone browsers only allow
// a video to start on its own when it is muted and started by script once the
// player is ready, so we do exactly that, check it really started, and fall back
// to our own "Tap to play" button if the browser (or an in-app browser like
// LinkedIn's) still blocks it.

state.sound = false;
const isPhone = () => matchMedia("(max-width: 760px), (pointer: coarse)").matches;
const PLAYING = 1, BUFFERING = 3;

let ytApi;
function loadYouTubeApi() {
  ytApi ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytApi = null; reject(new Error("YouTube player failed to load")); };
    document.head.appendChild(s);
  });
  return ytApi;
}

function setBlocked(card, blocked) {
  card.classList.toggle("blocked", blocked);
}

/** Start (or retry) playback. Unmuted only if the viewer turned sound on. */
function startPlayback(card) {
  const p = card._player;
  if (!p?.playVideo) return;
  if (state.sound) { p.unMute(); p.setVolume(100); } else p.mute();
  p.playVideo();
  clearTimeout(card._watchdog);
  card._watchdog = setTimeout(() => {
    if (!card.classList.contains("active") || card._player !== p) return;
    const s = p.getPlayerState?.();
    if (s === PLAYING || s === BUFFERING) return;
    if (state.sound) {
      // Sound on was refused without a fresh tap: retry muted, which browsers allow.
      p.mute();
      p.playVideo();
      card._watchdog = setTimeout(() => {
        const s2 = p.getPlayerState?.();
        if (card._player === p && s2 !== PLAYING && s2 !== BUFFERING) setBlocked(card, true);
      }, 1500);
    } else {
      setBlocked(card, true);
    }
  }, 1800);
}

async function mountYouTube(card, v) {
  const media = $(".media", card);
  const host = document.createElement("div");
  host.className = "yt-host";
  media.insertBefore(host, $(".tapzone", media) ?? null);
  let YT;
  try {
    YT = await loadYouTubeApi();
  } catch {
    setBlocked(card, true);
    return;
  }
  // The viewer may have scrolled on while the API loaded.
  if (!card.classList.contains("active") || !host.isConnected) return;
  card._player = new YT.Player(host, {
    host: "https://www.youtube-nocookie.com",
    videoId: v.videoId,
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1, mute: 1, playsinline: 1, loop: 1, playlist: v.videoId, rel: 0, modestbranding: 1,
      // On phones our tap / sound controls replace YouTube's, which would sit under the caption and rail.
      controls: isPhone() ? 0 : 1,
      origin: location.origin,
    },
    events: {
      onReady: () => startPlayback(card),
      onStateChange: (e) => {
        if (e.data === PLAYING) {
          setBlocked(card, false);
          card.classList.remove("paused");
          $(".media iframe", card)?.classList.add("ready");
        }
      },
      onError: () => setBlocked(card, true),
    },
  });
  const iframe = $(".media iframe", card);
  if (iframe) iframe.title = v.title;
}

function activate(card) {
  if (!card || !card.dataset.id) return; // end, empty and loading cards have no player
  for (const other of feedEl.querySelectorAll(".card.active")) if (other !== card) deactivate(other);
  card.classList.add("active");
  const v = state.items[Number(card.dataset.index)];
  const media = $(".media", card);
  if (!$("iframe, .yt-host", media)) {
    if (v.platform === "youtube") {
      mountYouTube(card, v);
    } else {
      const f = document.createElement("iframe");
      f.src = `https://www.instagram.com/${v.embedKind || "reel"}/${v.videoId}/embed/`;
      f.title = v.title;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.addEventListener("load", () => setTimeout(() => f.classList.add("ready"), 250));
      media.appendChild(f);
    }
  } else if (card._player) {
    startPlayback(card);
  }
  if (!state.seenSent.has(v.id)) {
    state.seenSent.add(v.id);
    backend.feedback(v.id, "seen").catch(() => {});
  }
  updateProgress(Number(card.dataset.index));
}

function deactivate(card) {
  card.classList.remove("active", "paused", "blocked");
  clearTimeout(card._watchdog);
  try { card._player?.destroy?.(); } catch {}
  card._player = null;
  $(".media", card)?.querySelectorAll("iframe, .yt-host").forEach((el) => el.remove());
  $(".info", card)?.classList.remove("expanded");
}

// ---------- Phone controls: tap for sound / pause, swipe stays with the feed ----------
// On touch screens a transparent layer sits over the YouTube player, so swipes
// scroll the feed instead of being swallowed by the iframe.

function showHint() {
  try { return !localStorage.getItem("ss-hinted"); } catch { return false; }
}
function dismissHint() {
  document.querySelectorAll(".hint").forEach((h) => h.remove());
  try { localStorage.setItem("ss-hinted", "1"); } catch {}
}

function setSound(on) {
  state.sound = on;
  const card = $(".card.active");
  const p = card?._player;
  if (p?.playVideo) {
    if (on) { p.unMute(); p.setVolume(100); p.playVideo(); } else p.mute();
  }
  document.querySelectorAll(".sound").forEach((b) => {
    b.innerHTML = on ? ICON.sound : ICON.muted;
    b.setAttribute("aria-label", on ? "Mute" : "Turn sound on");
  });
  dismissHint();
}

function tapVideo(card) {
  if (!card.classList.contains("active")) return activate(card);
  const p = card._player;
  // Blocked from starting on its own: this tap is the user gesture the browser wants.
  // Like Reels, a tap that starts a video starts it with sound.
  if (card.classList.contains("blocked") || !p?.getPlayerState) {
    setBlocked(card, false);
    state.sound = true;
    setSound(true);
    return startPlayback(card);
  }
  // First tap turns sound on; after that a tap pauses / resumes.
  if (!state.sound) return setSound(true);
  const playing = [PLAYING, BUFFERING].includes(p.getPlayerState());
  card.classList.toggle("paused", playing);
  playing ? p.pauseVideo() : p.playVideo();
}

let io;
function observe() {
  io?.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(e.target);
        else if (!e.isIntersecting) deactivate(e.target);
      }
    },
    { root: feedEl, threshold: [0, 0.6] },
  );
  feedEl.querySelectorAll(".card").forEach((c) => io.observe(c));
  setTimeout(activateCardInView, 300);
}

// Backup to the observer: once scrolling settles, play whichever card fills the
// screen. Cards are exactly one screen tall, so it's scrollTop / height.
function activateCardInView() {
  const cards = feedEl.querySelectorAll(".card");
  const card = cards[Math.round(feedEl.scrollTop / Math.max(1, feedEl.clientHeight))];
  if (card && card.dataset.id && !card.classList.contains("active")) activate(card);
}
let settleTimer;
feedEl.addEventListener("scroll", () => {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(activateCardInView, 150);
}, { passive: true });

function updateProgress(index) {
  const show = state.mode === "daily" && state.items.length > 0;
  $("#progress").hidden = !show;
  if (!show) return;
  const n = state.items.length;
  const i = index ?? 0;
  $("#progressBar").style.width = `${((i + 1) / n) * 100}%`;
  $("#progressText").textContent = `${Math.min(i + 1, n)} / ${n}`;
}

function currentCard() {
  return feedEl.querySelector(".card.active") ?? feedEl.querySelector(".card");
}
function go(delta) {
  const cards = [...feedEl.querySelectorAll(".card")];
  const i = cards.indexOf(currentCard());
  const next = cards[Math.max(0, Math.min(cards.length - 1, i + delta))];
  next?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Feedback ----------

async function act(card, action) {
  const v = state.items[Number(card.dataset.index)];
  const undo = v.feedback === action;
  try {
    await backend.feedback(v.id, undo ? "undo" : action);
  } catch (err) {
    return toast(`Couldn't save that: ${err.message}`);
  }
  v.feedback = undo ? null : action;
  card.querySelectorAll(".act").forEach((b) => b.classList.toggle("on", b.dataset.act === v.feedback));
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12);
  card.classList.toggle("dismissed", ["knew", "skip"].includes(v.feedback));
  if (undo) return toast("Undone");
  const name = topicName(v.score.topic);
  toast({ more: `More ${name} coming`, knew: `Got it. Less basic ${name}.`, save: "Saved", skip: "Skipped" }[action]);
  if (action !== "save") setTimeout(() => go(1), 450);
}

feedEl.addEventListener("click", (e) => {
  const tz = e.target.closest(".tapzone");
  if (tz) return tapVideo(tz.closest(".card"));
  // Phones: tapping the caption expands the takeaway and "Try this".
  const info = e.target.closest(".info");
  if (info && isPhone() && !e.target.closest("button, a")) return info.classList.toggle("expanded");
  const btn = e.target.closest("button");
  if (!btn) return;
  const card = btn.closest(".card");
  if (btn.dataset.act) act(card, btn.dataset.act);
  else if (btn.classList.contains("sound")) setSound(!state.sound);
  else if (btn.classList.contains("play")) tapVideo(card);
  else if (btn.dataset.goto) setMode(btn.dataset.goto);
});
feedEl.addEventListener("scroll", () => { if (feedEl.scrollTop > 40) dismissHint(); }, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog[open]")) return;
  const card = currentCard();
  const keys = { ArrowDown: () => go(1), j: () => go(1), ArrowUp: () => go(-1), k: () => go(-1) };
  if (keys[e.key]) {
    e.preventDefault();
    return keys[e.key]();
  }
  const map = { m: "more", x: "knew", s: "save" };
  if (map[e.key] && card?.dataset.id) act(card, map[e.key]);
});

// ---------- Tabs, topic filter, add dialog ----------

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  try { localStorage.setItem("ss-mode", mode); } catch {}
  load().catch((err) => (feedEl.innerHTML = `<section class="card end"><div class="end-inner">Couldn't load the feed: ${esc(err.message)}</div></section>`));
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

$("#topic").addEventListener("change", (e) => {
  state.topic = e.target.value;
  if (state.mode === "saves" || state.mode === "saved") setMode("explore");
  else load();
});

const dlg = $("#addDialog");
$("#addBtn").addEventListener("click", () => {
  $("#addMsg").textContent = "";
  $("#addForm").reset();
  dlg.showModal();
});
$("#addForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  $("#addSubmit").disabled = true;
  $("#addMsg").textContent = state.meta?.claude ? "Adding and asking Claude to score it…" : "Adding…";
  try {
    const r = await api("/api/add", { url: fd.get("url"), note: fd.get("note") });
    dlg.close();
    toast(r.status === "added" ? "Added to your library" : "Already in your library");
    await refreshMeta();
    load();
  } catch (err) {
    $("#addMsg").textContent = err.message;
  } finally {
    $("#addSubmit").disabled = false;
  }
});

async function refreshMeta() {
  state.meta = await backend.meta();
  const sel = $("#topic");
  const current = sel.value;
  sel.innerHTML = `<option value="">${matchMedia("(max-width: 760px)").matches ? "Topics" : "All topics"}</option>` + state.meta.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.weight > 0 ? " ↑" : ""}</option>`).join("");
  sel.value = current;
}

(async () => {
  if (STATIC) {
    // Public site: no server to add videos to, and no one's Instagram saves.
    $('.tabs [data-mode="saves"]').remove();
    $("#addBtn").remove();
    const gh = $("#repoLink");
    gh.href = STATIC.repo;
    gh.hidden = false;
  }
  await refreshMeta();
  let saved = "daily";
  try { saved = localStorage.getItem("ss-mode") || "daily"; } catch {}
  const modes = STATIC ? ["daily", "explore", "saved"] : ["daily", "explore", "saves", "saved"];
  setMode(modes.includes(saved) ? saved : "daily");
})();
