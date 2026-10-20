'use strict';
/* Точка сохранения — личный трекер-игра. Всё хранится только на этом устройстве. */

const STORE_KEY = 'savepoint.v1';
const DAY_SHIFT_H = 4;            // день заканчивается в 04:00, ночь считается за вчера
const SHIELDS_PER_WEEK = 2;
const UNLOCK_NEED = 14, UNLOCK_WINDOW = 21;
const AUTO_NEED = 21, AUTO_WINDOW = 28;

const STATS = {
  sleep: { name: 'Сон' },
  body: { name: 'Тело' },
  money: { name: 'Деньги' },
  people: { name: 'Люди' },
};

const QUESTS = [
  { id: 'wake', title: 'Подъём в своё время', stat: 'sleep', kind: 'wake', start: true,
    hint: 'Жми сразу, как встал. Попал в окно — полный опыт, проспал — меньше, но не ноль.' },
  { id: 'shower', title: 'Душ до телефона', stat: 'body', kind: 'check', start: true,
    hint: 'Сразу после подъёма. До чая, ленты и дискорда.' },
  { id: 'walk', title: 'Прогулка 30 минут', stat: 'body', kind: 'check', req: 'wake',
    hint: 'Пешком на пары тоже считается, если в сумме полчаса.' },
  { id: 'bed', title: 'Отбой вовремя', stat: 'sleep', kind: 'bed', req: 'wake',
    hint: 'Жми, когда ложишься. Телефон на зарядку подальше от кровати.' },
  { id: 'food', title: 'День без доставки', stat: 'body', kind: 'check', req: 'walk',
    hint: 'Приготовил сам, поел в столовой, купил в магазине — считается.' },
  { id: 'smoke', title: 'Сигареты в лимите', stat: 'body', kind: 'smoke', req: 'food',
    hint: 'Считай каждую. Лимит на неделю — на одну в день меньше, чем в среднем на прошлой.' },
];
const Q = Object.fromEntries(QUESTS.map(q => [q.id, q]));

const SIDE = [
  { id: 'dent-book', title: 'Записаться к стоматологу', stat: 'body', xp: 150 },
  { id: 'dent-go', title: 'Сходить к стоматологу', stat: 'body', xp: 250 },
  { id: 'ther-book', title: 'Записаться к терапевту: спина, вес, анализы', stat: 'body', xp: 150 },
  { id: 'ther-go', title: 'Сходить к терапевту', stat: 'body', xp: 250 },
  { id: 'weigh', title: 'Взвеситься и записать вес', stat: 'body', xp: 60 },
  { id: 'pans', title: 'Купить сковородку и кастрюлю', stat: 'body', xp: 80 },
  { id: 'chair', title: 'Пересесть подальше от окна или поправить стул', stat: 'body', xp: 60 },
  { id: 'call', title: 'Позвонить родным первым', stat: 'people', xp: 60, repeat: 'week' },
  { id: 'walk-uni', title: 'Позвать кого-то из универа погулять', stat: 'people', xp: 150 },
  { id: 'card-plan', title: 'Посмотреть условия кредитки: ставка, минимальный платёж', stat: 'money', xp: 100 },
];

const SKIP_TAGS = ['Дискорд до утра', 'Не выспался', 'Забыл', 'Не было сил', 'Был занят'];
const RANKS = [[80, 'Машина'], [60, 'Стабильно'], [40, 'В деле'], [0, 'Разгон']];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

/* ---------------- dates ---------------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const shifted = (t = Date.now()) => new Date(t - DAY_SHIFT_H * 3600e3);
const todayKey = () => keyOf(shifted());
const wdIndex = k => (dateOf(k).getDay() + 6) % 7;      // 0 = понедельник
const weekOf = k => addDays(k, -wdIndex(k));
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
const fmtDay = k => { const d = dateOf(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtWeek = w => {
  const a = dateOf(w), b = dateOf(addDays(w, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
};
const isoWeekNo = k => {
  const d = dateOf(k); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const y1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - y1) / 864e5 - 3 + (y1.getDay() + 6) % 7) / 7);
};
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const shiftedMin = date => (date.getHours() * 60 + date.getMinutes() - DAY_SHIFT_H * 60 + 1440) % 1440;
const hhmm = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const rub = n => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };

/* ---------------- state ---------------- */
let S = null;
let ui = { tab: 'today', week: null, sheet: null, confirmReset: false, editTime: null, noteDraft: '' };

function fresh(cfg) {
  const t = todayKey();
  return {
    v: 1,
    created: t,
    settings: { wake: cfg.wake || '09:00', bed: cfg.bed || '01:00', tone: cfg.tone || 'roast', theme: 'auto' },
    boss: { total: cfg.debt || 0, paid: [], weekly: cfg.weekly || 0 },
    quests: Object.fromEntries(QUESTS.filter(q => q.start).map(q => [q.id, { periods: [{ from: t }], auto: null, check: null }])),
    days: {},
    side: {},          // id -> [дни выполнения]
    custom: [],        // свои сайд-квесты
    events: [],        // {day, type, id}
    seenWeek: null,
    lastLevel: 1,
  };
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* нет доступа */ }
  return null;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('Не получилось сохранить. Сделай резервную копию в Профиле.'); }
}
const day = k => (S.days[k] ||= { q: {} });
const peekDay = k => S.days[k] || { q: {} };

/* ---------------- quests status ---------------- */
function qStatus(id) {
  const r = S.quests[id];
  if (!r) return 'locked';
  const last = r.periods[r.periods.length - 1];
  return last && !last.to ? 'active' : (r.auto ? 'auto' : 'locked');
}
const activeOn = (id, k) => { const r = S.quests[id]; return !!r && r.periods.some(p => p.from <= k && (!p.to || k <= p.to)); };
const doneOn = (id, k) => !!peekDay(k).q[id];
function countDone(id, endK, windowDays) {
  let n = 0;
  for (let i = 0; i < windowDays; i++) { const k = addDays(endK, -i); if (k < S.created) break; if (doneOn(id, k)) n++; }
  return n;
}
function unlockProgress(q) {
  if (!q.req) return { have: 0, need: 0 };
  if (qStatus(q.req) === 'auto') return { have: UNLOCK_NEED, need: UNLOCK_NEED };
  return { have: countDone(q.req, todayKey(), UNLOCK_WINDOW), need: UNLOCK_NEED };
}
function activate(id, k) {
  const r = S.quests[id] ||= { periods: [], auto: null, check: null };
  r.periods.push({ from: k }); r.auto = null;
}

