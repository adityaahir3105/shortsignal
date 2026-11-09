import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeId, parseChannelFeed, isoDurationToSec } from "../src/youtube.js";
import { parseInstagramId, extractFromExport } from "../src/instagram.js";
import { heuristicScore, clusterKey } from "../src/score.js";
import { buildFeed, applyFeedback } from "../src/rank.js";

const topics = [
  { id: "claude-code", name: "Claude Code", keywords: ["claude code", "hooks"] },
  { id: "agents-mcp", name: "Agents & MCP", keywords: ["agent", "agents", "mcp"] },
];

test("parses YouTube ids from shorts, watch and youtu.be links", () => {
  assert.equal(parseYouTubeId("https://www.youtube.com/shorts/uVS88gnaxcg"), "uVS88gnaxcg");
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?v=DdCEmlAydcw&t=3"), "DdCEmlAydcw");
  assert.equal(parseYouTubeId("https://youtu.be/DdCEmlAydcw"), "DdCEmlAydcw");
  assert.equal(parseYouTubeId("https://example.com"), null);
});

test("parses Instagram reel and post links", () => {
  assert.deepEqual(parseInstagramId("https://www.instagram.com/reel/C9xYz_12AB/?igsh=1"), { kind: "reel", code: "C9xYz_12AB" });
  assert.deepEqual(parseInstagramId("https://www.instagram.com/p/ABC123/"), { kind: "p", code: "ABC123" });
  assert.deepEqual(parseInstagramId("https://www.instagram.com/someuser/reel/XYZ9/"), { kind: "reel", code: "XYZ9" });
});

test("channel feed keeps only Shorts", () => {
  const xml = `<feed><entry><yt:videoId>aaaaaaaaaaa</yt:videoId><yt:channelId>UC1</yt:channelId><title>Long talk</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/><author><name>A</name></author><published>2026-10-01T00:00:00+00:00</published></entry>
    <entry><yt:videoId>bbbbbbbbbbb</yt:videoId><yt:channelId>UC1</yt:channelId><title>Claude Code hooks &amp; you</title>
    <link rel="alternate" href="https://www.youtube.com/shorts/bbbbbbbbbbb"/><author><name>A</name></author><published>2026-10-02T00:00:00+00:00</published>
    <media:group><media:description>How hooks work.</media:description><media:community><media:statistics views="1234"/></media:community></media:group></entry></feed>`;
  const out = parseChannelFeed(xml, "@a");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "yt:bbbbbbbbbbb");
  assert.equal(out[0].title, "Claude Code hooks & you");
  assert.equal(out[0].views, 1234);
});

test("ISO durations", () => {
  assert.equal(isoDurationToSec("PT1M5S"), 65);
  assert.equal(isoDurationToSec("PT45S"), 45);
  assert.equal(isoDurationToSec("PT1H"), 3600);
});

test("Instagram export: finds saved and liked reels in either format", () => {
  const saved = {
    saved_saved_media: [
      { title: "aiwithjane", string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/REEL1/", timestamp: 1760000000 } } },
    ],
  };
  const liked = {
    likes_media_likes: [{ title: "codewithbob", string_list_data: [{ href: "https://www.instagram.com/p/POST2/", value: "👍", timestamp: 1760001000 }] }],
  };
  const a = extractFromExport(saved, "ig-export:saved");
  const b = extractFromExport(liked, "ig-export:liked");
  assert.equal(a[0].id, "ig:REEL1");
  assert.equal(a[0].author, "aiwithjane");
  assert.ok(a[0].publishedAt.startsWith("2025-10"));
  assert.equal(b[0].id, "ig:POST2");
  assert.equal(b[0].embedKind, "p");
});

test("heuristic: matches whole words, flags hype, judges freshness", () => {
  const base = { platform: "youtube", publishedAt: new Date().toISOString() };
  const calm = heuristicScore({ ...base, title: "How Claude Code hooks work", description: "A step by step guide." }, topics);
  assert.equal(calm.topic, "claude-code");
  assert.equal(calm.relevant, true);
  assert.ok(calm.hype <= 2);
  const hype = heuristicScore({ ...base, title: "THIS AI AGENT CHANGES EVERYTHING 🤯!!!", description: "" }, topics);
  assert.ok(hype.hype >= 4);
  const notAgent = heuristicScore({ ...base, title: "Talking to my real estate agency", description: "" }, topics);
  assert.equal(notAgent.relevant, false, "'agency' must not match 'agent'");
  const old = heuristicScore({ ...base, publishedAt: "2024-01-01T00:00:00Z", title: "MCP intro", description: "" }, topics);
  assert.equal(old.freshness, "stale");
});

test("clusterKey groups near-identical titles", () => {
  assert.equal(clusterKey("Claude Code hooks explained #shorts"), clusterKey("Hooks explained: Claude Code"));
});

function lib(videos) {
  return { videos: Object.fromEntries(videos.map((v) => [v.id, v])), feedback: {}, seen: {}, topicWeights: {}, daily: null };
}
const vid = (id, topic, depth, extra = {}) => ({
  id, platform: "youtube", title: id, publishedAt: new Date().toISOString(), views: 1000,
  score: { relevant: true, topic, depth, hype: 1, freshness: "current", cluster: id, by: "heuristic" }, ...extra,
});

test("daily feed: ranks by depth, caps per topic, collapses duplicates, stays fixed for the day", () => {
  const l = lib([
    vid("a", "claude-code", 5), vid("b", "claude-code", 4), vid("c", "claude-code", 4), vid("d", "claude-code", 3),
    vid("e", "agents-mcp", 2),
    vid("dup1", "agents-mcp", 3, { score: { relevant: true, topic: "agents-mcp", depth: 3, hype: 1, freshness: "current", cluster: "same", by: "heuristic" } }),
    vid("dup2", "agents-mcp", 1, { score: { relevant: true, topic: "agents-mcp", depth: 1, hype: 1, freshness: "current", cluster: "same", by: "heuristic" } }),
  ]);
  const feed = buildFeed(l, { mode: "daily" });
  const ids = feed.map((v) => v.id);
  assert.equal(ids[0], "a");
  assert.equal(ids.filter((id) => "abcd".includes(id)).length, 3, "max 3 per topic");
  assert.ok(ids.includes("dup1") && !ids.includes("dup2"), "duplicates collapse to the best one");
  // Same day: same list even after new feedback
  applyFeedback(l, "a", "knew");
  assert.deepEqual(buildFeed(l, { mode: "daily" }).map((v) => v.id), ids);
});

test("feedback: 'knew' hides and lowers topic weight, 'more' raises it", () => {
  const l = lib([vid("a", "claude-code", 3), vid("b", "agents-mcp", 3)]);
  applyFeedback(l, "a", "knew");
  applyFeedback(l, "b", "more");
  assert.equal(l.topicWeights["claude-code"], -0.5);
  assert.equal(l.topicWeights["agents-mcp"], 1);
  const explore = buildFeed(l, { mode: "explore" }).map((v) => v.id);
  assert.deepEqual(explore, ["b"]);
});
