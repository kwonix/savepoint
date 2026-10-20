'use strict';
/* Точка сохранения — личный трекер-игра. Всё хранится только на этом устройстве.
   Контент (квесты, карты, вызовы, ачивки) — в data.js. */

const STORE_KEY = 'savepoint.v1';      // имя ключа не меняем, чтобы не потерять старые данные
const STATE_VERSION = 2;
const DAY_SHIFT_H = 4;                 // день заканчивается в 04:00
const SHIELDS_PER_WEEK = 2;
const FIXES_PER_WEEK = 1;
const AUTO_NEED = 21, AUTO_WINDOW = 28;
const SPRINT_COUNT = 3, SPRINT_MS = 60e3, SPRINT_FLAG = 2;
const PHOTO_KEEP_DAYS = 14;
const STAKES = [50, 100, 200];

const Q = Object.fromEntries(CATALOG.map(q => [q.id, q]));
const CARD = Object.fromEntries(DECK.map(c => [c.id, c]));
const CH = Object.fromEntries(CHALLENGES.map(c => [c.id, c]));
const RANKS = [[80, 'Машина'], [60, 'Стабильно'], [40, 'В деле'], [0, 'Разгон']];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

/* ================= даты ================= */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date(Date.now() - DAY_SHIFT_H * 3600e3));
const wdIndex = k => (dateOf(k).getDay() + 6) % 7;
const weekOf = k => addDays(k, -wdIndex(k));
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
const fmtDay = k => { const d = dateOf(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtDayLong = k => { const d = dateOf(k); return `${WD_FULL[wdIndex(k)]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`; };
const fmtWeek = w => {
  const a = dateOf(w), b = dateOf(addDays(w, 6));
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
};
const isoWeekNo = k => {
  const d = dateOf(k); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const y1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - y1) / 864e5 - 3 + (y1.getDay() + 6) % 7) / 7);
};
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const shMin = hm => { const v = (toMin(hm) - DAY_SHIFT_H * 60 + 1440) % 1440; return v; };   // минуты от 04:00
const nowSh = (date = new Date()) => (date.getHours() * 60 + date.getMinutes() - DAY_SHIFT_H * 60 + 1440) % 1440;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addMin = (hm, m) => { const v = (toMin(hm) + m + 1440) % 1440; return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`; };
const rub = n => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

/* ================= состояние ================= */
let S = null;
let ui = { tab: 'today', week: null, sheet: null, guide: null, wiz: null, confirmReset: false, noteDraft: '', journalN: 14 };

function fresh(d) {
  const t = todayKey();
  return migrate({
    v: STATE_VERSION, created: t, profile: { name: (d.name || '').trim() }, profileDone: true,
    settings: { wake: d.wake || '09:00', bed: d.bed || '01:00', tone: d.tone || 'roast', theme: d.theme || 'auto', remind: {} },
    bosses: (d.bosses || []).map(b => makeBoss(b, t)),
    quests: Object.fromEntries((d.quests?.length ? d.quests : ['wake', 'shower']).map(id => [id, { periods: [{ from: t }], auto: null, check: null }])),
    days: {}, side: {}, sideList: d.side || SIDE_DEFAULT.slice(), custom: d.custom || [], events: [], guide: true,
    seenVersion: APP_VERSION, lastBackup: t,
    shop: { rewards: d.rewards || DEFAULT_REWARDS.map(r => ({ ...r })), bought: [] },
  });
}
function migrate(s) {
  s.v = STATE_VERSION;
  s.settings ||= {}; s.settings.remind ||= {}; s.settings.theme ||= 'auto';
  s.profile ||= { name: '' };
  if (!s.bosses) {
    s.bosses = [];
    if (s.boss && s.boss.total > 0) s.bosses.push({ id: 'b-legacy', type: 'debt', name: 'Кредитка', stat: 'money', unit: '₽', total: s.boss.total, weekly: s.boss.weekly || 0,
      hits: (s.boss.paid || []).map(p => ({ day: p.day, amount: p.amount, ts: 0 })), created: s.created, defeated: null });
  }
  delete s.boss;
  if (!s.sideList) s.sideList = [...new Set([...SIDE_DEFAULT, ...Object.keys(s.side || {}).filter(id => SIDE.some(x => x.id === id))])];
  s.lastBackup ||= s.created;
  s.quests ||= {}; s.days ||= {}; s.side ||= {}; s.custom ||= []; s.events ||= [];
  s.timers ||= {}; s.weeks ||= {}; s.ach ||= {}; s.sprints ||= []; s.fixes ||= {};
  s.shop ||= { rewards: DEFAULT_REWARDS.map(r => ({ ...r })), bought: [] };
  s.recentCards ||= [];
  s.lastLevel ||= 1;
  if (s.guide === undefined) s.guide = false;
  return s;
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { /* нет доступа */ }
  return null;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('Не получилось сохранить. Сделай резервную копию в Профиле'); }
}
const day = k => (S.days[k] ||= { q: {} });
const peekDay = k => S.days[k] || { q: {} };

/* ================= фото (IndexedDB) ================= */
const photos = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('savepoint-photos', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('p');
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('p', mode); const req = fn(t.objectStore('p')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); });
  },
  put(key, blob) { return this.tx('readwrite', s => s.put(blob, key)); },
  get(key) { return this.tx('readonly', s => s.get(key)); },
  del(key) { return this.tx('readwrite', s => s.delete(key)); },
  keys() { return this.tx('readonly', s => s.getAllKeys()); },
  async purge() {
    try {
      const edge = addDays(todayKey(), -PHOTO_KEEP_DAYS);
      for (const k of await this.keys()) if (String(k).slice(0, 10) < edge) await this.del(k);
    } catch (e) { /* без IndexedDB просто не храним фото */ }
  },
};
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', .6));
  } finally { URL.revokeObjectURL(url); }
}

/* ================= квесты ================= */
function qStatus(id) {
  const r = S.quests[id];
  if (!r || !r.periods.length) return 'off';
  const last = r.periods[r.periods.length - 1];
  return !last.to ? 'active' : (r.auto ? 'auto' : 'off');
}
const activeQuests = () => CATALOG.filter(q => qStatus(q.id) === 'active');
const activeOn = (id, k) => { const r = S.quests[id]; return !!r && r.periods.some(p => p.from <= k && (!p.to || k <= p.to)); };
const doneOn = (id, k) => !!peekDay(k).q[id];
function countDone(id, endK, n) {
  let c = 0;
  for (let i = 0; i < n; i++) { const k = addDays(endK, -i); if (k < S.created) break; if (doneOn(id, k)) c++; }
  return c;
}
function activate(id, k) { const r = S.quests[id] ||= { periods: [], auto: null, check: null }; r.periods.push({ from: k }); r.auto = null; }
function deactivate(id, k) {
  const r = S.quests[id]; if (!r) return;
  const last = r.periods[r.periods.length - 1];
  if (last && !last.to) { if (last.from >= k) r.periods.pop(); else last.to = addDays(k, -1); }
  r.auto = null;
}
const slotsFor = L => L >= 12 ? 6 : L >= 8 ? 5 : L >= 5 ? 4 : L >= 3 ? 3 : 2;
const slotLevel = n => ({ 3: 3, 4: 5, 5: 8, 6: 12 }[n]);

/* Окно отметки: можно ли отметить квест прямо сейчас */
function windowFor(q, t, now = new Date()) {
  if (!q.from) return { open: true };
  const m = nowSh(now);
  let F = shMin(q.from), T = shMin(q.to); if (T === 0) T = 1440;
  if (q.afterWake && activeOn('wake', t)) {
    const w = peekDay(t).q.wake;
    if (w && w.ts) {
      const left = w.ts + q.afterWake * 60e3 - now.getTime();
      return left >= 0 ? { open: true, note: `Окно ещё ${Math.ceil(left / 60e3)} мин` } : { open: false, why: 'Окно закрылось: прошло 2 часа после подъёма' };
    }
  }
  if (m < F) return { open: false, why: `Откроется в ${q.from}` };
  if (m > T) return { open: false, why: `Окно закрылось в ${q.to}` };
  return { open: true, note: T < 1440 && T - m <= 120 ? `Осталось ${Math.max(1, T - m)} мин` : '' };
}

/* Автопилот */
function evolve() {
  const t = todayKey(), notes = [];
  for (const q of CATALOG) {
    if (qStatus(q.id) !== 'active') continue;
    const r = S.quests[q.id], since = r.periods[r.periods.length - 1].from;
    if (daysBetween(since, t) >= AUTO_WINDOW - 1 && countDone(q.id, addDays(t, -1), AUTO_WINDOW) >= AUTO_NEED) {
      r.periods[r.periods.length - 1].to = addDays(t, -1);
      r.auto = t; r.check = weekOf(t);
      S.events.push({ day: t, type: 'auto', id: q.id });
      notes.push(`«${q.title}» ушёл на автопилот. +300 опыта, слот свободен`);
    }
  }
  ensureWeek(weekOf(t));
  return notes;
}

/* ================= серия и щиты ================= */
const anyDone = k => Object.keys(peekDay(k).q).length > 0 || !!peekDay(k).card?.done;
function streakInfo() {
  const t = todayKey(); let streak = 0, best = 0; const shieldDays = new Set(); const used = {};
  for (let k = S.created; k < t; k = addDays(k, 1)) {
    if (anyDone(k)) streak++;
    else {
      const w = weekOf(k); used[w] = used[w] || 0;
      if (used[w] < SHIELDS_PER_WEEK) { used[w]++; shieldDays.add(k); } else streak = Math.floor(streak / 2);
    }
    best = Math.max(best, streak);
  }
  if (anyDone(t)) streak++;
  best = Math.max(best, streak);
  return { streak, best, shieldDays, left: SHIELDS_PER_WEEK - (used[weekOf(t)] || 0) };
}

/* ================= карта дня ================= */
function drawCard(exclude = []) {
  const roll = Math.random() * 100;
  const rar = roll < RARITY.l.weight ? 'l' : roll < RARITY.l.weight + RARITY.r.weight ? 'r' : 'c';
  const avoid = new Set([...(S.recentCards || []), ...exclude]);
  let pool = DECK.filter(c => c.rarity === rar && !avoid.has(c.id));
  if (!pool.length) pool = DECK.filter(c => c.rarity === rar);
  const c = rnd(pool);
  S.recentCards = [c.id, ...(S.recentCards || [])].slice(0, 25);
  return c.id;
}
function ensureCard(t) {
  const d = day(t);
  if (!d.card) { d.card = { id: drawCard(), rerolled: false }; save(); }
  return d.card;
}

/* ================= вызов недели ================= */
function ensureWeek(w) {
  if (S.weeks[w]) return S.weeks[w];
  const prev = S.weeks[addDays(w, -7)];
  const pool = CHALLENGES.filter(c => !prev || c.id !== prev.ch);
  S.weeks[w] = { ch: rnd(pool).id, marks: [], stake: 0 };
  return S.weeks[w];
}
function challengeResult(w) {
  const wk = S.weeks[w]; if (!wk) return null;
  const c = CH[wk.ch]; const done = wk.marks.length >= c.n;
  const over = addDays(w, 6) < todayKey();
  return { c, wk, done, over, lost: over && !done && wk.stake > 0 };
}

/* ================= монеты, опыт ================= */
const recCoins = r => r.c ?? Math.round(10 * r.v);
const allSide = () => SIDE.filter(x => (S.sideList || []).includes(x.id)).concat(S.custom);
function coins() {
  let earned = 0;
  for (const k in S.days) {
    const d = S.days[k];
    for (const id in d.q) earned += recCoins(d.q[id]);
    if (d.card?.done) earned += d.card.done.c || 0;
  }
  for (const s of allSide()) earned += (S.side[s.id] || []).length * Math.round(s.xp / 5);
  for (const w in S.weeks) { const r = challengeResult(w); if (r?.done) earned += 100 + r.wk.stake * 2; }
  earned += Object.keys(S.ach).length * 50;
  for (const b of S.bosses) earned += bossXpCoins(b).c;
  let spent = S.shop.bought.reduce((s, b) => s + b.price, 0);
  for (const w in S.weeks) spent += S.weeks[w].stake || 0;
  return earned - spent;
}
const thresh = (L, base) => base * L * (L - 1) / 2;
function levelOf(xp, base = 100) { let L = 1; while (xp >= thresh(L + 1, base)) L++; return { L, from: thresh(L, base), to: thresh(L + 1, base) }; }
function xpAll() {
  const st = Object.fromEntries(Object.keys(STATS).map(k => [k, 0]));
  for (const k in S.days) {
    const d = S.days[k];
    for (const id in d.q) { const q = Q[id]; if (q) st[q.stat] += Math.round(20 * d.q[id].v); }
    if (d.card?.done) { const c = CARD[d.card.id]; if (c) st[c.stat] += Math.round(RARITY[c.rarity].xp * d.card.done.v); }
  }
  for (const s of allSide()) for (const _ of (S.side[s.id] || [])) st[s.stat] += s.xp;
  for (const b of S.bosses) st[b.stat] = (st[b.stat] || 0) + bossXpCoins(b).xp;
  for (const e of S.events) if (e.type === 'auto' && Q[e.id]) st[Q[e.id].stat] += 300;
  for (const w in S.weeks) { const r = challengeResult(w); if (r?.done) st[r.c.stat] += 150; }
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  return { total, st };
}

/* ================= качество отметок ================= */
function wakeQuality(date) { const diff = nowSh(date) - shMin(S.settings.wake); return diff <= 60 ? 1 : diff <= 180 ? .5 : .25; }
function bedQuality(date) { const target = shMin(S.settings.bed); const m = nowSh(date); return m <= target ? 1 : m <= target + 90 ? .5 : .25; }
function smokeLimit(k) {
  const prevW = addDays(weekOf(k), -7); let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) { const d = peekDay(addDays(prevW, i)); if (typeof d.cigs === 'number' && d.q.smoke) { sum += d.cigs; n++; } }
  return n < 3 ? null : Math.max(0, Math.round(sum / n) - 1);
}
function smokeQuality(k, count) { const lim = smokeLimit(k); return lim === null ? 1 : count <= lim ? 1 : count <= lim + 2 ? .5 : .25; }

/* ================= спринт-детектор ================= */
let markLog = [];      // [{ts, kind, id, day}] — отметки текущей сессии
function logMark(entry) {
  markLog.push(entry);
  const since = S.sprintReset || 0;
  const recent = markLog.filter(m => m.ts >= since && entry.ts - m.ts <= SPRINT_MS);
  if (recent.length >= SPRINT_COUNT) {
    S.sprintReset = entry.ts + 1;
    ui.sheet = { type: 'sprint', marks: recent.slice(-SPRINT_COUNT) };
  }
}
const sprintsIn = w => S.sprints.filter(s => s.kept && s.day >= w && s.day <= addDays(w, 6)).length;
const flagged = w => sprintsIn(w) >= SPRINT_FLAG;

/* ================= оценка недели ================= */
function weekScore(w) {
  const t = todayKey(); const { shieldDays } = streakInfo();
  const from = w < S.created ? S.created : w;
  const end = addDays(w, 6) < t ? addDays(w, 6) : t;
  const keys = []; for (let k = from; k <= end; k = addDays(k, 1)) keys.push(k);
  if (!keys.length) return null;
  let qSum = 0, qDays = 0, stable = 0, verified = 0, marks = 0, cards = 0;
  const perQuest = {};
  for (const k of keys) {
    const d = peekDay(k);
    const act = CATALOG.filter(q => activeOn(q.id, k));
    const done = anyDone(k), shield = shieldDays.has(k);
    if (done || shield) stable++;
    for (const q of act) { perQuest[q.id] ||= { done: 0, days: 0 }; perQuest[q.id].days++; if (d.q[q.id]) perQuest[q.id].done++; }
    for (const id in d.q) { marks++; if (['photo', 'timer', 'text'].includes(d.q[id].proof)) verified++; }
    if (d.card?.done) { cards++; marks++; if (d.card.done.proof) verified++; }
    if (shield || !act.length || (k === t && !done)) continue;
    qDays++; qSum += act.reduce((s, q) => s + (d.q[q.id]?.v || 0), 0) / act.length;
  }
  const denom = keys.length - (keys.includes(t) && !anyDone(t) ? 1 : 0);
  const quests = qDays ? qSum / qDays * 60 : (stable ? 60 : 0);
  const stability = denom ? stable / denom * 20 : 20;
  const boss = bossScore(w);
  const ch = challengeResult(w);
  const rushWhy = [];
  if (allSide().some(s => (S.side[s.id] || []).some(d => d >= w && d <= addDays(w, 6)))) rushWhy.push('сайд-квест');
  if (ch?.done) rushWhy.push('вызов недели');
  if (S.events.some(e => e.type === 'auto' && e.day >= w && e.day <= addDays(w, 6))) rushWhy.push('автопилот');
  if (S.events.some(e => e.type === 'bosskill' && e.day >= w && e.day <= addDays(w, 6))) rushWhy.push('победа над боссом');
  if (cards >= 5) rushWhy.push('5 карт дня');
  const rush = rushWhy.length ? 10 : 0;
  if (ch) { const wk = ch.wk; marks += wk.marks.length; verified += wk.marks.filter(m => m.proof).length; }
  const total = Math.round(quests + stability + boss + rush);
  return { total, quests, stability, boss, rush, rushWhy, perQuest, keys, stable, denom, verified, marks, cards,
    flagged: flagged(w), live: addDays(w, 6) >= t };
}
const rankOf = s => RANKS.find(([min]) => s >= min)[1];

/* ================= ачивки ================= */
function maxRun(from, to, pred) { let run = 0, best = 0; for (let k = from; k <= to; k = addDays(k, 1)) { run = pred(k) ? run + 1 : 0; best = Math.max(best, run); } return best; }
function achTests() {
  const t = todayKey(), y = addDays(t, -1);
  const allRecs = []; const cardsDone = [];
  for (const k in S.days) { const d = S.days[k]; for (const id in d.q) allRecs.push({ id, ...d.q[id] }); if (d.card?.done) cardsDone.push(d.card); }
  const weekMarks = Object.values(S.weeks).flatMap(w => w.marks);
  const proofs = p => allRecs.filter(r => r.proof === p).length + cardsDone.filter(c => c.done.proof === p).length + weekMarks.filter(m => m.proof === p).length;
  const si = streakInfo();
  const weeks = []; for (let w = weekOf(S.created); w <= weekOf(t); w = addDays(w, 7)) weeks.push(w);
  const pastScores = weeks.filter(w => addDays(w, 6) < t).map(w => weekScore(w)?.total || 0);
  const bossBest = S.bosses.reduce((m, b) => Math.max(m, bossPct(b)), 0);
  const chDone = weeks.map(challengeResult).filter(r => r?.done);
  return {
    first: allRecs.length + cardsDone.length > 0,
    shower7: maxRun(S.created, t, k => doneOn('shower', k)) >= 7,
    wake7: maxRun(S.created, t, k => peekDay(k).q.wake?.v === 1) >= 7,
    streak14: si.best >= 14, streak30: si.best >= 30,
    week60: pastScores.some(s => s >= 60), week80: pastScores.some(s => s >= 80),
    boss5: bossBest >= .05, boss25: bossBest >= .25, bosskill: S.bosses.some(b => b.defeated),
    card10: cardsDone.length >= 10,
    legend: cardsDone.some(c => CARD[c.id]?.rarity === 'l'),
    reroll: cardsDone.some(c => c.rerolled),
    challenge: chDone.length > 0, stake: chDone.some(r => r.wk.stake > 0),
    autopilot: S.events.some(e => e.type === 'auto'),
    doctor: (S.side['dent-go'] || []).length + (S.side['ther-go'] || []).length > 0,
    photo20: proofs('photo') >= 20, timer10: proofs('timer') >= 10,
    honest: S.sprints.some(s => !s.kept),
    nights7: daysBetween(S.created, t) >= 7 && maxRun(S.created, y, k => !peekDay(k).nosleep) >= 7,
    shop: S.shop.bought.length > 0,
    journal7: allRecs.filter(r => r.id === 'journal').length >= 7,
  };
}
function checkAch() {
  const t = todayKey(); const got = [];
  if (flagged(weekOf(t))) return got;    // в подозрительную неделю ачивки заморожены
  const tests = achTests();
  for (const a of ACHIEVEMENTS) if (!S.ach[a.id] && tests[a.id]) { S.ach[a.id] = t; got.push(a); }
  return got;
}

/* ================= босс ================= */
const BT = Object.fromEntries(BOSS_TYPES.map(b => [b.id, b]));
const activeBosses = () => S.bosses.filter(b => !b.defeated);
const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmtN = (n, unit) => { const r = Math.round(n * 10) / 10; return unit === '₽' ? rub(r) : `${r.toLocaleString('ru-RU')}${unit ? '\u00a0' + unit : ''}`; };
function makeBoss(d, t) {
  const T = BT[d.type];
  return { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: d.type,
    name: (d.name || '').trim() || T.defName || T.name, stat: T.pickStat ? (d.stat || 'mind') : T.stat,
    unit: T.id === 'custom' ? ((d.unit || '').trim() || 'раз') : T.unit,
    total: num(d.total), weekly: num(d.weekly), start: num(d.start), target: num(d.target), heal: num(d.heal) || 3,
    hits: [], created: t, defeated: null };
}
function bossProblem(d) {
  const T = BT[d.type];
  if (T.mode === 'measure') { if (!(num(d.start) > 0) || !(num(d.target) > 0)) return 'Заполни текущее значение и цель'; if (num(d.start) === num(d.target)) return 'Цель совпадает с текущим значением'; return ''; }
  return num(d.total) > 0 ? '' : 'Укажи цель больше нуля';
}
function bossState(b, upto) {
  const T = BT[b.type], hits = b.hits.filter(h => !upto || h.day <= upto);
  if (T.mode === 'sum') { const dealt = hits.reduce((s, h) => s + h.amount, 0); return { max: b.total, hp: Math.max(0, b.total - dealt), dealt }; }
  if (T.mode === 'measure') {
    const cur = hits.length ? hits[hits.length - 1].value : b.start, dir = b.start >= b.target ? 1 : -1, max = Math.abs(b.start - b.target) || 1;
    return { max, hp: Math.max(0, (cur - b.target) * dir), cur, dir };
  }
  let streak = 0;
  for (const h of [...hits].sort((a, c) => a.day < c.day ? -1 : 1)) streak = h.clean ? streak + 1 : Math.max(0, streak - (b.heal || 3));
  return { max: b.total, hp: Math.max(0, b.total - streak), streak };
}
const bossPct = b => { const st = bossState(b); return Math.min(1, Math.max(0, 1 - st.hp / st.max)); };
function bossWeek(b, w) {
  const T = BT[b.type], end = addDays(w, 6), inW = b.hits.filter(h => h.day >= w && h.day <= end);
  if (T.mode === 'sum') return inW.reduce((s, h) => s + h.amount, 0);
  if (T.mode === 'streak') return inW.filter(h => h.clean).length;
  if (!inW.length) return 0;
  const before = b.hits.filter(h => h.day < w), base = before.length ? before[before.length - 1].value : b.start;
  return (base - inW[inW.length - 1].value) * (b.start >= b.target ? 1 : -1);
}
function bossXpCoins(b) {
  const T = BT[b.type]; let xp = 0, c = 0, prev = b.start;
  for (const h of b.hits) {
    if (T.mode === 'sum') xp += Math.round(Math.min(300, Math.max(5, h.amount / (b.total || 1) * 1000)));
    else if (T.mode === 'measure') { const dir = b.start >= b.target ? 1 : -1; xp += 10 + Math.round(Math.min(300, Math.max(0, (prev - h.value) * dir / (Math.abs(b.start - b.target) || 1) * 1000))); prev = h.value; }
    else xp += h.clean ? 15 : 0;
    c += T.mode === 'streak' && !h.clean ? 0 : 5;
  }
  if (b.defeated) { xp += 500; c += 200; }
  return { xp, c };
}
function bossScore(w) {
  const end = addDays(w, 6);
  const list = S.bosses.filter(b => b.created <= end && (!b.defeated || b.defeated >= w));
  if (!list.length) return 10;
  return list.reduce((s, b) => { const p = bossWeek(b, w); return s + (b.weekly > 0 ? Math.min(1, Math.max(0, p / b.weekly)) : (p > 0 ? 1 : 0)); }, 0) / list.length * 10;
}
function checkBossKill(b, t) {
  if (!b.defeated && bossState(b).hp <= 0) { b.defeated = t; S.events.push({ day: t, type: 'bosskill', id: b.id }); return true; }
  if (b.defeated && bossState(b).hp > 0) b.defeated = null;
  return false;
}

/* ================= отметки ================= */
function mark(id, t, rec) {
  rec.ts = rec.ts || Date.now();
  day(t).q[id] = rec;
  logMark({ ts: rec.ts, kind: 'q', id, day: t });
}
function markCard(t, rec) {
  const d = day(t); rec.ts = Date.now(); d.card.done = rec;
  logMark({ ts: rec.ts, kind: 'card', id: d.card.id, day: t });
}
function markChallenge(t, proof) {
  const wk = ensureWeek(weekOf(t)); const ts = Date.now();
  wk.marks.push({ day: t, ts, proof: proof || '' });
  logMark({ ts, kind: 'ch', id: wk.ch, day: t });
}
function undoMark(m) {
  if (m.kind === 'q') delete day(m.day).q[m.id];
  else if (m.kind === 'card') { const d = day(m.day); if (d.card) delete d.card.done; }
  else if (m.kind === 'ch') { const wk = S.weeks[weekOf(m.day)]; if (wk) wk.marks = wk.marks.filter(x => x.ts !== m.ts); }
}

/* ================= уведомления на экране ================= */
function toast(msg, gold) {
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast' + (gold ? ' gold' : ''); el.textContent = msg;
  box.appendChild(el); setTimeout(() => el.remove(), 2800);
}
function afterChange(prevXp, prevCoins) {
  const notes = evolve();
  const got = checkAch();
  const now = xpAll(), c = coins();
  const L = levelOf(now.total).L;
  save(); render();
  const bits = [];
  if (prevXp !== undefined && now.total > prevXp) bits.push(`+${now.total - prevXp} опыта`);
  if (prevCoins !== undefined && c > prevCoins) bits.push(`+${c - prevCoins} монет`);
  if (bits.length) toast(bits.join(' · '));
  let delay = 500;
  if (L > (S.lastLevel || 1)) {
    const slotsUp = slotsFor(L) > slotsFor(S.lastLevel || 1);
    S.lastLevel = L; save();
    setTimeout(() => toast(`Новый уровень: ${L}${slotsUp ? '. Открыт новый слот для квеста' : ''}`, true), delay); delay += 800;
  }
  if (got.length) { setTimeout(() => toast(got.length === 1 ? `Ачивка: ${got[0].title}` : `Новые ачивки: ${got.map(a => a.title).join(', ')}`, true), delay); delay += 800; }
  notes.forEach(n => { setTimeout(() => toast(n, true), delay); delay += 800; });
}

/* ================= иконки ================= */
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  shield: '<svg class="shield" viewBox="0 0 22 26"><path d="M11 1.5 2 5v7c0 6 4 10.5 9 12.5 5-2 9-6.5 9-12.5V5z"/></svg>',
  coin: '<svg class="coin" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5"/><path d="M7 10h6M10 7v6"/></svg>',
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  quests: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9M8 6.5c5 1 8 2.5 8 4M8 17.5c5-1 8-2.5 8-4"/></svg>',
  week: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/></svg>',
  report: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/></svg>',
};

/* ================= мини-гайд ================= */
const GUIDE = [
  { eyebrow: 'Шаг 1 из 4 · Как это работает', title: 'Игра, где прокачиваешься ты',
    body: `<ul class="glist">
      <li><b>Квесты дня.</b> Привычки, которые ты сам выбираешь из каталога. Слотов сначала два, новые открываются с уровнем. Взять всё сразу нельзя специально.</li>
      <li><b>Карта дня.</b> Каждый день случайное задание из колоды. Ты не знаешь, что выпадет. Не нравится — можно перетянуть один раз.</li>
      <li><b>Вызов недели.</b> Одно задание посложнее на всю неделю. На него можно поставить монеты.</li>
      <li><b>Оценка недели из 100</b> и карточка, которую можно отправить друзьям.</li>
      <li><b>Боссы.</b> Большие цели с полоской здоровья: долг, вес, вредная привычка, чтение и другие.</li>
      <li><b>Монеты</b> тратишь в магазине на награды, которые придумаешь сам.</li></ul>` },
  { eyebrow: 'Шаг 2 из 4 · Правила честной игры', title: 'Накликать не получится',
    body: `<ul class="glist warn">
      <li><b>Отметки только в своё окно.</b> Подъём — до 14:00, душ — 2 часа после подъёма, вечерние квесты — только вечером. Задним числом нельзя.</li>
      <li><b>Одно исправление в неделю.</b> Если реально забыл нажать вчера. Засчитывается вполсилы и без монет.</li>
      <li><b>Фото только с камеры.</b> Для части квестов и карт. Без фото — половина опыта и ноль монет.</li>
      <li><b>Таймеры.</b> Прогулка, чтение, учёба — «Старт» и «Финиш». Раньше времени не засчитается.</li>
      <li><b>Детектор спринт-кликера.</b> Три отметки меньше чем за минуту — приложение спросит, всё ли честно. Две такие ситуации за неделю — неделя получает ⚠, ачивки замораживаются, а на карточке для друзей это видно.</li>
      <li><b>Ачивки нельзя нажать.</b> Они выдаются сами по твоим данным.</li></ul>` },
  { eyebrow: 'Шаг 3 из 4 · Важно знать', title: 'Пара предупреждений',
    body: `<ul class="glist warn">
      <li><b>Данные живут только на этом телефоне.</b> Удалишь иконку или очистишь Safari — пропадёт всё. Раз в неделю сохраняй резервную копию в Профиле.</li>
      <li><b>Сами уведомления приложение не присылает.</b> Напоминания можно добавить в Календарь айфона кнопкой у квеста.</li>
      <li><b>Фото хранятся 2 недели</b> и в резервную копию не попадают.</li>
      <li><b>Это не врач и не психолог.</b> Со здоровьем и сном — к специалисту. Для этого есть сайд-квесты с большим опытом.</li></ul>` },
  { eyebrow: 'Шаг 4 из 4 · Про срывы', title: 'Пропуск — это просто день',
    body: `<ul class="glist">
      <li><b>Два щита в неделю.</b> Пропущенный день закрывается щитом без штрафа.</li>
      <li><b>Серия не обнуляется.</b> Если щиты кончились, она падает наполовину.</li>
      <li><b>Не ложился спать?</b> Есть кнопка, чтобы записать это и причину. Без наказания — чтобы потом увидеть в отчёте, откуда растут ноги.</li>
      <li><b>Автопилот.</b> Привычка, которая держится 21 день из 28, уходит из списка и освобождает слот. Приложение со временем становится нужно меньше — так и задумано.</li></ul>` },
];
function viewGuide(step, final) {
  const g = GUIDE[step];
  return pagerNav(`<section class="guide pager" data-next="guide-next" data-back="${step > 0 ? 'guide-back' : ''}">
    <div class="dots">${GUIDE.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <span class="label">${g.eyebrow}</span>
    <h1>${g.title}</h1>
    ${g.body}
  </section>`, step > 0 ? '<button class="btn ghost" data-a="guide-back">Назад</button>' : '<span></span>',
    `<button class="btn" data-a="guide-next">${step < GUIDE.length - 1 ? 'Дальше' : final}</button>`);
}

/* Многостраничные экраны: кнопки всегда в одном месте внизу, листание свайпом */
function pagerNav(content, left, right) {
  return `${content}<nav class="pager-nav"><div class="pager-in">${left}${right}</div></nav>`;
}
let swipe = null;
document.addEventListener('touchstart', e => {
  const pg = e.target.closest('.pager'); if (!pg || e.target.closest('input, textarea, select')) { swipe = null; return; }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, pg };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, pg = swipe.pg; swipe = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const act = dx < 0 ? pg.dataset.next : pg.dataset.back; if (!act) return;
  document.querySelector(`.pager-nav [data-a="${act}"]`)?.click();
});
function animatePager() {
  const pg = document.querySelector('.pager'); if (!pg || !ui.slide) return;
  pg.classList.add(ui.slide === 'back' ? 'in-back' : 'in-next'); ui.slide = null;
}

/* ================= экраны ================= */
const WIZ = ['name', 'day', 'quests', 'bosses', 'side', 'rewards', 'style'];
function newWiz() {
  return { step: 0, mode: 'new', d: { name: '', wake: '09:00', bed: '01:00', quests: ['wake', 'shower'], bosses: [], keep: [],
    side: SIDE_DEFAULT.slice(), custom: [], rewards: DEFAULT_REWARDS.map(r => ({ ...r, on: true })), tone: 'roast', theme: 'auto' } };
}
function editWiz() {
  return { step: 0, mode: 'edit', d: { name: S.profile.name || '', wake: S.settings.wake, bed: S.settings.bed,
    quests: activeQuests().map(q => q.id), bosses: [], keep: activeBosses().map(b => b.id),
    side: S.sideList.slice(), custom: S.custom.map(c => ({ ...c })), rewards: S.shop.rewards.map(r => ({ ...r, on: true })),
    tone: S.settings.tone, theme: S.settings.theme || 'auto' } };
}
function wizSet(path, v) {
  const d = ui.wiz?.d; if (!d) return;
  d[path] = v;
}
const wizQuestLimit = () => ui.wiz.mode === 'new' ? 2 : slotsFor(levelOf(xpAll().total).L);
function wizProblem() {
  const d = ui.wiz.d, step = WIZ[ui.wiz.step];
  if (step === 'name' && !d.name.trim()) return 'Напиши, как к тебе обращаться';
  if (step === 'quests' && !d.quests.length) return 'Выбери хотя бы один квест';
  if (step === 'bosses') { for (const b of d.bosses) { const e = bossProblem(b); if (e) return `${BT[b.type].name}: ${e.toLowerCase()}`; } }
  return '';
}
function viewWizard() {
  const w = ui.wiz, d = w.d, step = WIZ[w.step], last = w.step === WIZ.length - 1;
  const head = (title, sub) => `<div class="dots">${WIZ.map((_, i) => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>
    <span class="label">${w.mode === 'new' ? 'Анкета' : 'Обнови анкету'} · шаг ${w.step + 1} из ${WIZ.length}</span><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}`;
  let body = '';
  if (step === 'name') body = head('Как тебя зовут?', 'Так приложение будет к тебе обращаться. Имя увидят только те, кому ты сам отправишь карточку недели.')
    + `<input type="text" data-wf="name" id="wz-name" maxlength="24" placeholder="Имя или ник" value="${esc(d.name)}" autocomplete="given-name">`;
  else if (step === 'day') body = head('Твой режим', 'От этого зависят окна отметок: подъём засчитывается полностью в течение часа от цели, отбой — до цели.')
    + `<div class="grid2"><label class="field"><span>Во сколько встаёшь</span><input type="time" data-wf="wake" value="${d.wake}"></label>
       <label class="field"><span>Во сколько ложишься</span><input type="time" data-wf="bed" value="${d.bed}"></label></div>
       <p class="muted small">День в приложении заканчивается в 04:00. Если лёг в 2 ночи, это засчитается во вчерашний день.</p>`;
  else if (step === 'quests') {
    const lim = wizQuestLimit();
    body = head('С чего начнём', `Выбери до ${lim} ${plural(lim, 'квеста', 'квестов', 'квестов')} на каждый день. Остальные возьмёшь позже, когда откроются слоты. Мало — это специально.`)
      + Object.entries(STATS).map(([sk, sv]) => `<div class="cat-head" data-stat="${sk}"><span class="chip">${sv.name}</span></div><div class="chips">${CATALOG.filter(q => q.stat === sk && qStatusSafe(q.id) !== 'auto').map(q =>
        `<button class="pill${d.quests.includes(q.id) ? ' on' : ''}" data-a="wz-q" data-id="${q.id}">${esc(q.title)}${['wake', 'shower'].includes(q.id) && w.mode === 'new' ? ' ★' : ''}</button>`).join('')}</div>`).join('')
      + `<p class="muted small">Выбрано: <b class="mono">${d.quests.length}/${lim}</b>${w.mode === 'new' ? ' · ★ — советую начать с них: режим тянет за собой всё остальное' : ''}</p>`;
  } else if (step === 'bosses') {
    const kept = w.mode === 'edit' ? activeBosses() : [];
    const total = d.keep.length + d.bosses.length;
    body = head('Боссы', 'Большие цели с полоской здоровья. Необязательно, можно пропустить и добавить позже во вкладке «Квесты».')
      + (kept.length ? `<div class="label">Уже есть</div>${kept.map(b => `<div class="side"><div style="min-width:0"><div class="side-title">${esc(b.name)}</div><span class="muted small">${esc(BT[b.type].name)} · ${Math.round(bossPct(b) * 100)}%</span></div>
          <button class="pill${d.keep.includes(b.id) ? ' on' : ''}" data-a="wz-keep" data-id="${b.id}">${d.keep.includes(b.id) ? 'Оставить' : 'Убрать'}</button></div>`).join('')}` : '')
      + d.bosses.map((b, i) => `<div class="card wb"><div class="section-head"><b>${esc(BT[b.type].name)}</b><button class="linkbtn" data-a="wz-bdel" data-i="${i}">убрать</button></div>${bossForm(b, 'wbk', i)}</div>`).join('')
      + (total < BOSS_LIMIT ? `<div class="label">Добавить${total ? ' ещё' : ''} · максимум ${BOSS_LIMIT}</div><div class="btypes">${BOSS_TYPES.map(T => `<button class="btype" data-stat="${T.stat}" data-a="wz-badd" data-t="${T.id}"><b>${esc(T.name)}</b><span class="muted small">${esc(T.desc)}</span></button>`).join('')}</div>` : `<p class="muted small">Это максимум: ${BOSS_LIMIT} босса одновременно.</p>`);
  } else if (step === 'side') {
    body = head('Разовые дела', 'То, что давно откладываешь. Каждое дело делается один раз и даёт много опыта. Отметь нужные и добавь свои.')
      + `<div class="chips">${SIDE.map(sq => `<button class="pill${d.side.includes(sq.id) ? ' on' : ''}" data-a="wz-side" data-id="${sq.id}">${esc(sq.title)}</button>`).join('')}</div>`
      + (d.custom.length ? `<div class="label">Свои</div>${d.custom.map((c, i) => `<div class="side"><div class="side-title">${esc(c.title)}</div><button class="linkbtn" data-a="wz-cdel" data-i="${i}">убрать</button></div>`).join('')}` : '')
      + `<div class="row"><input type="text" class="grow" id="wz-ctitle" maxlength="80" placeholder="Своё дело, например: продлить паспорт"><button class="btn sm" data-a="wz-cadd">Добавить</button></div>`;
  } else if (step === 'rewards') {
    body = head('Награды', 'За квесты капают монеты. Здесь решаешь, на что их тратить. Отдых по плану — часть игры, а не срыв.')
      + d.rewards.map((r, i) => `<div class="side"><div style="min-width:0"><div class="side-title">${esc(r.title)}</div><span class="muted small mono">${r.price} монет</span></div>
         <button class="pill${r.on ? ' on' : ''}" data-a="wz-rw" data-i="${i}">${r.on ? 'Беру' : 'Не надо'}</button></div>`).join('')
      + `<div class="grid2"><input type="text" id="wz-rtitle" maxlength="60" placeholder="Своя награда"><input type="number" id="wz-rprice" min="10" step="10" placeholder="Цена в монетах"></div>
         <button class="btn sm ghost" data-a="wz-radd" style="align-self:flex-start">Добавить награду</button>
         <p class="muted small">Ориентир: за обычный день набирается 30–60 монет.</p>`;
  } else {
    body = head('Последнее', 'Как с тобой разговаривать и как выглядеть.')
      + `<div class="field"><span>Тон недельной сводки</span><div class="seg"><button class="${d.tone === 'roast' ? 'on' : ''}" data-a="wz-tone" data-v="roast">С подколом</button><button class="${d.tone !== 'roast' ? 'on' : ''}" data-a="wz-tone" data-v="neutral">Нейтральный</button></div></div>
         <div class="field"><span>Тема</span><div class="seg seg3">${[['auto', 'Авто'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, n]) => `<button class="${d.theme === v ? 'on' : ''}" data-a="wz-theme" data-v="${v}">${n}</button>`).join('')}</div></div>
         <ul class="glist"><li><b>Напоминания</b> поставишь во вкладке «Квесты»: время у квеста → «В Календарь».</li>
         <li><b>Резервная копия.</b> Раз в неделю приложение напомнит её сохранить.</li>
         <li><b>Всё это можно поменять</b> потом: Профиль → «Изменить анкету».</li></ul>`;
  }
  return pagerNav(`<section class="guide wiz pager" data-next="wz-next" data-back="${w.step > 0 ? 'wz-back' : ''}">${body}
    ${w.mode === 'new' && w.step === 0 ? '<button class="linkbtn" data-a="open-import" style="align-self:flex-start">Восстановить из резервной копии</button>' : ''}
  </section>`, w.step > 0 ? '<button class="btn ghost" data-a="wz-back">Назад</button>' : (w.mode === 'edit' ? '<button class="btn ghost" data-a="wz-cancel">Отмена</button>' : '<span></span>'),
    `<button class="btn" data-a="wz-next">${last ? (w.mode === 'new' ? 'Начать игру' : 'Сохранить') : step === 'bosses' && !d.bosses.length && !d.keep.length ? 'Пропустить' : 'Дальше'}</button>`);
}
const qStatusSafe = id => S ? qStatus(id) : 'off';
function wizApply() {
  const d = ui.wiz.d, t = todayKey();
  const rewards = d.rewards.filter(r => r.on).map(({ on, ...r }) => r);
  if (ui.wiz.mode === 'new') {
    S = fresh({ ...d, rewards }); evolve(); save(); ui.wiz = null; ui.tab = 'today'; window.scrollTo(0, 0); render();
    toast(`${d.name.trim()}, сохранение создано. Первые квесты ждут`, true); return;
  }
  S.profile.name = d.name.trim(); Object.assign(S.settings, { wake: d.wake, bed: d.bed, tone: d.tone, theme: d.theme });
  for (const q of activeQuests()) if (!d.quests.includes(q.id)) deactivate(q.id, t);
  for (const id of d.quests) if (qStatus(id) === 'off') activate(id, t);
  S.bosses = S.bosses.filter(b => b.defeated || d.keep.includes(b.id)).concat(d.bosses.map(b => makeBoss(b, t)));
  S.sideList = d.side.slice(); S.custom = d.custom; S.shop.rewards = rewards; S.profileDone = true;
  ui.wiz = null; save(); window.scrollTo(0, 0); render(); toast('Анкета сохранена', true);
}

function viewHeader() {
  const x = xpAll(), lv = levelOf(x.total), t = todayKey();
  const pct = (x.total - lv.from) / (lv.to - lv.from) * 100;
  const si = streakInfo();
  const shields = Array.from({ length: SHIELDS_PER_WEEK }, (_, i) => ICON.shield.replace('class="shield"', `class="shield${i < si.left ? '' : ' used'}"`)).join('');
  return `
  <header class="top">
    <div class="top-row">
      <div style="min-width:0">
        <div class="date-line">${fmtDayLong(t)}</div>
        <h1>${greet()}${S.profile.name ? `, ${esc(S.profile.name)}` : ''}</h1>
      </div>
      <div class="lvl" aria-label="Уровень ${lv.L}"><small>ур.</small><b>${lv.L}</b></div>
    </div>
    <div class="xpbar">
      <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="xpmeta"><span class="mono">${x.total - lv.from} / ${lv.to - lv.from} опыта</span><button class="coins" data-a="go-shop">${ICON.coin}<span class="mono">${coins()}</span></button></div>
    </div>
    <div class="streak">
      <div class="streak-num">${si.streak}</div>
      <div class="streak-txt">${plural(si.streak, 'день', 'дня', 'дней')} подряд<br><span class="muted">Щиты недели: пропуск без штрафа</span></div>
      <div class="shields" aria-label="Осталось щитов: ${si.left}">${shields}</div>
    </div>
  </header>`;
}
function greet() { const h = new Date().getHours(); return h < 5 ? 'Ночь. Пора спать' : h < 12 ? 'Доброе утро' : h < 18 ? 'День в разгаре' : 'Вечер'; }

function timerBlock(key, mins) {
  const tm = S.timers[key];
  if (!tm) return '';
  return `<div class="timer"><span class="mono" data-tick="${key}" data-mins="${mins}">0:00</span><span class="muted small" data-left="${key}" data-mins="${mins}"></span>
    <button class="linkbtn" data-a="timer-cancel" data-k="${key}">сбросить</button></div>`;
}
function actionBtn(kind, q, done, win, extra = '') {
  // кнопка справа на карточке квеста
  const attrs = `data-id="${q.id}" ${extra}`;
  if (done) return `<button class="check" data-a="unmark" ${attrs} aria-label="Снять отметку">${ICON.check}</button>`;
  if (!win.open) return `<button class="check locked" data-a="locked" data-why="${esc(win.why)}" aria-label="Закрыто">${ICON.lock}</button>`;
  if (kind === 'timer') return S.timers[q.id]
    ? `<button class="check run" data-a="timer-stop" data-k="${q.id}" aria-label="Финиш">${ICON.stop}</button>`
    : `<button class="check" data-a="timer-start" data-k="${q.id}" aria-label="Старт">${ICON.play}</button>`;
  if (kind === 'text') return `<button class="check" data-a="text" ${attrs} aria-label="Написать">${ICON.pen}</button>`;
  if (q.proof === 'photo') return `<button class="check" data-a="proof" data-target="q:${q.id}" aria-label="Сфотографировать">${ICON.cam}</button>`;
  return `<button class="check" data-a="toggle" ${attrs} aria-label="Отметить">${ICON.check}</button>`;
}
function questCard(q, t) {
  const d = peekDay(t), rec = d.q[q.id], done = !!rec;
  const win = windowFor(q, t);
  let sub = q.hint, extra = '';
  const gain = rec ? ` · +${Math.round(20 * rec.v)} опыта${recCoins(rec) ? `, +${recCoins(rec)} монет` : ''}` : '';
  const proofTag = rec?.proof === 'photo' ? ' · 📷' : rec?.proof === 'timer' ? ' · ⏱' : rec?.fix ? ' · исправление' : '';
  if (q.kind === 'wake') sub = done ? `Встал в ${rec.time}${gain}` : `Цель ${S.settings.wake}, полный опыт до ${addMin(S.settings.wake, 60)}`;
  else if (q.kind === 'bed') {
    const ns = nosleepFor(t);
    sub = done ? `Лёг в ${rec.time}${gain}` : ns ? 'Записано: не ложился' : `Цель: лечь до ${S.settings.bed}`;
  }
  else if (q.kind === 'smoke') {
    const c = d.cigs || 0, lim = smokeLimit(t);
    sub = done ? `Итог дня: ${c}${gain}` : lim === null ? 'Первая неделя: просто считай' : `Лимит сегодня: ${lim}`;
    extra = `<div class="q-extra"><div class="counter"><button data-a="cig" data-d="-1" aria-label="Минус одна">−</button><span class="mono">${c}</span><button data-a="cig" data-d="1" aria-label="Плюс одна">+</button></div></div>`;
  }
  else if (done) sub = `Готово${gain}${proofTag}`;
  if (!done && q.kind === 'timer' && S.timers[q.id]) extra = timerBlock(q.id, q.mins);
  if (!done && !win.open) sub = win.why;
  else if (!done && win.note && q.kind !== 'wake') sub += ` · ${win.note}`;
  if (!done && q.kind === 'wake' && win.open) extra = `<div class="q-extra"><button class="linkbtn" data-a="time-sheet" data-id="wake">Встал раньше, указать время</button></div>`;
  if (!done && q.kind === 'bed' && win.open && !nosleepFor(t)) extra = `<div class="q-extra"><button class="linkbtn" data-a="time-sheet" data-id="bed">Уже лёг, указать время</button></div>`;
  const kindLabel = q.kind === 'timer' ? ` · ${q.mins} мин` : q.proof === 'photo' ? ' · фото' : q.kind === 'text' ? ' · текст' : '';
  return `
  <article class="q${done ? ' done' : ''}${!done && !win.open ? ' closed' : ''}" data-stat="${q.stat}">
    <div class="q-main">
      <span class="chip">${STATS[q.stat].name}${kindLabel}</span>
      <div class="q-title">${esc(q.title)}</div>
      <div class="q-sub">${esc(sub)}</div>
    </div>
    ${actionBtn(q.kind, q, done || (q.kind === 'bed' && nosleepFor(t)), win)}
    ${extra}
  </article>`;
}

function cardOfDay(t) {
  const cd = ensureCard(t), c = CARD[cd.id]; if (!c) return '';
  const R = RARITY[c.rarity], done = cd.done;
  const timerKey = 'card';
  let btn;
  if (done) btn = `<span class="badge gold">Выполнено · +${Math.round(R.xp * done.v)} опыта${done.c ? `, +${done.c} монет` : ''}</span>`;
  else if (c.mins) btn = S.timers[timerKey]
    ? `<button class="btn sm" data-a="timer-stop" data-k="card">${ICON.stop} Финиш</button>`
    : `<button class="btn sm" data-a="timer-start" data-k="card">${ICON.play} Старт, ${c.mins} мин</button>`;
  else if (c.proof === 'photo') btn = `<button class="btn sm" data-a="proof" data-target="card">${ICON.cam} Сфоткать</button>`;
  else btn = `<button class="btn sm" data-a="card-done">Сделал</button>`;
  return `<section class="dcard r-${c.rarity}" data-stat="${c.stat}">
    <div class="dcard-top"><span class="label">Карта дня</span><span class="rar">${R.name}</span></div>
    <div class="dcard-text">${esc(c.text)}</div>
    <div class="dcard-meta"><span class="chip">${STATS[c.stat].name}</span><span class="muted small">+${R.xp} опыта · +${R.coins} монет${c.proof ? ' · нужно фото' : ''}</span></div>
    ${!done && c.mins && S.timers[timerKey] ? timerBlock(timerKey, c.mins) : ''}
    <div class="row">${btn}${!done && !cd.rerolled ? '<button class="linkbtn" data-a="reroll">Перетянуть (1 раз)</button>' : ''}${!done && cd.rerolled ? '<span class="muted small">Перетянута. Эту уже не сменить</span>' : ''}</div>
  </section>`;
}

function challengeCard(t) {
  const w = weekOf(t), wk = ensureWeek(w), c = CH[wk.ch], r = challengeResult(w);
  const today = wk.marks.some(m => m.day === t);
  const pct = Math.min(100, wk.marks.length / c.n * 100);
  const bal = coins();
  let actions = '';
  if (r.done) actions = `<span class="badge gold">Вызов выполнен · +150 опыта, +${100 + wk.stake * 2} монет</span>`;
  else if (today) actions = `<span class="muted small">Сегодня уже отмечено. Следующая отметка завтра</span>`;
  else actions = c.proof === 'photo'
    ? `<button class="btn sm" data-a="proof" data-target="ch">${ICON.cam} +1 с фото</button>`
    : `<button class="btn sm" data-a="ch-plus">+1 сегодня</button>`;
  let stake = '';
  if (wk.stake) stake = `<p class="small">Ставка: <b class="mono">${wk.stake}</b> монет. Сделаешь — вернётся ×2. Нет — сгорит.</p>`;
  else if (!wk.marks.length && wdIndex(t) <= 2 && !r.done) stake = `<div class="row small"><span class="muted">Поставить монеты:</span>${STAKES.map(s => `<button class="pill" data-a="stake" data-v="${s}" ${bal < s ? 'disabled' : ''}>${s}</button>`).join('')}</div>`;
  return `<section class="card ch" data-stat="${c.stat}">
    <div class="section-head"><span class="label">Вызов недели</span><span class="muted small">до воскресенья</span></div>
    <h2>${esc(c.title)}</h2>
    <div class="bar ch-bar"><i style="width:${pct}%"></i></div>
    <div class="row" style="justify-content:space-between"><span class="mono">${Math.min(wk.marks.length, c.n)}/${c.n}</span>${actions}</div>
    ${stake}
  </section>`;
}

function nosleepFor(k) { return peekDay(k).nosleep; }
function nightKey() { const h = new Date().getHours(); const t = todayKey(); return h >= 4 && h < 16 ? addDays(t, -1) : t; }

function viewToday() {
  const t = todayKey(), y = addDays(t, -1);
  const active = activeQuests();
  let html = viewHeader();

  const prevW = addDays(weekOf(t), -7);
  if (S.seenWeek !== prevW && addDays(prevW, 6) >= S.created) {
    const sc = weekScore(prevW);
    if (sc) html += `<button class="card hl banner" data-a="open-week" data-w="${prevW}">
      <span class="label">Итоги прошлой недели готовы</span>
      <div class="row" style="justify-content:space-between"><span class="rank">${sc.total}/100 · ${rankOf(sc.total)}${sc.flagged ? ' ⚠' : ''}</span><span class="muted">Открыть</span></div></button>`;
  }
  if (daysBetween(S.lastBackup || S.created, t) >= 7) html += `<section class="card hl"><span class="label">Раз в неделю</span><h2>Сохрани резервную копию</h2>
    <p class="muted small">Данные живут только на этом телефоне. Копия займёт 10 секунд.</p><div class="row"><button class="btn sm" data-a="export">Сохранить копию</button><button class="linkbtn" data-a="backup-later">Напомни завтра</button></div></section>`;
  const lastCh = challengeResult(prevW);
  if (lastCh && lastCh.lost && !S.weeks[prevW].seenLoss) html += `<section class="card warnc"><span class="label">Ставка сгорела</span><p>Вызов «${esc(lastCh.c.title)}» не добит: ${lastCh.wk.marks.length}/${lastCh.c.n}. Минус ${lastCh.wk.stake} монет.</p><button class="linkbtn" data-a="seen-loss" data-w="${prevW}" style="align-self:flex-start">Понял</button></section>`;

  if (y >= S.created && !anyDone(y) && !peekDay(y).noted) {
    const d = peekDay(y), tags = d.tags || [];
    html += `<section class="card"><span class="label">Вчера пусто</span><h2>Что помешало?</h2>
      <div class="chips">${SKIP_TAGS.map(tg => `<button class="pill${tags.includes(tg) ? ' on' : ''}" data-a="tag" data-t="${esc(tg)}">${esc(tg)}</button>`).join('')}</div>
      <input type="text" id="note" placeholder="Одна строка, если хочется" value="${esc(ui.noteDraft)}" maxlength="140">
      <div class="row"><button class="btn sm" data-a="save-note">Записать</button><button class="linkbtn" data-a="skip-note">Пропустить</button></div></section>`;
  }

  for (const q of CATALOG) {
    const r = S.quests[q.id];
    if (qStatus(q.id) === 'auto' && r.check !== weekOf(t) && wdIndex(t) >= 5)
      html += `<section class="card hl"><span class="label">Автопилот · раз в неделю</span><h2>«${esc(q.title)}» ещё держится?</h2>
        <div class="row"><button class="btn sm" data-a="auto-yes" data-id="${q.id}">Да, держится</button><button class="btn sm ghost" data-a="auto-no" data-id="${q.id}">Нет, верни в список</button></div></section>`;
  }

  html += cardOfDay(t);

  const doneN = active.filter(q => doneOn(q.id, t)).length;
  html += `<section class="section"><div class="section-head"><h2>Квесты дня</h2><span class="muted mono small">${doneN}/${active.length}</span></div>
    <div class="quests">${active.length ? active.map(q => questCard(q, t)).join('') : '<div class="empty">Активных квестов нет. Возьми в каталоге на вкладке «Квесты».</div>'}</div>`;
  const fixesLeft = FIXES_PER_WEEK - (S.fixes[weekOf(t)] || 0);
  const missedY = y >= S.created ? active.filter(q => activeOn(q.id, y) && !doneOn(q.id, y) && q.kind !== 'smoke') : [];
  if (missedY.length && fixesLeft > 0) html += `<button class="linkbtn" data-a="fix-sheet">Забыл отметить вчера? Исправлений на неделе: ${fixesLeft}</button>`;
  html += `</section>`;

  html += challengeCard(t);

  const nk = nightKey(), ns = nosleepFor(nk);
  html += ns
    ? `<section class="card"><span class="label">Ночь на ${fmtDay(addDays(nk, 1))}</span><p>Записано: не ложился. ${esc((ns.tags || []).join(', '))}${ns.text ? ` — «${esc(ns.text)}»` : ''}</p><button class="linkbtn" data-a="nosleep-undo" style="align-self:flex-start">Убрать запись</button></section>`
    : `<button class="btn ghost" data-a="nosleep-sheet">Не ложился спать</button>`;

  html += activeBosses().map(b => bossCard(b, false)).join('');

  const next = allSide().find(s => !s.repeat && !(S.side[s.id] || []).length);
  if (next) html += `<section class="card"><span class="label">Сайд-квест · один раз</span>
    <div class="side" style="padding:0"><div class="side-title">${esc(next.title)}</div><span class="side-xp">+${next.xp}</span></div>
    <div class="row"><button class="btn sm" data-a="side" data-id="${next.id}">Сделал</button><button class="linkbtn" data-a="tab" data-t="quests">Все сайд-квесты</button></div></section>`;
  return html;
}

function bossCard(b, full) {
  const T = BT[b.type], st = bossState(b), t = todayKey();
  const hpPct = Math.min(100, st.hp / st.max * 100), wk = bossWeek(b, weekOf(t));
  const todayHit = b.hits.find(h => h.day === t);
  let info = '', week = '', controls = '';
  if (b.defeated) {
    return `<section class="card boss won" data-stat="${b.stat}"><div class="boss-top"><span class="boss-name">${esc(b.name)}</span><span class="badge gold">Побеждён · ${fmtDay(b.defeated)}</span></div>
      <span class="muted small">${esc(T.name)} · +500 опыта, +200 монет</span>${full ? `<button class="linkbtn" data-a="boss-undo" data-id="${b.id}" style="align-self:flex-start">отменить последний удар</button>` : ''}</section>`;
  }
  if (T.mode === 'sum') {
    info = `${fmtN(st.dealt, b.unit)} из ${fmtN(b.total, b.unit)}`;
    week = `За неделю: ${fmtN(wk, b.unit)}${b.weekly ? ' из ' + fmtN(b.weekly, b.unit) : ''}`;
    controls = `<div class="row"><input class="grow" id="bh-${b.id}" type="number" inputmode="decimal" min="0" step="${T.step || 1}" placeholder="${esc(T.hitLabel)}" aria-label="${esc(T.hitLabel)}"><button class="btn sm" data-a="boss-hit" data-id="${b.id}">${esc(T.hitBtn)}</button></div>`;
  } else if (T.mode === 'measure') {
    info = `Сейчас ${fmtN(st.cur, b.unit)} → цель ${fmtN(b.target, b.unit)}`;
    week = wk > 0 ? `За неделю ближе к цели на ${fmtN(wk, b.unit)}${b.weekly ? ` из ${fmtN(b.weekly, b.unit)}` : ''}` : wk < 0 ? `За неделю откат на ${fmtN(-wk, b.unit)}` : `За неделю без изменений${b.weekly ? ` · цель ${fmtN(b.weekly, b.unit)}` : ''}`;
    controls = `<div class="row"><input class="grow" id="bh-${b.id}" type="number" inputmode="decimal" min="0" step="${T.step || 1}" placeholder="${esc(T.hitLabel)}" aria-label="${esc(T.hitLabel)}"><button class="btn sm" data-a="boss-hit" data-id="${b.id}">${todayHit ? 'Обновить' : esc(T.hitBtn)}</button></div>${todayHit ? `<span class="muted small">Сегодня записано: ${fmtN(todayHit.value, b.unit)}</span>` : ''}`;
  } else {
    info = `Чистых дней: ${st.streak} из ${b.total}`;
    week = `На этой неделе: ${wk} из ${b.weekly || 7}`;
    controls = todayHit
      ? `<div class="row"><span class="badge ${todayHit.clean ? 'gold' : ''}">${todayHit.clean ? 'Сегодня чистый день' : `Срыв: босс вылечился на ${b.heal} дн.`}</span><button class="linkbtn" data-a="boss-undo" data-id="${b.id}">отменить</button></div>`
      : `<div class="row"><button class="btn sm" data-a="boss-clean" data-id="${b.id}" data-v="1">Чистый день</button><button class="btn sm ghost" data-a="boss-clean" data-id="${b.id}" data-v="0">Сорвался</button></div>
         <span class="muted small">Отмечай вечером. Срыв без штрафа к опыту, но босс лечится.</span>`;
  }
  const hist = full && b.hits.length ? `<div class="muted small">Последние: ${b.hits.slice(-4).reverse().map(h => `${fmtDay(h.day)} — ${T.mode === 'sum' ? fmtN(h.amount, b.unit) : T.mode === 'measure' ? fmtN(h.value, b.unit) : h.clean ? 'чисто' : 'срыв'}`).join(' · ')}
    ${T.mode !== 'streak' ? `<button class="linkbtn" data-a="boss-undo" data-id="${b.id}">отменить последний</button>` : ''}</div>` : '';
  const del = full ? `<button class="linkbtn" data-a="boss-del" data-id="${b.id}" style="align-self:flex-start">удалить босса</button>` : '';
  return `<section class="card boss" data-stat="${b.stat}">
    <div class="boss-top"><span class="boss-name">${esc(b.name)}</span><span class="chip">${esc(T.name)}</span></div>
    <div class="hp" role="img" aria-label="Здоровье босса ${Math.round(hpPct)}%"><i style="width:${hpPct.toFixed(1)}%"></i></div>
    <div class="hp-meta"><span>${info}</span><span class="mono">${Math.round(bossPct(b) * 100)}%</span></div>
    <span class="muted small">${week}</span>
    ${controls}${hist}${del}
  </section>`;
}

function bossForm(d, prefix, idx) {
  // поля для создания босса: в анкете и в листе «Новый босс»
  const T = BT[d.type];
  return `<div class="bform" data-stat="${T.stat}"${idx !== undefined ? ` data-bi="${idx}"` : ''}>
    <label class="field"><span>Название босса</span><input type="text" maxlength="40" data-${prefix}="name" value="${esc(d.name ?? T.defName)}" placeholder="${esc(T.defName || 'Например: Курсовая')}"></label>
    ${T.pickStat ? `<label class="field"><span>Характеристика</span><select data-${prefix}="stat">${Object.entries(STATS).map(([k, v]) => `<option value="${k}" ${(d.stat || 'mind') === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>` : ''}
    <div class="grid2">${T.fields.map(f => `<label class="field"><span>${esc(f.label)}</span><input ${f.text ? 'type="text" maxlength="12"' : `type="number" inputmode="decimal" min="0" step="${f.step || 1}"`} data-${prefix}="${f.k}" value="${esc(d[f.k] ?? '')}" placeholder="${esc(f.ph)}"></label>`).join('')}</div>
  </div>`;
}

function viewBosses() {
  const act = activeBosses(), won = S.bosses.filter(b => b.defeated);
  let html = `<section class="section"><div class="section-head"><h2>Боссы</h2><span class="muted small mono">${act.length}/${BOSS_LIMIT}</span></div>
    <p class="muted small">Большие цели с полоской здоровья. У каждого типа свой способ наносить урон.</p>`;
  html += act.map(b => bossCard(b, true)).join('') || '<div class="empty">Боссов нет. Добавь первого: долг, вес, вредная привычка, чтение — что угодно большое.</div>';
  if (act.length < BOSS_LIMIT) html += `<button class="btn ghost" data-a="boss-new">Новый босс</button>`;
  if (won.length) html += `<div class="label">Трофеи</div>` + won.map(b => bossCard(b, true)).join('');
  return html + '</section>';
}

function viewQuests() {
  const t = todayKey(), L = levelOf(xpAll().total).L, slots = slotsFor(L);
  const active = activeQuests(), free = slots - active.length;
  let html = `<header class="top"><span class="label">Квесты</span><h1>Твой набор привычек</h1>
    <p class="muted">Слоты: <b class="mono">${active.length}/${slots}</b>. ${slots < 6 ? `Следующий слот на уровне ${slotLevel(slots + 1)}.` : 'Все слоты открыты.'} Привычка, которая держится ${AUTO_NEED} дней из ${AUTO_WINDOW}, уходит на автопилот и освобождает слот.</p></header>`;

  html += `<section class="card"><h2>Активные</h2>${active.length ? active.map(q => {
    const r = S.quests[q.id], since = r.periods[r.periods.length - 1].from, have = countDone(q.id, t, AUTO_WINDOW);
    const rem = S.settings.remind[q.id] || '';
    return `<div class="aq" data-stat="${q.stat}"><div class="row" style="justify-content:space-between"><div style="min-width:0"><div class="side-title">${esc(q.title)}</div><span class="muted small">с ${fmtDay(since)} · до автопилота ${have}/${AUTO_NEED}</span></div>
      <button class="linkbtn" data-a="q-drop" data-id="${q.id}">убрать</button></div>
      <div class="mini"><i style="width:${Math.min(100, have / AUTO_NEED * 100)}%"></i></div>
      <div class="row remind"><span class="muted small">Напоминание</span><input type="time" id="rm-${q.id}" value="${rem}" aria-label="Время напоминания"><button class="btn sm ghost" data-a="ics" data-id="${q.id}">В Календарь</button></div></div>`;
  }).join('') : '<div class="empty">Пусто. Возьми квест из каталога ниже.</div>'}
    ${active.length > 1 ? '<button class="btn sm ghost" data-a="ics-all" style="align-self:flex-start">Все напоминания в Календарь</button>' : ''}
    <p class="muted small">Календарь айфона сам пришлёт уведомление в нужное время каждый день.</p></section>`;


  html += viewBosses();

  const auto = CATALOG.filter(q => qStatus(q.id) === 'auto');
  if (auto.length) html += `<section class="card"><h2>На автопилоте</h2>${auto.map(q => `<div class="side"><div class="side-title">${esc(q.title)}</div><span class="badge gold">★</span></div>`).join('')}</section>`;

  html += `<section class="card"><div class="section-head"><h2>Каталог</h2><span class="label">${free > 0 ? `свободно слотов: ${free}` : 'слоты заняты'}</span></div>`;
  for (const [sk, sv] of Object.entries(STATS)) {
    const list = CATALOG.filter(q => q.stat === sk && qStatus(q.id) === 'off');
    if (!list.length) continue;
    html += `<div class="cat-head" data-stat="${sk}"><span class="chip">${sv.name}</span></div>`;
    html += list.map(q => {
      const tag = q.kind === 'timer' ? `таймер ${q.mins} мин` : q.proof === 'photo' ? 'с фото' : q.kind === 'text' ? 'текст' : q.from && q.from !== '04:00' && q.from !== '06:00' ? `с ${q.from}` : '';
      return `<div class="side"><div style="min-width:0"><div class="side-title">${esc(q.title)}</div><span class="muted small">${esc(q.hint)}${tag ? ` · ${tag}` : ''}</span></div>
        ${free > 0 ? `<button class="btn sm" data-a="q-take" data-id="${q.id}">Взять</button>` : `<span class="badge">${ICON.lock}</span>`}</div>`;
    }).join('');
  }
  html += `</section>`;

  const w = weekOf(t);
  html += `<section class="card"><div class="section-head"><h2>Сайд-квесты</h2><span class="label">разовые</span></div><div>`;
  for (const s of allSide()) {
    const ds = S.side[s.id] || [];
    const done = s.repeat === 'week' ? ds.some(d => d >= w) : ds.length > 0;
    html += `<div class="side${done ? ' done' : ''}"><div style="min-width:0"><div class="side-title">${esc(s.title)}</div>
      <span class="muted small">${STATS[s.stat].name}${s.repeat ? ' · раз в неделю' : ''}${done && !s.repeat ? ' · ' + fmtDay(ds[ds.length - 1]) : ''}</span></div>
      <div class="row nowrap">${done ? `<button class="linkbtn" data-a="side-undo" data-id="${s.id}">отменить</button>` : `<button class="btn sm" data-a="side" data-id="${s.id}">+${s.xp}</button>`}<button class="xbtn" data-a="side-del" data-id="${s.id}" aria-label="Удалить">×</button></div></div>`;
  }
  const rest = SIDE.filter(x => !(S.sideList || []).includes(x.id));
  if (rest.length) html += `</div><details><summary class="muted">Добавить из списка</summary><div class="chips stack">${rest.map(x => `<button class="pill" data-a="side-add" data-id="${x.id}">+ ${esc(x.title)}</button>`).join('')}</div></details><div>`;
  html += `</div><details><summary class="muted">Добавить свой сайд-квест</summary>
      <div class="stack">
        <input type="text" id="c-title" placeholder="Например: разобрать завал на столе" maxlength="80">
        <div class="grid2"><select id="c-stat">${Object.entries(STATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
        <input id="c-xp" type="number" min="10" max="500" step="10" value="100" aria-label="Опыт"></div>
        <button class="btn sm" data-a="add-custom">Добавить</button>
      </div></details></section>`;
  return html;
}

function viewWeek() {
  const t = todayKey(), curW = weekOf(t), w = ui.week || curW;
  const sc = weekScore(w);
  let html = `<header class="top"><span class="label">Неделя ${isoWeekNo(w)} · ${fmtWeek(w)}</span><h1>${w === curW ? 'Эта неделя' : 'Итоги недели'}</h1></header>`;
  if (!sc) return html + '<div class="empty">На этой неделе ты ещё не играл.</div>';
  const prev = addDays(w, -7) >= weekOf(S.created) ? weekScore(addDays(w, -7)) : null;
  const delta = prev ? sc.total - prev.total : null;
  const C = 2 * Math.PI * 54;
  html += `<section class="card">
    <div class="score">
      <div class="ring"><svg viewBox="0 0 132 132"><circle class="trk" cx="66" cy="66" r="54"/><circle class="val" cx="66" cy="66" r="54" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - sc.total / 100)}"/></svg>
        <div class="ring-num"><b>${sc.total}</b><small>из 100</small></div></div>
      <div class="stack-sm">
        <span class="rank">${rankOf(sc.total)}</span>
        ${delta !== null ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${Math.abs(delta)} к прошлой неделе</span>` : '<span class="muted small">Первая неделя, сравнивать не с чем</span>'}
        <span class="muted small">Проверено фото, таймером или текстом: <b class="mono">${sc.verified}/${sc.marks}</b></span>
        ${sc.live ? '<span class="muted small">Считается по ходу недели</span>' : ''}
      </div>
    </div>
    ${sc.flagged ? `<div class="flag">⚠ Неделя помечена: ${sprintsIn(w)} ${plural(sprintsIn(w), 'спринт', 'спринта', 'спринтов')} отметок. Ачивки заморожены, на карточке это видно.</div>` : ''}
    <div class="parts">
      ${part('Квесты', sc.quests, 60)}${part('Стабильность', sc.stability, 20)}${part('Босс', sc.boss, 10)}${part(`Рывок${sc.rushWhy.length ? ': ' + sc.rushWhy.join(', ') : ': сайд-квест, вызов, 5 карт или автопилот'}`, sc.rush, 10)}
    </div>
    <button class="btn" data-a="share" data-w="${w}">Поделиться с друзьями</button>
  </section>`;

  const { shieldDays } = streakInfo();
  const shown = CATALOG.filter(q => sc.perQuest[q.id]);
  if (shown.length) {
    html += `<section class="card"><h2>По дням</h2><div class="xscroll"><div class="grid7"><span></span>${WD.map(d => `<span class="h">${d}</span>`).join('')}`;
    const rows = shown.map(q => [q.title, q.stat, k => { const r = peekDay(k).q[q.id]; return !activeOn(q.id, k) ? 'off' : r ? (r.v >= 1 ? 'full' : 'half') : ''; }]);
    rows.push(['Карта дня', 'mind', k => peekDay(k).card?.done ? (peekDay(k).card.done.v >= 1 ? 'full' : 'half') : '']);
    for (const [name, stat, f] of rows) {
      html += `<span class="nm">${esc(name)}</span>`;
      for (let i = 0; i < 7; i++) {
        const k = addDays(w, i);
        let cls = 'cell';
        if (k > t) cls += ' future'; else if (k < S.created) cls += ' off';
        else { const s = f(k); cls += s ? ' ' + s : shieldDays.has(k) ? ' shield' : ''; }
        if (peekDay(k).nosleep && name === rows[0][0]) cls += ' ns';
        html += `<span class="${cls}" data-stat="${stat}" title="${fmtDay(k)}"></span>`;
      }
    }
    html += `</div></div><p class="muted small">Полная клетка — в срок, бледная — с опозданием или вполсилы, пунктир — день закрыт щитом.</p></section>`;
  }
  html += `<section class="card"><div class="section-head"><h2>Сводка</h2><span class="label">только для тебя</span></div><div class="lines">${summaryLines(w, sc).map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`;

  const weeks = []; for (let k = curW; k >= weekOf(S.created) && weeks.length < 12; k = addDays(k, -7)) weeks.push(k);
  if (weeks.length > 1) html += `<section class="card"><h2>Все недели</h2><div class="weeks">${weeks.map(k => {
    const s = weekScore(k); return `<button class="wk${k === w ? ' sel' : ''}" data-a="open-week" data-w="${k}"><span>Неделя ${isoWeekNo(k)} <span class="muted small">${fmtWeek(k)}</span></span><span class="muted small">${s ? rankOf(s.total) + (s.flagged ? ' ⚠' : '') : ''}</span><span class="wk-score">${s ? s.total : '—'}</span></button>`;
  }).join('')}</div></section>`;
  return html;
}
function part(name, v, max) { return `<div class="part"><span>${name}</span><span class="mono">${Math.round(v)}/${max}</span><div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`; }

function summaryLines(w, sc) {
  const roast = S.settings.tone === 'roast', seed = isoWeekNo(w), out = [];
  const pick = arr => arr[seed % arr.length];
  const T = {
    shower: [['Шампунь в шкафу начинает обижаться.', 'Мыло ждёт тебя, как звонка от старого друга.'], ['Уже свежо, но ещё не стабильно.'], ['Свежесть уровня рекламы геля.', 'Чистота — твоё второе имя.']],
    wake: [['Будильник подаёт в суд за игнор.'], ['Режим собирается, как пазл без половины деталей.'], ['Будильник впервые чувствует уважение.']],
    walk: [['Ноги подозревают, что их держат для красоты.'], ['Улица тебя уже узнаёт.'], ['Голуби здороваются первыми.']],
    bed: [['Ночь снова победила.'], ['Ночь пока делится с тобой пополам.'], ['Друзья заметили, что ты уходишь спать первым.']],
    food: [['Курьеры знают тебя по имени.'], ['Кухня видела тебя чаще обычного.'], ['Приложение доставки пишет «мы скучаем».']],
    smoke: [['Вредная привычка чувствует себя как дома.'], ['Организм осторожно надеется.'], ['Организм пишет благодарность.']],
    read: [['Книга начала покрываться пылью из обиды.'], ['Закладка двигается. Медленно, но двигается.'], ['Ещё немного, и начнёшь цитировать.']],
  };
  for (const q of CATALOG) {
    const pq = sc.perQuest[q.id]; if (!pq || !pq.days) continue;
    const r = pq.done / pq.days, band = r < .4 ? 0 : r < .8 ? 1 : 2;
    let s = `${q.title}: ${pq.done} из ${pq.days}.`;
    if (roast && T[q.id]) s += ' ' + pick(T[q.id][band]);
    else if (roast) s += ' ' + pick([['Есть куда расти.'], ['Половина пути.'], ['Красиво.']][band]);
    out.push(s);
  }
  if (sc.cards) out.push(`Карт дня выполнено: ${sc.cards}.`);
  const ch = challengeResult(w);
  if (ch) out.push(`Вызов «${ch.c.title}»: ${ch.wk.marks.length}/${ch.c.n}${ch.done ? ', выполнен' : ch.over ? ', не добит' : ''}${ch.wk.stake ? `, ставка ${ch.wk.stake}` : ''}.`);
  for (const b of S.bosses.filter(b => b.created <= addDays(w, 6) && (!b.defeated || b.defeated >= w))) {
    const T = BT[b.type], p = bossWeek(b, w), st = bossState(b);
    if (b.defeated && b.defeated <= addDays(w, 6)) { out.push(`${b.name}: побеждён ${fmtDay(b.defeated)}.${roast ? ' Легенда.' : ''}`); continue; }
    if (T.mode === 'sum') out.push(p > 0 ? `${b.name}: урон за неделю ${fmtN(p, b.unit)}, осталось ${fmtN(st.hp, b.unit)}.${roast ? ' Босс шатается.' : ''}` : `${b.name}: на этой неделе без урона.${roast ? ' Босс отдыхает и набирается сил.' : ''}`);
    else if (T.mode === 'measure') out.push(`${b.name}: ${p > 0 ? 'сдвиг к цели на ' + fmtN(p, b.unit) : p < 0 ? 'откат на ' + fmtN(-p, b.unit) : 'без изменений'}, сейчас ${fmtN(st.cur, b.unit)}.`);
    else out.push(`${b.name}: чистых дней ${p} из 7.${roast && p >= 6 ? ' Босс в панике.' : roast && p <= 2 ? ' Босс доволен собой.' : ''}`);
  }
  const ns = sc.keys.filter(k => peekDay(k).nosleep).length;
  if (ns) out.push(`Ночей без сна: ${ns}.${roast ? ' Утро после них считается за два.' : ''}`);
  const tags = {};
  for (const k of sc.keys) for (const tg of (peekDay(k).tags || [])) tags[tg] = (tags[tg] || 0) + 1;
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`Главная причина пропусков: ${top[0].toLowerCase()} (${top[1]} ${plural(top[1], 'раз', 'раза', 'раз')}).`);
  return out;
}

/* ================= отчёт ================= */
function viewReport() {
  const t = todayKey(), x = xpAll(), si = streakInfo();
  const weeks = []; for (let w = weekOf(S.created); w <= weekOf(t); w = addDays(w, 7)) weeks.push(w);
  const scores = weeks.map(w => ({ w, s: weekScore(w) })).filter(o => o.s);
  const done = scores.filter(o => !o.s.live);
  const avg = done.length ? Math.round(done.reduce((a, o) => a + o.s.total, 0) / done.length) : null;
  const played = daysBetween(S.created, t) + 1;
  const allKeys = []; for (let k = S.created; k <= t; k = addDays(k, 1)) allKeys.push(k);
  const nights = allKeys.filter(k => peekDay(k).nosleep);
  const cardsDone = allKeys.filter(k => peekDay(k).card?.done).length;

  let html = `<header class="top"><span class="label">Отчёт</span><h1>Как ты справляешься</h1><p class="muted">Всё, что ты делал с ${fmtDay(S.created)}. Только для тебя.</p></header>`;
  html += `<section class="tiles">
    ${tile(played, plural(played, 'день в игре', 'дня в игре', 'дней в игре'))}${tile(si.best, 'лучшая серия')}
    ${tile(avg ?? '—', 'средняя оценка недели')}${tile(cardsDone, 'карт дня')}
    ${tile(Object.keys(S.ach).length + '/' + ACHIEVEMENTS.length, 'ачивок')}${tile(nights.length, plural(nights.length, 'ночь без сна', 'ночи без сна', 'ночей без сна'))}
  </section>`;

  // график недель
  const last = scores.slice(-12);
  if (last.length) {
    const W = 320, H = 150, pad = 22, bw = Math.min(28, (W - pad) / last.length - 6);
    const bars = last.map((o, i) => {
      const x0 = pad + i * ((W - pad) / last.length) + 3, h = (o.s.total / 100) * (H - 30);
      return `<rect x="${x0.toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" class="${o.s.live ? 'live' : ''}"/>
        <text x="${(x0 + bw / 2).toFixed(1)}" y="${(H - 22 - h).toFixed(1)}" class="v">${o.s.total}</text>
        <text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 4}" class="ax">${isoWeekNo(o.w)}</text>`;
    }).join('');
    const grid = [40, 60, 80].map(v => { const y = H - 18 - (v / 100) * (H - 30); return `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}"/><text x="0" y="${y + 3}" class="ax" text-anchor="start">${v}</text>`; }).join('');
    html += `<section class="card"><div class="section-head"><h2>Оценки по неделям</h2><span class="label">номер недели</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Оценки недель">${grid}${bars}</svg></section>`;
  }

  // привычки
  const ever = CATALOG.filter(q => S.quests[q.id]);
  if (ever.length) {
    html += `<section class="card"><h2>Привычки за всё время</h2><div class="parts">${ever.map(q => {
      let days = 0, d = 0; for (const k of allKeys) if (activeOn(q.id, k) && k < t) { days++; if (doneOn(q.id, k)) d++; }
      const pct = days ? Math.round(d / days * 100) : 0;
      return `<div class="part" data-stat="${q.stat}"><span>${esc(q.title)}${qStatus(q.id) === 'auto' ? ' ★' : ''}</span><span class="mono">${d}/${days} · ${pct}%</span><div class="bar stat-bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}</div><p class="muted small">Сегодняшний день не считается, пока не закончился.</p></section>`;
  }

  // боссы
  if (S.bosses.length) html += `<section class="card"><h2>Боссы</h2><div class="parts">${S.bosses.map(b => {
    const p = Math.round(bossPct(b) * 100);
    return `<div class="part" data-stat="${b.stat}"><span>${esc(b.name)}${b.defeated ? ' · побеждён ' + fmtDay(b.defeated) : ''}</span><span class="mono">${p}%</span><div class="bar stat-bar"><i style="width:${p}%"></i></div></div>`;
  }).join('')}</div></section>`;

  // причины
  const skip = {}, ns = {};
  for (const k of allKeys) { for (const tg of (peekDay(k).tags || [])) skip[tg] = (skip[tg] || 0) + 1; for (const tg of (peekDay(k).nosleep?.tags || [])) ns[tg] = (ns[tg] || 0) + 1; }
  const list = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="mono">${v}</span></div>`).join('');
  html += `<section class="card"><h2>Почему не получалось</h2>
    <div class="label">Пропущенные дни</div>${Object.keys(skip).length ? list(skip) : '<p class="muted small">Пока не записано ни одной причины.</p>'}
    <div class="label">Ночи без сна</div>${Object.keys(ns).length ? list(ns) : '<p class="muted small">Ни одной. Так держать.</p>'}</section>`;

  // ачивки
  html += `<section class="card"><div class="section-head"><h2>Ачивки</h2><span class="label">выдаются сами</span></div><div class="achs">${ACHIEVEMENTS.map(a => {
    const got = S.ach[a.id];
    return `<div class="ach${got ? ' got' : ''}"><div class="ach-ico">${got ? '★' : ICON.lock}</div><div style="min-width:0"><div class="ach-t">${esc(a.title)}</div><div class="muted small">${esc(a.desc)}${got ? ` · ${fmtDay(got)}` : ''}</div></div></div>`;
  }).join('')}</div></section>`;

  // журнал
  const jKeys = allKeys.slice().reverse().slice(0, ui.journalN);
  html += `<section class="card"><div class="section-head"><h2>Журнал</h2><button class="linkbtn" data-a="csv">Выгрузить таблицу</button></div><div class="journal">${jKeys.map(journalDay).join('')}</div>
    ${allKeys.length > ui.journalN ? '<button class="btn sm ghost" data-a="journal-more">Показать ещё</button>' : ''}</section>`;
  return html;
}
function tile(v, l) { return `<div class="tile"><b class="mono">${v}</b><span>${l}</span></div>`; }
function journalDay(k) {
  const d = peekDay(k), items = [];
  for (const id in d.q) { const q = Q[id]; if (!q) continue; const r = d.q[id]; items.push(`<span class="jchip" data-stat="${q.stat}">${esc(q.title)}${r.time ? ' ' + r.time : ''}${r.proof === 'photo' ? ' 📷' : r.proof === 'timer' ? ' ⏱' : ''}${r.fix ? ' (испр.)' : ''}</span>`); }
  if (d.card?.done && CARD[d.card.id]) items.push(`<span class="jchip card-chip">Карта: ${esc(CARD[d.card.id].text)}</span>`);
  const texts = [];
  for (const id of ['journal', 'spendlog']) if (d.q[id]?.text) texts.push(`<p class="jtext"><span class="muted">${Q[id].title}:</span> ${esc(d.q[id].text)}</p>`);
  if (d.tags?.length || d.note) texts.push(`<p class="jtext"><span class="muted">Пропуск:</span> ${esc([...(d.tags || []), d.note].filter(Boolean).join(', '))}</p>`);
  if (d.nosleep) texts.push(`<p class="jtext warn-t"><span class="muted">Не ложился:</span> ${esc([...(d.nosleep.tags || []), d.nosleep.text].filter(Boolean).join(', '))}</p>`);
  const photosHere = [...Object.keys(d.q).filter(id => d.q[id].proof === 'photo').map(id => `${k}|q:${id}`), ...(d.card?.done?.proof === 'photo' ? [`${k}|card`] : [])];
  return `<div class="jday"><div class="jhead"><b>${fmtDayLong(k)}</b>${k === todayKey() ? '<span class="badge">сегодня</span>' : ''}</div>
    ${items.length ? `<div class="jchips">${items.join('')}</div>` : '<p class="muted small">Ничего не отмечено</p>'}
    ${texts.join('')}${photosHere.length ? `<div class="jphotos">${photosHere.map(p => `<img data-photo="${esc(p)}" alt="Фото-подтверждение">`).join('')}</div>` : ''}</div>`;
}
async function loadPhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    try { const b = await photos.get(img.dataset.photo); if (b) img.src = URL.createObjectURL(b); else img.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'фото удалено' })); }
    catch (e) { img.remove(); }
  }
}
function csv() {
  const rows = [['Дата', 'Квесты', 'Карта дня', 'Пропуск: причины', 'Не ложился', 'Три строки о дне', 'Траты', 'Сигареты']];
  for (let k = S.created; k <= todayKey(); k = addDays(k, 1)) {
    const d = peekDay(k);
    rows.push([k, Object.keys(d.q).map(id => Q[id]?.title || id).join('; '), d.card?.done ? CARD[d.card.id]?.text || '' : '',
      [...(d.tags || []), d.note].filter(Boolean).join('; '), d.nosleep ? [...(d.nosleep.tags || []), d.nosleep.text].filter(Boolean).join('; ') : '',
      d.q.journal?.text || '', d.q.spendlog?.text || '', d.cigs ?? '']);
  }
  return '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

function viewMe() {
  const x = xpAll(), lv = levelOf(x.total), bal = coins();
  let html = `<header class="top"><span class="label">${esc(S.profile.name || 'Профиль')}</span><h1>Уровень ${lv.L}</h1><p class="muted">Опыт: <span class="mono">${x.total}</span> · монеты: <span class="mono">${bal}</span> · играешь с ${fmtDay(S.created)}</p></header>`;
  html += `<section class="stats">${Object.entries(STATS).map(([k, v]) => {
    const l = levelOf(x.st[k], 40);
    return `<div class="stat" data-stat="${k}"><div class="stat-top"><span class="stat-name">${v.name}</span><span class="stat-lvl">${l.L}</span></div>
      <div class="bar"><i style="width:${((x.st[k] - l.from) / (l.to - l.from) * 100).toFixed(1)}%"></i></div><span class="muted mono small">${x.st[k]} опыта</span></div>`;
  }).join('')}</section>`;

  // магазин
  html += `<section class="card" id="shop"><div class="section-head"><h2>Магазин наград</h2><span class="coins static">${ICON.coin}<span class="mono">${bal}</span></span></div>
    <p class="muted small">Монеты дают за квесты, карты, вызовы и ачивки. Награды придумываешь сам. Отдых по плану — не срыв.</p>
    ${S.shop.rewards.map(r => `<div class="side"><div style="min-width:0"><div class="side-title">${esc(r.title)}</div><span class="muted small mono">${r.price} монет</span></div>
      <div class="row"><button class="btn sm" data-a="buy" data-id="${r.id}" ${bal < r.price ? 'disabled' : ''}>Купить</button><button class="xbtn" data-a="reward-del" data-id="${r.id}" aria-label="Удалить награду">×</button></div></div>`).join('')}
    <details><summary class="muted">Добавить свою награду</summary><div class="stack">
      <input type="text" id="rw-title" placeholder="Например: шаурма в выходной" maxlength="60">
      <input type="number" id="rw-price" min="10" step="10" value="200" aria-label="Цена в монетах">
      <button class="btn sm" data-a="reward-add">Добавить</button></div></details>
    ${S.shop.bought.length ? `<div class="label">Куплено</div>${S.shop.bought.slice(-5).reverse().map(b => `<div class="kv"><span>${esc(b.title)} · ${fmtDay(b.day)}</span><span class="mono">−${b.price}</span></div>`).join('')}` : ''}
  </section>`;

  const st = S.settings;
  html += `<section class="card"><h2>Настройки</h2>
    <div class="grid2"><label class="field"><span>Подъём</span><input id="s-wake" type="time" value="${st.wake}"></label>
    <label class="field"><span>Отбой</span><input id="s-bed" type="time" value="${st.bed}"></label></div>
    <div class="field"><span>Тон сводки</span><div class="seg"><button class="${st.tone === 'roast' ? 'on' : ''}" data-a="tone" data-v="roast">С подколом</button><button class="${st.tone !== 'roast' ? 'on' : ''}" data-a="tone" data-v="neutral">Нейтральный</button></div></div>
    <div class="field"><span>Тема</span><div class="seg seg3">${[['auto', 'Авто'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, n]) => `<button class="${(st.theme || 'auto') === v ? 'on' : ''}" data-a="theme" data-v="${v}">${n}</button>`).join('')}</div></div>
    <button class="btn sm" data-a="save-settings">Сохранить настройки</button>
    <p class="muted small">День заканчивается в 04:00: если лёг в 2 ночи, отбой засчитается во вчерашний день.</p></section>`;

  html += `<section class="card"><h2>Анкета</h2><p class="muted small">Имя, режим, квесты, боссы, разовые дела и награды.</p><button class="btn sm ghost" data-a="wiz-open" style="align-self:flex-start">Изменить анкету</button></section>`;
  html += `<section class="card"><h2>Как это работает</h2><p class="muted small">Правила, окна отметок и защита от накрутки.</p><button class="btn sm ghost" data-a="guide-open" style="align-self:flex-start">Открыть гайд</button></section>`;
  html += `<section class="card"><h2>Резервная копия</h2>
    <p class="muted small">Все данные лежат только на телефоне. Удалишь иконку — пропадут. Раз в неделю сохраняй копию: отправь себе в «Избранное» или в заметки. Фото в копию не входят.</p>
    <div class="row"><button class="btn sm" data-a="export">Сохранить копию</button><button class="btn sm ghost" data-a="open-import">Восстановить</button></div></section>`;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone) html += `<section class="card"><h2>Поставить на экран «Домой»</h2><p class="muted small">В Safari нажми «Поделиться», затем «На экран "Домой"». После этого приложение работает без интернета.</p></section>`;
  html += `<section class="card"><h2>Сброс</h2><button class="btn sm danger" data-a="reset-ask" style="align-self:flex-start">Начать заново</button></section>`;
  html += `<p class="muted small center">Точка сохранения · версия ${APP_VERSION} · данные только на этом устройстве</p>`;
  return html;
}

/* ================= листы ================= */
function sheetWrap(label, inner, locked) {
  return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet${locked ? ' locked-sheet' : ''}" role="dialog" aria-modal="true" aria-label="${label}">
    <div class="grabber" aria-hidden="true"></div>${locked ? '' : '<button class="sheet-x" data-a="close-sheet" aria-label="Закрыть">×</button>'}${inner}</div></div>`;
}
function viewSheet() {
  const sh = ui.sheet; if (!sh) return '';
  const t = todayKey();
  if (sh.type === 'share') return sheetWrap('Карточка недели', `<h2>Карточка недели</h2>${sh.url ? `<img class="share-img" src="${sh.url}" alt="Карточка недели">` : '<div class="empty">Рисую…</div>'}
    <p class="muted small">${sh.canShare ? 'Отправь друзьям через меню «Поделиться».' : 'Зажми картинку и выбери «Сохранить» или «Поделиться».'}</p>
    <div class="row">${sh.canShare ? '<button class="btn grow" data-a="share-send">Поделиться</button>' : ''}<button class="btn ghost grow" data-a="share-copy">Скопировать текстом</button></div>`);
  if (sh.type === 'import') return sheetWrap('Восстановление', `<h2>Восстановить из копии</h2><p class="muted small">Выбери файл копии или вставь её текст. Текущие данные заменятся.</p>
    <input type="file" id="imp-file" accept=".json,application/json,text/plain"><textarea id="imp-text" placeholder='{"v":2, ...}'></textarea>
    <button class="btn" data-a="import">Восстановить</button>`);
  if (sh.type === 'export') return sheetWrap('Копия', `<h2>Резервная копия</h2><p class="muted small">Скопируй текст и сохрани в заметки или отправь себе.</p>
    <textarea id="exp-text" readonly>${esc(JSON.stringify(S))}</textarea>
    <div class="row">${sh.canShare ? '<button class="btn grow" data-a="export-share">Отправить файлом</button>' : ''}<button class="btn ghost grow" data-a="export-copy">Скопировать</button></div>`);
  if (sh.type === 'proof') return sheetWrap('Фото', `<h2>Нужно фото</h2><p class="muted small">Камера откроется сразу, галерея не подойдёт. Фото хранится только на телефоне 2 недели.</p>
    <button class="btn" data-a="photo-take">${ICON.cam} Сфотографировать</button>
    ${sh.target === 'ch' ? '' : '<button class="btn ghost" data-a="photo-skip">Без фото: половина опыта, без монет</button>'}
    `);
  if (sh.type === 'text') { const q = Q[sh.id]; return sheetWrap(q.title, `<h2>${esc(q.title)}</h2><p class="muted small">${esc(q.hint)}</p>
    <textarea id="txt" class="plain" placeholder="Пиши как есть" maxlength="600">${esc(sh.draft || '')}</textarea>
    <p class="muted small">Минимум ${q.minLen} символов. Сейчас: <span id="txt-n" class="mono">${(sh.draft || '').length}</span></p>
    <button class="btn" data-a="text-save" data-id="${q.id}">Записать</button>`); }
  if (sh.type === 'time') { const q = Q[sh.id]; return sheetWrap('Время', `<h2>${q.id === 'wake' ? 'Во сколько встал?' : 'Во сколько лёг?'}</h2>
    <p class="muted small">Только на сегодня и только в пределах окна. Отметка в будущем не засчитается.</p>
    <input type="time" id="t-val" value="${q.id === 'wake' ? S.settings.wake : S.settings.bed}">
    <button class="btn" data-a="time-save" data-id="${q.id}">Сохранить</button>`); }
  if (sh.type === 'fix') {
    const y = addDays(t, -1);
    const list = activeQuests().filter(q => activeOn(q.id, y) && !doneOn(q.id, y) && q.kind !== 'smoke');
    return sheetWrap('Исправление', `<h2>Отметить за вчера</h2><p class="muted small">Одно исправление в неделю. Засчитается вполсилы и без монет. Выбери один квест.</p>
      ${list.map(q => `<button class="btn ghost" data-a="fix" data-id="${q.id}">${esc(q.title)}</button>`).join('')}
      `);
  }
  if (sh.type === 'nosleep') { const sel = sh.tags || []; const nk = nightKey(); return sheetWrap('Не ложился', `<h2>Не ложился спать</h2>
    <p class="muted small">Запишется на ночь ${fmtDay(nk)} → ${fmtDay(addDays(nk, 1))}. Без штрафа, просто чтобы видеть в отчёте.</p>
    <div class="chips">${NOSLEEP_TAGS.map(tg => `<button class="pill${sel.includes(tg) ? ' on' : ''}" data-a="ns-tag" data-t="${esc(tg)}">${esc(tg)}</button>`).join('')}</div>
    <input type="text" id="ns-text" placeholder="Что было? Одна строка" maxlength="160" value="${esc(sh.text || '')}">
    <button class="btn" data-a="nosleep-save">Записать</button>`); }
  if (sh.type === 'confirm') return sheetWrap(sh.title, `<h2>${esc(sh.title)}</h2>${sh.text ? `<p class="muted">${esc(sh.text)}</p>` : ''}
    <button class="btn danger-fill" data-a="confirm-yes">${esc(sh.yes || 'Удалить')}</button>`);
  if (sh.type === 'boss') {
    if (!sh.d) return sheetWrap('Новый босс', `<h2>Новый босс</h2><p class="muted small">Выбери тип. У каждого свой способ наносить урон.</p>
      <div class="btypes">${BOSS_TYPES.map(T => `<button class="btype" data-stat="${T.stat}" data-a="boss-pick" data-t="${T.id}"><b>${esc(T.name)}</b><span class="muted small">${esc(T.desc)}</span></button>`).join('')}</div>
      `);
    return sheetWrap('Новый босс', `<span class="label">Новый босс · ${esc(BT[sh.d.type].name)}</span><h2>${esc(BT[sh.d.type].desc)}</h2>
      ${bossForm(sh.d, 'bf')}
      <button class="btn" data-a="boss-save">Создать босса</button><button class="linkbtn" data-a="boss-new">Другой тип</button>`);
  }
  if (sh.type === 'whatsnew') {
    const from = sh.from || '0';
    const items = CHANGELOG.filter(c => cmpVer(c.v, from) > 0);
    return sheetWrap('Что нового', `<span class="label">Обновление</span><h2>Версия ${APP_VERSION}</h2>
      <p class="muted small">Твои данные на месте: серия, опыт, записи и настройки сохранились.</p>
      ${items.map(c => `<div class="cl"><div class="cl-head"><b>${esc(c.v)} · ${esc(c.title)}</b><span class="muted small">${fmtDay(c.date)}</span></div>
        ${c.added.length ? `<div class="label">Добавлено</div><ul class="glist">${c.added.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${c.fixed.length ? `<div class="label">Исправлено</div><ul class="glist">${c.fixed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}
      <button class="btn" data-a="whatsnew-ok">Круто, погнали</button>`);
  }
  if (sh.type === 'sprint') return sheetWrap('Детектор', `<span class="label">Детектор спринт-кликера</span><h2>Три отметки меньше чем за минуту</h2>
    <p>Всё по-честному? Бывает, что закрываешь вечер разом. Но если накликал — лучше снять сейчас.</p>
    <p class="muted small">Если неделя наберёт ${SPRINT_FLAG} таких «по-честному», она получит ⚠: ачивки заморозятся, а на карточке для друзей будет видно.</p>
    <button class="btn" data-a="sprint-keep">Да, всё сделал</button><button class="btn ghost" data-a="sprint-undo">Накликал, сними эти отметки</button>`, true);
  if (sh.type === 'ics') return sheetWrap('Календарь', `<h2>Напоминание в Календарь</h2>
    <p class="muted small">Должен открыться файл календаря: нажми «Добавить все». Если ничего не произошло — нажми «Отправить файлом» и выбери «Календарь», либо создай напоминание вручную: Напоминания → Новое → Повтор: ежедневно.</p>
    <div class="row">${sh.canShare ? '<button class="btn grow" data-a="ics-share">Отправить файлом</button>' : ''}</div>`);
  return '';
}

function render() {
  applyTheme();
  const root = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');
  if (ui.guide !== null && ui.guide < GUIDE.length) { root.innerHTML = viewGuide(ui.guide, S ? 'Понял' : 'Понял, к анкете'); tabbar.hidden = true; document.getElementById('sheet').innerHTML = S ? '' : viewSheet(); syncLock(); animatePager(); return; }
  if (!S && !ui.wiz) ui.wiz = newWiz();
  if (ui.wiz) { root.innerHTML = viewWizard(); tabbar.hidden = true; document.getElementById('sheet').innerHTML = viewSheet(); syncLock(); animatePager(); return; }
  tabbar.hidden = false;
  root.innerHTML = ui.tab === 'quests' ? viewQuests() : ui.tab === 'week' ? viewWeek() : ui.tab === 'report' ? viewReport() : ui.tab === 'me' ? viewMe() : viewToday();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === ui.tab));
  document.getElementById('sheet').innerHTML = viewSheet();
  syncLock();
  if (ui.tab === 'report') loadPhotos();
  tick();
}
function applyTheme() {
  const th = ui.wiz ? ui.wiz.d.theme : S?.settings?.theme;
  if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th);
  else document.documentElement.removeAttribute('data-theme');
}
function tick() {
  for (const el of document.querySelectorAll('[data-tick]')) {
    const tm = S?.timers[el.dataset.tick]; if (!tm) continue;
    const s = Math.floor((Date.now() - tm.start) / 1000), need = Number(el.dataset.mins) * 60;
    el.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
    const left = document.querySelector(`[data-left="${el.dataset.tick}"]`);
    if (left) left.textContent = s >= need ? 'Можно жать «Финиш»' : `ещё ${Math.ceil((need - s) / 60)} мин`;
  }
}
setInterval(tick, 1000);

const val = id => document.getElementById(id)?.value ?? '';

/* ================= карточка для друзей ================= */
async function drawShare(w) {
  const sc = weekScore(w), si = streakInfo(), lv = levelOf(xpAll().total).L;
  const prev = addDays(w, -7) >= weekOf(S.created) ? weekScore(addDays(w, -7)) : null;
  const delta = prev ? sc.total - prev.total : null;
  try { await Promise.all(['800 120px Unbounded', '700 40px Unbounded', '500 36px "Golos Text"', '600 36px "Golos Text"'].map(f => document.fonts.load(f))); } catch (e) { /* фолбэк */ }
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const gold = '#f2b544', ink = '#11131a', fg = '#eceae3', mut = '#9097a9', line = '#2d3245', red = '#ff6f6f', green = '#5dd3a2';
  x.fillStyle = ink; x.fillRect(0, 0, W, H);
  const D = '"Unbounded", "Golos Text", system-ui, sans-serif', B = '"Golos Text", system-ui, sans-serif';
  x.fillStyle = mut; x.font = `600 34px ${B}`; x.fillText(`${S.profile.name ? S.profile.name.toUpperCase() + ' · ' : ''}НЕДЕЛЯ ${isoWeekNo(w)} · ${fmtWeek(w).toUpperCase()}`, 90, 150);
  const cx = 300, cy = 470, r = 190;
  x.lineCap = 'round'; x.lineWidth = 34;
  x.strokeStyle = line; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = gold; x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(.005, sc.total / 100)); x.stroke();
  x.fillStyle = fg; x.textAlign = 'center'; x.font = `800 140px ${D}`; x.fillText(String(sc.total), cx, cy + 40);
  x.fillStyle = mut; x.font = `500 32px ${B}`; x.fillText('из 100', cx, cy + 100);
  x.textAlign = 'left';
  x.fillStyle = gold; x.font = `800 64px ${D}`; x.fillText(rankOf(sc.total), 560, 420);
  if (delta !== null) { x.fillStyle = delta >= 0 ? green : red; x.font = `700 44px ${D}`; x.fillText(`${delta >= 0 ? '+' : '−'}${Math.abs(delta)} к прошлой`, 560, 500); }
  x.fillStyle = mut; x.font = `500 32px ${B}`; x.fillText(`проверено: ${sc.verified} из ${sc.marks}`, 560, 570);
  if (sc.flagged) { x.fillStyle = red; x.font = `700 32px ${B}`; x.fillText('⚠ спринт-клики на неделе', 560, 620); }
  const tiles = [[`${si.streak}`, plural(si.streak, 'день подряд', 'дня подряд', 'дней подряд')], [`${lv}`, 'уровень'], [`${sc.cards}`, plural(sc.cards, 'карта дня', 'карты дня', 'карт дня')]];
  tiles.forEach(([v, l], i) => {
    const tx = 90 + i * 310, ty = 790;
    x.fillStyle = '#1a1d27'; roundRect(x, tx, ty, 280, 220, 36); x.fill();
    x.fillStyle = fg; x.font = `800 76px ${D}`; x.fillText(v, tx + 34, ty + 120);
    x.fillStyle = mut; x.font = `500 32px ${B}`; x.fillText(l, tx + 34, ty + 175);
  });
  const ch = challengeResult(w);
  if (ch) { x.fillStyle = ch.done ? gold : mut; x.font = `600 32px ${B}`; x.fillText(`Вызов недели: ${ch.done ? 'выполнен' : `${ch.wk.marks.length}/${ch.c.n}`}`, 90, 1110); }
  x.fillStyle = gold; roundRect(x, 90, 1210, 64, 64, 18); x.fill();
  x.strokeStyle = ink; x.lineWidth = 7; x.lineJoin = 'round'; x.beginPath(); x.moveTo(104, 1258); x.lineTo(114, 1258); x.lineTo(114, 1246); x.lineTo(124, 1246); x.lineTo(124, 1234); x.lineTo(134, 1234); x.lineTo(134, 1224); x.lineTo(142, 1224); x.stroke();
  x.fillStyle = fg; x.font = `700 36px ${D}`; x.fillText('Точка сохранения', 176, 1254);
  const text = `${S.profile.name ? S.profile.name + ', н' : 'Н'}еделя ${isoWeekNo(w)}: ${sc.total}/100 · ${rankOf(sc.total)}${delta !== null ? ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}` : ''} · серия ${si.streak} · уровень ${lv} · проверено ${sc.verified}/${sc.marks}${sc.flagged ? ' · ⚠' : ''}`;
  return new Promise(res => c.toBlob(b => res({ blob: b, url: URL.createObjectURL(b), text }), 'image/png'));
}
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

/* ================= календарь ================= */
function icsFor(ids) {
  const t = todayKey().replace(/-/g, ''), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = ids.map(id => {
    const q = Q[id], tm = (S.settings.remind[id] || '09:00').replace(':', '');
    return ['BEGIN:VEVENT', `UID:savepoint-${id}-${Date.now()}@savepoint`, `DTSTAMP:${stamp}`, `DTSTART:${t}T${tm}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      `SUMMARY:Сейв: ${q.title}`, `DESCRIPTION:${q.hint.replace(/[,;]/g, ' ')}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${q.title}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Savepoint//RU', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
}
function openIcs(ids) {
  const text = icsFor(ids);
  const file = new File([text], 'savepoint.ics', { type: 'text/calendar' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = 'savepoint.ics'; document.body.appendChild(a); a.click(); a.remove();
  ui.sheet = { type: 'ics', file, canShare: !!(navigator.canShare && navigator.canShare({ files: [file] })) }; render();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); return true; }
  catch (e) { toast('Не вышло скопировать. Выдели текст вручную'); return false; }
}

/* ================= фото: выбор камеры ================= */
const photoInput = document.createElement('input');
photoInput.type = 'file'; photoInput.accept = 'image/*'; photoInput.setAttribute('capture', 'environment'); photoInput.hidden = true;
document.body.appendChild(photoInput);
let photoTarget = null;
photoInput.addEventListener('change', async () => {
  const f = photoInput.files?.[0]; photoInput.value = '';
  if (!f || !photoTarget) return;
  if (Date.now() - (f.lastModified || Date.now()) > 10 * 60e3) { toast('Это старое фото. Нужен свежий снимок с камеры'); return; }
  const target = photoTarget; photoTarget = null;
  const t = todayKey();
  try { const blob = await compress(f); await photos.put(`${t}|${target}${target === 'ch' ? ':' + Date.now() : ''}`, blob); }
  catch (e) { /* фото не сохранилось, но отметку ставим */ }
  completeWithProof(target, 'photo');
});
function completeWithProof(target, proof) {
  const t = todayKey(), px = xpAll().total, pc = coins();
  if (target.startsWith('q:')) {
    const id = target.slice(2);
    mark(id, t, proof === 'photo' ? { v: 1, proof: 'photo', c: 10 } : { v: .5, c: 0 });
  } else if (target === 'card') {
    const c = CARD[peekDay(t).card.id], R = RARITY[c.rarity];
    markCard(t, proof === 'photo' ? { v: 1, proof: 'photo', c: R.coins } : { v: .5, c: 0 });
  } else if (target === 'ch') markChallenge(t, 'photo');
  if (ui.sheet?.type === 'proof') ui.sheet = null;
  afterChange(px, pc);
}

/* ================= листы: закрытие, свайп, блок фона ================= */
function closeSheet() {
  const sh = ui.sheet; if (!sh || sh.type === 'sprint') return;
  if (sh.type === 'whatsnew' && S) { S.seenVersion = APP_VERSION; save(); }
  ui.sheet = null; render();
}
let lockY = null;
function syncLock() {
  const on = !!document.querySelector('.sheet');
  if (on && lockY === null) { lockY = window.scrollY; document.body.style.top = `-${lockY}px`; document.body.classList.add('locked'); }
  else if (!on && lockY !== null) { document.body.classList.remove('locked'); document.body.style.top = ''; window.scrollTo(0, lockY); lockY = null; }
}
let drag = null;
document.addEventListener('touchstart', e => {
  const sh = e.target.closest('.sheet'); if (!sh || sh.classList.contains('locked-sheet')) return;
  if (sh.scrollTop > 0 && !e.target.closest('.grabber')) return;
  drag = { sh, y: e.touches[0].clientY, dy: 0 };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!drag) return;
  drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
  if (drag.dy > 0) { drag.sh.style.transition = 'none'; drag.sh.style.transform = `translateY(${drag.dy}px)`; e.preventDefault(); }
}, { passive: false });
document.addEventListener('touchend', () => {
  if (!drag) return;
  const d = drag; drag = null;
  d.sh.style.transition = 'transform .2s ease';
  if (d.dy > 90) { d.sh.style.transform = 'translateY(100%)'; setTimeout(closeSheet, 180); }
  else d.sh.style.transform = '';
});
function confirmAsk(title, text, yes, act, id) { ui.sheet = { type: 'confirm', title, text, yes, act, id }; render(); }

/* ================= действия ================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  if (a === 'close-sheet' && e.target !== el && el.classList.contains('sheet-bg')) return;
  if (a === 'whatsnew-ok') { if (S) { S.seenVersion = APP_VERSION; save(); } ui.sheet = null; render(); return; }
  if (a === 'close-sheet') { closeSheet(); return; }
  if (a === 'open-import') { ui.sheet = { type: 'import' }; render(); return; }
  if (a === 'import') return doImport();
  if (a === 'guide-next') {
    ui.slide = 'next'; ui.guide = (ui.guide ?? 0) + 1;
    if (ui.guide >= GUIDE.length) { ui.guide = null; if (S) { S.guide = true; save(); } else ui.wiz = newWiz(); }
    window.scrollTo(0, 0); render(); return;
  }
  if (a.startsWith('wz-') && ui.wiz) { wizAction(a, el); return; }
  if (a === 'guide-back') { ui.slide = 'back'; ui.guide = Math.max(0, (ui.guide ?? 0) - 1); window.scrollTo(0, 0); render(); return; }
  if (!S) return;
  const t = todayKey(), px = xpAll().total, pc = coins();

  switch (a) {
    case 'tab': ui.tab = el.dataset.t; ui.week = null; window.scrollTo(0, 0); render(); return;
    case 'go-shop': ui.tab = 'me'; render(); document.getElementById('shop')?.scrollIntoView({ block: 'start' }); return;
    case 'guide-open': ui.guide = 0; window.scrollTo(0, 0); render(); return;
    case 'wiz-open': ui.wiz = editWiz(); window.scrollTo(0, 0); render(); return;
    case 'locked': toast(el.dataset.why || 'Сейчас отметить нельзя'); return;
    case 'toggle': {
      const id = el.dataset.id, q = Q[id], win = windowFor(q, t);
      if (!win.open) { toast(win.why); return; }
      const now = new Date();
      if (q.kind === 'wake') mark(id, t, { v: wakeQuality(now), time: hhmm(now) });
      else if (q.kind === 'bed') mark(id, t, { v: bedQuality(now), time: hhmm(now) });
      else if (q.kind === 'smoke') mark(id, t, { v: smokeQuality(t, day(t).cigs || 0) });
      else mark(id, t, { v: 1 });
      afterChange(px, pc); return;
    }
    case 'unmark': {
      const id = el.dataset.id;
      if (id === 'bed' && nosleepFor(t) && !doneOn('bed', t)) { toast('Записано «не ложился». Убери запись, чтобы отметить отбой'); return; }
      if (ui.unmarkAsk !== id) { ui.unmarkAsk = id; toast('Нажми ещё раз, чтобы снять отметку'); setTimeout(() => { if (ui.unmarkAsk === id) ui.unmarkAsk = null; }, 3000); return; }
      ui.unmarkAsk = null; delete day(t).q[id]; save(); render(); toast('Отметка снята'); return;
    }
    case 'time-sheet': ui.sheet = { type: 'time', id: el.dataset.id }; render(); return;
    case 'time-save': {
      const id = el.dataset.id, v = val('t-val'); if (!v) return;
      const [h, m] = v.split(':').map(Number); const dt = new Date(); dt.setHours(h, m, 0, 0);
      if (id === 'bed' && h < DAY_SHIFT_H) dt.setDate(dt.getDate() + (new Date().getHours() < DAY_SHIFT_H ? 0 : 1));
      if (dt > new Date()) { toast('Это время ещё не наступило'); return; }
      const win = windowFor(Q[id], t, dt); if (!win.open) { toast('Это время вне окна квеста'); return; }
      ui.sheet = null;
      mark(id, t, { v: id === 'wake' ? wakeQuality(dt) : bedQuality(dt), time: v, ts: Date.now() });
      afterChange(px, pc); return;
    }
    case 'timer-start': {
      const k = el.dataset.k;
      if (k !== 'card') { const win = windowFor(Q[k], t); if (!win.open) { toast(win.why); return; } }
      S.timers[k] = { start: Date.now(), day: t }; save(); render(); toast('Таймер пошёл. Можно закрыть приложение'); return;
    }
    case 'timer-stop': {
      const k = el.dataset.k, tm = S.timers[k]; if (!tm) return;
      const mins = k === 'card' ? CARD[peekDay(tm.day).card.id].mins : Q[k].mins;
      const passed = (Date.now() - tm.start) / 60e3;
      if (passed < mins) { toast(`Ещё ${Math.ceil(mins - passed)} мин. Раньше не засчитается`); return; }
      delete S.timers[k];
      if (tm.day !== t && passed > 12 * 60) { save(); render(); toast('Таймер висел слишком долго и сброшен'); return; }
      if (k === 'card') { const R = RARITY[CARD[peekDay(tm.day).card.id].rarity]; markCard(tm.day, { v: 1, proof: 'timer', c: R.coins }); }
      else mark(k, tm.day, { v: 1, proof: 'timer', c: 10 });
      afterChange(px, pc); return;
    }
    case 'timer-cancel': delete S.timers[el.dataset.k]; save(); render(); return;
    case 'proof': {
      const target = el.dataset.target;
      if (target.startsWith('q:')) { const win = windowFor(Q[target.slice(2)], t); if (!win.open) { toast(win.why); return; } }
      ui.sheet = { type: 'proof', target }; render(); return;
    }
    case 'photo-take': photoTarget = ui.sheet.target; photoInput.click(); return;
    case 'photo-skip': { const target = ui.sheet.target; ui.sheet = null; completeWithProof(target, ''); return; }
    case 'text': { const q = Q[el.dataset.id]; const win = windowFor(q, t); if (!win.open) { toast(win.why); return; } ui.sheet = { type: 'text', id: q.id, draft: '' }; render(); setTimeout(() => document.getElementById('txt')?.focus(), 50); return; }
    case 'text-save': {
      const q = Q[el.dataset.id], v = val('txt').trim();
      if (v.length < q.minLen) { toast(`Ещё ${q.minLen - v.length} символов`); return; }
      ui.sheet = null; mark(q.id, t, { v: 1, proof: 'text', text: v, c: 10 }); afterChange(px, pc); return;
    }
    case 'cig': { const d = day(t); d.cigs = Math.max(0, (d.cigs || 0) + Number(el.dataset.d)); if (d.q.smoke) d.q.smoke.v = smokeQuality(t, d.cigs); save(); render(); return; }
    case 'card-done': { const c = CARD[peekDay(t).card.id], R = RARITY[c.rarity]; markCard(t, { v: 1, c: R.coins }); afterChange(px, pc); return; }
    case 'reroll': {
      const d = day(t); if (d.card.rerolled || d.card.done) return;
      delete S.timers.card;
      const old = d.card.id; d.card = { id: drawCard([old]), rerolled: true, prev: old }; save(); render(); toast('Новая карта. Больше перетянуть нельзя'); return;
    }
    case 'ch-plus': markChallenge(t); afterChange(px, pc); return;
    case 'stake': {
      const v = Number(el.dataset.v); if (coins() < v) { toast('Не хватает монет'); return; }
      ensureWeek(weekOf(t)).stake = v; save(); render(); toast(`Ставка ${v}. Сделаешь — получишь ${v * 2}`, true); return;
    }
    case 'seen-loss': S.weeks[el.dataset.w].seenLoss = true; save(); render(); return;
    case 'fix-sheet': ui.sheet = { type: 'fix' }; render(); return;
    case 'fix': {
      const w = weekOf(t); if ((S.fixes[w] || 0) >= FIXES_PER_WEEK) { toast('Исправления на эту неделю кончились'); return; }
      S.fixes[w] = (S.fixes[w] || 0) + 1; day(addDays(t, -1)).q[el.dataset.id] = { v: .5, c: 0, fix: true, ts: Date.now() };
      ui.sheet = null; afterChange(px, pc); return;
    }
    case 'tag': { const d = day(addDays(t, -1)); d.tags ||= []; const tg = el.dataset.t; d.tags = d.tags.includes(tg) ? d.tags.filter(x => x !== tg) : d.tags.concat(tg); ui.noteDraft = val('note'); save(); render(); return; }
    case 'save-note': { const d = day(addDays(t, -1)); d.note = val('note').trim(); d.noted = true; ui.noteDraft = ''; save(); render(); toast('Записал. Сегодня новый день'); return; }
    case 'skip-note': day(addDays(t, -1)).noted = true; save(); render(); return;
    case 'nosleep-sheet': ui.sheet = { type: 'nosleep', tags: [], text: '' }; render(); return;
    case 'ns-tag': { const sh = ui.sheet, tg = el.dataset.t; sh.text = val('ns-text'); sh.tags = sh.tags.includes(tg) ? sh.tags.filter(x => x !== tg) : sh.tags.concat(tg); render(); return; }
    case 'nosleep-save': {
      const sh = ui.sheet, text = val('ns-text').trim();
      if (!sh.tags.length && !text) { toast('Выбери причину или напиши пару слов'); return; }
      day(nightKey()).nosleep = { tags: sh.tags, text, ts: Date.now() }; ui.sheet = null; save(); render(); toast('Записал. Сегодня береги себя: вода, прогулка, лечь пораньше'); return;
    }
    case 'nosleep-undo': delete day(nightKey()).nosleep; save(); render(); return;
    case 'sprint-keep': {
      S.sprints.push({ ts: Date.now(), day: t, kept: true }); ui.sheet = null; save();
      const n = sprintsIn(weekOf(t));
      render(); toast(n >= SPRINT_FLAG ? 'Неделя помечена ⚠' : `Принято. Ещё ${SPRINT_FLAG - n} — и неделя получит ⚠`); return;
    }
    case 'sprint-undo': {
      for (const m of ui.sheet.marks) undoMark(m);
      S.sprints.push({ ts: Date.now(), day: t, kept: false }); ui.sheet = null; markLog = [];
      afterChange(); toast('Снял. Честность засчитана', true); return;
    }
    case 'auto-yes': S.quests[el.dataset.id].check = weekOf(t); save(); render(); toast('Держится. Красава', true); return;
    case 'auto-no': {
      if (activeQuests().length >= slotsFor(levelOf(xpAll().total).L)) { toast('Слоты заняты. Освободи один на вкладке «Квесты»'); return; }
      activate(el.dataset.id, t); save(); render(); toast('Вернул в список дня. Это нормально'); return;
    }
    case 'q-take': {
      if (activeQuests().length >= slotsFor(levelOf(xpAll().total).L)) { toast('Свободных слотов нет'); return; }
      activate(el.dataset.id, t); save(); render(); toast(`Взят квест: ${Q[el.dataset.id].title}`, true); return;
    }
    case 'q-drop': confirmAsk(`Убрать «${Q[el.dataset.id].title}»?`, 'Слот освободится. Если вернёшь квест, прогресс до автопилота начнётся заново.', 'Убрать квест', 'q-drop', el.dataset.id); return;
    case 'confirm-yes': {
      const { act, id } = ui.sheet; ui.sheet = null;
      if (act === 'q-drop') { deactivate(id, t); toast('Квест убран, слот свободен'); }
      if (act === 'boss-del') { S.bosses = S.bosses.filter(b => b.id !== id); S.events = S.events.filter(e => e.id !== id); toast('Босс удалён'); }
      if (act === 'reward-del') { S.shop.rewards = S.shop.rewards.filter(r => r.id !== id); toast('Награда удалена'); }
      if (act === 'side-del') { S.sideList = S.sideList.filter(x => x !== id); S.custom = S.custom.filter(c => c.id !== id); toast('Сайд-квест удалён'); }
      if (act === 'reset') { try { localStorage.removeItem(STORE_KEY); } catch (err) { /* */ } S = null; ui = { tab: 'today', week: null, sheet: null, guide: 0, wiz: null, journalN: 14 }; render(); return; }
      save(); render(); return;
    }
    case 'ics': {
      const id = el.dataset.id, v = val('rm-' + id); if (!v) { toast('Сначала выбери время напоминания'); return; }
      S.settings.remind[id] = v; save(); openIcs([id]); return;
    }
    case 'ics-all': {
      for (const q of activeQuests()) { const v = val('rm-' + q.id); if (v) S.settings.remind[q.id] = v; }
      const ids = activeQuests().map(q => q.id).filter(id => S.settings.remind[id]);
      if (!ids.length) { toast('Укажи время хотя бы у одного квеста'); return; }
      save(); openIcs(ids); return;
    }
    case 'ics-share': try { await navigator.share({ files: [ui.sheet.file] }); } catch (err) { if (err?.name !== 'AbortError') toast('Не получилось. Создай напоминание вручную'); } return;
    case 'boss-hit': {
      const b = S.bosses.find(x => x.id === el.dataset.id), T = BT[b.type], v = num(val('bh-' + b.id));
      if (!(v > 0)) { toast('Введи число больше нуля'); return; }
      if (T.mode === 'sum') b.hits.push({ day: t, amount: v, ts: Date.now() });
      else { b.hits = b.hits.filter(h => h.day !== t); b.hits.push({ day: t, value: v, ts: Date.now() }); }
      const won = checkBossKill(b, t); afterChange(px, pc);
      if (won) setTimeout(() => toast(`Босс «${b.name}» побеждён! +500 опыта`, true), 1200);
      return;
    }
    case 'boss-clean': {
      const b = S.bosses.find(x => x.id === el.dataset.id);
      b.hits = b.hits.filter(h => h.day !== t); b.hits.push({ day: t, clean: el.dataset.v === '1', ts: Date.now() });
      const won = checkBossKill(b, t); afterChange(px, pc);
      if (el.dataset.v === '0') toast('Записал. Срыв — это просто день. Завтра снова бьём');
      if (won) setTimeout(() => toast(`Босс «${b.name}» побеждён! +500 опыта`, true), 1200);
      return;
    }
    case 'boss-undo': {
      const b = S.bosses.find(x => x.id === el.dataset.id); b.hits.pop();
      if (b.defeated) { b.defeated = null; S.events = S.events.filter(e => !(e.type === 'bosskill' && e.id === b.id)); }
      save(); render(); toast('Отменено'); return;
    }
    case 'boss-del': { const b = S.bosses.find(x => x.id === el.dataset.id); confirmAsk(`Удалить босса «${b.name}»?`, 'Вместе с историей ударов. Опыт за него тоже пропадёт.', 'Удалить босса', 'boss-del', b.id); return; }
    case 'boss-new': ui.sheet = { type: 'boss', d: null }; render(); return;
    case 'boss-pick': ui.sheet = { type: 'boss', d: { type: el.dataset.t } }; render(); return;
    case 'boss-save': {
      const d = ui.sheet.d, err = bossProblem(d); if (err) { toast(err); return; }
      if (activeBosses().length >= BOSS_LIMIT) { toast(`Больше ${BOSS_LIMIT} боссов одновременно нельзя`); return; }
      S.bosses.push(makeBoss(d, t)); ui.sheet = null; save(); render(); toast('Босс появился. В бой', true); return;
    }
    case 'side': (S.side[el.dataset.id] ||= []).push(t); afterChange(px, pc); return;
    case 'side-add': S.sideList.push(el.dataset.id); save(); render(); toast('Добавлено в сайд-квесты'); return;
    case 'side-undo': (S.side[el.dataset.id] || []).pop(); save(); render(); return;
    case 'add-custom': {
      const title = val('c-title').trim(); if (!title) { toast('Напиши название квеста'); return; }
      const xp = Math.min(500, Math.max(10, Math.round(Number(val('c-xp')) || 100)));
      S.custom.push({ id: 'c' + Date.now(), title, stat: val('c-stat') || 'body', xp }); save(); render(); toast('Квест добавлен'); return;
    }
    case 'buy': {
      const r = S.shop.rewards.find(x => x.id === el.dataset.id); if (!r) return;
      if (coins() < r.price) { toast('Не хватает монет'); return; }
      if (ui.buyAsk !== r.id) { ui.buyAsk = r.id; toast(`Нажми ещё раз, чтобы купить за ${r.price}`); setTimeout(() => { if (ui.buyAsk === r.id) ui.buyAsk = null; }, 3000); return; }
      ui.buyAsk = null; S.shop.bought.push({ id: r.id, title: r.title, price: r.price, day: t }); afterChange(); toast(`Куплено: ${r.title}. Наслаждайся без чувства вины`, true); return;
    }
    case 'reward-add': {
      const title = val('rw-title').trim(), price = Math.max(10, Math.round(Number(val('rw-price')) || 0));
      if (!title) { toast('Напиши, что за награда'); return; }
      S.shop.rewards.push({ id: 'r' + Date.now(), title, price }); save(); render(); toast('Награда добавлена'); return;
    }
    case 'reward-del': { const r = S.shop.rewards.find(x => x.id === el.dataset.id); confirmAsk(`Удалить награду «${r.title}»?`, 'Уже купленные останутся в истории.', 'Удалить награду', 'reward-del', r.id); return; }
    case 'side-del': { const sq = allSide().find(x => x.id === el.dataset.id); confirmAsk(`Удалить «${sq.title}»?`, 'Сайд-квест пропадёт из списка. Опыт за уже выполненные останется.', 'Удалить', 'side-del', sq.id); return; }
    case 'open-week': ui.tab = 'week'; ui.week = el.dataset.w; if (el.dataset.w === addDays(weekOf(t), -7)) S.seenWeek = el.dataset.w; save(); window.scrollTo(0, 0); render(); return;
    case 'journal-more': ui.journalN += 14; render(); return;
    case 'csv': {
      const file = new File([csv()], `savepoint-${t}.csv`, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (err) { /* отмена */ } }
      else { const a2 = document.createElement('a'); a2.href = URL.createObjectURL(file); a2.download = file.name; document.body.appendChild(a2); a2.click(); a2.remove(); }
      return;
    }
    case 'tone': S.settings.tone = el.dataset.v; save(); render(); return;
    case 'theme': S.settings.theme = el.dataset.v; save(); render(); return;
    case 'save-settings': {
      const wv = val('s-wake'), bv = val('s-bed'); if (wv) S.settings.wake = wv; if (bv) S.settings.bed = bv;
      save(); render(); toast('Настройки сохранены'); return;
    }
    case 'share': {
      ui.sheet = { type: 'share' }; render();
      const card = await drawShare(el.dataset.w);
      const file = new File([card.blob], `nedelya-${isoWeekNo(el.dataset.w)}.png`, { type: 'image/png' });
      ui.sheet = { type: 'share', url: card.url, file, text: card.text, canShare: !!(navigator.canShare && navigator.canShare({ files: [file] })) }; render(); return;
    }
    case 'share-send': try { await navigator.share({ files: [ui.sheet.file], text: ui.sheet.text }); } catch (err) { if (err && err.name !== 'AbortError') toast('Не получилось открыть меню. Зажми картинку'); } return;
    case 'share-copy': copyText(ui.sheet.text); return;
    case 'export': { const file = new File([JSON.stringify(S)], `savepoint-${t}.json`, { type: 'application/json' }); ui.sheet = { type: 'export', file, canShare: !!(navigator.canShare && navigator.canShare({ files: [file] })) }; render(); return; }
    case 'export-share': try { await navigator.share({ files: [ui.sheet.file] }); S.lastBackup = t; save(); } catch (err) { if (err?.name !== 'AbortError') toast('Не получилось. Скопируй текстом'); } return;
    case 'export-copy': { const ta = document.getElementById('exp-text'); if (!(await copyText(ta.value))) { ta.focus(); ta.select(); } S.lastBackup = t; save(); return; }
    case 'backup-later': S.lastBackup = addDays(t, -6); save(); render(); return;
    case 'reset-ask': confirmAsk('Удалить весь прогресс?', 'Опыт, серия, записи и настройки удалятся без возврата. Сначала лучше сохранить резервную копию.', 'Да, удалить всё', 'reset'); return;
  }
});
document.addEventListener('change', e => { const wbk = e.target.dataset?.wbk; if (wbk && ui.wiz) { const i = Number(e.target.closest('[data-bi]').dataset.bi); ui.wiz.d.bosses[i][wbk] = e.target.value; } const bf = e.target.dataset?.bf; if (bf && ui.sheet?.d) ui.sheet.d[bf] = e.target.value; const wf = e.target.dataset?.wf; if (wf) wizSet(wf, e.target.value); });
document.addEventListener('input', e => {
  const wf = e.target.dataset?.wf; if (wf) wizSet(wf, e.target.value);
  const wbk = e.target.dataset?.wbk; if (wbk && ui.wiz) { const i = Number(e.target.closest('[data-bi]').dataset.bi); ui.wiz.d.bosses[i][wbk] = e.target.value; }
  const bf = e.target.dataset?.bf; if (bf && ui.sheet?.d) ui.sheet.d[bf] = e.target.value;
  if (e.target.id === 'note') ui.noteDraft = e.target.value;
  if (e.target.id === 'txt') { if (ui.sheet) ui.sheet.draft = e.target.value; const n = document.getElementById('txt-n'); if (n) n.textContent = e.target.value.trim().length; }
});

