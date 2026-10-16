// Poisson-based match prediction from simple attack/defence strength.

const MAX_GOALS = 8;

function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/**
 * ratings: { gf, ga, played } per team (season goals for/against, games played)
 * leagueAvg: average goals per team per game in the league
 */
export function predict(home, away, leagueAvg = 1.35) {
  // Shrink small samples toward the league average: after 8 games a team's raw
  // goals-per-game is mostly noise, so blend in PRIOR_GAMES of "average" games.
  const PRIOR_GAMES = 4;
  const per = (x, n) => (x + leagueAvg * PRIOR_GAMES) / (n + PRIOR_GAMES);
  const hAtt = per(home.gf, home.played) / leagueAvg;
  const hDef = per(home.ga, home.played) / leagueAvg;
  const aAtt = per(away.gf, away.played) / leagueAvg;
  const aDef = per(away.ga, away.played) / leagueAvg;

  const HOME_ADV = 1.12;
  const lamH = Math.max(0.2, leagueAvg * hAtt * aDef * HOME_ADV);
  const lamA = Math.max(0.2, leagueAvg * aAtt * hDef / HOME_ADV);

  let pH = 0, pD = 0, pA = 0, over25 = 0, btts = 0;
  let best = { p: 0, h: 0, a: 0 };
  const scores = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(lamH, h) * poissonPmf(lamA, a);
      scores.push({ h, a, p });
      if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
      if (h + a > 2) over25 += p;
      if (h > 0 && a > 0) btts += p;
      if (p > best.p) best = { p, h, a };
    }
  }
  const total = pH + pD + pA;
  const pct = (x) => Math.round((x / total) * 100);
  let home1 = pct(pH), draw = pct(pD), away1 = pct(pA);
  // keep the rounded numbers summing to 100
  draw += 100 - (home1 + draw + away1);

  const pick = home1 >= draw && home1 >= away1 ? '1' : away1 >= draw ? '2' : 'X';
  const oddsOf = (p) => (p > 0 ? +(100 / p).toFixed(2) : 99.0);
  return {
    probabilities: { home: home1, draw, away: away1 },
    odds: { home: oddsOf(home1), draw: oddsOf(draw), away: oddsOf(away1) },
    expectedGoals: { home: +lamH.toFixed(2), away: +lamA.toFixed(2) },
    likelyScore: { home: best.h, away: best.a },
    topScores: scores.sort((x, y) => y.p - x.p).slice(0, 3).map((s) => ({ home: s.h, away: s.a, pct: +((s.p / total) * 100).toFixed(1) })),
    doubleChance: { homeOrDraw: Math.min(100, home1 + draw), awayOrDraw: Math.min(100, away1 + draw), homeOrAway: Math.max(0, 100 - draw) },
    over25: pct(over25),
    btts: pct(btts),
    pick,
  };
}
