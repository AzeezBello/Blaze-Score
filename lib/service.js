// Provider-agnostic app logic. Runs on the server and, when no server is
// reachable (static demo), in the browser, so both paths return the same shapes.

import { predict } from './predict.js';

const TTL_MS = 60_000;

export function createService(provider) {
  const standingsCache = new Map(); // code -> { at, promise }
  const lastGood = new Map(); // code -> last table that loaded, served if the provider fails

  // One provider call per league per minute, shared by every concurrent caller:
  // a day's predictions ask for the same table once per match, so the promise
  // itself is cached, not just the settled value.
  function standings(code) {
    const hit = standingsCache.get(code);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = provider.standings(code).then(
      (value) => { lastGood.set(code, value); return value; },
      () => { standingsCache.delete(code); return lastGood.get(code) ?? null; }, // failed: keep the old table, retry next call
    );
    standingsCache.set(code, { at: Date.now(), promise });
    return promise;
  }

  function leagueAverage(table) {
    const played = table.reduce((s, r) => s + r.played, 0);
    const goals = table.reduce((s, r) => s + r.gf, 0);
    return played > 0 ? goals / played : 1.35;
  }

  async function predictionFor(match) {
    const st = await standings(match.league.code);
    const table = st?.table ?? [];
    const empty = { gf: 0, ga: 0, played: 0, form: '', position: null, points: null };
    const rowOf = (id) => table.find((r) => r.team.id === id) ?? empty;
    const h = rowOf(match.home.id);
    const a = rowOf(match.away.id);
    const p = predict(h, a, leagueAverage(table));
    const confidence = Math.max(p.probabilities.home, p.probabilities.draw, p.probabilities.away);
    return {
      ...p,
      confidence,
      form: { home: h.form, away: a.form },
      position: { home: h.position ?? null, away: a.position ?? null },
      trends: trendsFor(match, p, h, a),
      model: 'poisson-v1',
    };
  }

  async function predictions(date) {
    const list = await provider.listMatches(date);
    return Promise.all(list.map(async (m) => ({ ...m, prediction: await predictionFor(m) })));
  }

  // StatArea-style "tips of the day": the strongest model edge per market among
  // matches that have not kicked off. Same data as /predictions, ranked.
  async function tips(date) {
    const list = await predictions(date);
    const open = list.filter((m) => m.status === 'SCHEDULED');
    const makeTip = (m, market, label, pct) => ({ market, label, pct, match: { id: m.id, league: m.league, utcDate: m.utcDate, home: m.home, away: m.away } });
    const all = [];
    for (const m of open) {
      const p = m.prediction, pr = p.probabilities;
      const homeSide = pr.home >= pr.away;
      all.push(makeTip(m, '1X2', `${homeSide ? m.home.name : m.away.name} to win`, homeSide ? pr.home : pr.away));
      all.push(makeTip(m, 'DC', `${homeSide ? m.home.name : m.away.name} or draw`, homeSide ? p.doubleChance.homeOrDraw : p.doubleChance.awayOrDraw));
      all.push(p.over25 >= 50 ? makeTip(m, 'OU', 'Over 2.5 goals', p.over25) : makeTip(m, 'OU', 'Under 2.5 goals', 100 - p.over25));
      all.push(p.btts >= 50 ? makeTip(m, 'BTTS', 'Both teams to score', p.btts) : makeTip(m, 'BTTS', 'Not both to score', 100 - p.btts));
    }
    const top = (market, n) => all.filter((t) => t.market === market).sort((a, b) => b.pct - a.pct).slice(0, n);
    return { date, count: open.length, sections: [
      { key: '1X2', title: 'Match result', tips: top('1X2', 5) },
      { key: 'DC', title: 'Double chance', tips: top('DC', 5) },
      { key: 'OU', title: 'Goals over/under 2.5', tips: top('OU', 5) },
      { key: 'BTTS', title: 'Both teams to score', tips: top('BTTS', 5) },
    ] };
  }

  return {
    providerName: provider.name,
    leagues: () => provider.leagues(),
    matches: (date) => provider.listMatches(date),
    standings,
    predictions,
    tips,

    async match(id) {
      const m = await provider.getMatch(id);
      if (!m) return null;
      const [prediction, h2h] = await Promise.all([
        predictionFor(m),
        provider.headToHead(m).catch(() => []),
      ]);
      return { ...m, prediction, h2h };
    },
  };
}

function trendsFor(match, p, h, a) {
  const out = [];
  const wins = (f) => (f.match(/W/g) ?? []).length;
  const losses = (f) => (f.match(/L/g) ?? []).length;
  for (const [row, team] of [[h, match.home], [a, match.away]]) {
    if (row.form.length === 5) {
      if (wins(row.form) >= 4) out.push(`${team.name} won ${wins(row.form)} of their last 5`);
      else if (losses(row.form) >= 4) out.push(`${team.name} lost ${losses(row.form)} of their last 5`);
      else if (!row.form.includes('L')) out.push(`${team.name} unbeaten in their last 5`);
    }
  }
  if (p.over25 >= 60) out.push(`Over 2.5 goals looks likely (${p.over25}%)`);
  else if (p.over25 <= 40) out.push(`Under 2.5 goals looks likely (${100 - p.over25}%)`);
  if (p.btts >= 58) out.push(`Both teams to score (${p.btts}%)`);
  else if (p.btts <= 40) out.push(`At least one clean sheet likely (${100 - p.btts}%)`);
  const { home, away } = p.probabilities;
  if (home >= 55) out.push(`${match.home.name} to win (${home}%)`);
  else if (away >= 55) out.push(`${match.away.name} to win (${away}%)`);
  return out;
}
