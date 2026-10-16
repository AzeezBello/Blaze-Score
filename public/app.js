// Blaze Score front end: no framework, no build step.
// Talks to /api/* when the Node server is there; otherwise runs the same
// service layer in the browser on demo data (static hosting, previews).

import { createService } from '../lib/service.js';
import { demoProvider } from '../lib/demo.js';
import { localDate, addDays, ordinal } from '../lib/format.js';

/* ---------- html templating with escaping by default ---------- */
class Raw { constructor(s) { this.s = s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v));
const html = (strs, ...vals) => new Raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? part(vals[i]) : ''), ''));
const bool = (v) => (v ? 'true' : 'false'); // ARIA state attributes must be the literal strings

/* ---------- per-viewer storage (can be blocked: always optional) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('blaze:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('blaze:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const favs = store.get('favs', {});   // teamId -> team name
const picks = store.get('picks', {}); // matchId -> { pick, model, home, away, date, league }

/* ---------- data access ---------- */
let mode = 'api';
let providerName = 'demo';
let availableProviders = [];
let local = null;

async function boot() {
  try {
    const pref = store.get('provider', null);
    const q = pref ? `?provider=${encodeURIComponent(pref)}` : '';
    const r = await fetch('/api/health' + q, { cache: 'no-store' });
    const h = r.ok ? await r.json() : null;
    if (!h?.ok) throw new Error('no api');
    providerName = h.provider;
    fetch('/api/providers')
      .then((res) => (res.ok ? res.json() : null))
      .then((p) => { if (p?.providers) availableProviders = p.providers; })
      .catch(() => {});
  } catch {
    mode = 'local';
    local = createService(demoProvider);
    providerName = 'demo';
  }
}

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(path) {
  if (mode === 'api') {
    const pref = store.get('provider', null);
    let target = path;
    if (pref) {
      const sep = target.includes('?') ? '&' : '?';
      target = `${target}${sep}provider=${encodeURIComponent(pref)}`;
    }
    const res = await fetch('/api' + target);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || 'Request failed', res.status);
    }
    return res.json();
  }
  const url = new URL(path, 'http://local');
  const date = url.searchParams.get('date') ?? todayStr();
  let m;
  let out = null;
  if (url.pathname === '/tips') out = await local.tips(date);
  else if (url.pathname === '/leagues') out = await local.leagues();
  else if (url.pathname === '/matches') out = await local.matches(date);
  else if (url.pathname === '/predictions') out = await local.predictions(date);
  else if ((m = /^\/matches\/([^/]+)$/.exec(url.pathname))) out = await local.match(m[1]);
  else if ((m = /^\/standings\/([^/]+)$/.exec(url.pathname))) out = await local.standings(m[1]);
  if (!out) throw new ApiError('Not found', 404);
  return out;
}

/* ---------- sound synthesis (zero external files) ---------- */
function playGoalChime() {
  if (!store.get('sound', false)) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch { /* audio blocked */ }
}

