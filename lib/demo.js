// Demo data provider: deterministic fixtures that "play" in real time, so the
// whole app can be used without an API key. Swap for a real provider via env.

const LEAGUES = [
  { code: 'PL', name: 'Premier League', country: 'England', teams: ['Arsenal', 'Aston Villa', 'Chelsea', 'Liverpool', 'Man City', 'Man United', 'Newcastle', 'Tottenham', 'Brighton', 'West Ham'] },
  { code: 'PD', name: 'La Liga', country: 'Spain', teams: ['Barcelona', 'Real Madrid', 'Atletico Madrid', 'Sevilla', 'Valencia', 'Villarreal', 'Real Betis', 'Athletic Club'] },
  { code: 'SA', name: 'Serie A', country: 'Italy', teams: ['Inter', 'Juventus', 'AC Milan', 'Napoli', 'Roma', 'Lazio', 'Atalanta', 'Fiorentina'] },
  { code: 'BL1', name: 'Bundesliga', country: 'Germany', teams: ['Bayern', 'Dortmund', 'Leverkusen', 'Leipzig', 'Frankfurt', 'Stuttgart', 'Freiburg', 'Wolfsburg'] },
  { code: 'FL1', name: 'Ligue 1', country: 'France', teams: ['PSG', 'Marseille', 'Monaco', 'Lyon', 'Lille', 'Nice', 'Lens', 'Rennes'] },
  { code: 'CL', name: 'Champions League', country: 'Europe', teams: ['Benfica', 'Porto', 'Ajax', 'Celtic', 'Galatasaray', 'PSV', 'Sporting CP', 'Club Brugge'] },
];

const SLOTS_MIN = [11 * 60 + 30, 12 * 60 + 30, 14 * 60, 15 * 60 + 30, 17 * 60, 19 * 60, 20 * 60 + 45];

// small seeded PRNG (mulberry32) + string hash
function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const short = (n) => n.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').padEnd(3, n[1] || 'X').slice(0, 3).toUpperCase();
const teamId = (leagueCode, name) => hash(leagueCode + name) % 100000;

function strength(leagueCode, name) {
  return 0.6 + rng(hash('str' + leagueCode + name))() * 1.0; // 0.6 - 1.6
}

function dayStart(dateStr) {
  return Date.parse(dateStr + 'T00:00:00Z');
}