function wizAction(a, el) {
  const w = ui.wiz, d = w.d;
  const re = () => render();
  switch (a) {
    case 'wz-next': { const err = wizProblem(); if (err) { toast(err); return; } if (w.step === WIZ.length - 1) { wizApply(); return; } w.step++; ui.slide = 'next'; window.scrollTo(0, 0); return re(); }
    case 'wz-back': ui.slide = 'back'; w.step = Math.max(0, w.step - 1); window.scrollTo(0, 0); return re();
    case 'wz-cancel': ui.wiz = null; if (S && !S.profileDone) { S.profileDone = true; save(); } return re();
    case 'wz-q': { const id = el.dataset.id; if (d.quests.includes(id)) d.quests = d.quests.filter(x => x !== id); else { if (d.quests.length >= wizQuestLimit()) { toast(`Максимум ${wizQuestLimit()}. Сними другой квест`); return; } d.quests.push(id); } return re(); }
    case 'wz-keep': { const id = el.dataset.id; d.keep = d.keep.includes(id) ? d.keep.filter(x => x !== id) : d.keep.concat(id); return re(); }
    case 'wz-badd': if (d.keep.length + d.bosses.length >= BOSS_LIMIT) { toast(`Максимум ${BOSS_LIMIT} босса`); return; } d.bosses.push({ type: el.dataset.t }); return re();
    case 'wz-bdel': d.bosses.splice(Number(el.dataset.i), 1); return re();
    case 'wz-side': { const id = el.dataset.id; d.side = d.side.includes(id) ? d.side.filter(x => x !== id) : d.side.concat(id); return re(); }
    case 'wz-cadd': { const title = val('wz-ctitle').trim(); if (!title) { toast('Напиши, что за дело'); return; } d.custom.push({ id: 'c' + Date.now(), title, stat: 'mind', xp: 100 }); return re(); }
    case 'wz-cdel': d.custom.splice(Number(el.dataset.i), 1); return re();
    case 'wz-rw': { const r = d.rewards[Number(el.dataset.i)]; r.on = !r.on; return re(); }
    case 'wz-radd': { const title = val('wz-rtitle').trim(), price = Math.max(10, Math.round(num(val('wz-rprice')) || 200)); if (!title) { toast('Напиши, что за награда'); return; } d.rewards.push({ id: 'r' + Date.now(), title, price, on: true }); return re(); }
    case 'wz-tone': d.tone = el.dataset.v; return re();
    case 'wz-theme': d.theme = el.dataset.v; document.documentElement.toggleAttribute('data-theme', d.theme !== 'auto'); if (d.theme !== 'auto') document.documentElement.setAttribute('data-theme', d.theme); return re();
  }
}

