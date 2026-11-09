// Ranking and feed assembly.
// Score = teaching depth, minus hype, plus freshness, plus how much you've said
// you want this topic. Near-duplicates (same cluster) collapse into one card.

const FRESH = { current: 2, aging: 0.5, stale: -3 };
export const DAILY_SIZE = 10;
const MAX_PER_TOPIC_DAILY = 3;
const MAX_SAVES_DAILY = 2;

export function rankScore(v, lib) {
  const s = v.score;
  if (!s) return -Infinity;
  const ageDays = v.publishedAt ? (Date.now() - new Date(v.publishedAt).getTime()) / 86400e3 : 365;
  return (
    s.depth * 2 -
    (s.hype - 1) * 1.2 +
    (FRESH[s.freshness] ?? 0) +
    (lib.topicWeights[s.topic] ?? 0) +
    Math.log10((v.views ?? 0) + 1) * 0.3 +
    (ageDays < 14 ? 1 : 0) +
    (s.by === "claude" ? 0.5 : 0)
  );
}

const hidden = (v, lib) => ["knew", "skip"].includes(lib.feedback[v.id]?.action);

/** Group by cluster and keep the best video in each, with a count of the rest. */
function collapse(videos, lib) {
  const byCluster = new Map();
  for (const v of videos) {
    const key = v.score?.cluster || v.id;
    const list = byCluster.get(key) ?? [];
    list.push(v);
    byCluster.set(key, list);
  }
  return [...byCluster.values()].map((list) => {
    list.sort((a, b) => rankScore(b, lib) - rankScore(a, lib));
    return { ...list[0], similar: list.length - 1, rank: rankScore(list[0], lib) };
  });
}

export function buildFeed(lib, { mode = "daily", topic = "" } = {}) {
  const all = Object.values(lib.videos).filter((v) => v.score);
  const today = new Date().toISOString().slice(0, 10);

  if (mode === "saved") {
    return all
      .filter((v) => lib.feedback[v.id]?.action === "save")
      .sort((a, b) => lib.feedback[b.id].at.localeCompare(lib.feedback[a.id].at))
      .map((v) => ({ ...v, similar: 0 }));
  }

  if (mode === "saves") {
    // Your Instagram saves, oldest first: things you meant to come back to.
    return all
      .filter((v) => v.platform === "instagram" && !hidden(v, lib))
      .sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))
      .map((v) => ({ ...v, similar: 0 }));
  }

  const pool = all.filter((v) => v.score.relevant && !hidden(v, lib) && (!topic || v.score.topic === topic));

  if (mode === "explore") {
    return collapse(pool, lib).sort((a, b) => b.rank - a.rank);
  }

  // Daily: fixed for the day once picked, so the list doesn't shuffle under you.
  if (!topic && lib.daily?.date === today && lib.daily.ids.length) {
    const sizes = new Map();
    for (const v of all.filter((x) => x.score.relevant)) {
      const k = v.score.cluster || v.id;
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    }
    return lib.daily.ids
      .map((id) => lib.videos[id])
      .filter(Boolean)
      .map((v) => ({ ...v, similar: (sizes.get(v.score.cluster || v.id) ?? 1) - 1, rank: rankScore(v, lib) }));
  }

  const ranked = collapse(pool.filter((v) => !lib.seen[v.id]), lib).sort((a, b) => b.rank - a.rank);
  const picks = [];
  const perTopic = {};
  let saves = 0;
  for (const v of ranked) {
    if (picks.length >= DAILY_SIZE) break;
    const t = v.score.topic;
    if ((perTopic[t] ?? 0) >= MAX_PER_TOPIC_DAILY && t !== topic) continue;
    if (v.platform === "instagram" && saves >= MAX_SAVES_DAILY) continue;
    perTopic[t] = (perTopic[t] ?? 0) + 1;
    if (v.platform === "instagram") saves++;
    picks.push(v);
  }
  if (!topic) lib.daily = { date: today, ids: picks.map((v) => v.id) };
  return picks;
}

export function applyFeedback(lib, id, action) {
  const v = lib.videos[id];
  if (!v) return false;
  const now = new Date().toISOString();
  if (action === "seen") {
    lib.seen[id] ??= now;
    return true;
  }
  if (action === "undo") {
    delete lib.feedback[id];
    return true;
  }
  lib.feedback[id] = { action, at: now };
  lib.seen[id] ??= now;
  const t = v.score?.topic;
  if (t) {
    const w = lib.topicWeights[t] ?? 0;
    if (action === "more") lib.topicWeights[t] = Math.min(5, w + 1);
    if (action === "knew") lib.topicWeights[t] = Math.max(-3, w - 0.5);
  }
  return true;
}