/* ---------- small helpers ---------- */
const todayStr = () => localDate();
const clock = (utc) => new Date(utc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const longDate = (utc) => new Date(utc).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const noon = (ymd) => new Date(ymd + 'T12:00:00Z');
const weekday = (ymd) => noon(ymd).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
const monthLabel = (ymd) => noon(ymd).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const crest = (t, lg) => {
  if (t?.logo) {
    return html`<span class="crest-wrap${lg ? ' lg' : ''}"><img class="crest-img" src="${t.logo}" alt="" loading="lazy" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline-grid'"><span class="crest${lg ? ' lg' : ''}" style="display:none;background:hsl(${hue(t.name)} 42% 36%)" aria-hidden="true">${t.short}</span></span>`;
  }
  return html`<span class="crest${lg ? ' lg' : ''}" style="background:hsl(${hue(t?.name || '???')} 42% 36%)" aria-hidden="true">${t?.short || '???'}</span>`;
};

const formDots = (f = '') => html`<span class="form" aria-label="Last five: ${f.split('').join(', ')}">${[...f].filter((c) => 'WDL'.includes(c)).map((c) => html`<i class="${c}">${c}</i>`)}</span>`;
const resultOf = (s) => (s.home > s.away ? '1' : s.home < s.away ? '2' : 'X');
const pickName = (p, m) => (p === '1' ? m.home.name : p === '2' ? m.away.name : 'Draw');
const scoreline = (s) => `${s.home}–${s.away}`;
const statusText = (m) =>
  m.status === 'LIVE' ? (m.halftime ? 'HT' : `${m.minute}'`) : m.status === 'FINISHED' ? 'FT' : m.status === 'POSTPONED' ? 'PPD' : clock(m.utcDate);

/* ---------- ui state ---------- */
const state = {
  date: todayStr(),
  filter: 'all',
  pfilter: 'upcoming',
  tab: 'summary',
  current: null,
  hasLive: false,
  search: '',
  oddsMode: store.get('oddsMode', 'pct'), // 'pct' | 'odds'
  tableSort: 'pos',
  tableSortDir: 'asc',
  pickFilter: 'all',
};
const view = document.getElementById('view');
let token = 0;

const chevron = (dir) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

function dayStrip() {
  const today = todayStr();
  const yest = addDays(today, -1);
  const tomo = addDays(today, 1);
  return html`<div class="daynav">
      <button class="iconbtn" data-act="day" data-date="${addDays(state.date, -7)}" aria-label="Previous week">${chevron(-1)}</button>
      <span class="month">${monthLabel(state.date)}</span>
      <div class="daynav-quick">
        <button class="chip small" data-act="day" data-date="${yest}">Yesterday</button>
        <button class="chip small" data-act="day" data-date="${today}">Today</button>
        <button class="chip small" data-act="day" data-date="${tomo}">Tomorrow</button>
        <label class="iconbtn date-picker-wrap" title="Jump to date" aria-label="Jump to date">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" fill="none" stroke-width="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2"/></svg>
          <input type="date" class="date-input-hidden" value="${state.date}" data-act="date-pick">
        </label>
      </div>
      <button class="iconbtn" data-act="day" data-date="${addDays(state.date, 7)}" aria-label="Next week">${chevron(1)}</button>
    </div>
    <div class="days" role="group" aria-label="Choose a day">${[-3, -2, -1, 0, 1, 2, 3].map((n) => {
      const d = addDays(state.date, n);
      const isToday = d === today;
      return html`<button class="day${isToday ? ' today' : ''}" data-act="day" data-date="${d}" aria-current="${bool(d === state.date)}" aria-label="${longDate(noon(d))}${isToday ? ', today' : ''}"><small>${isToday ? 'Today' : weekday(d)}</small><b class="num">${Number(d.slice(8))}</b></button>`;
    })}</div>`;
}

const chips = (items, current, act) =>
  html`<div class="chips" role="group">${items.map(([key, label]) => html`<button class="chip" data-act="${act}" data-f="${key}" aria-pressed="${bool(current === key)}">${label}</button>`)}</div>`;

function searchBar(count) {
  return html`<div class="search-bar" role="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
    <input type="search" placeholder="Search team or league..." value="${state.search}" data-act="search-input" aria-label="Search matches">
    ${state.search ? html`<button class="clear-btn" data-act="clear-search" aria-label="Clear search">✕</button>` : ''}
  </div>`;
}

/* ---------- views ---------- */
function matchRow(m) {
  const fav = (t) => (favs[t.id] ? html`<span class="star" aria-label="Followed">★</span>` : '');
  const done = m.status === 'FINISHED';
  const sc = (side) => {
    if (m.status === 'SCHEDULED' || m.status === 'POSTPONED') return '';
    const mine = m.score[side], other = m.score[side === 'home' ? 'away' : 'home'];
    return html`<span class="${done && mine < other ? 'muted' : 'lead'} num">${mine}</span>`;
  };
  const p = m.prediction?.probabilities;
  const prob = m.status === 'SCHEDULED' && p
    ? html`<div class="prob-mini" aria-label="Win probability: home ${p.home}%, draw ${p.draw}%, away ${p.away}%">
        <div class="bar"><i class="h" style="flex:${p.home}"></i><i class="d" style="flex:${p.draw}"></i><i class="a" style="flex:${p.away}"></i></div>
        <div class="nums num"><span>${m.home.short} ${p.home}%</span><span>Draw ${p.draw}%</span><span>${p.away}% ${m.away.short}</span></div>
      </div>` : '';
  return html`<a class="match" href="#/match/${m.id}">
    <div class="mstat num ${m.status === 'LIVE' ? 'live' : ''}">${statusText(m)}</div>
    <div class="mteams">
      <div class="mteam">${crest(m.home)}<span class="name">${m.home.name}</span>${fav(m.home)}</div>
      <div class="mteam">${crest(m.away)}<span class="name">${m.away.name}</span>${fav(m.away)}</div>
    </div>
    <div class="mscores">${sc('home')}${sc('away')}</div>
    ${prob}
  </a>`;
}

const empty = (title, body, extra = '') => html`<div class="empty card"><b>${title}</b><span>${body}</span>${extra}</div>`;

const EMPTY_BY_FILTER = {
  live: ['No live matches right now', 'Matches show up here the moment they kick off.'],
  upcoming: ['Nothing left to play', 'Every match on this day has started or finished.'],
  finished: ['No results yet', 'Full-time scores land here as matches finish.'],
  mine: ['No matches for your teams', 'Star a team on its match page or in the tables to follow it here.'],
};

async function scoresView() {
  const list = await api(`/predictions?date=${state.date}`);
  state.hasLive = list.some((m) => m.status === 'LIVE');
  checkAlerts(list);

  const q = state.search.trim().toLowerCase();
  const searchFilter = (m) => !q || m.home.name.toLowerCase().includes(q) || m.away.name.toLowerCase().includes(q) || m.league.name.toLowerCase().includes(q);

  const filters = {
    all: () => true,
    live: (m) => m.status === 'LIVE',
    finished: (m) => m.status === 'FINISHED',
    upcoming: (m) => m.status === 'SCHEDULED',
    mine: (m) => favs[m.home.id] || favs[m.away.id],
  };

  const filteredBySearch = list.filter(searchFilter);
  const count = (f) => filteredBySearch.filter(filters[f]).length;
  const live = count('live');
  const shown = filteredBySearch.filter(filters[state.filter] ?? filters.all);

  const groups = new Map();
  for (const m of shown.sort((a, b) => a.utcDate.localeCompare(b.utcDate))) {
    if (!groups.has(m.league.code)) groups.set(m.league.code, { league: m.league, items: [] });
    groups.get(m.league.code).items.push(m);
  }
  const liveCount = (g) => g.items.filter((m) => m.status === 'LIVE').length;
  const ordered = [...groups.values()].sort((a, b) => liveCount(b) - liveCount(a));

  let body;
  if (!list.length) body = empty('No matches this day', 'Pick another day above.');
  else if (!shown.length) body = empty(...(EMPTY_BY_FILTER[state.filter] ?? ['Nothing here', 'No matches fit your search or filter on this day.']));
  else {
    body = ordered.map(({ league, items }) => html`<section class="league">
      <div class="league-head"><a href="#/tables/${league.code}">${league.name}</a><span>${league.country}</span></div>
      <div class="card rows">${items.map(matchRow)}</div></section>`);
  }
  const liveLabel = html`${live ? html`<i class="dot" aria-hidden="true"></i>` : ''}Live ${live}`;
  return html`<h1>Scores</h1>${dayStrip()}
    ${searchBar(filteredBySearch.length)}
    ${chips([['all', `All ${filteredBySearch.length}`], ['live', liveLabel], ['upcoming', `Upcoming ${count('upcoming')}`], ['finished', `Finished ${count('finished')}`], ['mine', 'My teams']], state.filter, 'filter')}
    ${body}`;
}

async function predictionsView() {
  const list = await api(`/predictions?date=${state.date}`);
  state.hasLive = list.some((m) => m.status === 'LIVE');

  const q = state.search.trim().toLowerCase();
  const filteredList = list.filter((m) => !q || m.home.name.toLowerCase().includes(q) || m.away.name.toLowerCase().includes(q) || m.league.name.toLowerCase().includes(q));

  const open = filteredList.filter((m) => m.status !== 'FINISHED' && m.status !== 'POSTPONED');
  const shown = (state.pfilter === 'all' ? filteredList : state.pfilter === 'strong' ? open.filter((m) => m.prediction.confidence >= 55) : open)
    .sort((a, b) => b.prediction.confidence - a.prediction.confidence);

  const isOdds = state.oddsMode === 'odds';

  const card = (m) => {
    const p = m.prediction, pr = p.probabilities, od = p.odds || {};
    const val = (k) => isOdds ? `${od[k] ?? '—'}` : `${pr[k]}%`;
    const box = (k, label) => html`<div class="pbox ${p.pick === k ? 'best' : ''}"><b class="num">${val(k === '1' ? 'home' : k === 'X' ? 'draw' : 'away')}</b><span>${label}</span></div>`;
    const hasEdge = p.confidence >= 60;

    return html`<a class="card pcard" href="#/match/${m.id}">
      <div class="when">
        <span>${m.league.name}${hasEdge ? html` <span class="edge-pill">Edge</span>` : ''}</span>
        <span class="num">${m.status === 'LIVE' ? `Live ${statusText(m)}` : m.status === 'FINISHED' ? `FT ${scoreline(m.score)}` : clock(m.utcDate)}</span>
      </div>
      <div class="teams">
        <span style="display:flex;align-items:center;gap:6px">${crest(m.home)}${m.home.name}</span>
        <span style="display:flex;align-items:center;gap:6px">${crest(m.away)}${m.away.name}</span>
      </div>
      <div class="three">${box('1', m.home.short)}${box('X', 'Draw')}${box('2', m.away.short)}</div>
      <div class="when num">
        <span class="pick">Pick: ${pickName(p.pick, m)}</span>
        <span>Likely ${scoreline(p.likelyScore)} · O2.5 ${p.over25}% · BTTS ${p.btts}%</span>
      </div>
      ${p.trends.length ? html`<div class="trends">${p.trends.slice(0, 2).map((t) => html`<span class="trend">${t}</span>`)}</div>` : ''}
    </a>`;
  };

  return html`<h1>Predictions</h1>${dayStrip()}
    ${searchBar(filteredList.length)}
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      ${chips([['upcoming', 'Upcoming'], ['strong', 'Strong picks 55%+'], ['all', 'All']], state.pfilter, 'pfilter')}
      <div class="chips" role="group" aria-label="Format">
        <button class="chip" data-act="odds-toggle" data-val="pct" aria-pressed="${bool(!isOdds)}">% Prob</button>
        <button class="chip" data-act="odds-toggle" data-val="odds" aria-pressed="${bool(isOdds)}">Odds</button>
      </div>
    </div>
    <p class="note">${providerName === 'demo' ? 'These are computed from simulated demo results. ' : ''}The model is a Poisson goal model on each team's goals scored and conceded this season with a home edge. Not betting advice.</p>
    <div class="stack">${shown.length ? shown.map(card) : empty('No predictions here', 'Try another day or a wider filter.')}</div>`;
}

async function tipsView() {
  const t = await api(`/tips?date=${state.date}`);
  state.hasLive = false;
  const row = (x) => html`<a class="formrow tiprow" href="#/match/${x.match.id}">
    <span><b>${x.label}</b><small class="muted">${x.match.home.name} v ${x.match.away.name} · ${clock(x.match.utcDate)}</small></span>
    <b class="num">${x.pct}%</b></a>`;
  return html`<h1>Tips</h1>${dayStrip()}
    <p class="note">The model's strongest edges on matches that have not kicked off (${t.count} on this day). Ranked by model probability, not by odds, so a high number means likely, not good value. Not betting advice.</p>
    ${t.count === 0 ? empty('No upcoming matches', 'Everything on this day has started or finished. Try another day.') :
      t.sections.map((s) => html`<section class="league"><div class="league-head"><span>${s.title}</span></div><div class="card">${s.tips.length ? s.tips.map(row) : html`<div class="formrow muted">Nothing to show</div>`}</div></section>`)}`;
}

/* ---------- toasts and goal alerts ---------- */
const toasts = document.createElement('div');
toasts.className = 'toasts';
toasts.setAttribute('role', 'status');
toasts.setAttribute('aria-live', 'polite');
document.body.append(toasts);

function toast(msg, ms = 6000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toasts.append(el);
  setTimeout(() => el.remove(), ms);
}

const seen = new Map(); // matchId -> "h-a" last seen score
function checkAlerts(list) {
  for (const m of list) {
    if (m.status !== 'LIVE' && m.status !== 'FINISHED') continue;
    const key = scoreline(m.score);
    const prev = seen.get(m.id);
    seen.set(m.id, key);
    if (prev === undefined || prev === key) continue;
    if (!favs[m.home.id] && !favs[m.away.id]) continue;
    const msg = `GOAL ${m.home.name} ${key} ${m.away.name}`;
    playGoalChime();
    toast(msg, 8000);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification('Blaze Score', { body: msg, icon: '/icon.svg' }); } catch { /* ignore */ }
    }
  }
}

