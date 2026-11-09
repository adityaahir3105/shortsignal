// Tiny JSON-file store. One file holds the video library, your feedback and
// learned topic weights. Writes go to a temp file first, then rename, so a crash
// mid-write never corrupts the library.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const DATA_DIR = path.join(ROOT, "data");
const LIBRARY = path.join(DATA_DIR, "library.json");

const empty = () => ({
  videos: {}, // id -> video record
  feedback: {}, // id -> { action, at }
  seen: {}, // id -> ISO time first shown
  topicWeights: {}, // topic id -> number (learned from "Teach me more" / "Knew this")
  daily: null, // { date, ids }
  channels: {}, // "@handle" -> channelId (cache)
});

export function loadLibrary() {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(LIBRARY, "utf8")) };
  } catch (err) {
    if (err.code === "ENOENT") return empty();
    throw err;
  }
}

export function saveLibrary(lib) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${LIBRARY}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 1));
  fs.renameSync(tmp, LIBRARY);
}

/** Insert or merge a video. Keeps the existing score unless the new record has one. */
export function upsertVideo(lib, video) {
  const prev = lib.videos[video.id];
  if (!prev) {
    lib.videos[video.id] = { addedAt: new Date().toISOString(), ...video };
    return "added";
  }
  lib.videos[video.id] = {
    ...prev,
    ...Object.fromEntries(Object.entries(video).filter(([, v]) => v !== undefined && v !== null && v !== "")),
    addedAt: prev.addedAt,
    score: video.score ?? prev.score,
  };
  return "updated";
}

export function loadConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config", `${name}.json`), "utf8"));
}
