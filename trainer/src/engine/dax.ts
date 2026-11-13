// @ts-nocheck
/* Движок DAX для тренажёра.
   Модель в памяти (таблицы + связи «многие к одному», однонаправленные), контекст фильтра,
   CALCULATE с переходом контекста, ALL/REMOVEFILTERS/ALLEXCEPT/ALLSELECTED, KEEPFILTERS,
   итераторы, табличные функции, логика времени. Сообщения об ошибках — как в русском Power BI. */

export type Val = number | string | boolean | null; // null = BLANK
export type ColType = 'int' | 'num' | 'text' | 'date' | 'bool';
export interface ColDef { name: string; type: ColType; sortBy?: string; hidden?: boolean; key?: boolean }
export interface BaseTable { name: string; cols: ColDef[]; rows: Val[][]; ci: Map<string, number>; ix: Map<number, Map<string, number[]>>; dates?: Map<number, number[]> }
export interface Rel { from: string; fromCol: string; to: string; toCol: string; link?: Int32Array }
export interface Measure { name: string; table: string; text: string; node: any; format?: string }
export interface Model { tables: BaseTable[]; byName: Map<string, BaseTable>; rels: Rel[]; measures: Map<string, Measure>; date?: { table: string; col: string } }
export interface Filter { table: string; cols: string[]; keys: Set<string>; rows?: Set<number>; _ix?: number[] }

export class DaxError extends Error { pos?: number; constructor(msg: string, pos?: number) { super(msg); this.pos = pos; } }
const err = (m: string, p?: number): never => { throw new DaxError(m, p); };
export const low = (s: string) => String(s).toLowerCase().replace(/ё/g, 'е');

/* ───────────── модель ───────────── */
export function makeTable(name: string, cols: ColDef[], rows: Val[][]): BaseTable {
  return { name, cols, rows, ci: new Map(cols.map((c, i) => [low(c.name), i])), ix: new Map() };
}
export function makeModel(tables: BaseTable[], rels: Rel[], date?: { table: string; col: string }): Model {
  const m: Model = { tables, byName: new Map(tables.map(t => [low(t.name), t])), rels, measures: new Map(), date };
  for (const r of rels) {
    const from = tbl(m, r.from), to = tbl(m, r.to);
    const fi = colIx(from, r.fromCol), ti = colIx(to, r.toCol);
    const map = new Map<string, number>(); to.rows.forEach((row, i) => map.set(vk(row[ti]), i));
    r.link = new Int32Array(from.rows.length); from.rows.forEach((row, i) => { r.link[i] = map.get(vk(row[fi])) ?? -1; });
  }
  return m;
}
export function tbl(m: Model, name: string, p?: number): BaseTable {
  return m.byName.get(low(name)) || err(`Таблица «${name}» не найдена в модели. Таблицы модели: ${m.tables.map(t => t.name).join(', ')}.`, p);
}
export function colIx(t: BaseTable, c: string, p?: number): number {
  const i = t.ci.get(low(c)); if (i === undefined) err(`Столбец «${c}» не найден в таблице «${t.name}».`, p); return i;
}
export function addMeasure(m: Model, text: string, table = 'Продажи', format?: string) {
  const { name, node } = parseMeasure(text);
  m.measures.set(low(name), { name, table, text, node, format });
  return name;
}
const vk = (v: Val) => v === null || v === undefined ? '_' : typeof v === 'number' ? 'n' + v : typeof v === 'boolean' ? 'b' + (v ? 1 : 0) : 's' + v;
const tk = (vals: Val[]) => vals.length === 1 ? vk(vals[0]) : vals.map(vk).join('\u0001');
const index = (t: BaseTable, i: number) => {
  let x = t.ix.get(i); if (x) return x;
  x = new Map(); t.rows.forEach((r, k) => { const key = vk(r[i]); const a = x.get(key); if (a) a.push(k); else x.set(key, [k]); });
  t.ix.set(i, x); return x;
};

/* ───────────── видимые строки в контексте фильтра ───────────── */
const visCache = new WeakMap<Filter[], Map<string, number[]>>();
function passOwn(t: BaseTable, f: Filter, r: number) {
  if (f.rows) return f.rows.has(r);
  const ix = f._ix || (f._ix = f.cols.map(c => colIx(t, c)));
  const row = t.rows[r];
  return f.keys.has(ix.length === 1 ? vk(row[ix[0]]) : ix.map(i => vk(row[i])).join('\u0001'));
}
export function visible(m: Model, t: BaseTable, filters: Filter[]): number[] {
  let c = visCache.get(filters); if (!c) { c = new Map(); visCache.set(filters, c); }
  const hit = c.get(t.name); if (hit) return hit;
  const res = computeVisible(m, t, filters); c.set(t.name, res); return res;
}
let fseq = 0; const passCache = new Map<string, Uint8Array>();
const fid = (f: any) => f._id || (f._id = ++fseq);
function computeVisible(m: Model, t: BaseTable, filters: Filter[]): number[] {
  const own = filters.filter(f => f.table === t.name);
  const dimTests: { link: Int32Array; pass: Uint8Array }[] = [];
  for (const rel of m.rels) {
    if (rel.from !== t.name) continue;
    const df = filters.filter(f => f.table === rel.to);
    if (!df.length) continue;
    const d = tbl(m, rel.to);
    const key = d.name + ':' + df.map(fid).join(',');
    let pass = passCache.get(key);
    if (!pass) { pass = new Uint8Array(d.rows.length); for (const i of computeVisible(m, d, df)) pass[i] = 1; if (passCache.size > 20000) passCache.clear(); passCache.set(key, pass); }
    dimTests.push({ link: rel.link, pass });
  }
  // расширенная таблица: фильтр по строкам факта сужает и связанные справочники
  const exp: Set<number>[] = [];
  for (const rel of m.rels) {
    if (rel.to !== t.name) continue;
    for (const f of filters) if (f.table === rel.from && f.rows) { const s = new Set<number>(); for (const r of f.rows) { const k = rel.link[r]; if (k >= 0) s.add(k); } exp.push(s); }
  }
  let cand: number[] | null = null;
  const offer = (a: number[]) => { if (!cand || a.length < cand.length) cand = a; };
  for (const f of own) {
    if (f.rows) offer([...f.rows]);
    else if (f.cols.length === 1) { const x = index(t, colIx(t, f.cols[0])); const a: number[] = []; for (const k of f.keys) { const r = x.get(k); if (r) a.push(...r); } offer(a); }
  }
  for (const s of exp) offer([...s]);
  const base = cand ? [...new Set(cand)].sort((a, b) => a - b) : t.rows.map((_, i) => i);
  if (!own.length && !dimTests.length && !exp.length) return base;
  return base.filter(r => {
    for (const f of own) if (!passOwn(t, f, r)) return false;
    for (const d of dimTests) { const k = d.link[r]; if (k < 0 || !d.pass[k]) return false; }
    for (const s of exp) if (!s.has(r)) return false;
    return true;
  });
}