/* ---------- match page panels ---------- */
function timeline(m) {
  const started = m.status === 'LIVE' || m.status === 'FINISHED';
  if (!started) return empty('Not started', 'Goals and cards appear here as they happen.');
  if (!m.events.length) {
    return empty('No goals or cards yet', providerName === 'demo' ? 'Events appear here as they happen.' : 'This data source does not send match events on its free plan.');
  }
  const label = { goal: 'Goal', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution' };
  const who = (e) => html`<span class="who"><i class="ico ${e.type}"></i><span class="sr">${label[e.type] || e.type}: </span><span>${e.player}</span></span>`;
  const ev = (e) => html`<div class="ev"><div class="h">${e.team === 'home' ? who(e) : ''}</div><div class="min num">${e.minute}'</div><div>${e.team === 'away' ? who(e) : ''}</div></div>`;
  const mark = (text, score) => html`<div class="ev mark"><span>${text}</span><b class="num">${score}</b></div>`;
  const first = m.events.filter((e) => e.minute <= 45);
  const second = m.events.filter((e) => e.minute > 45);
  const goals = (list, side) => list.filter((e) => e.type === 'goal' && e.team === side).length;
  const pastHalfTime = m.status === 'FINISHED' || m.halftime || (m.minute ?? 0) > 45;
  return html`<div class="card timeline">
    ${first.map(ev)}
    ${pastHalfTime ? mark('Half time', scoreline({ home: goals(first, 'home'), away: goals(first, 'away') })) : ''}
    ${second.map(ev)}
    ${m.status === 'FINISHED' ? mark('Full time', scoreline(m.score)) : ''}
  </div>`;
}

function statsPanel(m) {
  if (!m.stats) return empty(m.status === 'SCHEDULED' ? 'Not started' : 'No stats available', m.status === 'SCHEDULED' ? 'Team stats appear once the match kicks off.' : 'This data source does not provide team stats.');
  const rows = [['possession', 'Possession', '%'], ['shots', 'Shots'], ['shotsOnTarget', 'On target'], ['corners', 'Corners'], ['fouls', 'Fouls'], ['yellowCards', 'Yellow cards']];
  return html`<div class="card">${rows.map(([k, label, suf = '']) => {
    const s = m.stats[k] || { home: 0, away: 0 };
    return html`<div class="stat"><div class="row num"><span>${s.home}${suf}</span><span>${label}</span><span>${s.away}${suf}</span></div>
      ${s.home + s.away > 0 ? html`<div class="split"><i style="flex:${s.home}"></i><i style="flex:${s.away}"></i></div>` : ''}</div>`;
  })}</div>`;
}

function lineupsPanel(m) {
  if (!m.lineups || (!m.lineups.home?.starters?.length && !m.lineups.away?.starters?.length)) {
    return empty('No lineups available', 'Lineups are confirmed about 60 minutes before kickoff when supported by the provider.');
  }
  const side = (team, roster) => html`<div class="lineup-col">
    <div class="lineup-header">
      <span style="display:flex;align-items:center;gap:6px">${crest(team)}${team.name}</span>
      ${roster.formation ? html`<span class="lineup-formation">${roster.formation}</span>` : ''}
    </div>
    <div class="card rows">
      <div class="formrow muted small" style="text-transform:uppercase;font-weight:700">Starting XI</div>
      ${(roster.starters || []).map((p) => html`<div class="player-row"><span class="jnum">${p.jersey || ''}</span><span class="pname">${p.name}</span>${p.position ? html`<span class="ppos">${p.position}</span>` : ''}</div>`)}
      ${roster.bench?.length ? html`<div class="formrow muted small" style="text-transform:uppercase;font-weight:700;margin-top:6px">Substitutes</div>
        ${roster.bench.map((p) => html`<div class="player-row"><span class="jnum">${p.jersey || ''}</span><span class="pname">${p.name}</span>${p.position ? html`<span class="ppos">${p.position}</span>` : ''}</div>`)}` : ''}
    </div>
  </div>`;
  return html`<div class="lineups-grid">${side(m.home, m.lineups.home)}${side(m.away, m.lineups.away)}</div>`;
}

function predictPanel(m) {
  const p = m.prediction, pr = p.probabilities, od = p.odds || {};
  const isOdds = state.oddsMode === 'odds';
  const val = (k) => isOdds ? `${od[k] ?? '—'}` : `${pr[k]}%`;
  const box = (k, label, key) => html`<div class="pbox ${p.pick === k ? 'best' : ''}"><b class="num">${val(key)}</b><span>${label}</span></div>`;
  const meter = (label, v) => html`<div class="meter"><div class="row"><span>${label}</span><span class="num">${v}%</span></div><div class="track" role="meter" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"><i style="width:${v}%"></i></div></div>`;
  const pos = (n) => (n ? html` <span class="muted small">· ${ordinal(n)}</span>` : '');
  const mine = picks[m.id];
  const canPick = m.status === 'SCHEDULED' && Date.parse(m.utcDate) > Date.now();
  const pickBtn = (k) => html`<button class="pickbtn" data-act="pick" data-pick="${k}" aria-pressed="${bool(mine?.pick === k)}" ${canPick ? '' : 'disabled'}>${k}</button>`;
  let pickNote = '';
  if (mine && m.status === 'FINISHED') {
    const ok = resultOf(m.score) === mine.pick;
    pickNote = html`<p class="small pickhelp">You picked ${mine.pick}, the result was ${resultOf(m.score)}: <span class="res ${ok ? 'ok' : 'no'}">${ok ? 'correct' : 'wrong'}</span>. The model picked ${mine.model}.</p>`;
  } else if (mine && canPick) {
    pickNote = html`<p class="small muted pickhelp">You picked ${pickName(mine.pick, m)}. You can change it until kickoff.</p>`;
  } else if (!canPick && !mine) {
    pickNote = html`<p class="small muted pickhelp">Picks close at kickoff.</p>`;
  }
  return html`<div class="stack">
    <div class="three">${box('1', m.home.short, 'home')}${box('X', 'Draw', 'draw')}${box('2', m.away.short, 'away')}</div>
    <div class="card"><div class="formrow"><span>Expected goals</span><b class="num">${p.expectedGoals.home} – ${p.expectedGoals.away}</b></div>
      <div class="formrow"><span>Most likely scores</span><b class="num">${p.topScores.map((s, i) => html`${i ? ' · ' : ''}${scoreline(s)} <small class="muted">${s.pct}%</small>`)}</b></div>
      <div class="formrow"><span>Double chance</span><b class="num">${m.home.short}/X ${p.doubleChance.homeOrDraw}% · X/${m.away.short} ${p.doubleChance.awayOrDraw}%</b></div>
      ${meter('Over 2.5 goals', p.over25)}${meter('Both teams to score', p.btts)}</div>
    ${p.trends.length ? html`<div><h2>Trends</h2><div class="trends">${p.trends.map((t) => html`<span class="trend">${t}</span>`)}</div></div>` : ''}
    <div><h2>${p.form.home || p.form.away ? 'Form, last 5' : 'League position'}</h2><div class="card">
      <div class="formrow"><span style="display:flex;align-items:center;gap:6px">${crest(m.home)}${m.home.name}${pos(p.position.home)}</span>${formDots(p.form.home)}</div>
      <div class="formrow"><span style="display:flex;align-items:center;gap:6px">${crest(m.away)}${m.away.name}${pos(p.position.away)}</span>${formDots(p.form.away)}</div></div></div>
    <div><h2>Your pick <span class="muted" style="text-transform:none;letter-spacing:0">(1 home · X draw · 2 away)</span></h2>
      <div class="card"><div class="pickbar" role="group" aria-label="Your pick">${pickBtn('1')}${pickBtn('X')}${pickBtn('2')}</div>${pickNote}</div></div>
    <p class="note">Model pick: ${pickName(p.pick, m)}. Poisson goal model on season goals scored and conceded with a home edge. Not betting advice.</p></div>`;
}

function h2hPanel(m) {
  if (!m.h2h.length) return empty('No meetings found', 'These teams have no recent head-to-head on record.');
  let hw = 0, dr = 0, aw = 0;
  for (const e of m.h2h) {
    const hs = e.home === m.home.name ? e.score.home : e.score.away;
    const as = e.home === m.home.name ? e.score.away : e.score.home;
    if (hs > as) hw++; else if (hs < as) aw++; else dr++;
  }
  return html`<div class="stack"><div class="three"><div class="pbox"><b class="num">${hw}</b><span>${m.home.short} wins</span></div><div class="pbox"><b class="num">${dr}</b><span>Draws</span></div><div class="pbox"><b class="num">${aw}</b><span>${m.away.short} wins</span></div></div>
    <div class="card">${m.h2h.map((e) => html`<div class="formrow"><span class="muted small num">${e.date}</span><span style="flex:1;text-align:right">${e.home}</span><b class="num">${scoreline(e.score)}</b><span style="flex:1">${e.away}</span></div>`)}</div></div>`;
}

const PANELS = { summary: timeline, stats: statsPanel, lineups: lineupsPanel, predict: predictPanel, h2h: h2hPanel };

async function matchView(id, sub) {
  state.tab = Object.hasOwn(PANELS, sub) ? sub : 'summary';
  const m = await api(`/matches/${encodeURIComponent(id)}`);
  state.current = m;
  state.hasLive = m.status === 'LIVE';
  const star = (t) => html`<button class="starbtn" data-act="star" data-id="${t.id}" data-name="${t.name}" aria-pressed="${bool(favs[t.id])}">${favs[t.id] ? '★ Following' : '☆ Follow'}</button>`;
  const scheduled = m.status === 'SCHEDULED' || m.status === 'POSTPONED';
  const tabs = [
    ['summary', 'Summary'],
    ['stats', 'Stats'],
    ...(m.lineups ? [['lineups', 'Lineups']] : []),
    ['predict', 'Prediction'],
    ['h2h', html`<span class="long">Head to head</span><span class="short" aria-hidden="true">H2H</span>`],
  ];
  const panel = (PANELS[state.tab] || timeline)(m);
  document.title = `${m.home.short} ${scheduled ? 'v' : scoreline(m.score)} ${m.away.short} · Blaze Score`;
  return html`<a class="back" href="#/" data-act="back">${chevron(-1)}Back</a>
    <div class="card mhead">
      <div class="meta"><a href="#/tables/${m.league.code}">${m.league.name}</a> · ${longDate(m.utcDate)}, ${clock(m.utcDate)}</div>
      <div class="grid">
        <div class="side">${crest(m.home, true)}<span class="name">${m.home.name}</span>${star(m.home)}</div>
        <div><div class="bigscore num ${scheduled ? 'pre' : ''}">${scheduled ? clock(m.utcDate) : scoreline(m.score)}</div>
          <div class="status num ${m.status === 'LIVE' ? 'live' : ''}">${m.status === 'LIVE' ? (m.halftime ? 'HALF TIME' : `LIVE ${m.minute}'`) : m.status === 'FINISHED' ? 'FULL TIME' : m.status === 'POSTPONED' ? 'POSTPONED' : 'KICK OFF'}</div></div>
        <div class="side">${crest(m.away, true)}<span class="name">${m.away.name}</span>${star(m.away)}</div>
      </div></div>
    <div class="tabs" role="tablist" aria-label="Match details">${tabs.map(([k, l]) => html`<button class="tab" role="tab" data-act="tab" data-t="${k}" aria-selected="${bool(state.tab === k)}" tabindex="${state.tab === k ? 0 : -1}">${l}</button>`)}</div>
    <div role="tabpanel">${panel}</div>`;
}

async function tablesView(arg) {
  const leagues = await api('/leagues');
  const code = leagues.some((l) => l.code === arg) ? arg : leagues[0].code;
  const st = await api(`/standings/${code}`);
  const n = st.table.length;
  const cup = code === 'CL' || code === 'EL';
  const zones = cup || n >= 16;
  const zone = (pos) => (!zones ? '' : cup ? (pos <= 8 ? 'zone-ucl' : '') : pos <= 4 ? 'zone-ucl' : pos > n - 3 ? 'zone-rel' : '');
  const hasForm = st.table.some((r) => r.form);

  const sortKey = state.tableSort || 'pos';
  const sortDir = state.tableSortDir || 'asc';
  const sorted = [...st.table].sort((a, b) => {
    const valA = sortKey === 'pos' ? a.position : a[sortKey];
    const valB = sortKey === 'pos' ? b.position : b[sortKey];
    return sortDir === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
  });

  const arrow = (k) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const row = (r) => html`<tr class="${zone(r.position)}">
    <td class="num">${r.position}</td>
    <td class="l"><span class="team">${crest(r.team)}${r.team.name}</span></td>
    <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
    <td>${r.gd > 0 ? '+' : ''}${r.gd}</td>
    <td class="pts">${r.points}</td>
    ${hasForm ? html`<td>${formDots(r.form)}</td>` : ''}
    <td><button class="starbtn" data-act="star" data-id="${r.team.id}" data-name="${r.team.name}" aria-pressed="${bool(favs[r.team.id])}" aria-label="${favs[r.team.id] ? 'Unfollow' : 'Follow'} ${r.team.name}">${favs[r.team.id] ? '★' : '☆'}</button></td></tr>`;

  return html`<h1>Tables</h1>
    <div class="chips" role="group" aria-label="League">${leagues.map((l) => html`<a class="chip" href="#/tables/${l.code}" aria-current="${bool(l.code === code)}">${l.name}</a>`)}</div>
    <div class="card scroll" style="margin-top:12px">
      <table>
        <caption class="sr">${st.league.name} standings</caption>
        <thead>
          <tr>
            <th class="sortable-th" data-act="sort-col" data-col="pos">#${arrow('pos')}</th>
            <th class="l">Team</th>
            <th class="sortable-th" data-act="sort-col" data-col="played"><abbr title="Played">P</abbr>${arrow('played')}</th>
            <th class="sortable-th" data-act="sort-col" data-col="won"><abbr title="Won">W</abbr>${arrow('won')}</th>
            <th class="sortable-th" data-act="sort-col" data-col="drawn"><abbr title="Drawn">D</abbr>${arrow('drawn')}</th>
            <th class="sortable-th" data-act="sort-col" data-col="lost"><abbr title="Lost">L</abbr>${arrow('lost')}</th>
            <th class="sortable-th" data-act="sort-col" data-col="gd"><abbr title="Goal difference">GD</abbr>${arrow('gd')}</th>
            <th class="sortable-th" data-act="sort-col" data-col="points">Pts${arrow('points')}</th>
            ${hasForm ? html`<th>Form</th>` : ''}
            <th><span class="sr">Follow</span></th>
          </tr>
        </thead>
        <tbody>${sorted.map(row)}</tbody>
      </table>
    </div>
    ${zones ? html`<p class="note">${cup ? 'Green marks the top eight, who go straight to the knockout round.' : 'Green marks the top four, red the bottom three.'} Click column headers to sort.</p>` : ''}`;
}

async function picksView() {
  const entries = Object.entries(picks);
  if (!entries.length) {
    return html`<h1>My picks</h1>${empty('No picks yet', 'Open an upcoming match, go to Prediction and choose 1, X or 2. Your record against the model shows up here.', html`<a class="btn" style="margin-top:8px" href="#/predictions">See predictions</a>`)}`;
  }
  const results = await Promise.all(entries.map(([id]) => api(`/matches/${encodeURIComponent(id)}`).catch(() => null)));
  let done = 0, mine = 0, model = 0;
  let streak = 0, bestStreak = 0;

  const rows = entries.map(([id, p], i) => {
    const m = results[i];
    const fin = m?.status === 'FINISHED';
    const res = fin ? resultOf(m.score) : null;
    if (fin) {
      done++;
      if (res === p.pick) mine++;
      if (res === p.model) model++;
    }
    return { id, p, m, fin, res };
  }).sort((a, b) => b.p.date.localeCompare(a.p.date));

  // Compute streaks
  for (const r of [...rows].reverse()) {
    if (!r.fin) continue;
    if (r.res === r.p.pick) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }

  const winPct = done > 0 ? Math.round((mine / done) * 100) : 0;
  const filteredRows = rows.filter((r) => {
    if (state.pickFilter === 'won') return r.fin && r.res === r.p.pick;
    if (state.pickFilter === 'lost') return r.fin && r.res !== r.p.pick;
    if (state.pickFilter === 'pending') return !r.fin;
    return true;
  });

  return html`<h1>My picks</h1>
    <div class="card tally">
      <div><b class="num">${done}</b><span>Settled</span></div>
      <div><b class="num">${mine}</b><span>You (${winPct}%)</span></div>
      <div><b class="num">${streak > 0 ? `🔥 ${streak}` : `${model}`}</b><span>${streak > 0 ? 'Win Streak' : 'Model right'}</span></div>
    </div>
    <div class="picks-actions">
      ${chips([['all', 'All'], ['won', 'Won'], ['lost', 'Lost'], ['pending', 'Pending']], state.pickFilter, 'pick-filter')}
      <button class="action-btn" data-act="share-picks"><svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>Share</button>
      <button class="action-btn" data-act="reset-picks" title="Reset picks record">Reset</button>
    </div>
    <div class="card rows" style="margin-top:12px">${filteredRows.map(({ id, p, m, fin, res }) => html`<a class="match" href="#/match/${id}" style="grid-template-columns:minmax(0,1fr) auto">
      <div class="mteams"><div class="name">${p.home} v ${p.away}</div><div class="small muted">${p.league} · ${longDate(p.date)}</div></div>
      <div style="text-align:right" class="num"><div>Pick <b>${p.pick}</b> · Model <b>${p.model}</b></div>
        <div class="small ${fin ? `res ${res === p.pick ? 'ok' : 'no'}` : 'muted'}">${fin ? `${scoreline(m.score)} ${res === p.pick ? 'correct' : 'wrong'}` : m ? 'Pending' : 'Unavailable'}</div></div></a>`)}</div>`;
}

/* ---------- provider settings modal ---------- */
function renderProviderModal() {
  const currentPref = store.get('provider', providerName);
  const soundOn = store.get('sound', false);
  const isOdds = store.get('oddsMode', 'pct') === 'odds';

  const provs = availableProviders.length ? availableProviders : [
    { id: 'espn', name: 'ESPN Live', label: 'Free Live Data', description: 'Zero API keys required, live clock, match statistics and lineups' },
    { id: 'demo', name: 'Demo Simulation', label: 'Simulated Data', description: 'Deterministic fixtures that play in real time, offline friendly' },
  ];

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = html`<div class="modal-card">
    <div class="modal-header">
      <span>Settings & Data Source</span>
      <button class="clear-btn" data-act="close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div>
        <b style="display:block;margin-bottom:8px">Data Provider</b>
        <div style="display:grid;gap:8px">
          ${provs.map((p) => html`<div class="provider-card ${currentPref === p.id ? 'active' : ''}" data-act="select-provider" data-id="${p.id}">
            <div class="phead"><span>${p.name}</span><span class="pbadge">${p.label}</span></div>
            <div class="pdesc">${p.description}</div>
          </div>`)}
        </div>
      </div>
      <div class="pref-row">
        <div><b>Audio Goal Chime</b><div class="setting-desc">Plays a sound when followed teams score</div></div>
        <button class="chip" data-act="toggle-sound" aria-pressed="${bool(soundOn)}">${soundOn ? 'On' : 'Off'}</button>
      </div>
      <div class="pref-row">
        <div><b>Predictions Format</b><div class="setting-desc">Show win probabilities or decimal odds</div></div>
        <button class="chip" data-act="toggle-odds-modal" aria-pressed="${bool(isOdds)}">${isOdds ? 'Odds (1.X.2)' : '% Probabilities'}</button>
      </div>
    </div>
  </div>`.s;

  document.body.append(modal);
}

const views = { '': scoresView, predictions: predictionsView, tips: tipsView, match: matchView, tables: tablesView, picks: picksView };
const LIST_ROUTES = new Set(['', 'predictions', 'tips', 'tables', 'picks']);

/* ---------- routing and rendering ---------- */
function parseHash() {
  const [name = '', arg = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: views[name] ? name : '', arg: decodeURIComponent(arg), sub };
}
const routeKey = () => location.hash || '#/';

const scrollMemo = new Map();
window.addEventListener('scroll', () => { if (LIST_ROUTES.has(parseHash().name)) scrollMemo.set(routeKey(), window.scrollY); }, { passive: true });
let navDepth = 0;

function focusSelector(el) {
  if (!el || !view.contains(el) || !el.dataset.act) return null;
  return Object.entries(el.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`).join('');
}

