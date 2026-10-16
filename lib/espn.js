// ESPN public soccer API provider (100% free, zero keys required, live clock,
// detailed statistics, rosters, lineups and team crests).
// Verified against the live ESPN site API (October 2026).

export const ESPN_LEAGUES = [
  { code: 'PL', slug: 'eng.1', name: 'Premier League', country: 'England' },
  { code: 'PD', slug: 'esp.1', name: 'La Liga', country: 'Spain' },
  { code: 'SA', slug: 'ita.1', name: 'Serie A', country: 'Italy' },
  { code: 'BL1', slug: 'ger.1', name: 'Bundesliga', country: 'Germany' },
  { code: 'FL1', slug: 'fra.1', name: 'Ligue 1', country: 'France' },
  { code: 'CL', slug: 'uefa.champions', name: 'Champions League', country: 'Europe' },
  { code: 'EL', slug: 'uefa.europa', name: 'Europa League', country: 'Europe' },
  { code: 'ELC', slug: 'eng.2', name: 'Championship', country: 'England' },
  { code: 'DED', slug: 'ned.1', name: 'Eredivisie', country: 'Netherlands' },
  { code: 'MLS', slug: 'usa.1', name: 'MLS', country: 'USA' },
  { code: 'LMX', slug: 'mex.1', name: 'Liga MX', country: 'Mexico' },
];

const SLUG_TO_LEAGUE = new Map(ESPN_LEAGUES.map((l) => [l.slug, l]));
const CODE_TO_LEAGUE = new Map(ESPN_LEAGUES.map((l) => [l.code, l]));

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB_BASE = 'https://site.web.api.espn.com/apis/v2/sports/soccer';