/* Автоматические переходы: открытие веток и автопилот */
function evolve() {
  const t = todayKey(), notes = [];
  for (const q of QUESTS) {
    const st = qStatus(q.id);
    if (st === 'locked' && q.req && !S.quests[q.id]) {
      const p = unlockProgress(q);
      if (p.have >= p.need && (qStatus(q.req) === 'active' || qStatus(q.req) === 'auto')) {
        activate(q.id, t); S.events.push({ day: t, type: 'unlock', id: q.id });
        notes.push(`Открыт новый квест: ${q.title}`);
      }
    }
    if (st === 'active') {
      const r = S.quests[q.id], since = r.periods[r.periods.length - 1].from;
      if (daysBetween(since, t) >= AUTO_WINDOW - 1 && countDone(q.id, addDays(t, -1), AUTO_WINDOW) >= AUTO_NEED) {
        r.periods[r.periods.length - 1].to = addDays(t, -1);
        r.auto = t; r.check = weekOf(t);
        S.events.push({ day: t, type: 'auto', id: q.id });
        notes.push(`«${q.title}» на автопилоте. +300 опыта`);
      }
    }
  }
  return notes;
}

/* ---------------- streak & shields ---------------- */
function anyDone(k) { return Object.keys(peekDay(k).q).length > 0; }
function streakInfo() {
  const t = todayKey(); let streak = 0; const shieldDays = new Set(); const used = {};
  for (let k = S.created; k < t; k = addDays(k, 1)) {
    if (anyDone(k)) streak++;
    else {
      const w = weekOf(k); used[w] = used[w] || 0;
      if (used[w] < SHIELDS_PER_WEEK) { used[w]++; shieldDays.add(k); }
      else streak = Math.floor(streak / 2);
    }
  }
  if (anyDone(t)) streak++;
  const left = SHIELDS_PER_WEEK - (used[weekOf(t)] || 0);
  return { streak, shieldDays, left };
}

/* ---------------- XP ---------------- */
const thresh = (L, base) => base * L * (L - 1) / 2;
function levelOf(xp, base = 100) { let L = 1; while (xp >= thresh(L + 1, base)) L++; return { L, from: thresh(L, base), to: thresh(L + 1, base) }; }
function xpAll() {
  const st = { sleep: 0, body: 0, money: 0, people: 0 };
  for (const k in S.days) for (const id in S.days[k].q) { const q = Q[id]; if (q) st[q.stat] += Math.round(20 * S.days[k].q[id].v); }
  for (const s of allSide()) for (const _ of (S.side[s.id] || [])) st[s.stat] += s.xp;
  for (const p of S.boss.paid) st.money += Math.floor(p.amount / 100);
  for (const e of S.events) if (e.type === 'auto') st[Q[e.id].stat] += 300;
  const total = st.sleep + st.body + st.money + st.people;
  return { total, st };
}
const allSide = () => SIDE.concat(S.custom);

/* ---------------- quality ---------------- */
function wakeQuality(date) {
  const diff = shiftedMin(date) - (toMin(S.settings.wake) - DAY_SHIFT_H * 60);
  return diff <= 60 ? 1 : diff <= 180 ? .5 : .25;
}
function bedQuality(date) {
  const target = (toMin(S.settings.bed) - DAY_SHIFT_H * 60 + 1440) % 1440;
  const m = shiftedMin(date);
  return m <= target ? 1 : m <= target + 90 ? .5 : .25;
}
function smokeLimit(k) {
  const prevW = addDays(weekOf(k), -7); let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) { const d = peekDay(addDays(prevW, i)); if (typeof d.cigs === 'number' && d.q.smoke) { sum += d.cigs; n++; } }
  if (n < 3) return null; // первая неделя — только считаем
  return Math.max(0, Math.round(sum / n) - 1);
}
function smokeQuality(k, count) {
  const lim = smokeLimit(k);
  if (lim === null) return 1;
  return count <= lim ? 1 : count <= lim + 2 ? .5 : .25;
}

/* ---------------- weekly score ---------------- */
function weekScore(w) {
  const t = todayKey();
  const { shieldDays } = streakInfo();
  const from = w < S.created ? S.created : w;
  const end = addDays(w, 6) < t ? addDays(w, 6) : t;
  const keys = []; for (let k = from; k <= end; k = addDays(k, 1)) keys.push(k);
  if (!keys.length) return null;
  let qSum = 0, qDays = 0, stable = 0;
  const perQuest = {};
  for (const k of keys) {
    const act = QUESTS.filter(q => activeOn(q.id, k));
    const done = anyDone(k), shield = shieldDays.has(k);
    if (done || shield) stable++;
    for (const q of act) { perQuest[q.id] ||= { done: 0, days: 0 }; perQuest[q.id].days++; if (doneOn(q.id, k)) perQuest[q.id].done++; }
    if (shield || !act.length) continue;
    // сегодняшний незакрытый день не тянет вниз
    if (k === t && !done) continue;
    qDays++; qSum += act.reduce((s, q) => s + (peekDay(k).q[q.id]?.v || 0), 0) / act.length;
  }
  const quests = qDays ? qSum / qDays * 60 : (stable ? 60 : 0);
  const denom = keys.length - (keys.includes(t) && !anyDone(t) ? 1 : 0);
  const stability = denom ? stable / denom * 20 : 20;
  const paid = S.boss.paid.filter(p => p.day >= w && p.day <= addDays(w, 6)).reduce((s, p) => s + p.amount, 0);
  const boss = !S.boss.total ? 10 : !S.boss.weekly ? (paid > 0 ? 10 : 0) : Math.min(1, paid / S.boss.weekly) * 10;
  const rushEv = S.events.some(e => e.day >= w && e.day <= addDays(w, 6))
    || allSide().some(s => (S.side[s.id] || []).some(d => d >= w && d <= addDays(w, 6)));
  const rush = rushEv ? 10 : 0;
  const total = Math.round(quests + stability + boss + rush);
  return { total, quests, stability, boss, rush, paid, perQuest, keys, stable, denom, live: end === t && addDays(w, 6) >= t };
}
const rankOf = s => RANKS.find(([min]) => s >= min)[1];