const SKELETON = '<div class="card" aria-busy="true" aria-label="Loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';

async function render(mode = 'soft') {
  const my = ++token;
  const { name, arg, sub } = parseHash();
  const saved = mode === 'nav' && LIST_ROUTES.has(name) ? scrollMemo.get(routeKey()) ?? 0 : 0;
  const focusSel = mode === 'soft' ? focusSelector(document.activeElement) : null;
  for (const a of document.querySelectorAll('.nav a')) {
    const target = a.getAttribute('href').replace(/^#\/?/, '').split('/')[0];
    if (target === (name === 'match' ? '' : name)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (name !== 'match') document.title = 'Blaze Score';
  if (mode !== 'soft') { view.innerHTML = SKELETON; window.scrollTo(0, 0); }
  view.setAttribute('aria-busy', 'true');
  try {
    const out = await views[name](arg, sub);
    if (my !== token) return;
    view.innerHTML = out.s;
  } catch (err) {
    if (my !== token) return;
    const gone = err.status === 404;
    view.innerHTML = (gone
      ? empty('Not found', 'That match or league does not exist.', html`<a class="btn" style="margin-top:8px" href="#/">Go to scores</a>`)
      : empty('Match data is unavailable', 'Check your connection and try again.', html`<button class="btn" data-act="retry" style="margin-top:8px">Try again</button>`)).s;
  } finally {
    if (my === token) view.removeAttribute('aria-busy');
  }
  if (mode === 'soft') { if (focusSel) view.querySelector(focusSel)?.focus({ preventScroll: true }); }
  else {
    window.scrollTo(0, saved);
    if (mode === 'nav') view.focus({ preventScroll: true });
  }
}

window.addEventListener('hashchange', () => { navDepth++; render('nav'); });
document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); view.focus(); });

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act="search-input"]');
  if (el) {
    state.search = el.value;
    render('soft');
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act="date-pick"]');
  if (el && el.value) {
    state.date = el.value;
    render('reload');
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act } = el.dataset;

  if (act === 'day') { state.date = el.dataset.date; render('reload'); }
  else if (act === 'filter') { state.filter = el.dataset.f; render('soft'); }
  else if (act === 'pfilter') { state.pfilter = el.dataset.f; render('soft'); }
  else if (act === 'pick-filter') { state.pickFilter = el.dataset.f; render('soft'); }
  else if (act === 'clear-search') { state.search = ''; render('soft'); }
  else if (act === 'odds-toggle') {
    state.oddsMode = el.dataset.val;
    store.set('oddsMode', state.oddsMode);
    render('soft');
  }
  else if (act === 'sort-col') {
    const col = el.dataset.col;
    if (state.tableSort === col) {
      state.tableSortDir = state.tableSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.tableSort = col;
      state.tableSortDir = 'asc';
    }
    render('soft');
  }
  else if (act === 'share-picks') {
    const entries = Object.entries(picks);
    let done = 0, mine = 0;
    entries.forEach(([id, p]) => {
      // rough tally
      done++;
    });
    const summary = `⚽ Blaze Score: ${entries.length} picks tracked against Poisson predictions! https://blazescore.app`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(summary).then(() => toast('Copied picks summary to clipboard!'));
    } else {
      toast(summary);
    }
  }
  else if (act === 'reset-picks') {
    if (confirm('Clear all your stored picks?')) {
      for (const k of Object.keys(picks)) delete picks[k];
      store.set('picks', picks);
      render('reload');
      toast('Picks history reset.');
    }
  }
  else if (act === 'close-modal') {
    document.querySelector('.modal-overlay')?.remove();
  }
  else if (act === 'select-provider') {
    const id = el.dataset.id;
    store.set('provider', id);
    document.querySelector('.modal-overlay')?.remove();
    toast(`Switched data provider to ${id.toUpperCase()}`);
    boot().then(() => render('reload'));
  }
  else if (act === 'toggle-sound') {
    const cur = store.get('sound', false);
    store.set('sound', !cur);
    if (!cur) playGoalChime();
    document.querySelector('.modal-overlay')?.remove();
    renderProviderModal();
    toast(!cur ? 'Goal chime enabled!' : 'Goal chime muted.');
  }
  else if (act === 'toggle-odds-modal') {
    const cur = store.get('oddsMode', 'pct');
    const next = cur === 'pct' ? 'odds' : 'pct';
    store.set('oddsMode', next);
    state.oddsMode = next;
    document.querySelector('.modal-overlay')?.remove();
    renderProviderModal();
    render('soft');
  }
  else if (act === 'tab') {
    if (state.current) history.replaceState(null, '', `#/match/${encodeURIComponent(state.current.id)}/${el.dataset.t}`);
    render('soft');
  }
  else if (act === 'retry') render('reload');
  else if (act === 'back' && navDepth > 0) { e.preventDefault(); history.back(); }
  else if (act === 'star') {
    const { id, name } = el.dataset;
    if (favs[id]) delete favs[id]; else favs[id] = name;
    store.set('favs', favs);
    render('soft');
  } else if (act === 'pick' && state.current) {
    const m = state.current;
    if (m.status !== 'SCHEDULED' || Date.parse(m.utcDate) <= Date.now()) return;
    picks[m.id] = { pick: el.dataset.pick, model: m.prediction.pick, home: m.home.name, away: m.away.name, date: m.utcDate, league: m.league.name };
    store.set('picks', picks);
    render('soft');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelector('.modal-overlay')?.remove();
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const el = e.target.closest('.tab, .chip, .day');
  if (!el || !view.contains(el)) return;
  const siblings = [...el.parentElement.children].filter((c) => c.matches('.tab, .chip, .day'));
  const next = siblings[siblings.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (next.matches('.tab')) next.click();
});