// Demo only: shift today's fixtures so a match is always ~25 minutes in when
// the app starts, whatever the time of day. Stable for the life of the process.
// "Today" is both the UTC date and the server's local date, because the browser
// asks for its local date. The shift anchors on the day's median kickoff, so it
// works whichever slots that day's fixtures happen to use.
const LOAD_TIME = Date.now();
const now = new Date(LOAD_TIME);
const TODAYS = new Set([now.toISOString().slice(0, 10), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`]);
const shifts = new Map();
function shiftFor(dateStr) {
  if (!TODAYS.has(dateStr)) return 0;
  if (!shifts.has(dateStr)) {
    shifts.set(dateStr, 0); // build the unshifted day first (buildDay calls back into shiftFor)
    const kickoffs = buildDay(dateStr).map((m) => m.kickoff).sort((a, b) => a - b);
    const anchor = kickoffs[Math.floor(kickoffs.length / 2)];
    shifts.set(dateStr, anchor ? LOAD_TIME - 25 * 60000 - anchor : 0);
  }
  return shifts.get(dateStr);
}

function buildDay(dateStr) {
  const out = [];
  const r = rng(hash('day' + dateStr));
  // pick 4-6 leagues' worth of fixtures per day, 2-3 matches each
  let slot = 0;
  for (const lg of LEAGUES) {
    if (r() < 0.2) continue;
    const pool = [...lg.teams].sort(() => r() - 0.5);
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n && pool.length >= 2; i++) {
      const home = pool.pop();
      const away = pool.pop();
      const idx = out.length;
      const kickoff = dayStart(dateStr) + SLOTS_MIN[(slot++ + Math.floor(r() * 3)) % SLOTS_MIN.length] * 60000 + shiftFor(dateStr);
      const mr = rng(hash(`m${dateStr}${lg.code}${home}${away}`));
      const sh = strength(lg.code, home) * 1.1;
      const sa = strength(lg.code, away);
      const goals = [];
      // Knuth's Poisson sampler, capped at 6 goals a side.
      const nGoals = (s) => {
        const lam = 1.3 * s;
        let k = 0, L = Math.exp(-lam), p = 1;
        do { k++; p *= mr(); } while (p > L && k < 7);
        return k - 1;
      };
      const gh = nGoals(sh);
      const ga = nGoals(sa);
      for (let g = 0; g < gh; g++) goals.push({ side: 'home', minute: 1 + Math.floor(mr() * 90) });
      for (let g = 0; g < ga; g++) goals.push({ side: 'away', minute: 1 + Math.floor(mr() * 90) });
      goals.sort((a, b) => a.minute - b.minute);
      const cards = [];
      const nCards = Math.floor(mr() * 5);
      for (let c = 0; c < nCards; c++) cards.push({ side: mr() < 0.5 ? 'home' : 'away', minute: 5 + Math.floor(mr() * 85), card: mr() < 0.06 ? 'red' : 'yellow' });
      cards.sort((a, b) => a.minute - b.minute);
      out.push({
        cards,
        str: { home: sh, away: sa },
        id: `d-${dateStr}-${idx}`,
        league: { code: lg.code, name: lg.name, country: lg.country },
        kickoff,
        home: { id: teamId(lg.code, home), name: home, short: short(home) },
        away: { id: teamId(lg.code, away), name: away, short: short(away) },
        goals,
      });
    }
  }
  return out;
}

function materialize(m, now = Date.now()) {
  const elapsed = Math.floor((now - m.kickoff) / 60000);
  let status = 'SCHEDULED', minute = null;
  // 45 + 15 break + 45 (+ short stoppage)
  if (elapsed >= 0 && elapsed < 112) {
    status = 'LIVE';
    minute = elapsed <= 45 ? Math.max(1, elapsed) : elapsed <= 60 ? 45 : Math.min(90, elapsed - 15);
  } else if (elapsed >= 112) {
    status = 'FINISHED';
  }
  const played = status === 'FINISHED' ? 91 : minute ?? 0;
  const seen = m.goals.filter((g) => g.minute <= played);
  const score = {
    home: seen.filter((g) => g.side === 'home').length,
    away: seen.filter((g) => g.side === 'away').length,
  };
  const halftime = status === 'LIVE' && elapsed > 45 && elapsed <= 60;
  return {
    id: m.id,
    league: m.league,
    utcDate: new Date(m.kickoff).toISOString(),
    status,
    minute,
    halftime,
    home: m.home,
    away: m.away,
    score: status === 'SCHEDULED' ? { home: null, away: null } : score,
    events: [
      ...seen.map((g) => ({ type: 'goal', minute: g.minute, team: g.side, player: playerName(m, g) })),
      ...m.cards.filter((c) => c.minute <= played).map((c) => ({ type: c.card, minute: c.minute, team: c.side, player: playerName(m, c) })),
    ].sort((a, b) => a.minute - b.minute),
    stats: status === 'SCHEDULED' ? null : matchStats(m, played, score),
  };
}

// Plausible, deterministic team stats that grow with the match clock.
function matchStats(m, played, score) {
  const r = rng(hash('st' + m.id));
  const t = Math.min(1, played / 90);
  const share = m.str.home / (m.str.home + m.str.away);
  const poss = Math.round(100 * (0.5 + (share - 0.5) * 0.6 + (r() - 0.5) * 0.06));
  const shots = (side, k) => Math.max(side === 'home' ? score.home : score.away, Math.round((6 + r() * 10) * k * t));
  const sh = shots('home', share + 0.4), sa = shots('away', 1.4 - share);
  const on = (s, g) => Math.max(g, Math.round(s * (0.3 + r() * 0.2)));
  const pair = (a, b) => ({ home: a, away: b });
  return {
    possession: pair(poss, 100 - poss),
    shots: pair(sh, sa),
    shotsOnTarget: pair(on(sh, score.home), on(sa, score.away)),
    corners: pair(Math.round(share * 8 * t + r() * 2), Math.round((1 - share) * 8 * t + r() * 2)),
    fouls: pair(Math.round((8 + r() * 6) * t), Math.round((8 + r() * 6) * t)),
    yellowCards: pair(m.cards.filter((c) => c.card === 'yellow' && c.side === 'home' && c.minute <= played).length, m.cards.filter((c) => c.card === 'yellow' && c.side === 'away' && c.minute <= played).length),
  };
}

const FIRST = ['A.', 'J.', 'M.', 'L.', 'D.', 'R.', 'K.', 'S.', 'T.', 'P.'];
const LAST = ['Silva', 'Costa', 'Martins', 'Rossi', 'Muller', 'Okafor', 'Diallo', 'Garcia', 'Novak', 'Haaland', 'Kane', 'Moreau', 'Santos', 'Ibrahim'];
function playerName(m, g) {
  const r = rng(hash(m.id + g.side + g.minute));
  return FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)];
}

function standingsFor(code) {
  const lg = LEAGUES.find((l) => l.code === code);
  if (!lg) return null;
  const played = 8;
  const rows = lg.teams.map((name) => {
    const r = rng(hash('tbl' + code + name));
    const s = strength(code, name);
    const gf = Math.round(played * 1.3 * s * (0.85 + r() * 0.3));
    const ga = Math.round(played * 1.3 * (2.2 - s) * (0.85 + r() * 0.3));
    const wins = Math.min(played, Math.max(0, Math.round((s - 0.5) * 5 + r() * 2)));
    const draws = Math.min(played - wins, Math.floor(r() * 3));
    const losses = played - wins - draws;
    const form = Array.from({ length: 5 }, () => {
      const x = r() * played;
      return x < wins ? 'W' : x < wins + draws ? 'D' : 'L';
    }).join('');
    return { team: { id: teamId(code, name), name, short: short(name) }, played, won: wins, drawn: draws, lost: losses, gf, ga, gd: gf - ga, points: wins * 3 + draws, form };
  });
  rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  rows.forEach((r, i) => (r.position = i + 1));
  return { league: { code: lg.code, name: lg.name, country: lg.country }, table: rows };
}

export const demoProvider = {
  name: 'demo',
  async leagues() {
    return LEAGUES.map(({ code, name, country }) => ({ code, name, country }));
  },
  async listMatches(dateStr) {
    return buildDay(dateStr).map((m) => materialize(m));
  },
  async getMatch(id) {
    const mm = /^d-(\d{4}-\d{2}-\d{2})-(\d+)$/.exec(id);
    if (!mm) return null;
    const day = buildDay(mm[1]);
    const m = day[Number(mm[2])];
    return m ? materialize(m) : null;
  },
  async standings(code) {
    return standingsFor(code);
  },
  async headToHead(match) {
    const r = rng(hash('h2h' + match.home.id + match.away.id));
    const list = [];
    for (let i = 0; i < 5; i++) {
      const hg = Math.floor(r() * 4), ag = Math.floor(r() * 3);
      const flip = r() < 0.5;
      const d = new Date(Date.now() - (i + 1) * 1000 * 60 * 60 * 24 * (90 + Math.floor(r() * 120)));
      list.push({
        date: d.toISOString().slice(0, 10),
        home: flip ? match.away.name : match.home.name,
        away: flip ? match.home.name : match.away.name,
        score: { home: flip ? ag : hg, away: flip ? hg : ag },
      });
    }
    return list;
  },
};
