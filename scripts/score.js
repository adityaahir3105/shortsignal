// npm run score            -> Claude scores every video not yet scored by Claude
// npm run score -- --all   -> re-score everything
// npm run score -- --limit 30
import Anthropic from "@anthropic-ai/sdk";
import { loadLibrary, saveLibrary, loadConfig } from "../src/store.js";
import { claudeScoreBatch, claudeCanJudge, hasClaude, heuristicScore, MODEL } from "../src/score.js";

const args = process.argv.slice(2);
const all = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const BATCH = 15;

const lib = loadLibrary();
const { topics } = loadConfig("topics");

if (!hasClaude()) {
  let n = 0;
  for (const v of Object.values(lib.videos)) {
    if (!v.score || all) {
      v.score = heuristicScore(v, topics);
      n++;
    }
  }
  saveLibrary(lib);
  console.log(`No ANTHROPIC_API_KEY set: used the keyword scorer on ${n} videos.`);
  console.log("Add your key to .env to get Claude's depth / hype / freshness scores and takeaways.");
  process.exit(0);
}

const todo = Object.values(lib.videos)
  .filter((v) => claudeCanJudge(v) && (all || v.score?.by !== "claude"))
  .slice(0, limit);

console.log(`Scoring ${todo.length} videos with ${MODEL} in batches of ${BATCH}...`);
let done = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  try {
    const scores = await claudeScoreBatch(batch, topics);
    for (const v of batch) {
      v.score = scores[v.id] ?? v.score ?? heuristicScore(v, topics);
      if (scores[v.id]) done++;
    }
    saveLibrary(lib); // save as we go, so a failure later keeps earlier work
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Invalid Anthropic API key.");
      break;
    } else if (err instanceof Anthropic.RateLimitError) {
      console.error("Rate limited. Scored what we could; run again later.");
      break;
    } else if (err instanceof Anthropic.APIError) {
      console.error(`API error ${err.status}: ${err.message}`);
    } else {
      console.error(`Batch failed: ${err.message}`);
    }
  }
}
saveLibrary(lib);
const relevant = Object.values(lib.videos).filter((v) => v.score?.relevant).length;
console.log(`Done. Claude scored ${done}. ${relevant} videos are relevant and can appear in your feed.`);