setInterval(() => { if (!document.hidden && state.hasLive) render('soft'); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render('soft'); });

/* ---------- header controls ---------- */
const THEME_ICONS = {
  system: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};
const THEME_LABEL = { system: 'follows your system', light: 'light', dark: 'dark' };
const themeBtn = document.getElementById('theme');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const paintThemeColor = () => { themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0d1411'; };
function applyTheme(t, announce = false) {
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  store.set('theme', t);
  themeBtn.querySelector('svg').innerHTML = THEME_ICONS[t];
  themeBtn.setAttribute('aria-label', `Theme: ${THEME_LABEL[t]}`);
  paintThemeColor();
  if (announce) toast(t === 'system' ? 'Theme follows your system' : `${t[0].toUpperCase()}${t.slice(1)} theme`, 2500);
}
const THEMES = ['system', 'light', 'dark'];
let theme = THEMES.includes(store.get('theme', 'system')) ? store.get('theme', 'system') : 'system';
applyTheme(theme);
themeBtn.addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(theme, true); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeColor);

const refreshBtn = document.getElementById('refresh');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('busy');
  refreshBtn.disabled = true;
  try { await render('soft'); } finally { refreshBtn.classList.remove('busy'); refreshBtn.disabled = false; }
});

await boot();
const pill = document.getElementById('mode');
pill.textContent = providerName === 'demo' ? 'Demo' : providerName === 'espn' ? 'Live (ESPN)' : 'Live';
const modeHelp = `Active provider: ${providerName}. Click to change settings or data source.`;
pill.title = modeHelp;
pill.addEventListener('click', () => renderProviderModal());

const bell = document.getElementById('bell');
if ('Notification' in window) {
  bell.hidden = false;
  const paint = () => { const on = Notification.permission === 'granted'; bell.querySelector('span').textContent = on ? 'Alerts on' : 'Alerts'; bell.classList.toggle('on', on); bell.setAttribute('aria-label', on ? 'Goal alerts are on' : 'Goal alerts'); };
  paint();
  bell.addEventListener('click', async () => {
    if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { toast('This browser does not support alerts.'); } }
    else toast(Notification.permission === 'granted' ? 'Goal alerts for followed teams are on while Blaze Score is open. Turn them off in browser site settings.' : 'Alerts are blocked. Allow notifications in browser site settings.');
    paint();
  });
}
if (mode === 'api' && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
render('reload');