async function doImport() {
  let text = val('imp-text').trim();
  const f = document.getElementById('imp-file')?.files?.[0];
  if (!text && f) text = await f.text();
  try {
    const data = JSON.parse(text);
    if (!data || !data.created || !data.days) throw new Error('bad');
    S = migrate(data); S.guide = true; S.seenVersion = APP_VERSION; save(); ui.sheet = null; ui.tab = 'today'; ui.guide = null; ui.wiz = S.profileDone ? null : editWiz(); render(); toast('Прогресс восстановлен', true);
  } catch (err) { toast('Это не похоже на копию из приложения. Проверь текст'); }
}

/* ================= жесты ================= */
// Pinch-зум в Safari: события gesture* есть только на iOS
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
// Двойной тап: на iOS touch-action не всегда срабатывает в standalone-режиме
let lastTouchEnd = 0;
document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea, select')) e.preventDefault(); lastTouchEnd = now; }, { passive: false });
// Резинка, когда содержимое помещается на экран
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) { e.preventDefault(); return; }
  if (document.body.classList.contains('locked') && !e.target.closest('.sheet')) { e.preventDefault(); return; }
  if (document.documentElement.scrollHeight <= window.innerHeight + 1 && !e.target.closest('.sheet, .xscroll, textarea')) e.preventDefault();
}, { passive: false });

