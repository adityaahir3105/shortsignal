// Scoring: decides whether a video is worth your time.
// Claude reads the title, description and metadata and returns depth, hype,
// freshness, a one-line takeaway and something to try. Without an API key a
// keyword heuristic stands in so the app still works end to end.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.SHORTSIGNAL_MODEL || "claude-opus-5-5";
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const daysOld = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400e3 : null);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

// ---------- Heuristic scorer (no key needed) ----------

const HYPE = [
  /🤯|🔥{2,}|😱|‼️/u,
  /\b(insane|crazy|mind[- ]?blowing|game[- ]?changer|changes everything|is dead|you won'?t believe|destroys|shocking|secret|nobody is talking)\b/i,
  /!{2,}/,
  /\b(AGI is here|replace(s|d)? (all )?(developers|programmers|jobs))\b/i,
];
const TEACH = /\b(how to|how (it|they|llms?) works?|explained|tutorial|tip|tips|step|guide|why|learn|lesson|example|demo|in \d+ (seconds|minutes)|vs\.?|difference|beginner|setup|workflow)\b/i;

function capsRatio(s) {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return 0;
  return letters.replace(/[^A-Z]/g, "").length / letters.length;
}

export function heuristicScore(video, topics) {
  const text = `${video.title} ${video.description}`.toLowerCase();
  const has = (k) => new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
  let best = null;
  let bestHits = 0;
  for (const t of topics) {
    const hits = t.keywords.filter(has).length;
    if (hits > bestHits) [best, bestHits] = [t, hits];
  }
  const fromYourSaves = video.platform === "instagram";
  let hype = 1 + HYPE.filter((r) => r.test(`${video.title} ${video.description}`)).length;
  if (capsRatio(video.title) > 0.5) hype += 1;
  let depth = 2 + (TEACH.test(text) ? 1 : 0) + (video.description.length > 300 ? 1 : 0);
  if (hype >= 3) depth -= 1;
  const age = daysOld(video.publishedAt);
  const firstSentence = (video.description || "").split(/(?<=[.!?])\s|\n/)[0]?.trim();
  return {
    by: "heuristic",
    relevant: fromYourSaves || bestHits > 0,
    topic: best?.id ?? (fromYourSaves ? "your-saves" : "other"),
    depth: clamp(depth, 1, 5),
    hype: clamp(hype, 1, 5),
    freshness: age === null ? "current" : age < 60 ? "current" : age < 180 ? "aging" : "stale",
    takeaway: firstSentence && firstSentence.length > 20 ? firstSentence.slice(0, 160) : "",
    tryThis: "",
    cluster: clusterKey(video.title),
    scoredAt: new Date().toISOString(),
  };
}

const STOP = new Set("the a an and or of to in on for with is are you your this that it how what why new my i we from just".split(" "));
export function clusterKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/#\w+/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 4)
    .sort()
    .join("-");
}

// ---------- Claude scorer ----------

const SCHEMA = (topicIds) => ({
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "relevant", "topic", "depth", "hype", "freshness", "takeaway", "try_this", "cluster"],
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          topic: { type: "string", enum: [...topicIds, "other"] },
          depth: { type: "integer" },
          hype: { type: "integer" },
          freshness: { type: "string", enum: ["current", "aging", "stale"] },
          takeaway: { type: "string" },
          try_this: { type: "string" },
          cluster: { type: "string" },
        },
      },
    },
  },
});

const SYSTEM = `You curate a personal learning feed of short videos (YouTube Shorts, Instagram Reels) about Claude, AI tools and how AI works. The viewer is a developer who wants to learn, not be entertained by hype.

For each video you get its title, channel, description, publish date and view count. Judge it only from that metadata, and say so implicitly by being conservative when the metadata is thin.

Fields:
- relevant: true only if the video is mainly about AI, LLMs, AI tools, Claude/Anthropic, agents, or AI-assisted coding.
- topic: the single best matching topic id from the list, or "other".
- depth (1-5): 1 = pure reaction or news headline, 3 = one concrete tip or concept explained, 5 = teaches a non-obvious technique or mental model clearly.
- hype (1-5): 1 = calm and specific, 5 = clickbait ("this changes everything", fear, exaggerated claims).
- freshness: "stale" if it centres on models, prices, features or APIs that have clearly been superseded as of today's date; "aging" if partly outdated; otherwise "current". AI moves fast, so weigh the publish date.
- takeaway: one plain sentence (max 20 words) with what the viewer learns. Empty string if nothing concrete.
- try_this: one concrete action, command or prompt the viewer could try in under five minutes. Empty string if none fits.
- cluster: a short kebab-case key for the underlying story or idea (e.g. "claude-code-hooks", "mcp-intro"), so near-duplicate videos share a key.

Return one item per video, using the exact id given.`;

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

/**
 * Score up to ~15 videos in one request. Returns a map id -> score.
 * Throws on API errors; returns {} on a refusal so the caller can fall back.
 */
export async function claudeScoreBatch(videos, topics) {
  const today = new Date().toISOString().slice(0, 10);
  const topicList = topics.map((t) => `${t.id}: ${t.name}`).join("\n");
  const payload = videos.map((v) => ({
    id: v.id,
    platform: v.platform,
    title: v.title,
    channel: v.author,
    published: v.publishedAt?.slice(0, 10) ?? "unknown",
    views: v.views,
    description: (v.description || "").slice(0, 800),
  }));

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA(topics.map((t) => t.id)) } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Today is ${today}.\n\nTopics:\n${topicList}\n\nVideos:\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`  Claude declined this batch (${response.stop_details?.category ?? "no category"}); using heuristic.`);
    return {};
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("  Response hit max_tokens; using heuristic for this batch.");
    return {};
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  const now = new Date().toISOString();
  const out = {};
  for (const it of parsed.items) {
    out[it.id] = {
      by: "claude",
      model: response.model,
      relevant: it.relevant,
      topic: it.topic,
      depth: clamp(it.depth, 1, 5),
      hype: clamp(it.hype, 1, 5),
      freshness: it.freshness,
      takeaway: it.takeaway,
      tryThis: it.try_this,
      cluster: it.cluster || clusterKey(videos.find((v) => v.id === it.id)?.title ?? ""),
      scoredAt: now,
    };
  }
  return out;
}

/** True if this record is worth sending to Claude (Instagram export rows have no text yet). */
export const claudeCanJudge = (v) => v.platform === "youtube" || Boolean(v.description);
