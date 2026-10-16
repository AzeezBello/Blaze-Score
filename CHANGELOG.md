# Changelog

## 0.2.1 (2026-10-13)

Verified against the live football-data.org API with a real key.

### Fixed
- The provider asked for `dateFrom=D&dateTo=D`, which the API treats as an empty window (`dateTo` is exclusive), so every day came back with no matches. It now asks for D..D+1.
- The free tier sends no form data, so the "Form, last 5" section and the tables' Form column now hide themselves instead of rendering empty.
- The demo's guaranteed live match anchored on one fixed kickoff slot that some days' fixtures never use, which made a test flaky around midnight UTC. It now anchors on the day's median kickoff, and treats both the UTC and the server's local date as "today".

### Added
- `.env` support with no dependencies: put `FOOTBALL_DATA_KEY=...` in a git-ignored `.env` and `npm start` picks it up.
- `npm run check` calls the real API with your key and prints today's matches, a standings table and the remaining request budget.

## 0.2.0 (2026-10-13)

### Fixed
- League positions read "1st, 2nd, 3rd" instead of "1th, 2th, 3th".
- The API rejected `2026-02-30x` but accepted `2026-02-30`, which silently became 2 March. Impossible dates now return 400.
- "Today" is now the user's local date. Users west of UTC used to be shown tomorrow's fixtures in the evening.
- A day's predictions fired one standings request per match before the cache filled. The service now caches the in-flight promise, so each league table loads once.
- The service worker was cache-first for HTML, so a new deploy could run old JavaScript against new markup until the second load. Static files are now network-first with an offline fallback.
- Picks note explains that a pick can still be changed until kickoff.

### Added
- Theme switch (system, light, dark) in the header, applied before first paint so there is no flash.
- Refresh button in the header.
- Day strip walks week by week in either direction, shows the month, marks today, and offers a "Today" shortcut when you are elsewhere.
- Half-time and full-time markers with the score in the match timeline.
- "Back" on a match page returns to the screen you came from (Predictions, Tips, My picks), and lists restore your scroll position.
- Match tabs live in the URL (`#/match/<id>/predict`), so a prediction or head-to-head view can be shared and survives reload.
- Keyboard: arrow keys move along tabs, filter chips and the day strip; a skip link jumps to content; a silent refresh keeps focus on the control you were using.
- Live filter chip pulses when matches are in play; empty states explain each filter.
- Header fits 320px phones: the alerts control becomes a bell icon below 480px and the brand drops its second word below 400px, so no page ever scrolls sideways. Verified in headless Chrome with device emulation at 320, 360, 390 and 480 in both colour schemes.
- A missing match or league offers a link back to Scores instead of a retry button.
- Security headers on every response, including a Content Security Policy that only allows same-origin scripts. Repeated in `vercel.json` for statically served files.
- Static files get weak ETags and answer `304 Not Modified`; text responses are gzipped for clients that accept it (left to Vercel's edge when deployed there).
- CDN cache hints on API responses (`s-maxage`) so the football-data.org request budget survives multiple serverless instances.
- football-data.org: only the shown leagues are requested, and the API's own match clock is used when present.
- `npm run dev` restarts the server on file changes.
- Ten more tests: helpers, standings dedupe and fallback, cache headers, security headers, ETag, gzip, HEAD, served modules.

### Changed
- Tips and predictions share one code path in the service; `tips` no longer depends on `this`.
- Stylesheet tidied: colour tokens for cards and toasts in both themes, hover states only on devices that hover, reduced-motion covers every animation.