/* ───────────── токенизатор и разбор ───────────── */
type Tok = { k: 'num' | 'str' | 'col' | 'qtbl' | 'id' | 'op' | 'sep' | 'eof'; v: string; p: number; n?: number };
export function detectSep(src: string): ',' | ';' {
  let q = ''; for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch; else if (ch === '[') q = ']'; else if (ch === ';') return ';';
  }
  return ',';
}
export function tokenize(src: string, sep: ',' | ';' = detectSep(src)): Tok[] {
  const out: Tok[] = []; let i = 0;
  const L = /[A-Za-zА-Яа-яЁё_À-ɏ]/, W = /[A-Za-zА-Яа-яЁё_0-9.À-ɏ]/;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('//', i) || src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const p = i;
    if (ch === '"') { let s = ''; i++; for (;;) { if (i >= src.length) err('Строка не закрыта: не хватает кавычки «"».', p); if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; } s += src[i++]; } out.push({ k: 'str', v: s, p }); continue; }
    if (ch === "'") { let s = ''; i++; for (;;) { if (i >= src.length) err('Имя таблицы не закрыто: не хватает апострофа «\'».', p); if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += src[i++]; } out.push({ k: 'qtbl', v: s, p }); continue; }
    if (ch === '[') { const e = src.indexOf(']', i); if (e < 0) err('Не хватает закрывающей скобки «]».', p); out.push({ k: 'col', v: src.slice(i + 1, e).trim(), p }); i = e + 1; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = ''; while (i < src.length && /[0-9]/.test(src[i])) s += src[i++];
      const dec = sep === ';' ? /[.,]/ : /\./;
      if (i < src.length && dec.test(src[i]) && /[0-9]/.test(src[i + 1] || '')) { i++; s += '.'; while (i < src.length && /[0-9]/.test(src[i])) s += src[i++]; }
      if (/[eE]/.test(src[i] || '') && /[-+0-9]/.test(src[i + 1] || '')) { s += 'e'; i++; if (/[-+]/.test(src[i])) s += src[i++]; while (i < src.length && /[0-9]/.test(src[i])) s += src[i++]; }
      out.push({ k: 'num', v: s, n: Number(s), p }); continue;
    }
    if (L.test(ch)) { let s = ''; while (i < src.length && W.test(src[i])) s += src[i++]; out.push({ k: 'id', v: s, p }); continue; }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '<=', '>=', '<>', '=='].includes(two)) { out.push({ k: 'op', v: two, p }); i += 2; continue; }
    if ('=<>+-*/^&(){}'.includes(ch)) { out.push({ k: 'op', v: ch, p }); i++; continue; }
    if (ch === ',' || ch === ';') {
      if (ch !== sep) err(sep === ';' ? 'В этой формуле аргументы разделяются точкой с запятой «;». Запятая здесь лишняя.' : 'Неожиданный символ «;».', p);
      out.push({ k: 'sep', v: ch, p }); i++; continue;
    }
    err(`Неожиданный символ «${ch}».`, p);
  }
  out.push({ k: 'eof', v: '', p: src.length });
  return out;
}

