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
    </div>
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
      ${s.tryThis ? `<div class="try"><b>Try this</b>${esc(s.tryThis)}</div>` : ""}
      <p class="scored muted">${s.by === "claude" ? "Scored by Claude" : "Quick keyword score. Run <code>npm run score</code> for Claude's take."}</p>
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
    </div>
  </section>`;
}

function emptyHtml() {
  const c = state.meta?.counts ?? {};
  const msg = {
    daily: c.total ? "You've seen everything relevant. Run <code>npm run fetch</code> for new videos." : "Your library is empty. Run <code>npm run fetch</code> to pull Shorts from AI channels.",
    explore: "Nothing here for this topic yet.",
    saves: "No Instagram saves yet. Export your data from Instagram and run <code>npm run import:instagram -- &lt;folder&gt;</code>, or paste a reel with <b>+ Add</b>.",
    saved: "Nothing saved yet. Tap ★ Save on a video to keep it here.",
  }[state.mode];
  return `<section class="card end"><div class="end-inner"><div class="big">📭</div><p>${msg}</p></div></section>`;
}

async function load() {
  feedEl.innerHTML = `<section class="card end"><div class="end-inner muted">Loading…</div></section>`;
  const params = new URLSearchParams({ mode: state.mode, topic: state.topic });
  const { items } = await api(`/api/feed?${params}`);
  state.items = items;
  feedEl.innerHTML = items.length ? items.map(cardHtml).join("") + endCardHtml() : emptyHtml();
  feedEl.scrollTop = 0;
  observe();
  updateProgress();
}

// ---------- Playback: only the card in view gets a live player ----------

function embedSrc(v) {
  if (v.platform === "youtube") {
    const p = new URLSearchParams({ autoplay: "1", mute: "1", playsinline: "1", loop: "1", playlist: v.videoId, rel: "0", modestbranding: "1" });
    return `https://www.youtube-nocookie.com/embed/${v.videoId}?${p}`;
  }
  return `https://www.instagram.com/${v.embedKind || "reel"}/${v.videoId}/embed/`;
}

function activate(card) {
  if (!card || !card.dataset.id) return; // end, empty and loading cards have no player
  for (const other of feedEl.querySelectorAll(".card.active")) if (other !== card) deactivate(other);
  card.classList.add("active");
  const v = state.items[Number(card.dataset.index)];
  const media = $(".media", card);
  if (!$("iframe", media)) {
    const f = document.createElement("iframe");
    f.src = embedSrc(v);
    f.title = v.title;
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    media.appendChild(f);
  }
  if (!state.seenSent.has(v.id)) {
    state.seenSent.add(v.id);
    api("/api/feedback", { id: v.id, action: "seen" }).catch(() => {});
  }
  updateProgress(Number(card.dataset.index));
}

function deactivate(card) {
  card.classList.remove("active");
  $(".media iframe", card)?.remove();
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
}

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
    await api("/api/feedback", { id: v.id, action: undo ? "undo" : action });
  } catch (err) {
    return toast(`Couldn't save that: ${err.message}`);
  }
  v.feedback = undo ? null : action;
  card.querySelectorAll(".act").forEach((b) => b.classList.toggle("on", b.dataset.act === v.feedback));
  card.classList.toggle("dismissed", ["knew", "skip"].includes(v.feedback));
  if (undo) return toast("Undone");
  const name = topicName(v.score.topic);
  toast({ more: `More ${name} coming`, knew: `Got it. Less basic ${name}.`, save: "Saved", skip: "Skipped" }[action]);
  if (action !== "save") setTimeout(() => go(1), 450);
}

feedEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const card = btn.closest(".card");
  if (btn.dataset.act) act(card, btn.dataset.act);
  else if (btn.classList.contains("play")) activate(card);
  else if (btn.dataset.goto) setMode(btn.dataset.goto);
});

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
  state.meta = await api("/api/meta");
  const sel = $("#topic");
  const current = sel.value;
  sel.innerHTML = `<option value="">All topics</option>` + state.meta.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.weight > 0 ? " ↑" : ""}</option>`).join("");
  sel.value = current;
}

(async () => {
  await refreshMeta();
  let saved = "daily";
  try { saved = localStorage.getItem("ss-mode") || "daily"; } catch {}
  setMode(["daily", "explore", "saves", "saved"].includes(saved) ? saved : "daily");
})();