/* ================= запуск ================= */
document.getElementById('tabbar').innerHTML = `<nav class="tabbar-in">${[['today', 'Сегодня'], ['quests', 'Квесты'], ['week', 'Неделя'], ['report', 'Отчёт'], ['me', 'Профиль']].map(([t, n]) => `<button class="tab" data-a="tab" data-t="${t}">${ICON[t]}<span>${n}</span></button>`).join('')}</nav>`;
S = load();
if (S) {
  if (!S.guide) ui.guide = 0;            // обновились с первой версии — показываем гайд один раз
  if (S.seenVersion !== APP_VERSION) ui.sheet = { type: 'whatsnew', from: S.seenVersion || '1.0.0' };
  if (!S.profileDone) ui.wiz = editWiz();
  const notes = evolve(); const got = checkAch(); save(); render();
  [...notes, ...(got.length ? [got.length === 1 ? `Ачивка: ${got[0].title}` : `Новые ачивки: ${got.map(a => a.title).join(', ')}`] : [])].forEach((n, i) => setTimeout(() => toast(n, true), 500 + i * 800));
} else { ui.guide = 0; render(); }
photos.purge();

let lastKey = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S) return;
  if (todayKey() !== lastKey) { lastKey = todayKey(); evolve(); checkAch(); save(); }
  render();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  try {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('./sw.js').then(r => r.update()).catch(() => { });
  } catch (e) { /* превью без офлайна */ }
}
