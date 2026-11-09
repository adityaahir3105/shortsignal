# ShortSignal

A HackerTube-style feed for **short** AI videos. It collects YouTube Shorts and Instagram Reels about Claude, AI tools, agents and how LLMs work. Claude scores each one for depth, hype and freshness. You get **10 good ones a day** instead of an endless scroll.

## Run it

```bash
npm install
npm run fetch      # pull Shorts from ~30 AI channels (no keys needed)
npm start          # http://localhost:5173
```

Optional keys go in `.env` (copy `.env.example`):

| Key | What it adds |
|---|---|
| `ANTHROPIC_API_KEY` | Claude scores every video (depth, hype, freshness), writes a one-line takeaway and a "Try this" action, and groups near-duplicates. Run `npm run score`. Without it, a keyword scorer is used. |
| `YOUTUBE_API_KEY` | Search-based discovery across all creators, not just the channel list. Uses ~1,200 of your 10,000 free daily quota units per `npm run fetch`. |

Daily refresh: `npm run refresh` (fetch + score). You can schedule it with Windows Task Scheduler or cron.

## Where videos come from

1. **YouTube channel RSS feeds** (no key). Each channel in [config/channels.json](config/channels.json) has a public feed of its latest 15 uploads. Shorts are linked as `/shorts/`, so only those are kept. Add your favourite creators there.
2. **YouTube search** (with `YOUTUBE_API_KEY`). Queries come from [config/topics.json](config/topics.json). Videos are filtered to 3 minutes or less.
3. **Your Instagram saves and likes.** Instagram has no feed API, so the app uses your own data export:
   Instagram → Settings → Accounts Center → Your information and permissions → Download your information → **JSON** format, with "Saved" and "Likes" selected. Unzip it, then run:
   ```bash
   npm run import:instagram -- "C:\path\to\instagram-export"
   ```
   They appear under **Your IG saves**, oldest first, and up to 2 a day are mixed into Today's 10 so old saves actually get watched.
4. **+ Add**: paste any YouTube or Instagram link, with an optional note on what it covers (so Instagram reels can be scored).

## How the feed works

- **Score** = depth × 2 − hype + freshness + your topic weight + a little for views and recency.
- **Teach me more** raises that topic's weight. **Knew this** hides the video and lowers the weight a bit. **Skip** hides it. **Save** keeps it under Saved.
- **Near-duplicates collapse**: 10 videos about the same launch become one card, marked "+9 similar".
- **Today's 10** is picked once per day and stays fixed. There's an end card when you finish.
- **Thumbnails** are a frame from the middle of the video (`hq2.jpg`), not the creator's clickbait image, same as HackerTube.
- **Go deeper** opens a YouTube search for long videos (over 20 minutes) on the same topic.
- Keyboard: `↓`/`j` next, `↑`/`k` previous, `m` more, `x` knew this, `s` save.

## Files

| Path | Does |
|---|---|
| [src/youtube.js](src/youtube.js) | RSS feeds, Data API search, oEmbed |
| [src/instagram.js](src/instagram.js) | Instagram link parsing and export reader |
| [src/score.js](src/score.js) | Claude scorer (structured JSON output) and keyword fallback |
| [src/rank.js](src/rank.js) | Ranking, daily pick, duplicates, feedback |
| [src/store.js](src/store.js) | JSON file store at `data/library.json` |
| [server.js](server.js) | Small HTTP server and API |
| [public/](public/) | The vertical feed UI |

## Rules it follows

- Nothing is downloaded or re-hosted. Videos play through YouTube's and Instagram's own embed players.
- It doesn't touch your Instagram or YouTube accounts, and doesn't automate likes or follows. Your real feeds are unchanged.
- Model: `claude-opus-5-5` by default with low effort. Set `SHORTSIGNAL_MODEL=claude-haiku-5-5` in `.env` to score large batches more cheaply.

## Ideas for next

- Transcripts: score from what the video actually says, not just its title and description.
- Phone share sheet: a small PWA so "Share → ShortSignal" works from the Instagram app.
- Reddit / Hacker News as a recommendation source, the way HackerTube uses HN comments.
- Quiz cards and spaced repetition built from the takeaways.
