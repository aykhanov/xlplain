// @ts-nocheck
import { XL } from './excel';

export type Cell = string | number | boolean | null;
export interface VaryRule { cells: string; oneOf?: Cell[]; template?: string; empty?: number }
export interface ExcelTask {
  id: string; slug: string; module: 'excel'; track: number; order: number;
  title: string; fn: string; seo_title: string; story: string; goal: string;
  grid: Cell[][]; target: string; answer: string; fixed?: string[]; vary?: VaryRule[];
  hint: string; tip?: string; xlplain?: string; verified?: string;
}

export function parseAddr(a: string): [number, number] {
  const m = a.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error('Bad address ' + a);
  return [XL.colIdx(m[1]), +m[2] - 1];
}
export function cellsOf(spec: string): [number, number][] {
  const [a, b] = spec.split(':');
  const [c1, r1] = parseAddr(a); const [c2, r2] = b ? parseAddr(b) : [c1, r1];
  const out = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push([c, r]);
  return out;
}

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
export function fillTemplate(t: string, rowIdx: number, rnd = Math.random): string {
  return t.replace(/\{([^}]+)\}/g, (_, tok) => {
    if (tok.startsWith('oneOf:')) return pick(tok.slice(6).split('|'), rnd);
    if (tok.startsWith('int:')) { const [lo, hi] = tok.slice(4).split('-').map(Number); return String(lo + Math.floor(rnd() * (hi - lo + 1))); }
    const m = tok.match(/^idx\+(\d+)$/); if (m) return String(rowIdx + +m[1]);
    throw new Error('Unknown template token ' + tok);
  });
}

const decimals = n => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

export function perturb(task: ExcelTask, rnd = Math.random): Cell[][] {
  const g = task.grid.map(r => r.slice());
  const fixed = new Set(task.fixed || []);
  g.forEach((row, r) => row.forEach((v, c) => {
    if (typeof v !== 'number' || fixed.has(XL.addr(c, r))) return;
    const f = 0.55 + rnd() * 1.05; const d = decimals(v); const k = Math.pow(10, d);
    row[c] = Math.round(v * f * k) / k;
  }));
  for (const rule of task.vary || []) {
    for (const [c, r] of cellsOf(rule.cells)) {
      while (g.length <= r) g.push([]);
      while (g[r].length <= c) g[r].push(null);
      if (rule.empty && rnd() < rule.empty) { g[r][c] = null; continue; }
      g[r][c] = rule.template ? fillTemplate(rule.template, r, rnd) : pick(rule.oneOf, rnd);
    }
  }
  return g;
}

export const getter = (grid, target) => (c, r) => {
  if (target && c === target[0] && r === target[1]) return null;
  const row = grid[r]; if (!row) return null; const v = row[c]; return v === undefined ? null : v;
};

export type CheckResult = { ok: true; got: any } | { ok: false; kind: 'empty' | 'noeq' | 'parse' | 'hardcode' | 'circular' | 'wrong' | 'fragile'; msg?: string; got?: any; want?: any };

export function check(task: ExcelTask, input: string, rounds = 12, rnd = Math.random): CheckResult {
  const s = (input || '').trim();
  if (!s) return { ok: false, kind: 'empty' };
  if (s[0] !== '=') return { ok: false, kind: 'noeq' };
  let ast;
  try { ast = XL.parse(s.slice(1)); } catch (e) { if (e instanceof XL.ParseErr) return { ok: false, kind: 'parse', msg: e.msg }; throw e; }
  const refs = XL.refsOf(ast);
  if (!refs.length) return { ok: false, kind: 'hardcode' };
  const target = parseAddr(task.target); const [tc, tr] = target;
  if (refs.some(x => tc >= x.c1 && tc <= x.c2 && tr >= x.r1 && tr <= x.r2)) return { ok: false, kind: 'circular' };
  const refAst = XL.parse(task.answer.slice(1));
  const got = XL.evaluate(ast, getter(task.grid, target));
  const want = XL.evaluate(refAst, getter(task.grid, target));
  if (!XL.same(got, want)) return { ok: false, kind: 'wrong', got, want };
  for (let i = 0; i < rounds; i++) {
    const g = perturb(task, rnd);
    if (!XL.same(XL.evaluate(ast, getter(g, target)), XL.evaluate(refAst, getter(g, target)))) return { ok: false, kind: 'fragile' };
  }
  return { ok: true, got };
}

export function preview(task: ExcelTask, input: string) {
  const s = (input || '').trim();
  if (!s || s[0] !== '=') return null;
  try { return XL.evaluate(XL.parse(s.slice(1)), getter(task.grid, parseAddr(task.target))); } catch (e) { return null; }
}
