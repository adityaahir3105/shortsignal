// npm start -> http://localhost:5173
// Plain Node http server: serves the feed UI and a small JSON API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadLibrary, saveLibrary, upsertVideo, loadConfig } from "./src/store.js";
import { buildFeed, applyFeedback, DAILY_SIZE } from "./src/rank.js";
import { heuristicScore, claudeScoreBatch, claudeCanJudge, hasClaude } from "./src/score.js";
import { parseYouTubeId, youtubeRecord, oembed } from "./src/youtube.js";
import { parseInstagramId, instagramRecord } from "./src/instagram.js";

const PORT = Number(process.env.PORT) || 5173;
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const ACTIONS = new Set(["more", "knew", "skip", "save", "seen", "undo"]);

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

async function addByUrl(url, note) {
  const { topics } = loadConfig("topics");
  let video;
  const yt = parseYouTubeId(url);
  const ig = !yt && parseInstagramId(url);

  // Already in the library: keep what we know, just make sure it shows up.
  const existingId = yt ? `yt:${yt}` : ig ? `ig:${ig.code}` : null;
  const lib0 = loadLibrary();
  const existing = existingId && lib0.videos[existingId];
  if (existing) {
    existing.score = { ...existing.score, relevant: true };
    if (note && !existing.description) existing.description = note;
    saveLibrary(lib0);
    return { status: "exists", video: existing };
  }

  if (yt) {
    const meta = await oembed(`https://www.youtube.com/watch?v=${yt}`).catch(() => null);
    video = youtubeRecord({
      videoId: yt,
      title: meta?.title ?? "YouTube video",
      author: meta?.author_name ?? null,
      description: note || "",
      publishedAt: null,
      source: "manual",
      isShort: /\/shorts\//.test(url),
    });
  } else if (ig) {
    video = instagramRecord({ code: ig.code, kind: ig.kind, note, source: "manual", savedAt: new Date().toISOString() });
  } else {
    return { error: "Paste a YouTube or Instagram link." };
  }
  video.score = heuristicScore(video, topics);
  video.score.relevant = true; // you added it on purpose
  if (hasClaude() && claudeCanJudge(video)) {
    try {
      const s = (await claudeScoreBatch([video], topics))[video.id];
      if (s) video.score = { ...s, relevant: true };
    } catch (err) {
      console.warn(`Claude scoring failed for ${video.id}: ${err.message}`);
    }
  }
  const lib = loadLibrary();
  const status = upsertVideo(lib, video);
  saveLibrary(lib);
  return { status, video: lib.videos[video.id] };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/meta") {
      const lib = loadLibrary();
      const vids = Object.values(lib.videos);
      return send(res, 200, {
        topics: loadConfig("topics").topics.map(({ id, name }) => ({ id, name, weight: lib.topicWeights[id] ?? 0 })),
        dailySize: DAILY_SIZE,
        claude: hasClaude(),
        counts: {
          total: vids.length,
          relevant: vids.filter((v) => v.score?.relevant).length,
          claudeScored: vids.filter((v) => v.score?.by === "claude").length,
          instagram: vids.filter((v) => v.platform === "instagram").length,
          saved: Object.values(lib.feedback).filter((f) => f.action === "save").length,
        },
      });
    }
    if (url.pathname === "/api/feed") {
      const lib = loadLibrary();
      const items = buildFeed(lib, { mode: url.searchParams.get("mode") || "daily", topic: url.searchParams.get("topic") || "" });
      saveLibrary(lib); // persists today's daily pick
      return send(res, 200, {
        items: items.slice(0, 200).map((v) => ({ ...v, feedback: lib.feedback[v.id]?.action ?? null })),
      });
    }
    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const { id, action } = await readJson(req);
      if (!ACTIONS.has(action)) return send(res, 400, { error: "unknown action" });
      const lib = loadLibrary();
      if (!applyFeedback(lib, id, action)) return send(res, 404, { error: "unknown video" });
      saveLibrary(lib);
      return send(res, 200, { ok: true, topicWeights: lib.topicWeights });
    }
    if (url.pathname === "/api/add" && req.method === "POST") {
      const { url: link, note } = await readJson(req);
      const result = await addByUrl(String(link || "").trim(), String(note || "").trim().slice(0, 500));
      return send(res, result.error ? 400 : 200, result);
    }

    // Static files
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`ShortSignal running at http://localhost:${PORT}`);
  console.log(hasClaude() ? "Claude scoring: on" : "Claude scoring: off (keyword scorer). Add ANTHROPIC_API_KEY to .env to turn it on.");
});
