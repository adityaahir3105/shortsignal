// npm run fetch
// Pulls new Shorts from the channel RSS feeds (no key) and, if YOUTUBE_API_KEY
// is set, from YouTube search for each topic. New videos get a quick heuristic
// score straight away; run `npm run score` to have Claude score them properly.
import { loadLibrary, saveLibrary, upsertVideo, loadConfig } from "../src/store.js";
import { resolveHandle, fetchChannelShorts, searchShorts } from "../src/youtube.js";
import { heuristicScore } from "../src/score.js";

const lib = loadLibrary();
const { topics } = loadConfig("topics");
const { handles } = loadConfig("channels");
let added = 0;
const stats = [];

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

console.log(`Scanning ${handles.length} channel feeds for Shorts...`);
await pool(handles, 6, async (handle) => {
  try {
    let channelId = lib.channels[handle];
    if (!channelId) {
      channelId = await resolveHandle(handle);
      if (!channelId) {
        console.warn(`  ! ${handle}: channel not found, skipping`);
        return;
      }
      lib.channels[handle] = channelId;
    }
    const shorts = await fetchChannelShorts(channelId, handle);
    let n = 0;
    for (const v of shorts) if (upsertVideo(lib, v) === "added") n++;
    added += n;
    stats.push(`${handle}: ${shorts.length} shorts (${n} new)`);
  } catch (err) {
    console.warn(`  ! ${handle}: ${err.message}`);
  }
});
stats.sort().forEach((s) => console.log(`  ${s}`));

if (process.env.YOUTUBE_API_KEY) {
  const queries = topics.flatMap((t) => t.searches);
  console.log(`\nSearching YouTube for ${queries.length} queries (~${queries.length * 101} quota units)...`);
  for (const q of queries) {
    try {
      const found = await searchShorts(q, process.env.YOUTUBE_API_KEY);
      let n = 0;
      for (const v of found) if (upsertVideo(lib, v) === "added") n++;
      added += n;
      console.log(`  "${q}": ${found.length} shorts (${n} new)`);
    } catch (err) {
      console.warn(`  ! "${q}": ${err.message}`);
      if (/quota/i.test(err.message)) break;
    }
  }
} else {
  console.log("\n(No YOUTUBE_API_KEY: skipping search. Channel feeds only.)");
}

let quick = 0;
for (const v of Object.values(lib.videos)) {
  if (!v.score) {
    v.score = heuristicScore(v, topics);
    quick++;
  }
}
saveLibrary(lib);
console.log(`\nDone. ${added} new videos, ${Object.keys(lib.videos).length} in library. ${quick} got a quick score; run "npm run score" for Claude scoring.`);