/* ---------------- summary lines ---------------- */
function pick(arr, seed) { return arr[seed % arr.length]; }
function summaryLines(w, sc) {
  const roast = S.settings.tone === 'roast';
  const seed = isoWeekNo(w);
  const out = [];
  const T = {
    shower: {
      lo: ['Душ {n} из {d}. Соседи по блоку начинают открывать окно, когда ты заходишь.', 'Душ {n} из {d}. Шампунь в шкафу ждёт тебя, как бабушка звонка.'],
      mid: ['Душ {n} из {d}. Уже не вонючка, но ещё не свежесть.', 'Душ {n} из {d}. Половина пути к званию «пахнет нормально».'],
      hi: ['Душ {n} из {d}. Официально: не вонючка.', 'Душ {n} из {d}. Свежесть уровня рекламы геля.'],
      n: 'Душ {n} из {d}.',
    },
    wake: {
      lo: ['Подъём в окне {n} из {d}. Будильник подаёт в суд за игнор.', 'Подъём {n} из {d}. Пары начинаются без тебя, а ты где-то в середине дня.'],
      mid: ['Подъём {n} из {d}. Режим собирается, как пазл без половины деталей.', 'Подъём {n} из {d}. Уже похоже на человека с режимом.'],
      hi: ['Подъём {n} из {d}. Будильник впервые чувствует уважение.', 'Подъём {n} из {d}. Режим держится, тело это запомнит.'],
      n: 'Подъём в своё время {n} из {d}.',
    },
    walk: {
      lo: ['Прогулка {n} из {d}. Ноги подозревают, что их держат для красоты.'],
      mid: ['Прогулка {n} из {d}. Улица тебя уже узнаёт.'],
      hi: ['Прогулка {n} из {d}. Голуби здороваются первыми.'],
      n: 'Прогулка {n} из {d}.',
    },
    bed: {
      lo: ['Отбой вовремя {n} из {d}. Дискорд снова победил.'],
      mid: ['Отбой {n} из {d}. Ночь пока делится с дискордом пополам.'],
      hi: ['Отбой {n} из {d}. Кенты в дискорде заметили, что ты уходишь первым.'],
      n: 'Отбой вовремя {n} из {d}.',
    },
    food: {
      lo: ['Без доставки {n} из {d}. Курьеры уже знают тебя по имени.'],
      mid: ['Без доставки {n} из {d}. Кухня видела тебя чаще, чем обычно.'],
      hi: ['Без доставки {n} из {d}. Приложение доставки шлёт «мы скучаем».'],
      n: 'Без доставки {n} из {d}.',
    },
    smoke: {
      lo: ['Сигареты в лимите {n} из {d}. Лифт с 13-го этажа устал возить тебя курить.'],
      mid: ['Сигареты в лимите {n} из {d}. Лёгкие осторожно надеются.'],
      hi: ['Сигареты в лимите {n} из {d}. Лёгкие пишут благодарность.'],
      n: 'Сигареты в лимите {n} из {d}.',
    },
  };
  for (const q of QUESTS) {
    const pq = sc.perQuest[q.id]; if (!pq || !pq.days) continue;
    const r = pq.done / pq.days, tpl = T[q.id];
    const s = roast ? pick(r < .4 ? tpl.lo : r < .8 ? tpl.mid : tpl.hi, seed) : tpl.n;
    out.push(s.replace('{n}', pq.done).replace('{d}', pq.days));
  }
  if (S.boss.total) {
    const left = bossLeft();
    out.push(sc.paid > 0
      ? (roast ? `Урон по кредитке: ${rub(sc.paid)}. Босс шатается, осталось ${rub(left)}.` : `По кредитке внесено ${rub(sc.paid)}, осталось ${rub(left)}.`)
      : (roast ? `По кредитке ноль урона. Босс отдыхает и копит проценты.` : `По кредитке на этой неделе ничего не внесено.`));
  }
  const tags = {};
  for (const k of sc.keys) for (const t of (peekDay(k).tags || [])) tags[t] = (tags[t] || 0) + 1;
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`Главная причина пропусков: ${top[0].toLowerCase()} (${top[1]} ${plural(top[1], 'раз', 'раза', 'раз')}).`);
  return out;
}

/* ---------------- boss ---------------- */
const bossPaid = () => S.boss.paid.reduce((s, p) => s + p.amount, 0);
const bossLeft = () => Math.max(0, S.boss.total - bossPaid());

/* ---------------- toasts ---------------- */
function toast(msg, gold) {
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast' + (gold ? ' gold' : ''); el.textContent = msg;
  box.appendChild(el); setTimeout(() => el.remove(), 2600);
}
function afterChange(prevXp) {
  const notes = evolve();
  const now = xpAll();
  const L = levelOf(now.total).L;
  save(); render();
  if (prevXp !== undefined && now.total > prevXp) toast(`+${now.total - prevXp} опыта`);
  if (L > (S.lastLevel || 1)) { S.lastLevel = L; save(); setTimeout(() => toast(`Новый уровень: ${L}`, true), 500); }
  notes.forEach((n, i) => setTimeout(() => toast(n, true), 900 + i * 700));
}

/* ---------------- icons ---------------- */
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield: '<svg class="shield" viewBox="0 0 22 26"><path d="M11 1.5 2 5v7c0 6 4 10.5 9 12.5 5-2 9-6.5 9-12.5V5z"/></svg>',
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9M8 6.5c5 1 8 2.5 8 4M8 17.5c5-1 8-2.5 8-4"/></svg>',
  week: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/></svg>',
};

/* ---------------- views ---------------- */
function viewOnboarding() {
  return `
  <section class="hero">
    <svg class="hero-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="var(--accent)"/><path d="M16 44h8V34h8V24h8V16h8" stroke="var(--on-accent)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h1>Точка сохранения</h1>
    <p class="muted">Маленькие квесты каждый день, честная оценка недели и привычки, которые со временем уходят на автопилот. Данные живут только на этом телефоне.</p>
  </section>
  <form class="card" id="onb">
    <h2>Настрой старт</h2>
    <div class="row">
      <label class="field grow"><span>Во сколько встаёшь</span><input id="o-wake" type="time" value="09:00" required></label>
      <label class="field grow"><span>Во сколько ложишься</span><input id="o-bed" type="time" value="01:00" required></label>
    </div>
    <label class="field"><span>Долг по кредитке, ₽ (0, если не нужен босс)</span><input id="o-debt" type="number" inputmode="numeric" min="0" step="100" placeholder="например, 300000"></label>
    <label class="field"><span>Сколько в неделю вносить на кредитку, ₽</span><input id="o-weekly" type="number" inputmode="numeric" min="0" step="100" placeholder="например, 2000"></label>
    <div class="field"><span>Тон недельной сводки</span>
      <div class="seg" id="o-tone"><button type="button" class="on" data-v="roast">С подколом</button><button type="button" data-v="neutral">Нейтральный</button></div>
    </div>
    <p class="muted" style="font-size:.85rem">На старте открыты два квеста: подъём и душ. Остальные откроются, когда эти продержатся 14 дней из 21.</p>
    <button class="btn" type="submit">Начать</button>
  </form>
  <button class="linkbtn" data-a="open-import" type="button">Восстановить из резервной копии</button>`;
}

function viewHeader() {
  const x = xpAll(), lv = levelOf(x.total), t = todayKey(), d = dateOf(t);
  const pct = (x.total - lv.from) / (lv.to - lv.from) * 100;
  const si = streakInfo();
  const shields = Array.from({ length: SHIELDS_PER_WEEK }, (_, i) => ICON.shield.replace('class="shield"', `class="shield${i < si.left ? '' : ' used'}"`)).join('');
  return `
  <header class="top">
    <div class="top-row">
      <div style="min-width:0">
        <div class="date-line">${WD_FULL[wdIndex(t)]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}</div>
        <h1>${greet()}</h1>
      </div>
      <div class="lvl" aria-label="Уровень ${lv.L}"><small>ур.</small><b>${lv.L}</b></div>
    </div>
    <div class="xpbar">
      <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="xpmeta"><span class="mono">${x.total - lv.from} / ${lv.to - lv.from} опыта</span><span>до уровня ${lv.L + 1}</span></div>
    </div>
    <div class="streak">
      <div class="streak-num">${si.streak}</div>
      <div class="streak-txt">${plural(si.streak, 'день', 'дня', 'дней')} подряд<br><span class="muted">Щиты недели: пропуск без штрафа</span></div>
      <div class="shields" aria-label="Осталось щитов: ${si.left}">${shields}</div>
    </div>
  </header>`;
}
function greet() {
  const h = new Date().getHours();
  return h < 5 ? 'Ночь. Пора спать' : h < 12 ? 'Доброе утро' : h < 18 ? 'День в разгаре' : 'Вечер';
}

