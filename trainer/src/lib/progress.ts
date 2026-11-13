// Прогресс в браузере. v2 хранит все модули; при первом запуске переносит решённые задачи из тренажёра v1.
const KEY = 'xlplain-trainer.v2';
const V1 = 'xlplain-trainer.v1';
export type State = { v: 2; solved: Record<string, { at: string; xp: number; a?: string }>; revealed: Record<string, true>; drafts: Record<string, string>; days: string[]; migrated?: boolean };

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export function load(): State {
  let s: State = { v: 2, solved: {}, revealed: {}, drafts: {}, days: [] };
  try { const raw = localStorage.getItem(KEY); if (raw) s = Object.assign(s, JSON.parse(raw)); } catch (e) {}
  if (!s.migrated) {
    try {
      const old = JSON.parse(localStorage.getItem(V1) || 'null');
      if (old && old.solved) for (const [id, x] of Object.entries<any>(old.solved)) if (!s.solved['excel:' + id]) s.solved['excel:' + id] = { at: '', xp: x.gain || 0, a: x.f };
      if (old && old.revealed) for (const id of Object.keys(old.revealed)) s.revealed['excel:' + id] = true;
    } catch (e) {}
    s.migrated = true; save(s);
  }
  return s;
}
export function save(s: State) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
export function markSolved(s: State, key: string, xp: number, answer?: string) {
  const first = !s.solved[key];
  if (first) s.solved[key] = { at: today(), xp: s.revealed[key] ? Math.round(xp / 2) : xp, a: answer };
  else if (answer) s.solved[key].a = answer;
  const d = today(); if (!s.days.includes(d)) s.days.push(d);
  if (s.days.length > 400) s.days = s.days.slice(-400);
  delete s.drafts[key]; save(s);
  return first ? s.solved[key].xp : 0;
}
export function streak(s: State) {
  const set = new Set(s.days); let n = 0; const d = new Date();
  if (!set.has(today())) d.setDate(d.getDate() - 1);
  for (;;) { const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); if (!set.has(k)) break; n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const xpOf = (s: State, mod?: string) => Object.entries(s.solved).filter(([k]) => !mod || k.startsWith(mod + ':')).reduce((a, [, v]) => a + (v.xp || 0), 0);
export const solvedIn = (s: State, mod: string) => Object.keys(s.solved).filter(k => k.startsWith(mod + ':')).map(k => k.slice(mod.length + 1));
export function refreshHeader(s: State, mod: string, id?: string) {
  const h = document.querySelector('header.top') as HTMLElement; if (!h) return;
  const xp = xpOf(s, mod);
  const x = document.getElementById('xp'); if (x) x.textContent = xp + ' XP';
  const bar = document.getElementById('bar') as HTMLElement; if (bar) bar.style.width = Math.min(100, Math.round(100 * xp / +h.dataset.maxxp!)) + '%';
  const c = document.getElementById('count'); if (c) c.textContent = 'Решено ' + solvedIn(s, mod).length + ' из ' + h.dataset.total;
  const n = streak(s); const st = document.getElementById('streak'); if (st && n > 0) { st.hidden = false; st.textContent = 'Серия: ' + n + ' ' + plural(n, 'день', 'дня', 'дней'); }
  if (id) document.querySelectorAll('[data-task="' + id + '"]').forEach(el => { el.classList.add('done'); const d = el.querySelector('.dot'); if (d) d.textContent = '✓'; });
}
export function goal(name: string, params?: any) { try { if (!__BETA__ && (window as any).ym) (window as any).ym(113091081, 'reachGoal', name, params); } catch (e) {} }
export const plural = (n: number, one: string, few: string, many: string) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many; };