const KW = new Set(['VAR', 'RETURN', 'IN', 'NOT']);
export function parse(src: string): any {
  const toks = tokenize(src); let i = 0;
  const peek = (o = 0) => toks[i + o], next = () => toks[i++];
  const isOp = (v: string) => peek().k === 'op' && peek().v === v;
  const isId = (v: string) => peek().k === 'id' && peek().v.toUpperCase() === v;
  const show = (t: Tok) => t.k === 'eof' ? 'конец формулы' : t.k === 'str' ? `"${t.v}"` : t.k === 'col' ? `[${t.v}]` : t.k === 'qtbl' ? `'${t.v}'` : t.v;
  const expect = (v: string) => { if (!isOp(v)) err(`Неверный синтаксис рядом с «${show(peek())}»: ожидалось «${v}».`, peek().p); return next(); };

  function expr(): any {
    if (isId('VAR')) {
      const vars: [string, any][] = [];
      while (isId('VAR')) { next(); const n = next(); if (n.k !== 'id') err('После VAR нужно имя переменной.', n.p); expect('='); vars.push([n.v, expr()]); }
      if (!isId('RETURN')) err(`Неверный синтаксис рядом с «${show(peek())}»: после переменных нужно RETURN.`, peek().p);
      next();
      return { t: 'let', vars, body: expr(), p: vars.length ? 0 : 0 };
    }
    return or();
  }
  function or(): any { let a = and(); while (isOp('||')) { const p = next().p; a = { t: 'bin', op: '||', a, b: and(), p }; } return a; }
  function and(): any { let a = not(); while (isOp('&&')) { const p = next().p; a = { t: 'bin', op: '&&', a, b: not(), p }; } return a; }
  function not(): any { if (isId('NOT') && !(peek(1).k === 'op' && peek(1).v === '(')) { const p = next().p; return { t: 'un', op: 'NOT', a: not(), p }; } return cmp(); }
  function cmp(): any {
    let a = cat();
    for (;;) {
      if (peek().k === 'op' && ['=', '==', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const t = next(); a = { t: 'bin', op: t.v, a, b: cat(), p: t.p }; }
      else if (isId('IN')) { const p = next().p; a = { t: 'in', a, b: cat(), p }; }
      else if (isId('NOT') && peek(1).k === 'id' && peek(1).v.toUpperCase() === 'IN') { const p = next().p; next(); a = { t: 'un', op: 'NOT', a: { t: 'in', a, b: cat(), p }, p }; }
      else return a;
    }
  }
  function cat(): any { let a = add(); while (isOp('&')) { const p = next().p; a = { t: 'bin', op: '&', a, b: add(), p }; } return a; }
  function add(): any { let a = mul(); while (isOp('+') || isOp('-')) { const t = next(); a = { t: 'bin', op: t.v, a, b: mul(), p: t.p }; } return a; }
  function mul(): any { let a = pow(); while (isOp('*') || isOp('/')) { const t = next(); a = { t: 'bin', op: t.v, a, b: pow(), p: t.p }; } return a; }
  function pow(): any { let a = un(); while (isOp('^')) { const p = next().p; a = { t: 'bin', op: '^', a, b: un(), p }; } return a; }
  function un(): any { if (isOp('-') || isOp('+')) { const t = next(); const a = un(); return t.v === '-' ? { t: 'un', op: '-', a, p: t.p } : a; } return prim(); }
  function args(): any[] {
    expect('('); const a: any[] = [];
    if (isOp(')')) { next(); return a; }
    for (;;) {
      if (peek().k === 'sep') { a.push({ t: 'empty', p: peek().p }); next(); continue; }
      a.push(expr());
      if (peek().k === 'sep') { next(); if (isOp(')')) { a.push({ t: 'empty', p: peek().p }); } continue; }
      if (isOp(')')) { next(); return a; }
      if (peek().k === 'eof') err('Не хватает закрывающей скобки «)».', peek().p);
      err(`Неверный синтаксис рядом с «${show(peek())}». Проверьте скобки и разделители аргументов.`, peek().p);
    }
  }
  function prim(): any {
    const t = peek();
    if (t.k === 'num') { next(); return { t: 'num', v: t.n, p: t.p }; }
    if (t.k === 'str') { next(); return { t: 'str', v: t.v, p: t.p }; }
    if (t.k === 'col') { next(); return { t: 'col', col: t.v, p: t.p }; }
    if (t.k === 'qtbl') { next(); if (peek().k === 'col') { const c = next(); return { t: 'col', table: t.v, col: c.v, p: t.p }; } return { t: 'tbl', name: t.v, p: t.p }; }
    if (t.k === 'id') {
      if (KW.has(t.v.toUpperCase()) && t.v.toUpperCase() !== 'NOT') err(`Неверный синтаксис рядом с «${t.v}».`, t.p);
      next();
      if (peek().k === 'col') { const c = next(); return { t: 'col', table: t.v, col: c.v, p: t.p }; }
      if (isOp('(')) return { t: 'call', name: t.v.toUpperCase(), args: args(), p: t.p };
      return { t: 'tbl', name: t.v, p: t.p };
    }
    if (isOp('(')) { next(); const e = expr(); expect(')'); return e; }
    if (isOp('{')) {
      const p = next().p; const rows: any[][] = [];
      if (isOp('}')) { next(); return { t: 'list', rows, p }; }
      for (;;) {
        if (isOp('(')) {
          const save = i; next(); const first = expr();
          if (peek().k === 'sep') { const tup = [first]; while (peek().k === 'sep') { next(); tup.push(expr()); } expect(')'); rows.push(tup); }
          else { i = save; rows.push([expr()]); }
        } else rows.push([expr()]);
        if (peek().k === 'sep') { next(); continue; }
        expect('}'); return { t: 'list', rows, p };
      }
    }
    if (t.k === 'eof') err('Формула оборвалась: не хватает аргумента или закрывающей скобки.', t.p);
    return err(`Неверный синтаксис рядом с «${show(t)}».`, t.p);
  }
  const e = expr();
  if (peek().k !== 'eof') err(`Неверный синтаксис рядом с «${show(peek())}». Возможно, лишняя скобка или пропущен оператор.`, peek().p);
  return e;
}

export function parseMeasure(text: string): { name: string; node: any; body: string; offset: number } {
  const m = /^\s*\[?([^=\[\]()"';,{}]+?)\]?\s*=(?!=)/.exec(text);
  if (!m) err('Формула меры начинается с имени и знака «=», например: Выручка = SUM(\'Продажи\'[Сумма])', 0);
  const name = m[1].trim();
  if (!name) err('Укажите имя меры перед знаком «=».', 0);
  const body = text.slice(m[0].length);
  if (!body.trim()) err('После знака «=» напишите формулу меры.', m[0].length);
  try { return { name, node: parse(body), body, offset: m[0].length }; }
  catch (e) { if (e instanceof DaxError && e.pos !== undefined) e.pos += m[0].length; throw e; }
}

/* ───────────── вычисление ───────────── */
export interface TCol { table?: string; col: string }
export interface TableVal { kind: 'table'; cols: TCol[]; rows: Val[][]; base?: string; ids?: number[] }
interface Frame { tv: TableVal; i: number }
export interface Ctx { m: Model; filters: Filter[]; shadow: Filter[]; frames: Frame[]; vars: Map<string, any>; scope: Set<string>; stack: string[]; budget: { n: number } }

export function makeCtx(m: Model, filters: Filter[] = [], shadow: Filter[] = filters, scope: Set<string> = new Set()): Ctx {
  return { m, filters, shadow, frames: [], vars: new Map(), scope, stack: [], budget: { n: 0 } };
}
const isTable = (v: any): v is TableVal => v && typeof v === 'object' && v.kind === 'table';
const tick = (ctx: Ctx, n = 1) => { ctx.budget.n += n; if (ctx.budget.n > 4e7) err('Формула считается слишком долго. Возможно, итератор перебирает лишние строки.'); };

function baseTableVal(t: BaseTable, ids: number[]): TableVal {
  return { kind: 'table', cols: t.cols.map(c => ({ table: t.name, col: c.name })), rows: ids.map(i => t.rows[i]), base: t.name, ids };
}
function distinctVal(cols: TCol[], rows: Val[][]): TableVal {
  const seen = new Set<string>(); const out: Val[][] = [];
  for (const r of rows) { const k = tk(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return { kind: 'table', cols, rows: out };
}
function colsOf(m: Model, t: BaseTable, names: string[]) { return names.map(c => ({ table: t.name, col: t.cols[colIx(t, c)].name })); }
function project(m: Model, t: BaseTable, ids: number[], names: string[]): TableVal {
  const ix = names.map(c => colIx(t, c));
  return distinctVal(colsOf(m, t, names), ids.map(i => ix.map(k => t.rows[i][k])));
}

function measureByName(ctx: Ctx, name: string) { return ctx.m.measures.get(low(name)); }
function resolveColNode(ctx: Ctx, n: any): { t: BaseTable; c: number } {
  if (n.t !== 'col') err('Здесь нужна ссылка на столбец, например \'Продажи\'[Сумма].', n.p);
  if (n.table) { const t = tbl(ctx.m, n.table, n.p); return { t, c: colIx(t, n.col, n.p) }; }
  const hits = ctx.m.tables.filter(t => t.ci.has(low(n.col)));
  if (hits.length === 1) return { t: hits[0], c: hits[0].ci.get(low(n.col)) };
  if (!hits.length) err(measureByName(ctx, n.col) ? `[${n.col}] — это мера, а здесь нужна ссылка на столбец.` : `Столбец [${n.col}] не найден в модели.`, n.p);
  return err(`Столбец [${n.col}] есть в нескольких таблицах. Укажите таблицу: '${hits[0].name}'[${n.col}].`, n.p);
}
const qname = (t: string, c: string) => `'${t}'[${c}]`;

function tableToFilters(ctx: Ctx, tv: TableVal): Filter[] {
  if (tv.base && tv.ids) return [{ table: tv.base, cols: ['__row'], keys: new Set(), rows: new Set(tv.ids) }];
  const groups = new Map<string, number[]>();
  tv.cols.forEach((c, i) => { if (c.table) { const g = groups.get(c.table); if (g) g.push(i); else groups.set(c.table, [i]); } });
  if (!groups.size) err('Таблицу без столбцов модели нельзя использовать как фильтр.');
  const out: Filter[] = [];
  for (const [table, ix] of groups) out.push({ table, cols: ix.map(i => tv.cols[i].col), keys: new Set(tv.rows.map(r => tk(ix.map(i => r[i])))) });
  return out;
}
function rowFilters(fr: Frame): Filter[] {
  const { tv, i } = fr;
  if (tv.base && tv.ids) return [{ table: tv.base, cols: ['__row'], keys: new Set(), rows: new Set([tv.ids[i]]) }];
  return tableToFiltersPlain(tv, [tv.rows[i]]);
}
function tableToFiltersPlain(tv: TableVal, rows: Val[][]): Filter[] {
  const groups = new Map<string, number[]>();
  tv.cols.forEach((c, k) => { if (c.table) { const g = groups.get(c.table); if (g) g.push(k); else groups.set(c.table, [k]); } });
  return [...groups].map(([table, ix]) => ({ table, cols: ix.map(k => tv.cols[k].col), keys: new Set(rows.map(r => tk(ix.map(k => r[k])))) }));
}
function overrides(m: Model, nf: Filter, f: Filter) {
  if (nf.rows) return f.table === nf.table || m.rels.some(r => r.from === nf.table && r.to === f.table);
  if (f.rows) return false;
  return f.table === nf.table && f.cols.some(c => nf.cols.some(d => low(c) === low(d)));
}
export function applyFilter(m: Model, filters: Filter[], nf: Filter, keep = false): Filter[] {
  let out = keep ? filters : filters.filter(f => !overrides(m, nf, f));
  if (!keep && m.date && low(nf.table) === low(m.date.table) && !nf.rows && nf.cols.some(c => low(c) === low(m.date.col))) out = out.filter(f => low(f.table) !== low(m.date.table));
  return [...out, nf];
}
function transition(ctx: Ctx): Filter[] {
  let f = ctx.filters;
  for (const fr of ctx.frames) for (const nf of rowFilters(fr)) f = applyFilter(ctx.m, f, nf);
  return f;
}
function dimsOf(m: Model, t: string) { return m.rels.filter(r => r.from === t).map(r => r.to); }
function removeTable(m: Model, filters: Filter[], t: string) { const ds = dimsOf(m, t); return filters.filter(f => f.table !== t && !ds.includes(f.table)); }
function removeCols(filters: Filter[], t: string, cols: string[]) { return filters.filter(f => !(f.table === t && !f.rows && f.cols.some(c => cols.some(d => low(c) === low(d))))); }

function modifier(n: any, ctx: Ctx, filters: Filter[]): Filter[] {
  const m = ctx.m, name = n.name, a = n.args.filter(x => x.t !== 'empty');
  if (name === 'ALL' || name === 'REMOVEFILTERS' || name === 'ALLNOBLANKROW' || name === 'ALLSELECTED') {
    const sel = name === 'ALLSELECTED';
    if (!a.length) return sel ? [...ctx.shadow] : [];
    let out = filters; const back: Filter[] = [];
    for (const x of a) {
      if (x.t === 'tbl') { const t = tbl(m, x.name, x.p); out = removeTable(m, out, t.name); if (sel) back.push(...ctx.shadow.filter(f => f.table === t.name || dimsOf(m, t.name).includes(f.table))); }
      else if (x.t === 'col') { const { t, c } = resolveColNode(ctx, x); const cn = t.cols[c].name; out = removeCols(out, t.name, [cn]); if (sel) back.push(...ctx.shadow.filter(f => f.table === t.name && !f.rows && f.cols.some(k => low(k) === low(cn)))); }
      else err(`Аргументом ${name} может быть таблица или столбец.`, x.p);
    }
    for (const f of back) if (!out.includes(f)) out = [...out, f];
    return out;
  }
  if (name === 'ALLEXCEPT') {
    if (!a.length || a[0].t !== 'tbl') err('Первый аргумент ALLEXCEPT — таблица, например ALLEXCEPT(\'Продажи\'; \'Клиенты\'[Город]).', n.p);
    const t = tbl(m, a[0].name, a[0].p);
    const keep = a.slice(1).map(x => { const r = resolveColNode(ctx, x); return { t: r.t.name, c: r.t.cols[r.c].name }; });
    const scope = [t.name, ...dimsOf(m, t.name)];
    return filters.filter(f => !scope.includes(f.table) || (!f.rows && f.cols.every(c => keep.some(k => k.t === f.table && low(k.c) === low(c)))));
  }
  return err(`Функция ${name} не может быть модификатором CALCULATE.`, n.p);
}
const MODS = new Set(['ALL', 'REMOVEFILTERS', 'ALLEXCEPT', 'ALLSELECTED', 'ALLNOBLANKROW']);

function walkCols(n: any, out: any[]) {
  if (!n || typeof n !== 'object') return;
  if (n.t === 'col') out.push(n);
  for (const k of ['a', 'b', 'body']) if (n[k]) walkCols(n[k], out);
  if (n.args) n.args.forEach(x => walkCols(x, out));
  if (n.rows) n.rows.forEach(r => r.forEach(x => walkCols(x, out)));
  if (n.vars) n.vars.forEach(([, x]) => walkCols(x, out));
}
function filterArg(n: any, ctx: Ctx): Filter[] {
  if (returnsTable(n, ctx)) return tableToFilters(ctx, evalTable(n, ctx));
  const refs: any[] = []; walkCols(n, refs);
  const cols: { t: BaseTable; c: number }[] = [];
  for (const r of refs) {
    if (!r.table && measureByName(ctx, r.col) && !ctx.m.tables.some(t => t.ci.has(low(r.col)))) err(`Логическое выражение в фильтре CALCULATE не может ссылаться на меру [${r.col}]. Оберните условие в FILTER, например FILTER(VALUES('Продажи'[Номер заказа]); [${r.col}] > 0).`, r.p);
    const x = resolveColNode(ctx, r); if (!cols.some(y => y.t === x.t && y.c === x.c)) cols.push(x);
  }
  if (!cols.length) err('Условие фильтра в CALCULATE должно ссылаться на столбец, например \'Продажи\'[Статус] = "Доставлен".', n.p);
  const t = cols[0].t;
  if (cols.some(x => x.t !== t)) err('В одном логическом условии фильтра можно использовать столбцы только одной таблицы. Разделите условие на несколько аргументов CALCULATE.', n.p);
  const tv = project(ctx.m, t, t.rows.map((_, i) => i), cols.map(x => t.cols[x.c].name));
  const keep = tv.rows.filter((_, i) => truthy(scalar(n, push(ctx, tv, i))));
  return [{ table: t.name, cols: tv.cols.map(c => c.col), keys: new Set(keep.map(r => tk(r))) }];
}
function calcCtx(args: any[], ctx: Ctx): Ctx {
  const ops: any[] = [];
  for (const a of args) {
    if (a.t === 'empty') continue;
    if (a.t === 'call' && MODS.has(a.name)) ops.push({ mod: a });
    else if (a.t === 'call' && a.name === 'KEEPFILTERS') ops.push({ fs: filterArg(a.args[0], ctx), keep: true });
    else if (a.t === 'call' && (a.name === 'USERELATIONSHIP' || a.name === 'CROSSFILTER')) err(`${a.name} в тренажёре пока не поддерживается: в модели нет неактивных связей.`, a.p);
    else ops.push({ fs: filterArg(a, ctx), keep: false });
  }
  let filters = transition(ctx);
  for (const o of ops) if (o.mod) filters = modifier(o.mod, ctx, filters);
  for (const o of ops) if (o.fs) for (const f of o.fs) filters = applyFilter(ctx.m, filters, f, o.keep);
  return { ...ctx, filters, frames: [] };
}
function push(ctx: Ctx, tv: TableVal, i: number): Ctx { return { ...ctx, frames: [...ctx.frames, { tv, i }] }; }

export function evalMeasure(ms: Measure, ctx: Ctx): Val {
  if (ctx.stack.includes(ms.name)) err(`Обнаружена циклическая зависимость: мера [${ms.name}] ссылается сама на себя.`);
  if (ctx.stack.length > 30) err('Слишком глубокая вложенность мер.');
  const c2: Ctx = { ...ctx, filters: transition(ctx), frames: [], vars: new Map(), stack: [...ctx.stack, ms.name] };
  try { return scalar(ms.node, c2); }
  catch (e) { if (e instanceof DaxError && ctx.stack.length === 0 && !e.message.includes('мер')) { /* ошибка во вложенной мере */ } throw e; }
}

const truthy = (v: Val) => v === null ? false : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v !== '' ? err(`Невозможно преобразовать значение "${v}" типа Text в тип True/False.`) : false;
const num = (v: Val, p?: number): number => v === null ? 0 : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : (/^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : err(`Невозможно преобразовать значение "${v}" типа Text в тип Number.`, p));
const str = (v: Val) => v === null ? '' : typeof v === 'boolean' ? (v ? 'True' : 'False') : typeof v === 'number' ? String(v).replace('.', ',') : v;
const coll = new Intl.Collator('ru', { sensitivity: 'base' });
function cmp(a: Val, b: Val, p?: number): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'string' ? '' : 0;
  if (b === null) b = typeof a === 'string' ? '' : 0;
  if (typeof a === 'boolean') a = a ? 1 : 0; if (typeof b === 'boolean') b = b ? 1 : 0;
  if (typeof a !== typeof b) err(`Операции сравнения DAX не поддерживают сравнение значений типа ${typeof a === 'string' ? 'Text' : 'Number'} со значениями типа ${typeof b === 'string' ? 'Text' : 'Number'}. Попробуйте использовать функцию VALUE или FORMAT для преобразования одного из значений.`, p);
  if (typeof a === 'string') return coll.compare(a, b as string);
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

function returnsTable(n: any, ctx: Ctx): boolean {
  if (n.t === 'list') return true;
  if (n.t === 'tbl') { const v = ctx.vars.get(low(n.name)); if (v !== undefined) return isTable(v); return !SCALAR_WORDS.has(n.name.toUpperCase()); }
  if (n.t === 'call') return TABLE_FN.has(n.name);
  if (n.t === 'let') return returnsTable(n.body, ctx);
  return false;
}
const SCALAR_WORDS = new Set(['TRUE', 'FALSE', 'BLANK']);

export function scalar(n: any, ctx: Ctx): Val {
  switch (n.t) {
    case 'num': case 'str': return n.v;
    case 'empty': return null;
    case 'col': return colValue(n, ctx);
    case 'tbl': {
      const v = ctx.vars.get(low(n.name));
      if (v !== undefined) return isTable(v) ? toScalar(v, n.p) : v;
      const w = n.name.toUpperCase(); if (w === 'TRUE') return true; if (w === 'FALSE') return false; if (w === 'BLANK') return null;
      if (!ctx.m.byName.has(low(n.name))) err(`Не удалось распознать «${n.name}»: это не таблица, не переменная и не функция. Если это имя столбца или меры, возьмите его в квадратные скобки: [${n.name}].`, n.p);
      return toScalar(evalTable(n, ctx), n.p);
    }
    case 'list': return toScalar(evalTable(n, ctx), n.p);
    case 'let': return scalar(n.body, bindVars(n, ctx));
    case 'un': { const a = scalar(n.a, ctx); if (n.op === 'NOT') return !truthy(a); return a === null ? null : -num(a, n.p); }
    case 'in': {
      const a = scalar(n.a, ctx); const tv = evalTable(n.b, ctx);
      return tv.rows.some(r => { try { return cmp(a, r[0], n.p) === 0; } catch { return false; } });
    }
    case 'bin': return binop(n, ctx);
    case 'call': {
      if (TABLE_FN.has(n.name)) return toScalar(evalTable(n, ctx), n.p);
      const f = FN[n.name];
      if (!f) err(`Функция «${n.name}» не найдена или пока не поддерживается в тренажёре.`, n.p);
      tick(ctx);
      return f(n.args, ctx, n);
    }
  }
  return err('Не удалось вычислить выражение.', n.p);
}
function bindVars(n: any, ctx: Ctx): Ctx {
  const vars = new Map(ctx.vars); const c: Ctx = { ...ctx, vars };
  for (const [name, e] of n.vars) {
    if (ctx.m.byName.has(low(name))) err(`Имя переменной «${name}» совпадает с именем таблицы. Выберите другое имя.`, e.p);
    vars.set(low(name), returnsTable(e, c) ? evalTable(e, c) : scalar(e, c));
  }
  return c;
}
function toScalar(tv: TableVal, p?: number): Val {
  if (!tv.rows.length) return null;
  if (tv.rows.length === 1 && tv.cols.length === 1) return tv.rows[0][0];
  return err('Была предоставлена таблица из нескольких значений, когда ожидалось одно значение.', p);
}
function binop(n: any, ctx: Ctx): Val {
  const op = n.op;
  if (op === '&&') return truthy(scalar(n.a, ctx)) && truthy(scalar(n.b, ctx));
  if (op === '||') return truthy(scalar(n.a, ctx)) || truthy(scalar(n.b, ctx));
  const a = scalar(n.a, ctx), b = scalar(n.b, ctx);
  switch (op) {
    case '&': return str(a) + str(b);
    case '+': return a === null && b === null ? null : num(a, n.p) + num(b, n.p);
    case '-': return a === null && b === null ? null : num(a, n.p) - num(b, n.p);
    case '*': return a === null || b === null ? null : num(a, n.p) * num(b, n.p);
    case '/': { if (a === null) return null; const x = num(a, n.p), y = num(b, n.p); return y === 0 ? (x === 0 ? NaN : x > 0 ? Infinity : -Infinity) : x / y; }
    case '^': return Math.pow(num(a, n.p), num(b, n.p));
    case '=': return cmp(a, b, n.p) === 0;
    case '==': return a === null || b === null ? a === b : cmp(a, b, n.p) === 0;
    case '<>': return cmp(a, b, n.p) !== 0;
    case '<': return cmp(a, b, n.p) < 0;
    case '>': return cmp(a, b, n.p) > 0;
    case '<=': return cmp(a, b, n.p) <= 0;
    case '>=': return cmp(a, b, n.p) >= 0;
  }
  return err('Неизвестный оператор ' + op, n.p);
}

function colValue(n: any, ctx: Ctx): Val {
  if (!n.table) { const ms = measureByName(ctx, n.col); if (ms) return evalMeasure(ms, ctx); }
  else if (!ctx.m.byName.get(low(n.table))?.ci.has(low(n.col))) { const ms = measureByName(ctx, n.col); if (ms && ctx.m.byName.has(low(n.table))) return evalMeasure(ms, ctx); }
  for (let k = ctx.frames.length - 1; k >= 0; k--) {
    const { tv, i } = ctx.frames[k];
    const j = tv.cols.findIndex(c => low(c.col) === low(n.col) && (!n.table || (c.table ? low(c.table) === low(n.table) : false)));
    if (j >= 0) return tv.rows[i][j];
  }
  const { t, c } = resolveColNode(ctx, n);
  const cn = t.cols[c].name;
  const fact = ctx.frames.find(f => f.tv.base && ctx.m.rels.some(r => r.from === f.tv.base && r.to === t.name));
  if (fact) err(`Столбец ${qname(t.name, cn)} нельзя взять напрямую в контексте строки таблицы «${fact.tv.base}». Чтобы получить значение из связанной таблицы, используйте RELATED(${qname(t.name, cn)}).`, n.p);
  if (ctx.frames.length) err(`Столбец ${qname(t.name, cn)} недоступен в текущем контексте строки.`, n.p);
  if (!ctx.m.measures.has(low(n.col)) && !n.table) {}
  return err(`Невозможно определить одно значение для столбца «${cn}» в таблице «${t.name}». Это может произойти, если формула меры ссылается на столбец, содержащий много значений, без указания такой статистической функции, как MIN, MAX, COUNT или SUM, для получения единственного результата.`, n.p);
}

/* ───────────── табличные выражения ───────────── */
const TABLE_FN = new Set(['FILTER', 'ALL', 'ALLNOBLANKROW', 'VALUES', 'DISTINCT', 'ALLSELECTED', 'ALLEXCEPT', 'CALCULATETABLE', 'RELATEDTABLE', 'TOPN',
  'DATESYTD', 'DATESMTD', 'DATESQTD', 'DATEADD', 'SAMEPERIODLASTYEAR', 'PREVIOUSMONTH', 'PREVIOUSQUARTER', 'PREVIOUSYEAR', 'PREVIOUSDAY', 'NEXTMONTH', 'NEXTQUARTER', 'NEXTYEAR', 'NEXTDAY', 'DATESBETWEEN', 'FIRSTDATE', 'LASTDATE', 'REMOVEFILTERS', 'KEEPFILTERS']);

export function evalTable(n: any, ctx: Ctx): TableVal {
  tick(ctx);
  if (n.t === 'tbl') {
    const v = ctx.vars.get(low(n.name));
    if (v !== undefined) { if (!isTable(v)) err(`Переменная ${n.name} содержит значение, а здесь нужна таблица.`, n.p); return v; }
    const t = tbl(ctx.m, n.name, n.p); return baseTableVal(t, visible(ctx.m, t, ctx.filters));
  }
  if (n.t === 'list') {
    const rows = n.rows.map(r => r.map(x => scalar(x, ctx)));
    const w = Math.max(1, ...rows.map(r => r.length));
    return { kind: 'table', cols: Array.from({ length: w }, (_, k) => ({ col: w === 1 ? 'Value' : 'Value' + (k + 1) })), rows };
  }
  if (n.t === 'let') return evalTable(n.body, bindVars(n, ctx));
  if (n.t === 'col') { const { t, c } = resolveColNode(ctx, n); err(`Здесь нужна таблица, а передан столбец ${qname(t.name, t.cols[c].name)}. Возможно, нужен VALUES(${qname(t.name, t.cols[c].name)}).`, n.p); }
  if (n.t !== 'call') err('Здесь нужно табличное выражение.', n.p);
  const a = n.args.filter(x => x.t !== 'empty');
  const need = (k: number, sig: string) => { if (a.length < k) err(`Не хватает аргументов: ${sig}.`, n.p); };
  switch (n.name) {
    case 'FILTER': {
      need(2, 'FILTER(таблица; условие)');
      const tv = evalTable(a[0], ctx);
      const keep: number[] = [];
      for (let i = 0; i < tv.rows.length; i++) { tick(ctx); if (truthy(scalar(a[1], push(ctx, tv, i)))) keep.push(i); }
      return { ...tv, rows: keep.map(i => tv.rows[i]), ids: tv.ids ? keep.map(i => tv.ids[i]) : undefined };
    }
    case 'ALL': case 'ALLNOBLANKROW': {
      need(1, 'ALL(таблица или столбец)');
      if (a[0].t === 'tbl') { const t = tbl(ctx.m, a[0].name, a[0].p); return baseTableVal(t, t.rows.map((_, i) => i)); }
      const cs = a.map(x => resolveColNode(ctx, x)); const t = cs[0].t;
      if (cs.some(x => x.t !== t)) err('Все столбцы в ALL должны быть из одной таблицы.', n.p);
      return project(ctx.m, t, t.rows.map((_, i) => i), cs.map(x => t.cols[x.c].name));
    }
    case 'REMOVEFILTERS': return err('REMOVEFILTERS можно использовать только как аргумент CALCULATE.', n.p);
    case 'KEEPFILTERS': return err('KEEPFILTERS можно использовать только как аргумент CALCULATE.', n.p);
    case 'ALLSELECTED': {
      const c2 = { ...ctx, filters: modifier(n, ctx, ctx.filters) };
      if (!a.length) err('Укажите таблицу или столбец для ALLSELECTED.', n.p);
      return evalTable({ t: 'call', name: 'VALUES', args: [a[0]], p: n.p }, c2);
    }
    case 'ALLEXCEPT': { const c2 = { ...ctx, filters: modifier(n, ctx, ctx.filters) }; return evalTable(a[0], c2); }
    case 'VALUES': case 'DISTINCT': {
      need(1, n.name + '(столбец)');
      if (a[0].t === 'tbl' && !ctx.vars.has(low(a[0].name))) { const t = tbl(ctx.m, a[0].name, a[0].p); return baseTableVal(t, visible(ctx.m, t, ctx.filters)); }
      if (a[0].t !== 'col') return distinctVal(evalTable(a[0], ctx).cols, evalTable(a[0], ctx).rows);
      const { t, c } = resolveColNode(ctx, a[0]);
      return project(ctx.m, t, visible(ctx.m, t, ctx.filters), [t.cols[c].name]);
    }
    case 'CALCULATETABLE': { need(1, 'CALCULATETABLE(таблица; фильтры...)'); return evalTable(a[0], calcCtx(a.slice(1), ctx)); }
    case 'RELATEDTABLE': { need(1, 'RELATEDTABLE(таблица)'); return evalTable(a[0], calcCtx([], ctx)); }
    case 'TOPN': {
      need(2, 'TOPN(число; таблица; выражение)');
      const k = num(scalar(a[0], ctx)); const tv = evalTable(a[1], ctx);
      if (!a[2]) return { ...tv, rows: tv.rows.slice(0, k), ids: tv.ids?.slice(0, k) };
      const asc = a[3] && orderWord(a[3], ctx) === 'ASC';
      const vals = tv.rows.map((_, i) => scalar(a[2], push(ctx, tv, i)));
      const ord = vals.map((_, i) => i).sort((x, y) => (asc ? 1 : -1) * cmp(vals[x], vals[y]));
      let cut = Math.min(k, ord.length); while (cut > 0 && cut < ord.length && cmp(vals[ord[cut]], vals[ord[cut - 1]]) === 0) cut++;
      const keep = ord.slice(0, cut).sort((x, y) => x - y);
      return { ...tv, rows: keep.map(i => tv.rows[i]), ids: tv.ids ? keep.map(i => tv.ids[i]) : undefined };
    }
  }
  return timeFn(n, a, ctx);
}
function orderWord(n: any, ctx: Ctx) {
  if (n.t === 'tbl') return n.name.toUpperCase();
  const v = scalar(n, ctx); return v === 1 || v === true ? 'ASC' : 'DESC';
}

/* ───────────── даты ───────────── */
export const ser = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
export const ymd = (s: number) => { const d = new Date((s - 25569) * 864e5); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function allDates(t: BaseTable, c: number): number[] {
  if (!t.dates) t.dates = new Map();
  let d = t.dates.get(c); if (d) return d;
  d = [...new Set(t.rows.map(r => r[c]).filter(v => typeof v === 'number'))].sort((x, y) => x - y) as number[];
  t.dates.set(c, d); return d;
}
function datesIn(ctx: Ctx, n: any): { t: BaseTable; c: number; vals: number[] } {
  if (n.t === 'col') {
    const { t, c } = resolveColNode(ctx, n);
    if (t.cols[c].type !== 'date') err(`Функциям логики времени нужен столбец дат, а ${qname(t.name, t.cols[c].name)} не содержит даты.`, n.p);
    const vals = [...new Set(visible(ctx.m, t, ctx.filters).map(i => t.rows[i][c]).filter(v => typeof v === 'number'))].sort((x, y) => x - y) as number[];
    return { t, c, vals };
  }
  const tv = evalTable(n, ctx); const lc = tv.cols[0];
  if (!lc?.table) err('Функциям логики времени нужен столбец дат, например \'Календарь\'[Дата].', n.p);
  const t = tbl(ctx.m, lc.table); const c = colIx(t, lc.col);
  return { t, c, vals: [...new Set(tv.rows.map(r => r[0]).filter(v => typeof v === 'number'))].sort((x, y) => x - y) as number[] };
}
const dt = (t: BaseTable, c: number, vals: number[]): TableVal => ({ kind: 'table', cols: [{ table: t.name, col: t.cols[c].name }], rows: vals.map(v => [v]) });
function shiftMonths(s: number, k: number) { const [y, m, d] = ymd(s); const mm = m - 1 + k; const ny = y + Math.floor(mm / 12), nm = ((mm % 12) + 12) % 12 + 1; return ser(ny, nm, Math.min(d, dim(ny, nm))); }
function period(t: BaseTable, c: number, from: number, to: number) { return allDates(t, c).filter(d => d >= from && d <= to); }
function timeFn(n: any, a: any[], ctx: Ctx): TableVal {
  const name = n.name;
  if (!a.length) err(`Не хватает аргументов: ${name}('Календарь'[Дата]).`, n.p);
  if (name === 'DATESBETWEEN') {
    const { t, c } = resolveColNode(ctx, a[0]); const all = allDates(t, c);
    const s = a[1] ? scalar(a[1], ctx) : null, e = a[2] ? scalar(a[2], ctx) : null;
    return dt(t, c, period(t, c, s === null ? -Infinity : num(s), e === null ? Infinity : num(e)).filter(d => all.includes(d)));
  }
  const { t, c, vals } = datesIn(ctx, a[0]);
  if (!vals.length) return dt(t, c, []);
  const first = vals[0], last = vals[vals.length - 1];
  const [ly, lm] = ymd(last), [fy, fm] = ymd(first);
  switch (name) {
    case 'DATESYTD': return dt(t, c, period(t, c, ser(ly, 1, 1), last));
    case 'DATESQTD': return dt(t, c, period(t, c, ser(ly, Math.floor((lm - 1) / 3) * 3 + 1, 1), last));
    case 'DATESMTD': return dt(t, c, period(t, c, ser(ly, lm, 1), last));
    case 'FIRSTDATE': return dt(t, c, [first]);
    case 'LASTDATE': return dt(t, c, [last]);
    case 'PREVIOUSDAY': return dt(t, c, period(t, c, first - 1, first - 1));
    case 'NEXTDAY': return dt(t, c, period(t, c, last + 1, last + 1));
    case 'PREVIOUSMONTH': { const s = shiftMonths(ser(fy, fm, 1), -1); const [y, m] = ymd(s); return dt(t, c, period(t, c, s, ser(y, m, dim(y, m)))); }
    case 'NEXTMONTH': { const s = shiftMonths(ser(ly, lm, 1), 1); const [y, m] = ymd(s); return dt(t, c, period(t, c, s, ser(y, m, dim(y, m)))); }
    case 'PREVIOUSQUARTER': { const q = Math.floor((fm - 1) / 3) * 3 + 1; const s = shiftMonths(ser(fy, q, 1), -3); return dt(t, c, period(t, c, s, shiftMonths(s, 3) - 1)); }
    case 'NEXTQUARTER': { const q = Math.floor((lm - 1) / 3) * 3 + 1; const s = shiftMonths(ser(ly, q, 1), 3); return dt(t, c, period(t, c, s, shiftMonths(s, 3) - 1)); }
    case 'PREVIOUSYEAR': return dt(t, c, period(t, c, ser(fy - 1, 1, 1), ser(fy - 1, 12, 31)));
    case 'NEXTYEAR': return dt(t, c, period(t, c, ser(ly + 1, 1, 1), ser(ly + 1, 12, 31)));
    case 'SAMEPERIODLASTYEAR': return shift(t, c, vals, -12, false);
    case 'DATEADD': {
      if (a.length < 3) err("Не хватает аргументов: DATEADD('Календарь'[Дата]; -1; MONTH).", n.p);
      const k = num(scalar(a[1], ctx)); const iv = a[2].t === 'tbl' ? a[2].name.toUpperCase() : '';
      if (iv === 'DAY') return dt(t, c, vals.map(v => v + k).filter(v => allDates(t, c).includes(v)));
      const mult = { MONTH: 1, QUARTER: 3, YEAR: 12 }[iv];
      if (!mult) err('Третий аргумент DATEADD — интервал: DAY, MONTH, QUARTER или YEAR.', a[2].p);
      return shift(t, c, vals, k * mult, true);
    }
  }
  return err(`Функция «${name}» не найдена или пока не поддерживается в тренажёре.`, n.p);
}
function shift(t: BaseTable, c: number, vals: number[], k: number, _dateadd: boolean): TableVal {
  const all = allDates(t, c); const has = new Set(all);
  const months = new Map<number, number>(); for (const v of vals) { const [y, m] = ymd(v); months.set(y * 12 + m - 1, (months.get(y * 12 + m - 1) || 0) + 1); }
  const whole = [...months].every(([ym, cnt]) => cnt === dim(Math.floor(ym / 12), ym % 12 + 1));
  let out: number[];
  if (whole) { out = []; for (const ym of months.keys()) { const n2 = ym + k, y = Math.floor(n2 / 12), m = n2 % 12 + 1; for (let d = 1; d <= dim(y, m); d++) out.push(ser(y, m, d)); } }
  else out = vals.map(v => shiftMonths(v, k));
  return dt(t, c, [...new Set(out)].filter(v => has.has(v)).sort((x, y) => x - y));
}

/* ───────────── скалярные функции ───────────── */
function aggVals(n: any, ctx: Ctx, fname: string): Val[] {
  const a = n.args.filter(x => x.t !== 'empty');
  if (a.length !== 1) err(`Функция ${fname} принимает один аргумент — ссылку на столбец.`, n.p);
  if (a[0].t !== 'col') err(`Функция ${fname} принимает в качестве аргумента только ссылку на столбец. Для выражения используйте ${fname === 'COUNTROWS' ? 'COUNTROWS(таблица)' : fname + 'X(таблица; выражение)'}.`, a[0].p);
  if (!a[0].table && measureByName(ctx, a[0].col) && !ctx.m.tables.some(t => t.ci.has(low(a[0].col)))) err(`Функция ${fname} принимает только ссылку на столбец, а [${a[0].col}] — это мера. Мера уже возвращает одно значение, оборачивать её в ${fname} не нужно.`, a[0].p);
  const { t, c } = resolveColNode(ctx, a[0]);
  return visible(ctx.m, t, ctx.filters).map(i => t.rows[i][c]);
}
function iter(args: any[], ctx: Ctx, fname: string): Val[] {
  const a = args.filter(x => x.t !== 'empty');
  if (a.length < 2) err(`Не хватает аргументов: ${fname}(таблица; выражение).`);
  if (a[0].t === 'col') err(`Первый аргумент ${fname} — таблица, а передан столбец. Например: ${fname}('Продажи'; 'Продажи'[Количество] * 'Продажи'[Цена]).`, a[0].p);
  const tv = evalTable(a[0], ctx); const out: Val[] = [];
  for (let i = 0; i < tv.rows.length; i++) { tick(ctx); out.push(scalar(a[1], push(ctx, tv, i))); }
  return out;
}
const nums = (v: Val[]) => v.filter(x => typeof x === 'number' || typeof x === 'boolean').map(x => num(x));
const sum = (v: Val[]) => { const n = nums(v); return n.length ? n.reduce((s, x) => s + x, 0) : null; };
const avg = (v: Val[]) => { const n = nums(v); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; };
const mn = (v: Val[]) => { const n = nums(v); return n.length ? Math.min(...n) : null; };
const mx = (v: Val[]) => { const n = nums(v); return n.length ? Math.max(...n) : null; };
const cnt = (v: number) => v || null;
const sc = (a: any[], i: number, ctx: Ctx) => a[i] && a[i].t !== 'empty' ? scalar(a[i], ctx) : null;
const roundHalf = (x: number, d: number) => { const f = Math.pow(10, d); return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; };

const FN: Record<string, (a: any[], ctx: Ctx, n: any) => Val> = {
  SUM: (a, ctx, n) => sum(aggVals(n, ctx, 'SUM')),
  AVERAGE: (a, ctx, n) => avg(aggVals(n, ctx, 'AVERAGE')),
  MIN: (a, ctx, n) => a.length === 2 ? (() => { const x = sc(a, 0, ctx), y = sc(a, 1, ctx); return x === null ? y : y === null ? x : cmp(x, y) <= 0 ? x : y; })() : mn(aggVals(n, ctx, 'MIN')),
  MAX: (a, ctx, n) => a.length === 2 ? (() => { const x = sc(a, 0, ctx), y = sc(a, 1, ctx); return x === null ? y : y === null ? x : cmp(x, y) >= 0 ? x : y; })() : mx(aggVals(n, ctx, 'MAX')),
  COUNT: (a, ctx, n) => cnt(aggVals(n, ctx, 'COUNT').filter(v => typeof v === 'number').length),
  COUNTA: (a, ctx, n) => cnt(aggVals(n, ctx, 'COUNTA').filter(v => v !== null && v !== '').length),
  COUNTBLANK: (a, ctx, n) => cnt(aggVals(n, ctx, 'COUNTBLANK').filter(v => v === null || v === '').length),
  DISTINCTCOUNT: (a, ctx, n) => cnt(new Set(aggVals(n, ctx, 'DISTINCTCOUNT').map(vk)).size),
  DISTINCTCOUNTNOBLANK: (a, ctx, n) => cnt(new Set(aggVals(n, ctx, 'DISTINCTCOUNTNOBLANK').filter(v => v !== null).map(vk)).size),
  COUNTROWS: (a, ctx, n) => { const x = a.filter(y => y.t !== 'empty'); if (x.length !== 1) err('COUNTROWS принимает один аргумент — таблицу, например COUNTROWS(\'Продажи\').', n.p); if (x[0].t === 'col') err('COUNTROWS считает строки таблицы, а передан столбец. Напишите COUNTROWS(\'Продажи\') или DISTINCTCOUNT для уникальных значений столбца.', x[0].p); return cnt(evalTable(x[0], ctx).rows.length); },
  SUMX: (a, ctx) => sum(iter(a, ctx, 'SUMX')),
  AVERAGEX: (a, ctx) => avg(iter(a, ctx, 'AVERAGEX')),
  MINX: (a, ctx) => mn(iter(a, ctx, 'MINX')),
  MAXX: (a, ctx) => mx(iter(a, ctx, 'MAXX')),
  COUNTX: (a, ctx) => cnt(iter(a, ctx, 'COUNTX').filter(v => typeof v === 'number').length),
  COUNTAX: (a, ctx) => cnt(iter(a, ctx, 'COUNTAX').filter(v => v !== null && v !== '').length),
  CONCATENATEX: (a, ctx) => { const v = iter(a.slice(0, 2), ctx, 'CONCATENATEX'); const d = a[2] ? str(scalar(a[2], ctx)) : ''; return v.map(str).join(d); },
  CALCULATE: (a, ctx, n) => { if (!a.length || a[0].t === 'empty') err('Не хватает аргументов: CALCULATE(выражение; фильтры...).', n.p); return scalar(a[0], calcCtx(a.slice(1), ctx)); },
  RELATED: (a, ctx, n) => {
    if (a.length !== 1 || a[0].t !== 'col') err("RELATED принимает ссылку на столбец связанной таблицы, например RELATED('Товары'[Себестоимость]).", n.p);
    const { t, c } = resolveColNode(ctx, a[0]);
    for (let k = ctx.frames.length - 1; k >= 0; k--) {
      const { tv, i } = ctx.frames[k];
      if (tv.base === t.name && tv.ids) return t.rows[tv.ids[i]][c];
      const rel = tv.base && ctx.m.rels.find(r => r.from === tv.base && r.to === t.name);
      if (rel && tv.ids) { const j = rel.link[tv.ids[i]]; return j < 0 ? null : t.rows[j][c]; }
    }
    return err(`RELATED(${qname(t.name, t.cols[c].name)}) работает только внутри перебора строк таблицы, связанной с «${t.name}», например в SUMX('Продажи'; ...).`, n.p);
  },
  SELECTEDVALUE: (a, ctx, n) => { const tv = evalTable({ t: 'call', name: 'VALUES', args: [a[0]], p: n.p }, ctx); return tv.rows.length === 1 ? tv.rows[0][0] : sc(a, 1, ctx); },
  HASONEVALUE: (a, ctx, n) => evalTable({ t: 'call', name: 'VALUES', args: [a[0]], p: n.p }, ctx).rows.length === 1,
  ISFILTERED: (a, ctx, n) => {
    if (a[0]?.t === 'tbl') { const t = tbl(ctx.m, a[0].name); return ctx.filters.some(f => f.table === t.name); }
    const { t, c } = resolveColNode(ctx, a[0]); const cn = low(t.cols[c].name);
    return ctx.filters.some(f => f.table === t.name && !f.rows && f.cols.some(x => low(x) === cn));
  },
  ISCROSSFILTERED: (a, ctx, n) => { const { t } = resolveColNode(ctx, a[0]); return visible(ctx.m, t, ctx.filters).length !== t.rows.length; },
  ISINSCOPE: (a, ctx) => { const { t, c } = resolveColNode(ctx, a[0]); return ctx.scope.has(low(t.name + '|' + t.cols[c].name)); },
  ISBLANK: (a, ctx) => sc(a, 0, ctx) === null,
  BLANK: () => null,
  TRUE: () => true, FALSE: () => false,
  IF: (a, ctx, n) => { if (a.length < 2) err('Не хватает аргументов: IF(условие; значение_если_истина; [значение_если_ложь]).', n.p); return truthy(scalar(a[0], ctx)) ? scalar(a[1], ctx) : sc(a, 2, ctx); },
  'IF.EAGER': (a, ctx, n) => FN.IF(a, ctx, n),
  SWITCH: (a, ctx, n) => {
    if (a.length < 3) err('Не хватает аргументов: SWITCH(выражение; значение1; результат1; ...; [иначе]).', n.p);
    const v = scalar(a[0], ctx);
    for (let i = 1; i + 1 < a.length; i += 2) { const w = scalar(a[i], ctx); if (v === true ? truthy(w) : cmp(v, w, a[i].p) === 0) return scalar(a[i + 1], ctx); }
    return a.length % 2 === 0 ? scalar(a[a.length - 1], ctx) : null;
  },
  DIVIDE: (a, ctx, n) => { if (a.length < 2) err('Не хватает аргументов: DIVIDE(числитель; знаменатель; [альтернатива]).', n.p); const x = scalar(a[0], ctx), y = scalar(a[1], ctx); if (y === null || num(y) === 0) return sc(a, 2, ctx); return x === null ? null : num(x) / num(y); },
  AND: (a, ctx, n) => { if (a.length !== 2) err('AND принимает ровно два аргумента. Для нескольких условий используйте оператор &&.', n.p); return truthy(scalar(a[0], ctx)) && truthy(scalar(a[1], ctx)); },
  OR: (a, ctx, n) => { if (a.length !== 2) err('OR принимает ровно два аргумента. Для нескольких условий используйте оператор ||.', n.p); return truthy(scalar(a[0], ctx)) || truthy(scalar(a[1], ctx)); },
  NOT: (a, ctx) => !truthy(scalar(a[0], ctx)),
  ROUND: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : roundHalf(num(v), a[1] ? num(scalar(a[1], ctx)) : 0); },
  ROUNDUP: (a, ctx) => { const v = num(sc(a, 0, ctx)), f = Math.pow(10, a[1] ? num(scalar(a[1], ctx)) : 0); return Math.sign(v) * Math.ceil(Math.abs(v) * f - 1e-9) / f; },
  ROUNDDOWN: (a, ctx) => { const v = num(sc(a, 0, ctx)), f = Math.pow(10, a[1] ? num(scalar(a[1], ctx)) : 0); return Math.sign(v) * Math.floor(Math.abs(v) * f + 1e-9) / f; },
  INT: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : Math.floor(num(v)); },
  ABS: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : Math.abs(num(v)); },
  MOD: (a, ctx) => { const x = num(sc(a, 0, ctx)), y = num(sc(a, 1, ctx)); return x - y * Math.floor(x / y); },
  YEAR: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : ymd(num(v))[0]; },
  MONTH: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : ymd(num(v))[1]; },
  DAY: (a, ctx) => { const v = sc(a, 0, ctx); return v === null ? null : ymd(num(v))[2]; },
  DATE: (a, ctx, n) => { if (a.length !== 3) err('DATE принимает три аргумента: DATE(год; месяц; день).', n.p); return ser(num(scalar(a[0], ctx)), num(scalar(a[1], ctx)), num(scalar(a[2], ctx))); },
  EOMONTH: (a, ctx) => { const [y, m] = ymd(num(sc(a, 0, ctx))); const s = shiftMonths(ser(y, m, 1), num(sc(a, 1, ctx))); const [y2, m2] = ymd(s); return ser(y2, m2, dim(y2, m2)); },
  COALESCE: (a, ctx) => { for (let i = 0; i < a.length; i++) { const v = sc(a, i, ctx); if (v !== null) return v; } return null; },
  CONCATENATE: (a, ctx) => str(sc(a, 0, ctx)) + str(sc(a, 1, ctx)),
  UPPER: (a, ctx) => str(sc(a, 0, ctx)).toUpperCase(),
  LOWER: (a, ctx) => str(sc(a, 0, ctx)).toLowerCase(),
  LEN: (a, ctx) => str(sc(a, 0, ctx)).length,
  VALUE: (a, ctx) => num(sc(a, 0, ctx)),
  RANKX: (a, ctx, n) => {
    if (a.length < 2) err('Не хватает аргументов: RANKX(таблица; выражение; [значение]; [порядок]; [связи]).', n.p);
    if (a[0].t === 'col') err('Первый аргумент RANKX — таблица. Например: RANKX(ALL(\'Клиенты\'[Город]); [Выручка]).', a[0].p);
    const tv = evalTable(a[0], ctx);
    const vals = tv.rows.map((_, i) => { tick(ctx); return scalar(a[1], push(ctx, tv, i)); }).map(v => v === null ? 0 : num(v));
    const v0 = a[2] && a[2].t !== 'empty' ? scalar(a[2], ctx) : scalar(a[1], ctx);
    const v = v0 === null ? 0 : num(v0);
    const asc = a[3] && a[3].t !== 'empty' && orderWord(a[3], ctx) === 'ASC';
    const dense = a[4] && a[4].t === 'tbl' && a[4].name.toUpperCase() === 'DENSE';
    const better = (x: number) => asc ? x < v - 1e-9 : x > v + 1e-9;
    return dense ? new Set(vals.filter(better)).size + 1 : vals.filter(better).length + 1;
  },
  TOTALYTD: (a, ctx, n) => FN.CALCULATE([a[0], { t: 'call', name: 'DATESYTD', args: [a[1]], p: n.p }, ...a.slice(2)], ctx, n),
  TOTALQTD: (a, ctx, n) => FN.CALCULATE([a[0], { t: 'call', name: 'DATESQTD', args: [a[1]], p: n.p }, ...a.slice(2)], ctx, n),
  TOTALMTD: (a, ctx, n) => FN.CALCULATE([a[0], { t: 'call', name: 'DATESMTD', args: [a[1]], p: n.p }, ...a.slice(2)], ctx, n),
};
export const FUNCTIONS = [...Object.keys(FN), ...TABLE_FN].filter(f => !['IF.EAGER'].includes(f)).sort();

/* ───────────── визуальные элементы ───────────── */
export interface Field { table: string; col: string }
export function colFilter(m: Model, f: Field, values: Val[]): Filter {
  const t = tbl(m, f.table); return { table: t.name, cols: [t.cols[colIx(t, f.col)].name], keys: new Set(values.map(vk)) };
}
export function distinctSorted(m: Model, f: Field): Val[] {
  const t = tbl(m, f.table); const c = colIx(t, f.col); const def = t.cols[c];
  const sc2 = def.sortBy ? colIx(t, def.sortBy) : c;
  const seen = new Map<string, [Val, Val]>(); for (const r of t.rows) { const k = vk(r[c]); if (!seen.has(k)) seen.set(k, [r[c], r[sc2]]); }
  return [...seen.values()].sort((x, y) => cmp(x[1], y[1])).map(x => x[0]);
}
export function evalIn(m: Model, measure: string | Measure, filters: Filter[], shadow: Filter[] = filters, scope: Set<string> = new Set()): Val {
  const ms = typeof measure === 'string' ? m.measures.get(low(measure)) : measure;
  if (!ms) err(`Мера [${measure}] не найдена.`);
  return evalMeasure(ms, makeCtx(m, filters, shadow, scope));
}
export interface MatrixRow { label: Val; values: Val[] }
export function matrix(m: Model, rows: Field | null, measures: (string | Measure)[], slicers: Filter[]): { rows: MatrixRow[]; total: Val[] } {
  const total = measures.map(ms => evalIn(m, ms, slicers, slicers));
  if (!rows) return { rows: [], total };
  const scope = new Set([low(tbl(m, rows.table).name + '|' + rows.col)]);
  const out: MatrixRow[] = [];
  for (const v of distinctSorted(m, rows)) {
    const fs = applyFilter(m, slicers, colFilter(m, rows, [v]));
    const values = measures.map(ms => evalIn(m, ms, fs, slicers, scope));
    if (!measures.length || values.some(x => x !== null)) out.push({ label: v, values });
  }
  return { rows: out, total };
}

/* ───────────── формат чисел как в Power BI ───────────── */
export function fmt(v: Val, format?: string, type?: ColType): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'Истина' : 'Ложь';
  if (typeof v === 'string') return v;
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Бесконечность' : '-Бесконечность';
  if (type === 'date' || format === 'date') { const [y, m, d] = ymd(v); return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`; }
  if (type === 'int' || type === 'num') return String(v).replace('.', ',');
  const nf = (x: number, d: number, min = d) => x.toLocaleString('ru-RU', { minimumFractionDigits: min, maximumFractionDigits: d });
  if (format === 'percent') return nf(v * 100, 1, 1) + ' %';
  if (format === 'int') return nf(Math.round(v), 0);
  if (format === 'dec2') return nf(v, 2, 2);
  if (format === 'rub') return nf(Math.round(v), 0) + ' ₽';
  return Number.isInteger(v) ? nf(v, 0) : nf(v, 2, 0);
}
