// football-data.org v4 provider (free tier: 12 competitions, 10 requests/min,
// scores can lag). Runs ONLY on the server so the API key never reaches a browser.
//
// Verified against the live API (October 2026). Quirks worth knowing:
//   - dateTo is exclusive: dateFrom=D&dateTo=D returns nothing, so ask for D..D+1.
//   - the free tier sends no `form` in standings and usually no `minute`.
// `npm run check` exercises all of this with your key.

import { addDays } from './format.js';

const BASE = 'https://api.football-data.org/v4';

export const DEFAULT_LEAGUES = [
  { code: 'PL', name: 'Premier League', country: 'England' },
  { code: 'PD', name: 'La Liga', country: 'Spain' },
  { code: 'SA', name: 'Serie A', country: 'Italy' },
  { code: 'BL1', name: 'Bundesliga', country: 'Germany' },
  { code: 'FL1', name: 'Ligue 1', country: 'France' },
  { code: 'CL', name: 'Champions League', country: 'Europe' },
];

export const ALL_FREE_LEAGUES = [
  ...DEFAULT_LEAGUES,
  { code: 'ELC', name: 'Championship', country: 'England' },
  { code: 'DED', name: 'Eredivisie', country: 'Netherlands' },
  { code: 'PPL', name: 'Primeira Liga', country: 'Portugal' },
  { code: 'BSA', name: 'Brasileirão Série A', country: 'Brazil' },
  { code: 'WC', name: 'World Cup', country: 'World' },
  { code: 'EC', name: 'European Championship', country: 'Europe' },
];

export function createFootballDataProvider(apiKey, activeLeagues = DEFAULT_LEAGUES) {
  const cache = new Map(); // url -> { at, ttl, promise }
  const lastGood = new Map(); // url -> last successful body, served if upstream fails
  const LEAGUES = activeLeagues;

  // Cache + de-duplicate in-flight calls: the free tier allows 10 requests/min,
  // so every browser refresh must be served from here, not forwarded.
  // If upstream errors (rate limit, outage) we serve the last good copy rather
  // than failing the page; first-ever failures still surface as errors.
  function get(path, ttlMs) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
    const promise = fetch(BASE + path, { headers: { 'X-Auth-Token': apiKey }, signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        if (res.status === 429) throw new Error('football-data.org rate limit reached, try again in a minute');
        if (!res.ok) throw new Error(`football-data.org responded ${res.status}`);
        const body = await res.json();
        lastGood.set(path, body);
        return body;
      })
      .catch((err) => {
        cache.delete(path); // never cache failures
        if (lastGood.has(path)) return lastGood.get(path);
        throw err;
      });
    cache.set(path, { at: Date.now(), ttl: ttlMs, promise });
    return promise;
  }

  const team = (t) => ({ id: t.id, name: t.shortName || t.name, short: t.tla || (t.name || '???').slice(0, 3).toUpperCase(), logo: t.crest || null });

  function toMatch(m) {
    const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
    const status = live ? 'LIVE' : m.status === 'FINISHED' ? 'FINISHED' : ['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(m.status) ? 'POSTPONED' : 'SCHEDULED';
    const elapsed = Math.floor((Date.now() - Date.parse(m.utcDate)) / 60000);
    const halftime = m.status === 'PAUSED';
    // Some plans send a match clock; the free tier does not, so fall back to an
    // estimate from kickoff (45 + 15 minute break + 45).
    const estimate = Math.max(1, Math.min(90, elapsed <= 45 ? elapsed : elapsed - 15));
    const minute = !live ? null : halftime ? 45 : Number.isInteger(m.minute) && m.minute > 0 ? m.minute : estimate;
    const ft = m.score?.fullTime ?? {};
    const goals = (m.goals ?? []).map((g) => ({
      type: 'goal',
      minute: g.minute,
      team: g.team?.id === m.homeTeam.id ? 'home' : 'away',
      player: g.scorer?.name ?? 'Goal',
    }));
    return {
      id: `fd-${m.id}`,
      league: { code: m.competition.code, name: m.competition.name, country: m.area?.name ?? '' },
      utcDate: m.utcDate,
      status,
      minute,
      halftime,
      home: team(m.homeTeam),
      away: team(m.awayTeam),
      score: status === 'SCHEDULED' ? { home: null, away: null } : { home: ft.home ?? 0, away: ft.away ?? 0 },
      events: goals,
      stats: null,
    };
  }

  const wanted = new Set(LEAGUES.map((l) => l.code));
  const codes = LEAGUES.map((l) => l.code).join(',');

  return {
    name: 'football-data.org',
    async leagues() { return LEAGUES; },

    async listMatches(date) {
      const data = await get(`/matches?dateFrom=${date}&dateTo=${addDays(date, 1)}&competitions=${codes}`, 30_000);
      return (data.matches ?? []).filter((m) => wanted.has(m.competition.code)).map(toMatch);
    },

    async getMatch(id) {
      const raw = String(id).replace(/^fd-/, '');
      if (!/^\d+$/.test(raw)) return null;
      const data = await get(`/matches/${raw}`, 30_000).catch(() => null);
      return data ? toMatch(data.match ?? data) : null;
    },

    async standings(code) {
      if (!wanted.has(code)) return null;
      const data = await get(`/competitions/${code}/standings`, 300_000);
      const total = (data.standings ?? []).find((s) => s.type === 'TOTAL') ?? data.standings?.[0];
      if (!total) return null;
      const league = LEAGUES.find((l) => l.code === code);
      return {
        league,
        table: total.table.map((r) => ({
          position: r.position,
          team: team(r.team),
          played: r.playedGames,
          won: r.won,
          drawn: r.draw,
          lost: r.lost,
          gf: r.goalsFor,
          ga: r.goalsAgainst,
          gd: r.goalDifference,
          points: r.points,
          form: (r.form ?? '').replace(/,/g, ''),
        })),
      };
    },

    async headToHead(match) {
      const raw = String(match.id).replace(/^fd-/, '');
      const data = await get(`/matches/${raw}/head2head?limit=5`, 3_600_000);
      return (data.matches ?? []).map((m) => ({
        date: m.utcDate.slice(0, 10),
        home: m.homeTeam.shortName || m.homeTeam.name,
        away: m.awayTeam.shortName || m.awayTeam.name,
        score: { home: m.score?.fullTime?.home ?? 0, away: m.score?.fullTime?.away ?? 0 },
      }));
    },
  };
}