function questCard(q, t) {
  const rec = peekDay(t).q[q.id], done = !!rec;
  let sub = q.hint, extra = '';
  if (q.kind === 'wake') {
    sub = done ? `Встал в ${rec.time} · +${Math.round(20 * rec.v)}` : `Окно: до ${addMin(S.settings.wake, 60)} · цель ${S.settings.wake}`;
    if (!done) extra = ui.editTime === q.id
      ? `<div class="q-extra"><input type="time" id="t-${q.id}" value="${S.settings.wake}" style="max-width:140px"><button class="btn sm" data-a="set-time" data-id="${q.id}">Сохранить</button></div>`
      : `<div class="q-extra"><button class="linkbtn" data-a="edit-time" data-id="${q.id}">Встал раньше, указать время</button></div>`;
  }
  if (q.kind === 'bed') {
    sub = done ? `Лёг в ${rec.time} · +${Math.round(20 * rec.v)}` : `Цель: лечь до ${S.settings.bed}`;
    if (!done) extra = ui.editTime === q.id
      ? `<div class="q-extra"><input type="time" id="t-${q.id}" value="${S.settings.bed}" style="max-width:140px"><button class="btn sm" data-a="set-time" data-id="${q.id}">Сохранить</button></div>`
      : `<div class="q-extra"><button class="linkbtn" data-a="edit-time" data-id="${q.id}">Уже лёг, указать время</button></div>`;
  }
  if (q.kind === 'check' && done) sub = `Готово · +${Math.round(20 * rec.v)}`;
  if (q.kind === 'smoke') {
    const c = peekDay(t).cigs || 0, lim = smokeLimit(t);
    sub = lim === null ? 'Первая неделя: просто считай. Лимит появится по её итогам.' : `Лимит сегодня: ${lim}`;
    if (done) sub = `Итог дня: ${c} · +${Math.round(20 * rec.v)}`;
    extra = `<div class="q-extra"><div class="counter"><button data-a="cig" data-d="-1" aria-label="Минус одна">−</button><span class="mono">${c}</span><button data-a="cig" data-d="1" aria-label="Плюс одна">+</button></div><span class="muted" style="font-size:.8rem">${done ? 'Можно поправить счёт' : 'Вечером закрой день галочкой'}</span></div>`;
  }
  return `
  <article class="q${done ? ' done' : ''}" data-stat="${q.stat}">
    <div class="q-main">
      <span class="chip">${STATS[q.stat].name}</span>
      <div class="q-title">${esc(q.title)}</div>
      <div class="q-sub">${esc(sub)}</div>
    </div>
    <button class="check" data-a="toggle" data-id="${q.id}" aria-pressed="${done}" aria-label="${done ? 'Отменить' : 'Отметить'}: ${esc(q.title)}">${ICON.check}</button>
    ${extra}
  </article>`;
}
const addMin = (hm, m) => { const v = (toMin(hm) + m) % 1440; return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`; };

function viewToday() {
  const t = todayKey(), y = addDays(t, -1);
  const active = QUESTS.filter(q => qStatus(q.id) === 'active');
  let html = viewHeader();

  // Итоги прошлой недели
  const prevW = addDays(weekOf(t), -7);
  if (S.seenWeek !== prevW && addDays(prevW, 6) >= S.created) {
    const sc = weekScore(prevW);
    if (sc) html += `<button class="card hl" data-a="open-week" data-w="${prevW}" style="text-align:left;border-width:1px">
      <span class="label">Итоги прошлой недели готовы</span>
      <div class="row" style="justify-content:space-between"><span class="rank">${sc.total}/100 · ${rankOf(sc.total)}</span><span class="muted">Открыть</span></div></button>`;
  }

  // Заметка про вчерашний пропуск
  if (y >= S.created && !anyDone(y) && !peekDay(y).noted) {
    const d = peekDay(y), tags = d.tags || [];
    html += `<section class="card">
      <span class="label">Вчера пусто</span>
      <h2>Что помешало?</h2>
      <div class="chips">${SKIP_TAGS.map(tg => `<button class="pill${tags.includes(tg) ? ' on' : ''}" data-a="tag" data-t="${esc(tg)}">${esc(tg)}</button>`).join('')}</div>
      <input type="text" id="note" placeholder="Одна строка, если хочется" value="${esc(ui.noteDraft)}" maxlength="140">
      <div class="row"><button class="btn sm" data-a="save-note">Записать</button><button class="linkbtn" data-a="skip-note">Пропустить</button></div>
    </section>`;
  }

  // Проверка автопилота
  for (const q of QUESTS) {
    const r = S.quests[q.id];
    if (qStatus(q.id) === 'auto' && r.check !== weekOf(t) && wdIndex(t) >= 5) {
      html += `<section class="card hl"><span class="label">Автопилот · раз в неделю</span><h2>«${esc(q.title)}» ещё держится?</h2>
        <div class="row"><button class="btn sm" data-a="auto-yes" data-id="${q.id}">Да, держится</button><button class="btn sm ghost" data-a="auto-no" data-id="${q.id}">Нет, верни в список</button></div></section>`;
    }
  }

  html += `<section class="section"><div class="section-head"><h2>Квесты дня</h2><span class="muted mono" style="font-size:.85rem">${active.filter(q => doneOn(q.id, t)).length}/${active.length}</span></div>
    <div class="quests">${active.length ? active.map(q => questCard(q, t)).join('') : '<div class="empty">Все квесты на автопилоте. Красиво.</div>'}</div></section>`;

  const auto = QUESTS.filter(q => qStatus(q.id) === 'auto');
  if (auto.length) html += `<p class="muted" style="font-size:.85rem">На автопилоте: ${auto.map(q => esc(q.title)).join(', ')}</p>`;

  if (S.boss.total) html += bossCard(true);

  const next = allSide().find(s => !s.repeat && !(S.side[s.id] || []).length);
  if (next) html += `<section class="card"><span class="label">Сайд-квест · один раз</span>
    <div class="side" style="padding:0"><div class="side-title">${esc(next.title)}</div><span class="side-xp">+${next.xp}</span></div>
    <div class="row"><button class="btn sm" data-a="side" data-id="${next.id}">Сделал</button><button class="linkbtn" data-a="tab" data-t="tree">Все сайд-квесты</button></div></section>`;
  return html;
}

function bossCard(compact) {
  const left = bossLeft(), pct = S.boss.total ? left / S.boss.total * 100 : 0;
  const w = weekOf(todayKey());
  const paidW = S.boss.paid.filter(p => p.day >= w).reduce((s, p) => s + p.amount, 0);
  return `<section class="card boss">
    <div class="boss-top"><span class="boss-name">Босс: Кредитка</span><span class="mono" style="font-size:.85rem">${rub(left)}</span></div>
    <div class="hp" role="img" aria-label="Осталось ${Math.round(pct)}%"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="hp-meta"><span>Урон за неделю: ${rub(paidW)}${S.boss.weekly ? ' из ' + rub(S.boss.weekly) : ''}</span><span>${(100 - pct).toFixed(1)}% побеждено</span></div>
    <div class="row"><input class="grow" id="pay" type="number" inputmode="numeric" min="0" step="100" placeholder="Внёс на кредитку, ₽"><button class="btn sm" data-a="pay">Нанести урон</button></div>
    ${compact ? '' : (S.boss.paid.length ? `<div class="muted" style="font-size:.82rem">Последние: ${S.boss.paid.slice(-4).reverse().map((p, i) => `${fmtDay(p.day)} — ${rub(p.amount)}`).join(' · ')} <button class="linkbtn" data-a="undo-pay">отменить последний</button></div>` : '')}
  </section>`;
}

function viewTree() {
  const t = todayKey();
  let html = `<header class="top"><span class="label">Дерево</span><h1>Ветки открываются по порядку</h1>
    <p class="muted">Новый квест открывается, когда предыдущий выполнен ${UNLOCK_NEED} дней из ${UNLOCK_WINDOW}. Квест, который держится ${AUTO_NEED} из ${AUTO_WINDOW} дней, уходит на автопилот.</p></header>`;
  html += '<section class="tree">';
  QUESTS.forEach((q, i) => {
    const st = qStatus(q.id);
    const state = st === 'active' ? 'active' : st === 'auto' ? 'auto' : 'locked';
    let body = '';
    if (state === 'active') {
      const r = S.quests[q.id], since = r.periods[r.periods.length - 1].from;
      const have = countDone(q.id, t, AUTO_WINDOW);
      body = `<span class="badge">Активен с ${fmtDay(since)}</span>
        <div class="mini"><i style="width:${Math.min(100, have / AUTO_NEED * 100)}%"></i></div>
        <span class="muted" style="font-size:.8rem">До автопилота: ${have}/${AUTO_NEED} за последние ${AUTO_WINDOW} дней</span>`;
    } else if (state === 'auto') {
      body = `<span class="badge gold">Автопилот</span><span class="muted" style="font-size:.8rem">Не появляется в списке дня. Раз в неделю спрошу, держится ли.</span>`;
    } else {
      const p = unlockProgress(q);
      const reqOk = q.req && qStatus(q.req) !== 'locked';
      body = `<span class="badge">Закрыт</span>` + (reqOk
        ? `<div class="mini"><i style="width:${Math.min(100, p.have / p.need * 100)}%"></i></div><span class="muted" style="font-size:.8rem">«${esc(Q[q.req].title)}»: ${p.have}/${p.need} за ${UNLOCK_WINDOW} дней</span>`
        : `<span class="muted" style="font-size:.8rem">Сначала откроется «${esc(Q[q.req].title)}»</span>`)
        + (ui.confirmEarly === q.id
          ? `<div class="row"><span class="muted" style="font-size:.8rem">Точно? Брать всё сразу — твой старый сценарий с пачкой.</span><button class="btn sm danger" data-a="early" data-id="${q.id}">Открыть всё равно</button><button class="linkbtn" data-a="early-cancel">Не надо</button></div>`
          : `<button class="linkbtn" data-a="early-ask" data-id="${q.id}" style="align-self:flex-start">Открыть досрочно</button>`);
    }
    html += `<div class="node" data-state="${state}" data-stat="${q.stat}">
      <div class="node-rail"><div class="node-dot">${state === 'auto' ? '★' : i + 1}</div><div class="node-line"></div></div>
      <div class="node-body"><div class="node-title">${esc(q.title)}</div><span class="chip" style="--c:var(--${q.stat})">${STATS[q.stat].name}</span>${body}</div></div>`;
  });
  html += '</section>';

  const w = weekOf(t);
  html += `<section class="card"><div class="section-head"><h2>Сайд-квесты</h2><span class="label">разовые</span></div><div>`;
  for (const s of allSide()) {
    const ds = S.side[s.id] || [];
    const done = s.repeat === 'week' ? ds.some(d => d >= w) : ds.length > 0;
    html += `<div class="side${done ? ' done' : ''}"><div style="min-width:0"><div class="side-title">${esc(s.title)}</div>
      <span class="muted" style="font-size:.78rem">${STATS[s.stat].name}${s.repeat ? ' · раз в неделю' : ''}${done && !s.repeat ? ' · ' + fmtDay(ds[ds.length - 1]) : ''}</span></div>
      ${done ? `<button class="linkbtn" data-a="side-undo" data-id="${s.id}">отменить</button>` : `<button class="btn sm" data-a="side" data-id="${s.id}">+${s.xp}</button>`}</div>`;
  }
  html += `</div>
    <details><summary class="muted" style="cursor:pointer">Добавить свой сайд-квест</summary>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <input type="text" id="c-title" placeholder="Например: разобрать завал на столе" maxlength="80">
        <div class="row"><select id="c-stat" class="grow">${Object.entries(STATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
        <input id="c-xp" class="grow" type="number" min="10" max="500" step="10" value="100" aria-label="Опыт"></div>
        <button class="btn sm" data-a="add-custom">Добавить</button>
      </div></details></section>`;
  return html;
}

function viewWeek() {
  const t = todayKey(), curW = weekOf(t);
  const w = ui.week || curW;
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
      <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
        <span class="rank">${rankOf(sc.total)}</span>
        ${delta !== null ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : '−'}${Math.abs(delta)} к прошлой неделе</span>` : '<span class="muted" style="font-size:.85rem">Первая неделя, сравнивать пока не с чем</span>'}
        ${sc.live ? '<span class="muted" style="font-size:.8rem">Считается по ходу недели</span>' : ''}
      </div>
    </div>
    <div class="parts">
      ${part('Квесты', sc.quests, 60)}${part('Стабильность', sc.stability, 20)}${part('Босс', sc.boss, 10)}${part('Рывок: сайд-квест или новая ветка', sc.rush, 10)}
    </div>
    <button class="btn" data-a="share" data-w="${w}">Поделиться с кентами</button>
  </section>`;

  // сетка 7 дней
  const { shieldDays } = streakInfo();
  const shown = QUESTS.filter(q => sc.perQuest[q.id]);
  if (shown.length) {
    html += `<section class="card"><h2>По дням</h2><div style="overflow-x:auto"><div class="grid7"><span></span>${WD.map(d => `<span class="h">${d}</span>`).join('')}`;
    for (const q of shown) {
      html += `<span class="nm" data-stat="${q.stat}">${esc(q.title)}</span>`;
      for (let i = 0; i < 7; i++) {
        const k = addDays(w, i), rec = peekDay(k).q[q.id];
        let cls = 'cell';
        if (k > t) cls += ' future';
        else if (!activeOn(q.id, k) || k < S.created) cls += ' off';
        else if (rec) cls += rec.v >= 1 ? ' full' : ' half';
        else if (shieldDays.has(k)) cls += ' shield';
        html += `<span class="${cls}" data-stat="${q.stat}" title="${fmtDay(k)}"></span>`;
      }
    }
    html += `</div></div><p class="muted" style="font-size:.78rem">Полная клетка — в срок, бледная — с опозданием, пунктир — день закрыт щитом.</p></section>`;
  }

  html += `<section class="card"><div class="section-head"><h2>Сводка</h2><span class="label">только для тебя</span></div><div class="lines">${summaryLines(w, sc).map(l => `<p>${esc(l)}</p>`).join('')}</div></section>`;

  // список недель
  const weeks = []; for (let k = curW; k >= weekOf(S.created) && weeks.length < 12; k = addDays(k, -7)) weeks.push(k);
  if (weeks.length > 1) html += `<section class="card"><h2>Все недели</h2><div class="weeks">${weeks.map(k => {
    const s = weekScore(k); return `<button class="wk${k === w ? ' sel' : ''}" data-a="open-week" data-w="${k}"><span>Неделя ${isoWeekNo(k)} <span class="muted" style="font-size:.8rem">${fmtWeek(k)}</span></span><span class="muted" style="font-size:.8rem">${s ? rankOf(s.total) : ''}</span><span class="wk-score">${s ? s.total : '—'}</span></button>`;
  }).join('')}</div></section>`;
  return html;
}
function part(name, v, max) {
  return `<div class="part"><span>${name}</span><span class="mono">${Math.round(v)}/${max}</span><div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`;
}

function viewMe() {
  const x = xpAll(), lv = levelOf(x.total);
  let html = `<header class="top"><span class="label">Профиль</span><h1>Уровень ${lv.L}</h1><p class="muted">Всего опыта: <span class="mono">${x.total}</span> · играешь с ${fmtDay(S.created)}</p></header>`;
  html += `<section class="stats">${Object.entries(STATS).map(([k, v]) => {
    const l = levelOf(x.st[k], 40);
    return `<div class="stat" data-stat="${k}"><div class="stat-top"><span class="stat-name">${v.name}</span><span class="stat-lvl">${l.L}</span></div>
      <div class="bar"><i style="width:${((x.st[k] - l.from) / (l.to - l.from) * 100).toFixed(1)}%"></i></div><span class="muted mono" style="font-size:.75rem">${x.st[k]} опыта</span></div>`;
  }).join('')}</section>`;
  if (S.boss.total) html += bossCard(false);

  const st = S.settings;
  html += `<section class="card"><h2>Настройки</h2>
    <div class="row"><label class="field grow"><span>Подъём</span><input id="s-wake" type="time" value="${st.wake}"></label>
    <label class="field grow"><span>Отбой</span><input id="s-bed" type="time" value="${st.bed}"></label></div>
    <div class="row"><label class="field grow"><span>Долг всего, ₽</span><input id="s-debt" type="number" inputmode="numeric" min="0" step="100" value="${S.boss.total || ''}"></label>
    <label class="field grow"><span>Цель в неделю, ₽</span><input id="s-weekly" type="number" inputmode="numeric" min="0" step="100" value="${S.boss.weekly || ''}"></label></div>
    <div class="field"><span>Тон сводки</span><div class="seg"><button class="${st.tone === 'roast' ? 'on' : ''}" data-a="tone" data-v="roast">С подколом</button><button class="${st.tone !== 'roast' ? 'on' : ''}" data-a="tone" data-v="neutral">Нейтральный</button></div></div>
    <div class="field"><span>Тема</span><div class="seg" style="grid-template-columns:repeat(3,1fr)">${[['auto', 'Как в системе'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, n]) => `<button class="${(st.theme || 'auto') === v ? 'on' : ''}" data-a="theme" data-v="${v}">${n}</button>`).join('')}</div></div>
    <button class="btn sm" data-a="save-settings">Сохранить настройки</button>
    <p class="muted" style="font-size:.8rem">День заканчивается в 04:00: если лёг в 2 ночи, отбой засчитается во вчерашний день.</p>
  </section>`;

  html += `<section class="card"><h2>Резервная копия</h2>
    <p class="muted" style="font-size:.88rem">Все данные лежат только на телефоне. Удалишь иконку — пропадут. Раз в неделю сохраняй копию: отправь её себе в «Избранное» или в заметки.</p>
    <div class="row"><button class="btn sm" data-a="export">Сохранить копию</button><button class="btn sm ghost" data-a="open-import">Восстановить</button></div>
  </section>`;

  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone) html += `<section class="card"><h2>Поставить на экран «Домой»</h2><p class="muted" style="font-size:.88rem">В Safari нажми «Поделиться» внизу, затем «На экран "Домой"». После этого приложение открывается без интернета и без адресной строки.</p></section>`;

  html += `<section class="card"><h2>Сброс</h2>${ui.confirmReset
    ? `<p>Удалить весь прогресс без возврата?</p><div class="row"><button class="btn sm danger" data-a="reset-yes">Да, удалить всё</button><button class="btn sm ghost" data-a="reset-no">Отмена</button></div>`
    : `<button class="btn sm danger" data-a="reset-ask" style="align-self:flex-start">Начать заново</button>`}</section>`;
  html += `<p class="muted" style="font-size:.75rem;text-align:center">Точка сохранения · данные только на этом устройстве</p>`;
  return html;
}

function viewSheet() {
  if (!ui.sheet) return '';
  if (ui.sheet.type === 'share') return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet" role="dialog" aria-label="Карточка недели">
    <h2>Карточка недели</h2>${ui.sheet.url ? `<img class="share-img" src="${ui.sheet.url}" alt="Карточка недели">` : '<div class="empty">Рисую…</div>'}
    <p class="muted" style="font-size:.85rem">${ui.sheet.canShare ? 'Отправь кентам через меню «Поделиться».' : 'Зажми картинку и выбери «Сохранить» или «Поделиться».'}</p>
    <div class="row">${ui.sheet.canShare ? '<button class="btn grow" data-a="share-send">Поделиться</button>' : ''}<button class="btn ghost grow" data-a="share-copy">Скопировать текстом</button></div>
    <button class="btn ghost" data-a="close-sheet">Закрыть</button></div></div>`;
  if (ui.sheet.type === 'import') return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet" role="dialog" aria-label="Восстановление">
    <h2>Восстановить из копии</h2><p class="muted" style="font-size:.88rem">Выбери файл копии или вставь её текст. Текущие данные заменятся.</p>
    <input type="file" id="imp-file" accept=".json,application/json,text/plain">
    <textarea id="imp-text" placeholder='{"v":1, ...}'></textarea>
    <button class="btn" data-a="import">Восстановить</button><button class="btn ghost" data-a="close-sheet">Отмена</button></div></div>`;
  if (ui.sheet.type === 'export') return `<div class="sheet-bg" data-a="close-sheet"><div class="sheet" role="dialog" aria-label="Копия">
    <h2>Резервная копия</h2><p class="muted" style="font-size:.88rem">Скопируй текст и сохрани в заметки или отправь себе.</p>
    <textarea id="exp-text" readonly>${esc(JSON.stringify(S))}</textarea>
    <div class="row">${ui.sheet.canShare ? '<button class="btn grow" data-a="export-share">Отправить файлом</button>' : ''}<button class="btn ghost grow" data-a="export-copy">Скопировать</button></div>
    <button class="btn ghost" data-a="close-sheet">Закрыть</button></div></div>`;
  return '';
}

function render() {
  applyTheme();
  const root = document.getElementById('app');
  if (!S) { root.innerHTML = viewOnboarding(); document.getElementById('tabbar').hidden = true; bindOnboarding(); document.getElementById('sheet').innerHTML = viewSheet(); return; }
  document.getElementById('tabbar').hidden = false;
  root.innerHTML = ui.tab === 'tree' ? viewTree() : ui.tab === 'week' ? viewWeek() : ui.tab === 'me' ? viewMe() : viewToday();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === ui.tab));
  document.getElementById('sheet').innerHTML = viewSheet();
}
function applyTheme() {
  const th = S?.settings?.theme;
  if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th);
  else document.documentElement.removeAttribute('data-theme');
}

/* ---------------- onboarding ---------------- */
function bindOnboarding() {
  const seg = document.getElementById('o-tone');
  seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  document.getElementById('onb').onsubmit = e => {
    e.preventDefault();
    S = fresh({
      wake: val('o-wake'), bed: val('o-bed'),
      debt: Math.max(0, Number(val('o-debt')) || 0), weekly: Math.max(0, Number(val('o-weekly')) || 0),
      tone: seg.querySelector('.on')?.dataset.v || 'roast',
    });
    save(); ui.tab = 'today'; render(); toast('Сохранение создано. Первые квесты ждут', true);
  };
}
const val = id => document.getElementById(id)?.value ?? '';

/* ---------------- share card ---------------- */
async function drawCard(w) {
  const sc = weekScore(w), si = streakInfo(), lv = levelOf(xpAll().total).L;
  const prev = addDays(w, -7) >= weekOf(S.created) ? weekScore(addDays(w, -7)) : null;
  const delta = prev ? sc.total - prev.total : null;
  try { await Promise.all(['800 120px Unbounded', '700 40px Unbounded', '500 36px "Golos Text"', '600 36px "Golos Text"'].map(f => document.fonts.load(f))); } catch (e) { /* фолбэк */ }
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const gold = '#f2b544', ink = '#11131a', fg = '#eceae3', mut = '#9097a9', line = '#2d3245';
  x.fillStyle = ink; x.fillRect(0, 0, W, H);
  const D = '"Unbounded", "Golos Text", system-ui, sans-serif', B = '"Golos Text", system-ui, sans-serif';
  x.fillStyle = mut; x.font = `600 34px ${B}`; x.fillText(`НЕДЕЛЯ ${isoWeekNo(w)} · ${fmtWeek(w).toUpperCase()}`, 90, 150);
  // кольцо
  const cx = 300, cy = 470, r = 190;
  x.lineCap = 'round'; x.lineWidth = 34;
  x.strokeStyle = line; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = gold; x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(.005, sc.total / 100)); x.stroke();
  x.fillStyle = fg; x.textAlign = 'center'; x.font = `800 140px ${D}`; x.fillText(String(sc.total), cx, cy + 40);
  x.fillStyle = mut; x.font = `500 32px ${B}`; x.fillText('из 100', cx, cy + 100);
  x.textAlign = 'left';
  x.fillStyle = gold; x.font = `800 64px ${D}`; x.fillText(rankOf(sc.total), 560, 430);
  if (delta !== null) { x.fillStyle = delta >= 0 ? '#5dd3a2' : '#ff6f6f'; x.font = `700 44px ${D}`; x.fillText(`${delta >= 0 ? '+' : '−'}${Math.abs(delta)} к прошлой`, 560, 510); }
  // плитки
  const tiles = [[`${si.streak}`, plural(si.streak, 'день подряд', 'дня подряд', 'дней подряд')], [`${lv}`, 'уровень'], [`${sc.stable}/${Math.max(sc.denom, 1)}`, 'дни с квестами']];
  tiles.forEach(([v, l], i) => {
    const tx = 90 + i * 310, ty = 790;
    x.fillStyle = '#1a1d27'; roundRect(x, tx, ty, 280, 220, 36); x.fill();
    x.fillStyle = fg; x.font = `800 76px ${D}`; x.fillText(v, tx + 34, ty + 120);
    x.fillStyle = mut; x.font = `500 32px ${B}`; x.fillText(l, tx + 34, ty + 175);
  });
  x.fillStyle = mut; x.font = `500 30px ${B}`; x.fillText('Квесты · стабильность · босс · рывок', 90, 1110);
  x.fillStyle = gold; roundRect(x, 90, 1210, 64, 64, 18); x.fill();
  x.strokeStyle = ink; x.lineWidth = 7; x.beginPath(); x.moveTo(104, 1258); x.lineTo(114, 1258); x.lineTo(114, 1246); x.lineTo(124, 1246); x.lineTo(124, 1234); x.lineTo(134, 1234); x.lineTo(134, 1224); x.lineTo(142, 1224); x.stroke();
  x.fillStyle = fg; x.font = `700 36px ${D}`; x.fillText('Точка сохранения', 176, 1254);
  const text = `Неделя ${isoWeekNo(w)}: ${sc.total}/100 · ${rankOf(sc.total)}${delta !== null ? ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}` : ''} · серия ${si.streak} · уровень ${lv}`;
  return new Promise(res => c.toBlob(b => res({ blob: b, url: URL.createObjectURL(b), text }), 'image/png'));
}
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); return true; }
  catch (e) { toast('Не вышло скопировать. Выдели текст вручную'); return false; }
}

