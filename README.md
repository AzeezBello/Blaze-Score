# Blaze Score

Ad-free live soccer scores, league tables, a Poisson prediction model with StatArea-style tips, and a local "beat the model" pick game. A progressive web app with no framework, no build step and no runtime dependencies.

    npm test                               # 29 checks, no network needed
    npm run dev                            # http://127.0.0.1:3000 on demo data, restarts on file changes
    FOOTBALL_DATA_KEY=xxxx npm start       # real data (free key at football-data.org)

## Live data

1. Get a free key at https://www.football-data.org/client/register (the free tier covers the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the Champions League at 10 requests a minute).
2. Put it in a `.env` file in the project root (git-ignored):

        FOOTBALL_DATA_KEY=your-key-here

3. `npm run check` calls the real API with that key and prints today's matches, the first standings table and the requests you have left. If it says the key was rejected, nothing else will work.
4. `npm start`. The pill in the header reads "Live" instead of "Demo".

## What it does

- **Scores**: a day's fixtures grouped by league, live minute, goals and cards, filters for live / upcoming / finished / followed teams. The day strip walks week by week with a "Today" shortcut.
- **Match page**: timeline with half-time and full-time markers, team stats, prediction, head to head. Follow a team to get goal toasts (and browser notifications while the tab is in the background).
- **Predictions and Tips**: win / draw / loss probabilities, expected goals, most likely scorelines, double chance, over 2.5 and both-teams-to-score, with the strongest edges ranked per market.
- **Tables**: standings per league with form and promotion / relegation zones.

## API Endpoints

- `GET /api/health` – health check.
- `GET /api/leagues` – list supported leagues.
- `GET /api/matches` – upcoming and live matches (optional `provider` query).
- `GET /api/predictions` – model predictions for matches (includes `odds` when enabled).
- `GET /api/tips` – suggested tips per match.
- `GET /api/standings/:code` – league table for the given league code.
- `GET /api/matches/:id` – detailed match data.
- **My picks**: pick 1, X or 2 before kickoff and track your record against the model. Stored in the browser only.
- **Theme**: follows the system by default; the header button switches to light or dark without a flash on reload.

## How it is built

    server.js            HTTP server and JSON API (also the Vercel function via api/[...path].js)
    lib/service.js       provider-agnostic app logic: predictions, tips, standings cache
    lib/predict.js       Poisson goal model
    lib/footballdata.js  football-data.org v4 provider (server only, so the key never reaches a browser)
    lib/demo.js          deterministic demo fixtures that play out in real time
    lib/format.js        date and ordinal helpers shared by server, browser and tests
    public/              the PWA: app.js (views and routing), styles.css, sw.js, theme.js

The browser imports the same `lib/` modules as the server, so when no API is reachable (plain static hosting) it runs the demo provider locally and every screen still works.

The API caches upstream calls in memory and asks the CDN to cache list responses for 30 seconds and tables for 5 minutes. On Vercel this keeps football-data.org's free tier (10 requests per minute) safe even when several serverless instances are running. Static files carry ETags and are gzipped when the client accepts it.

## Deploy (Vercel)

    npx vercel --prod

Then add `FOOTBALL_DATA_KEY` under Project Settings > Environment Variables and redeploy. Without it the app runs on demo data. Check `/api/health` after adding a real key: the football-data.org provider is tested against a stubbed API only.

## Limits

- Goal alerts only fire while the app is open. There is no push server.
- The football-data.org free tier sends no match clock for most matches, so the live minute is estimated from kickoff. Scores can lag the broadcast by a minute or two.
- Picks live in `localStorage`. A shared leaderboard would need accounts and a database.

## New UI Features

- **Search bar** – Quickly find teams, matches, or leagues.
- **Odds toggle** – Switch between percentage probabilities and decimal odds.
- **Lineups panel** – View starting lineups and substitutes for each match.
- **Team crests** – Team logos displayed using external crest domains (e.g., `https://crests.football-data.org`).
- **Provider modal** – Choose data provider (football-data.org, ESPN, Demo) and toggle sound/odds mode at runtime.
- **Streaks** – Visual indication of winning/losing streaks on the predictions view.
- **Sortable tables** – Click column headers to sort standings and fixtures.
- **Pick system** – Make a pre‑kickoff pick (1, X, 2); picks are stored locally in `localStorage`.

## Configuration Options

- `DATA_PROVIDER` (env var) – Set to `football-data`, `espn`, or `demo` to select the default data source. Can also be changed via the Provider modal.
- `ODDS_MODE` – When enabled, the odds toggle displays decimal odds instead of win‑draw‑loss percentages.
- `SOUND_CHIME` – Enable/disable goal sound notifications.
- `FOOTBALL_DATA_KEY` – Required for the football‑data.org provider; place in a `.env` file.

## API Enhancements

- All endpoints now accept an optional `provider` query parameter to override the default data source (e.g., `/api/matches?provider=espn`).
- Odds are included in the prediction payload as a `odds` field (decimal odds).

## Development Notes

- Updated Content Security Policy (CSP) headers to allow crest image domains (`https://crests.football-data.org`) and ESPN assets (`https://a.espncdn.com`).
- The server now supports the ESPN provider (`lib/espn.js`) and selects the provider based on the `DATA_PROVIDER` env var or UI selection.

## Testing

- New tests cover the ESPN provider and decimal odds output (`test/smoke.js`). Run `npm test` to verify all functionality.
# Blaze-Score