export function createEspnProvider() {
  const cache = new Map(); // url -> { at, ttl, promise }
  const lastGood = new Map(); // url -> last successful body

  function get(url, ttlMs = 30_000) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
    const promise = fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
        const body = await res.json();
        lastGood.set(url, body);
        return body;
      })
      .catch((err) => {
        cache.delete(url);
        if (lastGood.has(url)) return lastGood.get(url);
        throw err;
      });
    cache.set(url, { at: Date.now(), ttl: ttlMs, promise });
    return promise;
  }

  function parseTeam(c) {
    const t = c.team || {};
    const name = t.name || t.displayName || 'Unknown';
    const short = t.abbreviation || t.shortDisplayName || name.slice(0, 3).toUpperCase();
    const logo = t.logo || t.logos?.[0]?.href || null;
    return { id: String(t.id || name), name, short, logo };
  }

  function parseStatus(st) {
    const type = st?.type || {};
    const state = type.state; // 'pre' | 'in' | 'post'
    const name = type.name || '';
    if (name.includes('POSTPONED') || name.includes('CANCELLED') || name.includes('SUSPENDED')) {
      return { status: 'POSTPONED', minute: null, halftime: false };
    }
    if (state === 'post' || type.completed) {
      return { status: 'FINISHED', minute: null, halftime: false };
    }
    if (state === 'in') {
      const isHT = type.description === 'Halftime' || name === 'STATUS_HALFTIME';
      let minute = 45;
      if (st.displayClock) {
        const m = parseInt(st.displayClock, 10);
        if (Number.isFinite(m) && m > 0) minute = m;
      } else if (Number.isFinite(st.clock) && st.clock > 0) {
        minute = Math.min(90, Math.floor(st.clock / 60));
      }
      return { status: 'LIVE', minute: isHT ? 45 : minute, halftime: isHT };
    }
    return { status: 'SCHEDULED', minute: null, halftime: false };
  }

  function eventToMatch(e, league) {
    const comp = e.competitions?.[0] || {};
    const homeComp = comp.competitors?.find((c) => c.homeAway === 'home') || comp.competitors?.[0] || {};
    const awayComp = comp.competitors?.find((c) => c.homeAway === 'away') || comp.competitors?.[1] || {};
    const { status, minute, halftime } = parseStatus(comp.status || e.status);
    const homeScore = status === 'SCHEDULED' ? null : Number(homeComp.score ?? 0);
    const awayScore = status === 'SCHEDULED' ? null : Number(awayComp.score ?? 0);

    return {
      id: `espn-${league.code}-${e.id}`,
      league: { code: league.code, name: league.name, country: league.country },
      utcDate: e.date,
      status,
      minute,
      halftime,
      home: parseTeam(homeComp),
      away: parseTeam(awayComp),
      score: { home: homeScore, away: awayScore },
      events: [],
      stats: null,
    };
  }

  return {
    name: 'espn',
    async leagues() {
      return ESPN_LEAGUES.map(({ code, name, country }) => ({ code, name, country }));
    },

    async listMatches(dateStr) {
      const ymd = dateStr.replace(/-/g, '');
      const url = `${BASE}/scorepanel?dates=${ymd}`;
      const data = await get(url, 30_000);
      const out = [];

      for (const section of data.scores || []) {
        const slug = section.league?.slug || section.leagues?.[0]?.slug;
        const league = SLUG_TO_LEAGUE.get(slug);
        if (!league) continue;

        for (const ev of section.events || []) {
          out.push(eventToMatch(ev, league));
        }
      }

      return out;
    },

    async getMatch(id) {
      const m = /^espn-([A-Za-z0-9]+)-(\d+)$/.exec(id);
      if (!m) return null;
      const [, code, eventId] = m;
      const league = CODE_TO_LEAGUE.get(code);
      if (!league) return null;

      const url = `${BASE}/${league.slug}/summary?event=${eventId}`;
      const data = await get(url, 30_000).catch(() => null);
      if (!data) return null;

      const comp = data.header?.competitions?.[0] || {};
      const homeComp = comp.competitors?.find((c) => c.homeAway === 'home') || comp.competitors?.[0] || {};
      const awayComp = comp.competitors?.find((c) => c.homeAway === 'away') || comp.competitors?.[1] || {};
      const { status, minute, halftime } = parseStatus(comp.status);

      const home = parseTeam(homeComp);
      const away = parseTeam(awayComp);
      const homeScore = status === 'SCHEDULED' ? null : Number(homeComp.score ?? 0);
      const awayScore = status === 'SCHEDULED' ? null : Number(awayComp.score ?? 0);

      // Parse timeline events (goals, cards, substitutions)
      const events = [];
      for (const ev of data.keyEvents || []) {
        const text = ev.text || '';
        const rawType = (ev.type?.text || '').toLowerCase();
        let type = null;
        if (rawType.includes('goal') || text.toLowerCase().includes('goal')) {
          type = 'goal';
        } else if (rawType.includes('red card') || text.toLowerCase().includes('red card')) {
          type = 'red';
        } else if (rawType.includes('yellow card') || text.toLowerCase().includes('yellow card')) {
          type = 'yellow';
        } else if (rawType.includes('sub')) {
          type = 'sub';
        }
        if (!type) continue;

        let evMinute = 1;
        if (ev.clock?.displayValue) {
          const parsed = parseInt(ev.clock.displayValue, 10);
          if (Number.isFinite(parsed) && parsed > 0) evMinute = parsed;
        }

        const teamSide = text.includes(home.name) ? 'home' : text.includes(away.name) ? 'away' : 'home';
        const player = ev.participants?.[0]?.athlete?.displayName || text.split('(')[0].replace(/Goal!|Yellow Card|Red Card/g, '').trim() || 'Player';

        events.push({
          type,
          minute: evMinute,
          team: teamSide,
          player,
          detail: text,
        });
      }

      // Parse match statistics
      let stats = null;
      const boxTeams = data.boxscore?.teams || [];
      if (boxTeams.length >= 2) {
        const hStats = boxTeams.find((t) => t.team?.id === home.id || t.team?.name === home.name) || boxTeams[0];
        const aStats = boxTeams.find((t) => t.team?.id === away.id || t.team?.name === away.name) || boxTeams[1];

        const findStat = (teamStats, name) => Number(teamStats?.statistics?.find((s) => s.name === name)?.displayValue ?? 0);
        stats = {
          possession: { home: Math.round(findStat(hStats, 'possessionPct')), away: Math.round(findStat(aStats, 'possessionPct')) },
          shots: { home: findStat(hStats, 'totalShots'), away: findStat(aStats, 'totalShots') },
          shotsOnTarget: { home: findStat(hStats, 'shotsOnTarget'), away: findStat(aStats, 'shotsOnTarget') },
          corners: { home: findStat(hStats, 'wonCorners'), away: findStat(aStats, 'wonCorners') },
          fouls: { home: findStat(hStats, 'foulsCommitted'), away: findStat(aStats, 'foulsCommitted') },
          yellowCards: { home: findStat(hStats, 'yellowCards'), away: findStat(aStats, 'yellowCards') },
        };
      }

      // Parse lineups if available
      let lineups = null;
      if (data.rosters && data.rosters.length >= 2) {
        const parseRoster = (r) => ({
          formation: r.formation || '',
          starters: (r.roster || []).filter((p) => p.starter).map((p) => ({
            jersey: p.jersey || '',
            name: p.athlete?.displayName || p.athlete?.fullName || '',
            position: p.position?.abbreviation || p.position?.name || '',
          })),
          bench: (r.roster || []).filter((p) => !p.starter).map((p) => ({
            jersey: p.jersey || '',
            name: p.athlete?.displayName || p.athlete?.fullName || '',
            position: p.position?.abbreviation || p.position?.name || '',
          })),
        });
        lineups = {
          home: parseRoster(data.rosters[0]),
          away: parseRoster(data.rosters[1]),
        };
      }

      return {
        id,
        league: { code: league.code, name: league.name, country: league.country },
        utcDate: comp.date || data.header?.date || new Date().toISOString(),
        status,
        minute,
        halftime,
        home,
        away,
        score: { home: homeScore, away: awayScore },
        events,
        stats,
        lineups,
        h2hData: data.lastFiveGames || [],
      };
    },

    async standings(code) {
      const league = CODE_TO_LEAGUE.get(code);
      if (!league) return null;

      const url = `${WEB_BASE}/${league.slug}/standings`;
      const data = await get(url, 300_000);
      const entries = data.children?.[0]?.standings?.entries || data.standings?.[0]?.entries || [];
      if (!entries.length) return null;

      const table = entries.map((e) => {
        const s = (name) => Number(e.stats?.find((x) => x.name === name)?.value ?? 0);
        const t = e.team || {};
        const name = t.name || t.displayName || 'Unknown';
        const short = t.abbreviation || t.shortDisplayName || name.slice(0, 3).toUpperCase();
        const logo = t.logos?.[0]?.href || t.logo || null;

        return {
          position: s('rank') || Number(e.rank ?? 0),
          team: { id: String(t.id || name), name, short, logo },
          played: s('gamesPlayed'),
          won: s('wins'),
          drawn: s('ties'),
          lost: s('losses'),
          gf: s('pointsFor'),
          ga: s('pointsAgainst'),
          gd: s('pointDifferential'),
          points: s('points'),
          form: '', // ESPN free summary has form in team stats if needed
        };
      });

      return {
        league: { code: league.code, name: league.name, country: league.country },
        table,
      };
    },

    async headToHead(match) {
      // If match was fetched via getMatch, it carries h2hData
      if (match.h2hData && match.h2hData.length) {
        const events = match.h2hData[0]?.events || [];
        return events.slice(0, 5).map((e) => {
          const comp = e.competitors || [];
          const h = comp.find((c) => c.homeAway === 'home') || comp[0] || {};
          const a = comp.find((c) => c.homeAway === 'away') || comp[1] || {};
          return {
            date: (e.date || '').slice(0, 10),
            home: h.team?.displayName || h.team?.name || 'Home',
            away: a.team?.displayName || a.team?.name || 'Away',
            score: { home: Number(h.score ?? 0), away: Number(a.score ?? 0) },
          };
        });
      }
      return [];
    },
  };
}