/* ---------------- actions ---------------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  if (a === 'close-sheet' && e.target !== el && el.classList.contains('sheet-bg')) return; // клик внутри листа
  if (a === 'open-import') { ui.sheet = { type: 'import' }; render(); return; }
  if (a === 'close-sheet') { ui.sheet = null; render(); return; }
  if (a === 'import') return doImport();
  if (!S) return;
  const t = todayKey(), prevXp = xpAll().total;

  switch (a) {
    case 'tab': ui.tab = el.dataset.t; ui.week = null; ui.editTime = null; ui.confirmReset = false; window.scrollTo(0, 0); render(); return;
    case 'toggle': {
      const id = el.dataset.id, q = Q[id], d = day(t);
      if (d.q[id]) { delete d.q[id]; save(); render(); toast('Отметка снята'); return; }
      const now = new Date();
      if (q.kind === 'wake') d.q[id] = { v: wakeQuality(now), time: hhmm(now) };
      else if (q.kind === 'bed') d.q[id] = { v: bedQuality(now), time: hhmm(now) };
      else if (q.kind === 'smoke') d.q[id] = { v: smokeQuality(t, d.cigs || 0) };
      else d.q[id] = { v: 1 };
      ui.editTime = null;
      afterChange(prevXp);
      requestAnimationFrame(() => document.querySelector(`[data-id="${id}"]`)?.closest('.q')?.classList.add('pop'));
      return;
    }
    case 'edit-time': ui.editTime = el.dataset.id; render(); return;
    case 'set-time': {
      const id = el.dataset.id, v = val('t-' + id); if (!v) return;
      const [h, m] = v.split(':').map(Number); const dt = new Date(); dt.setHours(h, m, 0, 0);
      day(t).q[id] = { v: id === 'wake' ? wakeQuality(dt) : bedQuality(dt), time: v };
      ui.editTime = null; afterChange(prevXp); return;
    }
    case 'cig': {
      const d = day(t); d.cigs = Math.max(0, (d.cigs || 0) + Number(el.dataset.d));
      if (d.q.smoke) d.q.smoke.v = smokeQuality(t, d.cigs);
      save(); render(); return;
    }
    case 'tag': {
      const y = addDays(t, -1), d = day(y); d.tags ||= [];
      const tg = el.dataset.t; d.tags = d.tags.includes(tg) ? d.tags.filter(x => x !== tg) : d.tags.concat(tg);
      ui.noteDraft = val('note'); save(); render(); return;
    }
    case 'save-note': { const d = day(addDays(t, -1)); d.note = val('note').trim(); d.noted = true; ui.noteDraft = ''; save(); render(); toast('Записал. Сегодня новый день'); return; }
    case 'skip-note': { day(addDays(t, -1)).noted = true; save(); render(); return; }
    case 'auto-yes': S.quests[el.dataset.id].check = weekOf(t); save(); render(); toast('Держится. Красава', true); return;
    case 'auto-no': activate(el.dataset.id, t); save(); render(); toast('Вернул в список дня. Это нормально'); return;
    case 'pay': {
      const n = Math.round(Number(val('pay'))); if (!(n > 0)) { toast('Введи сумму больше нуля'); return; }
      S.boss.paid.push({ day: t, amount: n }); afterChange(prevXp);
      if (!bossLeft()) setTimeout(() => toast('Босс побеждён. Кредитка закрыта!', true), 1200);
      return;
    }
    case 'undo-pay': S.boss.paid.pop(); save(); render(); toast('Последний платёж отменён'); return;
    case 'side': { (S.side[el.dataset.id] ||= []).push(t); afterChange(prevXp); return; }
    case 'side-undo': { const arr = S.side[el.dataset.id] || []; arr.pop(); save(); render(); return; }
    case 'add-custom': {
      const title = val('c-title').trim(); if (!title) { toast('Напиши название квеста'); return; }
      const xp = Math.min(500, Math.max(10, Math.round(Number(val('c-xp')) || 100)));
      S.custom.push({ id: 'c' + Date.now(), title, stat: val('c-stat') || 'body', xp }); save(); render(); toast('Квест добавлен'); return;
    }
    case 'early-ask': ui.confirmEarly = el.dataset.id; render(); return;
    case 'early-cancel': ui.confirmEarly = null; render(); return;
    case 'early': activate(el.dataset.id, t); ui.confirmEarly = null; save(); render(); toast('Квест открыт. Не перегружай себя'); return;
    case 'open-week': ui.tab = 'week'; ui.week = el.dataset.w; if (el.dataset.w === addDays(weekOf(t), -7)) S.seenWeek = el.dataset.w; save(); window.scrollTo(0, 0); render(); return;
    case 'tone': S.settings.tone = el.dataset.v; save(); render(); return;
    case 'theme': S.settings.theme = el.dataset.v; save(); render(); return;
    case 'save-settings': {
      const wv = val('s-wake'), bv = val('s-bed');
      if (wv) S.settings.wake = wv; if (bv) S.settings.bed = bv;
      S.boss.total = Math.max(0, Math.round(Number(val('s-debt')) || 0));
      S.boss.weekly = Math.max(0, Math.round(Number(val('s-weekly')) || 0));
      save(); render(); toast('Настройки сохранены'); return;
    }
    case 'share': {
      ui.sheet = { type: 'share' }; render();
      const card = await drawCard(el.dataset.w);
      const file = new File([card.blob], `nedelya-${isoWeekNo(el.dataset.w)}.png`, { type: 'image/png' });
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      ui.sheet = { type: 'share', url: card.url, file, text: card.text, canShare }; render(); return;
    }
    case 'share-send': {
      try { await navigator.share({ files: [ui.sheet.file], text: ui.sheet.text }); }
      catch (err) { if (err && err.name !== 'AbortError') toast('Не получилось открыть меню. Зажми картинку'); }
      return;
    }
    case 'share-copy': copyText(ui.sheet.text); return;
    case 'export': {
      const file = new File([JSON.stringify(S)], `savepoint-${t}.json`, { type: 'application/json' });
      ui.sheet = { type: 'export', file, canShare: !!(navigator.canShare && navigator.canShare({ files: [file] })) }; render(); return;
    }
    case 'export-share': try { await navigator.share({ files: [ui.sheet.file] }); } catch (err) { if (err?.name !== 'AbortError') toast('Не получилось. Скопируй текстом'); } return;
    case 'export-copy': { const ta = document.getElementById('exp-text'); if (!(await copyText(ta.value))) { ta.focus(); ta.select(); } return; }
    case 'reset-ask': ui.confirmReset = true; render(); return;
    case 'reset-no': ui.confirmReset = false; render(); return;
    case 'reset-yes': try { localStorage.removeItem(STORE_KEY); } catch (err) { } S = null; ui = { tab: 'today', week: null, sheet: null }; render(); return;
  }
});
document.addEventListener('input', e => { if (e.target.id === 'note') ui.noteDraft = e.target.value; });

async function doImport() {
  let text = val('imp-text').trim();
  const f = document.getElementById('imp-file')?.files?.[0];
  if (!text && f) text = await f.text();
  try {
    const data = JSON.parse(text);
    if (!data || data.v !== 1 || !data.created || !data.days) throw new Error('bad');
    S = data; save(); ui.sheet = null; ui.tab = 'today'; render(); toast('Прогресс восстановлен', true);
  } catch (err) { toast('Это не похоже на копию из приложения. Проверь текст'); }
}

/* ---------------- boot ---------------- */
document.getElementById('tabbar').innerHTML = `<nav class="tabbar-in">${[['today', 'Сегодня'], ['tree', 'Дерево'], ['week', 'Неделя'], ['me', 'Профиль']].map(([t, n]) => `<button class="tab" data-a="tab" data-t="${t}">${ICON[t]}<span>${n}</span></button>`).join('')}</nav>`;
S = load();
if (S) { const notes = evolve(); save(); render(); notes.forEach((n, i) => setTimeout(() => toast(n, true), 400 + i * 700)); }
else render();

// перерисовать при возвращении в приложение (день мог смениться)
let lastKey = todayKey();
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && todayKey() !== lastKey) { lastKey = todayKey(); evolve(); save(); render(); } });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  try { navigator.serviceWorker?.register('./sw.js').catch(() => { }); } catch (e) { /* превью без офлайна */ }
}
