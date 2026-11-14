// @ts-nocheck
/* Движок шагов Power Query для тренажёра: применяет шаги к таблице, пишет код M, сравнивает результат. */
export type PType = 'any' | 'text' | 'number' | 'int' | 'date' | 'table';
import { parseM, evalM, isDate as mIsDate, MError } from './m';
export type Cell = string | number | null | { err: string } | { table: PTable };
export interface PCol { name: string; type: PType }
export interface PTable { cols: PCol[]; rows: Cell[][] }
export interface Step { op: string; [k: string]: any }
export class StepError extends Error {}
const se = (m: string): never => { throw new StepError(m); };
export const isErr = (c: Cell): c is { err: string } => !!c && typeof c === 'object' && 'err' in c;
export const isTbl = (c: Cell): c is { table: PTable } => !!c && typeof c === 'object' && 'table' in c;
export interface Env { queries: Record<string, PTable> }
export const TYPE_NAME: Record<PType, string> = { any: 'Любой', text: 'Текст', number: 'Десятичное число', int: 'Целое число', date: 'Дата', table: 'Таблица' };
const M_TYPE: Record<PType, string> = { any: 'type any', text: 'type text', number: 'type number', int: 'Int64.Type', date: 'type date', table: 'type table' };

const ser = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
export const dstr = (s: number) => { const d = new Date((s - 25569) * 864e5); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); };
export function show(c: Cell, type: PType): string {
  if (c === null) return 'null';
  if (isErr(c)) return 'Error';
  if (isTbl(c)) return 'Table';
  if (typeof c === 'number') return type === 'date' ? dstr(c) : String(c).replace('.', ',');
  return c;
}
function colIx(t: PTable, name: string): number {
  const i = t.cols.findIndex(c => c.name === name);
  if (i < 0) se(`Expression.Error: Столбец «${name}» таблицы не найден.`);
  return i;
}
function conv(v: Cell, type: PType): Cell {
  if (v === null || isErr(v)) return v;
  if (type === 'any') return v;
  if (isTbl(v)) return { err: 'Expression.Error: Значение типа Table нельзя преобразовать в ' + TYPE_NAME[type] + '. Сначала разверните столбец.' };
  if (type === 'text') return typeof v === 'number' ? String(v).replace('.', ',') : v;
  if (type === 'number' || type === 'int') {
    if (typeof v === 'number') return type === 'int' ? Math.round(v) : v;
    const s = v.replace(/[\s  ]/g, '').replace(',', '.');
    if (s === '') return null;
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return { err: `DataFormat.Error: Не удалось преобразовать в тип Number. Подробности: ${v}` };
    return type === 'int' ? Math.round(Number(s)) : Number(s);
  }
  if (type === 'date') {
    if (typeof v === 'number') return Math.floor(v);
    const s = v.trim(); let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) return ser(+m[3], +m[2], +m[1]);
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (m) return ser(+m[1], +m[2], +m[3]);
    return { err: `DataFormat.Error: Не удалось выполнить синтаксический анализ входного значения как Date. Подробности: ${v}` };
  }
  return v;
}
const key = (c: Cell) => c === null ? '∅' : isErr(c) ? '⚠' : isTbl(c) ? 'T' + c.table.rows.length : typeof c === 'number' ? 'n' + c : 's' + c;
const blank = (c: Cell) => c === null || c === '';
const proper = (s: string) => s.toLowerCase().replace(/(^|[^A-Za-zА-Яа-яЁё0-9])([A-Za-zА-Яа-яЁё])/g, (_, a, b) => a + b.toUpperCase());

export function applyStep(t: PTable, s: Step, env: Env = { queries: {} }): PTable {
  const rows = t.rows, cols = t.cols;
  switch (s.op) {
    case 'removeTop': return { cols, rows: rows.slice(s.n) };
    case 'removeBottom': return { cols, rows: rows.slice(0, Math.max(0, rows.length - s.n)) };
    case 'removeBlank': return { cols, rows: rows.filter(r => !r.every(blank)) };
    case 'promote': {
      if (!rows.length) return t;
      const seen = new Map<string, number>();
      const names = rows[0].map((c, i) => { let n = c === null || isErr(c) || c === '' ? 'Column' + (i + 1) : show(c, 'any'); const k = seen.get(n) || 0; seen.set(n, k + 1); return k ? n + '_' + k : n; });
      return { cols: names.map(name => ({ name, type: 'any' })), rows: rows.slice(1) };
    }
    case 'demote': return { cols: cols.map((_, i) => ({ name: 'Column' + (i + 1), type: 'any' })), rows: [cols.map(c => c.name), ...rows] };
    case 'type': {
      const ix = Object.entries(s.cols).map(([n, ty]) => [colIx(t, n), ty] as [number, PType]);
      const nc = cols.map(c => ({ ...c })); for (const [i, ty] of ix) nc[i].type = ty;
      return { cols: nc, rows: rows.map(r => { const x = [...r]; for (const [i, ty] of ix) x[i] = conv(x[i], ty); return x; }) };
    }
    case 'filter': {
      const i = colIx(t, s.col);
      const ex = s.exclude ? new Set(s.exclude.map(key)) : null, kp = s.keep ? new Set(s.keep.map(key)) : null;
      return { cols, rows: rows.filter(r => ex ? !ex.has(key(r[i])) : kp.has(key(r[i]))) };
    }
    case 'replace': {
      const ix = s.cols.map(n => colIx(t, n));
      const fnum = Number(String(s.find).replace(',', '.'));
      return { cols, rows: rows.map(r => { const x = [...r]; for (const i of ix) { const v = x[i]; if (typeof v === 'string') x[i] = s.find === '' ? v : v.split(s.find).join(s.repl); else if (typeof v === 'number' && v === fnum) { const rn = Number(String(s.repl).replace(',', '.')); x[i] = isFinite(rn) && s.repl !== '' ? rn : s.repl; } else if (v === null && s.find === 'null') x[i] = s.repl; } return x; }) };
    }
    case 'trim': case 'clean': case 'upper': case 'lower': case 'proper': {
      const ix = s.cols.map(n => colIx(t, n));
      const f = { trim: (v: string) => v.trim(), clean: (v: string) => v.replace(/[\x00-\x1f\x7f]/g, ''), upper: (v: string) => v.toUpperCase(), lower: (v: string) => v.toLowerCase(), proper }[s.op];
      return { cols, rows: rows.map(r => { const x = [...r]; for (const i of ix) { if (typeof x[i] === 'string') x[i] = f(x[i] as string); else if (typeof x[i] === 'number' && cols[i].type !== 'any') x[i] = { err: 'Expression.Error: Не удается преобразовать значение типа Number в тип Text.' }; } return x; }) };
    }
    case 'removeCols': { const ix = new Set(s.cols.map(n => colIx(t, n))); return { cols: cols.filter((_, i) => !ix.has(i)), rows: rows.map(r => r.filter((_, i) => !ix.has(i))) }; }
    case 'keepCols': { const ix = s.cols.map(n => colIx(t, n)); return { cols: ix.map(i => cols[i]), rows: rows.map(r => ix.map(i => r[i])) }; }
    case 'rename': {
      const i = colIx(t, s.col);
      if (s.to !== s.col && cols.some(c => c.name === s.to)) se(`Expression.Error: Столбец «${s.to}» уже существует в таблице.`);
      return { cols: cols.map((c, k) => k === i ? { ...c, name: s.to } : c), rows };
    }
    case 'split': {
      const i = colIx(t, s.col);
      const parts = rows.map(r => r[i] === null ? [null] : typeof r[i] === 'string' ? (r[i] as string).split(s.delim) : [r[i]]);
      const k = Math.max(1, ...parts.map(p => p.length));
      const nc = Array.from({ length: k }, (_, j) => ({ name: s.col + '.' + (j + 1), type: 'text' as PType }));
      return { cols: [...cols.slice(0, i), ...nc, ...cols.slice(i + 1)], rows: rows.map((r, n) => [...r.slice(0, i), ...Array.from({ length: k }, (_, j) => parts[n][j] ?? null), ...r.slice(i + 1)]) };
    }
    case 'fillDown': {
      const ix = s.cols.map(n => colIx(t, n)); const last = ix.map(() => null as Cell);
      return { cols, rows: rows.map(r => { const x = [...r]; ix.forEach((i, k) => { if (x[i] === null) x[i] = last[k]; else last[k] = x[i]; }); return x; }) };
    }
    case 'unpivotOther': case 'unpivot': {
      const sel = new Set(s.cols.map(n => colIx(t, n)));
      const keep = cols.map((_, i) => i).filter(i => s.op === 'unpivotOther' ? sel.has(i) : !sel.has(i));
      const piv = cols.map((_, i) => i).filter(i => !keep.includes(i));
      const types = new Set(piv.map(i => cols[i].type));
      const out: Cell[][] = [];
      for (const r of rows) for (const i of piv) if (r[i] !== null) out.push([...keep.map(k => r[k]), cols[i].name, r[i]]);
      return { cols: [...keep.map(k => cols[k]), { name: 'Атрибут', type: 'text' }, { name: 'Значение', type: types.size === 1 ? [...types][0] : 'any' }], rows: out };
    }
    case 'group': {
      const by = s.by.map(n => colIx(t, n));
      const aggs = s.aggs.map(a => ({ ...a, i: a.op === 'count' ? -1 : colIx(t, a.col) }));
      const groups = new Map<string, Cell[][]>();
      for (const r of rows) { const k = by.map(i => key(r[i])).join('\u0001'); const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
      const out: Cell[][] = [];
      for (const g of groups.values()) out.push([...by.map(i => g[0][i]), ...aggs.map(a => {
        if (a.op === 'count') return g.length;
        const vals = g.map(r => r[a.i]).filter(v => v !== null);
        if (vals.some(isErr)) return { err: 'Expression.Error: В столбце есть ошибки.' };
        if (vals.some(v => typeof v !== 'number')) return { err: `Expression.Error: Невозможно применить оператор + к типам Text и Number. Сначала задайте столбцу «${a.col}» числовой тип.` };
        const n = vals as number[];
        if (!n.length) return null;
        if (a.op === 'sum') return n.reduce((x, y) => x + y, 0);
        if (a.op === 'avg') return n.reduce((x, y) => x + y, 0) / n.length;
        if (a.op === 'min') return Math.min(...n);
        if (a.op === 'max') return Math.max(...n);
        return null;
      })]);
      return { cols: [...by.map(i => cols[i]), ...aggs.map(a => ({ name: a.name, type: (a.op === 'count' ? 'int' : a.op === 'avg' ? 'number' : cols[a.i].type) as PType }))], rows: out };
    }

    case 'keepTop': return { cols, rows: rows.slice(0, s.n) };
    case 'removeErrors': { const ix = (s.cols && s.cols.length ? s.cols : cols.map(c => c.name)).map(n => colIx(t, n)); return { cols, rows: rows.filter(r => !ix.some(i => isErr(r[i]))) }; }
    case 'fillUp': {
      const ix = s.cols.map(n => colIx(t, n)); const out = rows.map(r => [...r]); const last = ix.map(() => null as Cell);
      for (let k = out.length - 1; k >= 0; k--) ix.forEach((i, j) => { if (out[k][i] === null) out[k][i] = last[j]; else last[j] = out[k][i]; });
      return { cols, rows: out };
    }
    case 'dedupe': {
      const ix = (s.cols && s.cols.length ? s.cols : cols.map(c => c.name)).map(n => colIx(t, n));
      const seen = new Set<string>(); return { cols, rows: rows.filter(r => { const k = ix.map(i => key(typeof r[i] === 'string' ? (r[i] as string) : r[i])).join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; }) };
    }
    case 'sort': {
      const by = s.by.map(b => ({ i: colIx(t, b.col), d: b.desc ? -1 : 1 }));
      const cmp = (a: Cell, b: Cell) => a === b ? 0 : a === null ? -1 : b === null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(show(a, 'any')).localeCompare(String(show(b, 'any')), 'ru');
      return { cols, rows: rows.map((r, k) => [r, k] as [Cell[], number]).sort((x, y) => { for (const b of by) { const c = cmp(x[0][b.i], y[0][b.i]); if (c) return c * b.d; } return x[1] - y[1]; }).map(x => x[0]) };
    }
    case 'index': { const st = s.start ?? 1; return { cols: [...cols, { name: s.name || 'Индекс', type: 'int' }], rows: rows.map((r, k) => [...r, st + k]) }; }
    case 'addCol': case 'condCol': {
      if (cols.some(c => c.name === s.name)) se(`Expression.Error: Столбец «${s.name}» уже существует в таблице.`);
      const src = s.op === 'condCol' ? condM(s) : s.expr;
      let ast; try { ast = parseM(src); } catch (e) { se('Expression.SyntaxError: ' + e.message); }
      let dates = 0, vals = 0;
      const out: Cell[] = rows.map(r => {
        const get = (n: string) => { const i = cols.findIndex(c => c.name === n); if (i < 0) throw new MError(`Expression.Error: Поле «${n}» записи не найдено.`); const v = r[i]; if (isErr(v)) throw new MError(v.err); if (isTbl(v)) return null; return cols[i].type === 'date' && typeof v === 'number' ? { date: v } : v; };
        try {
          const v = evalM(ast, get);
          if (v !== null) { vals++; if (mIsDate(v)) dates++; }
          return mIsDate(v) ? v.date : Array.isArray(v) ? { err: 'Expression.Error: Результат — список, а нужно одно значение.' } : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v as Cell;
        } catch (e) { return { err: /^(Expression|DataFormat)\./.test(e.message) ? e.message : 'Expression.Error: ' + e.message }; }
      });
      const type: PType = s.type || (vals && dates === vals ? 'date' : 'any');
      return { cols: [...cols, { name: s.name, type }], rows: rows.map((r, k) => [...r, type === 'any' || type === 'date' ? out[k] : conv(out[k], type)]) };
    }
    case 'extract': case 'dateOp': {
      const i = colIx(t, s.col); const ty = cols[i].type;
      const f = s.op === 'extract' ? EXTRACT[s.mode](s) : DATEOP[s.mode];
      const otype: PType = s.op === 'extract' ? (s.mode === 'length' ? 'int' : 'text') : (['year', 'month', 'day', 'quarter'].includes(s.mode) ? 'int' : s.mode === 'monthName' ? 'text' : 'date');
      const val = (v: Cell): Cell => {
        if (v === null || isErr(v)) return v;
        if (s.op === 'dateOp') { if (ty !== 'date' || typeof v !== 'number') return { err: `Expression.Error: Не удается преобразовать значение «${show(v, ty)}» в тип Date. Сначала задайте столбцу «${s.col}» тип «Дата».` }; return f(v); }
        if (typeof v !== 'string') return { err: `Expression.Error: Не удается преобразовать значение ${show(v, ty)} типа Number в тип Text.` };
        return f(v);
      };
      if (s.add) { const name = s.name || DEFAULT_NEW[s.mode]; if (cols.some(c => c.name === name)) se(`Expression.Error: Столбец «${name}» уже существует в таблице.`); return { cols: [...cols, { name, type: otype }], rows: rows.map(r => [...r, val(r[i])]) }; }
      return { cols: cols.map((c, k) => k === i ? { ...c, type: otype } : c), rows: rows.map(r => r.map((v, k) => k === i ? val(v) : v)) };
    }
    case 'pivot': {
      const ai = colIx(t, s.col), vi = colIx(t, s.val);
      const keys = cols.map((_, i) => i).filter(i => i !== ai && i !== vi);
      const names: string[] = []; for (const r of rows) { const n = show(r[ai], cols[ai].type); if (r[ai] !== null && !names.includes(n)) names.push(n); }
      const groups = new Map<string, { k: Cell[]; v: Map<string, Cell[]> }>();
      for (const r of rows) { const gk = keys.map(i => key(r[i])).join('\u0001'); let g = groups.get(gk); if (!g) { g = { k: keys.map(i => r[i]), v: new Map() }; groups.set(gk, g); } if (r[ai] === null) continue; const n = show(r[ai], cols[ai].type); const a = g.v.get(n) || []; a.push(r[vi]); g.v.set(n, a); }
      const agg = (a: Cell[] | undefined): Cell => {
        if (!a || !a.length) return s.agg === 'count' ? 0 : null;
        if (s.agg === 'none') return a.length > 1 ? { err: 'Expression.Error: Слишком много элементов в перечислении для выполнения операции. Выберите агрегирование значений.' } : a[0];
        if (s.agg === 'count') return a.filter(x => x !== null).length;
        if (a.some(x => x !== null && typeof x !== 'number')) return { err: `Expression.Error: Невозможно применить операцию к типу Text. Задайте столбцу «${s.val}» числовой тип.` };
        const n = a.filter(x => x !== null) as number[]; if (!n.length) return null;
        return s.agg === 'sum' ? n.reduce((x, y) => x + y, 0) : s.agg === 'min' ? Math.min(...n) : s.agg === 'max' ? Math.max(...n) : n.reduce((x, y) => x + y, 0) / n.length;
      };
      const vt: PType = s.agg === 'count' ? 'int' : s.agg === 'avg' ? 'number' : cols[vi].type;
      return { cols: [...keys.map(i => cols[i]), ...names.map(name => ({ name, type: vt }))], rows: [...groups.values()].map(g => [...g.k, ...names.map(n => agg(g.v.get(n)))]) };
    }
    case 'merge': {
      const other = env.queries[s.with]; if (!other) se(`Expression.Error: Запрос «${s.with}» не найден.`);
      if (s.left.length !== s.right.length) se('Expression.Error: Число ключевых столбцов в двух таблицах должно совпадать.');
      const li = s.left.map(n => colIx(t, n)), ri = s.right.map(n => colIx(other, n));
      const map = new Map<string, number[]>(); other.rows.forEach((r, k) => { const kk = ri.map(i => key(r[i])).join('\u0001'); if (ri.some(i => r[i] === null)) return; const a = map.get(kk); if (a) a.push(k); else map.set(kk, [k]); });
      const name = s.as || s.with; if (cols.some(c => c.name === name)) se(`Expression.Error: Столбец «${name}» уже существует в таблице.`);
      const sub = (ids: number[]): Cell => ({ table: { cols: other.cols, rows: ids.map(k => other.rows[k]) } });
      const used = new Set<number>(); const out: Cell[][] = [];
      for (const r of rows) {
        const ids = li.some(i => r[i] === null) ? [] : (map.get(li.map(i => key(r[i])).join('\u0001')) || []);
        ids.forEach(k => used.add(k));
        if (s.kind === 'inner' && !ids.length) continue;
        if (s.kind === 'leftanti' && ids.length) continue;
        if (s.kind === 'rightanti' || s.kind === 'rightouter') { if (ids.length && s.kind === 'rightouter') out.push([...r, sub(ids)]); continue; }
        out.push([...r, sub(ids)]);
      }
      if (s.kind === 'fullouter' || s.kind === 'rightouter' || s.kind === 'rightanti') other.rows.forEach((r, k) => { if (!used.has(k)) out.push([...cols.map(() => null), sub([k])]); });
      return { cols: [...cols, { name, type: 'table' }], rows: out };
    }
    case 'expand': {
      const i = colIx(t, s.col);
      if (cols[i].type !== 'table') se(`Expression.Error: Столбец «${s.col}» не содержит таблиц, разворачивать нечего.`);
      const sample = rows.find(r => isTbl(r[i]))?.[i] as any;
      const fcols: PCol[] = sample ? sample.table.cols : [];
      const fi = s.fields.map(f => { const k = fcols.findIndex(c => c.name === f); if (k < 0 && sample) se(`Expression.Error: Столбец «${f}» таблицы не найден.`); return k; });
      const names = s.names || s.fields;
      for (const n of names) if (cols.some((c, k) => k !== i && c.name === n)) se(`Expression.Error: Столбец «${n}» уже существует в таблице. Включите префикс или переименуйте столбец.`);
      const out: Cell[][] = [];
      for (const r of rows) {
        const nt = isTbl(r[i]) ? r[i].table : null;
        if (!nt || !nt.rows.length) out.push([...r.slice(0, i), ...fi.map(() => null), ...r.slice(i + 1)]);
        else for (const x of nt.rows) out.push([...r.slice(0, i), ...fi.map(k => x[k]), ...r.slice(i + 1)]);
      }
      return { cols: [...cols.slice(0, i), ...fi.map((k, j) => ({ name: names[j], type: fcols[k]?.type || 'any' })), ...cols.slice(i + 1)], rows: out };
    }
    case 'aggregate': {
      const i = colIx(t, s.col);
      if (cols[i].type !== 'table') se(`Expression.Error: Столбец «${s.col}» не содержит таблиц.`);
      const names = s.aggs.map(a => a.name);
      return { cols: [...cols.slice(0, i), ...s.aggs.map(a => ({ name: a.name, type: (a.op === 'count' ? 'int' : 'number') as PType })), ...cols.slice(i + 1)], rows: rows.map(r => { const nt = isTbl(r[i]) ? r[i].table : { cols: [], rows: [] }; return [...r.slice(0, i), ...s.aggs.map(a => { if (a.op === 'count') return nt.rows.length; const k = nt.cols.findIndex(c => c.name === a.field); const v = nt.rows.map(x => x[k]).filter(x => x !== null); if (v.some(x => typeof x !== 'number')) return { err: 'Expression.Error: Невозможно сложить значения типа Text.' }; return v.length ? (v as number[]).reduce((x, y) => x + y, 0) : null; }), ...r.slice(i + 1)]; }) };
    }
    case 'append': {
      const tabs = [t, ...s.queries.map(q => env.queries[q] || se(`Expression.Error: Запрос «${q}» не найден.`))];
      const names: string[] = []; const types = new Map<string, PType>();
      for (const x of tabs) for (const c of x.cols) { if (!names.includes(c.name)) { names.push(c.name); types.set(c.name, c.type); } else if (types.get(c.name) !== c.type) types.set(c.name, 'any'); }
      return { cols: names.map(n => ({ name: n, type: types.get(n) })), rows: tabs.flatMap(x => x.rows.map(r => names.map(n => { const k = x.cols.findIndex(c => c.name === n); return k < 0 ? null : r[k]; }))) };
    }
  }
  return se('Неизвестная операция ' + s.op);
}

const OPM = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' };
const lit2 = (v: any) => v === null || v === undefined || v === '' ? 'null' : typeof v === 'number' ? String(v) : /^-?\d+(\.\d+)?$/.test(String(v).replace(',', '.')) && String(v).trim() !== '' ? String(v).replace(',', '.') : '"' + String(v).replace(/"/g, '""') + '"';
export function condM(s: Step): string {
  const parts = s.rules.map(r => {
    const f = `[${r.col}]`, v = lit2(r.value);
    const c = OPM[r.op] ? `${f} ${OPM[r.op]} ${v}` : r.op === 'begins' ? `Text.StartsWith(${f}, ${v})` : r.op === 'notbegins' ? `not Text.StartsWith(${f}, ${v})` : r.op === 'ends' ? `Text.EndsWith(${f}, ${v})` : r.op === 'contains' ? `Text.Contains(${f}, ${v})` : `not Text.Contains(${f}, ${v})`;
    return `if ${c} then ${lit2(r.out)}`;
  });
  return parts.join(' else ') + ' else ' + lit2(s.else);
}
const ser2 = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
const ymd2 = (n: number) => { const d = new Date((n - 25569) * 864e5); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const EXTRACT = {
  first: s => v => v.slice(0, s.n), last: s => v => s.n ? v.slice(-s.n) : '', length: () => v => v.length,
  before: s => v => { const k = v.indexOf(s.delim); return k < 0 ? v : v.slice(0, k); },
  after: s => v => { const k = v.indexOf(s.delim); return k < 0 ? '' : v.slice(k + s.delim.length); },
  between: s => v => { const a = v.indexOf(s.delim); if (a < 0) return ''; const r = v.slice(a + s.delim.length); const b = r.indexOf(s.delim2); return b < 0 ? r : r.slice(0, b); },
};
const MN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const DATEOP = {
  year: v => ymd2(v)[0], month: v => ymd2(v)[1], day: v => ymd2(v)[2], quarter: v => Math.ceil(ymd2(v)[1] / 3), monthName: v => MN[ymd2(v)[1] - 1],
  startOfMonth: v => { const [y, m] = ymd2(v); return ser2(y, m, 1); }, endOfMonth: v => { const [y, m] = ymd2(v); return ser2(y, m + 1, 0); },
};
const DEFAULT_NEW = { first: 'Первые символы', last: 'Последние символы', length: 'Длина', before: 'Текст перед разделителем', after: 'Текст после разделителя', between: 'Текст между разделителями', year: 'Год', month: 'Месяц', day: 'День', quarter: 'Квартал', monthName: 'Название месяца', startOfMonth: 'Начало месяца', endOfMonth: 'Конец месяца' };


/* ───── имена шагов и код M ───── */
const BASE_NAME: Record<string, string> = {
  removeTop: 'Удаленные верхние строки', removeBottom: 'Удаленные нижние строки', removeBlank: 'Удаленные пустые строки', promote: 'Повышенные заголовки', demote: 'Пониженные заголовки',
  type: 'Измененный тип', filter: 'Строки с примененным фильтром', replace: 'Замененное значение', trim: 'Обрезанный текст', clean: 'Очищенный текст', upper: 'Текст в верхнем регистре',
  lower: 'Текст в нижнем регистре', proper: 'Каждое слово с прописной буквы', removeCols: 'Удаленные столбцы', keepCols: 'Другие удаленные столбцы', rename: 'Переименованные столбцы',
  split: 'Разделить столбец по разделителю', fillDown: 'Заполнено вниз', unpivotOther: 'Столбец со снятым свертыванием', unpivot: 'Столбец со снятым свертыванием', group: 'Сгруппированные строки', keepTop: 'Сохраненные первые строки', removeErrors: 'Удаленные ошибки', fillUp: 'Заполнено вверх', dedupe: 'Удаленные дубликаты', sort: 'Отсортированные строки', index: 'Добавлен индекс', addCol: 'Добавлен пользовательский объект', condCol: 'Добавлен условный столбец', extract: 'Извлеченный текст', dateOp: 'Извлеченная дата', pivot: 'Столбец сведения', merge: 'Объединенные запросы', expand: 'Развернутый элемент', aggregate: 'Статистическое выражение', append: 'Добавленный запрос',
};
export function stepNames(steps: Step[]): string[] {
  const used = new Map<string, number>([['Источник', 1]]);
  return steps.map(s => { const b = s.op === 'expand' ? 'Развернутый элемент ' + s.col : s.op === 'extract' && s.add ? 'Вставлен ' + DEFAULT_NEW[s.mode].toLowerCase() : s.op === 'dateOp' ? (s.add ? 'Вставлен ' : 'Извлечен ') + DEFAULT_NEW[s.mode].toLowerCase() : (BASE_NAME[s.op] || s.op); const k = used.get(b) || 0; used.set(b, k + 1); return k ? b + k : b; });
}
const q = (n: string) => /^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*$/.test(n) && !n.includes(' ') ? n : '#"' + n.replace(/"/g, '""') + '"';
const lit = (v: Cell) => v === null ? 'null' : typeof v === 'number' ? String(v) : '"' + String(v).replace(/"/g, '""') + '"';
const list = (a: string[]) => '{' + a.map(x => '"' + x + '"').join(', ') + '}';
export function mCode(s: Step, prev: string): string {
  const p = q(prev);
  switch (s.op) {
    case 'removeTop': return `Table.Skip(${p},${s.n})`;
    case 'removeBottom': return `Table.RemoveLastN(${p},${s.n})`;
    case 'removeBlank': return `Table.SelectRows(${p}, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null})))`;
    case 'promote': return `Table.PromoteHeaders(${p}, [PromoteAllScalars=true])`;
    case 'demote': return `Table.DemoteHeaders(${p})`;
    case 'type': return `Table.TransformColumnTypes(${p},{${Object.entries(s.cols).map(([n, t]) => `{"${n}", ${M_TYPE[t as PType]}}`).join(', ')}})`;
    case 'filter': { const f = `[${s.col}]`; return `Table.SelectRows(${p}, each ${s.exclude ? '(' + s.exclude.map(v => `${f} <> ${lit(v)}`).join(' and ') + ')' : '(' + s.keep.map(v => `${f} = ${lit(v)}`).join(' or ') + ')'})`; }
    case 'replace': return `Table.ReplaceValue(${p},${lit(s.find)},${lit(s.repl)},Replacer.ReplaceText,${list(s.cols)})`;
    case 'trim': case 'clean': case 'upper': case 'lower': case 'proper': { const fn = { trim: 'Text.Trim', clean: 'Text.Clean', upper: 'Text.Upper', lower: 'Text.Lower', proper: 'Text.Proper' }[s.op]; return `Table.TransformColumns(${p},{${s.cols.map(c => `{"${c}", ${fn}, type text}`).join(', ')}})`; }
    case 'removeCols': return `Table.RemoveColumns(${p},${list(s.cols)})`;
    case 'keepCols': return `Table.SelectColumns(${p},${list(s.cols)})`;
    case 'rename': return `Table.RenameColumns(${p},{{"${s.col}", "${s.to}"}})`;
    case 'split': return `Table.SplitColumn(${p}, "${s.col}", Splitter.SplitTextByDelimiter("${s.delim}", QuoteStyle.Csv))`;
    case 'fillDown': return `Table.FillDown(${p},${list(s.cols)})`;
    case 'unpivotOther': return `Table.UnpivotOtherColumns(${p}, ${list(s.cols)}, "Атрибут", "Значение")`;
    case 'unpivot': return `Table.Unpivot(${p}, ${list(s.cols)}, "Атрибут", "Значение")`;

    case 'keepTop': return `Table.FirstN(${p},${s.n})`;
    case 'removeErrors': return `Table.RemoveRowsWithErrors(${p}${s.cols && s.cols.length ? ', ' + list(s.cols) : ''})`;
    case 'fillUp': return `Table.FillUp(${p},${list(s.cols)})`;
    case 'dedupe': return `Table.Distinct(${p}${s.cols && s.cols.length ? ', ' + list(s.cols) : ''})`;
    case 'sort': return `Table.Sort(${p},{${s.by.map(b => `{"${b.col}", Order.${b.desc ? 'Descending' : 'Ascending'}}`).join(', ')}})`;
    case 'index': return `Table.AddIndexColumn(${p}, "${s.name || 'Индекс'}", ${s.start ?? 1}, 1, Int64.Type)`;
    case 'addCol': return `Table.AddColumn(${p}, "${s.name}", each ${s.expr}${s.type ? ', ' + M_TYPE[s.type] : ''})`;
    case 'condCol': return `Table.AddColumn(${p}, "${s.name}", each ${condM(s)})`;
    case 'extract': case 'dateOp': {
      const fx = s.op === 'extract' ? { first: `each Text.Start(_, ${s.n})`, last: `each Text.End(_, ${s.n})`, length: 'Text.Length', before: `each Text.BeforeDelimiter(_, ${lit(s.delim)})`, after: `each Text.AfterDelimiter(_, ${lit(s.delim)})`, between: `each Text.BetweenDelimiters(_, ${lit(s.delim)}, ${lit(s.delim2)})` }[s.mode] : { year: 'Date.Year', month: 'Date.Month', day: 'Date.Day', quarter: 'Date.QuarterOfYear', monthName: 'each Date.MonthName(_)', startOfMonth: 'Date.StartOfMonth', endOfMonth: 'Date.EndOfMonth' }[s.mode];
      const ty = s.op === 'extract' ? (s.mode === 'length' ? 'Int64.Type' : 'type text') : (['year', 'month', 'day', 'quarter'].includes(s.mode) ? 'Int64.Type' : s.mode === 'monthName' ? 'type text' : 'type date');
      if (s.add) return `Table.AddColumn(${p}, "${s.name || DEFAULT_NEW[s.mode]}", each ${fx.startsWith('each ') ? fx.slice(5).replace(/_/g, `[${s.col}]`) : fx + '([' + s.col + '])'}, ${ty})`;
      return `Table.TransformColumns(${p}, {{"${s.col}", ${fx}, ${ty}}})`;
    }
    case 'pivot': return `Table.Pivot(${p}, List.Distinct(${p}[${s.col}]), "${s.col}", "${s.val}"${s.agg === 'none' ? '' : ', List.' + { sum: 'Sum', count: 'Count', min: 'Min', max: 'Max', avg: 'Average' }[s.agg]})`;
    case 'merge': return `Table.NestedJoin(${p}, ${list(s.left)}, ${q(s.with)}, ${list(s.right)}, "${s.as || s.with}", JoinKind.${{ leftouter: 'LeftOuter', inner: 'Inner', fullouter: 'FullOuter', rightouter: 'RightOuter', leftanti: 'LeftAnti', rightanti: 'RightAnti' }[s.kind]})`;
    case 'expand': return `Table.ExpandTableColumn(${p}, "${s.col}", ${list(s.fields)}, ${list(s.names || s.fields)})`;
    case 'aggregate': return `Table.AggregateTableColumn(${p}, "${s.col}", {${s.aggs.map(a => a.op === 'count' ? `{"${a.field || ''}", Table.RowCount, "${a.name}"}` : `{"${a.field}", List.Sum, "${a.name}"}`).join(', ')}})`;
    case 'append': return `Table.Combine({${[p, ...s.queries.map(q)].join(', ')}})`;
    case 'group': return `Table.Group(${p}, ${list(s.by)}, {${s.aggs.map(a => a.op === 'count' ? `{"${a.name}", each Table.RowCount(_), Int64.Type}` : `{"${a.name}", each List.${{ sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max' }[a.op]}([${a.col}]), type nullable number}`).join(', ')}})`;
  }
  return '';
}
export function fullM(steps: Step[], sourceExpr: string): string {
  const names = stepNames(steps);
  const lines = [`    Источник = ${sourceExpr}`];
  steps.forEach((s, i) => lines.push(`    ${q(names[i])} = ${mCode(s, i ? names[i - 1] : 'Источник')}`));
  return 'let\n' + lines.join(',\n') + '\nin\n    ' + q(names.length ? names[names.length - 1] : 'Источник');
}

/* ───── прогон и сравнение ───── */
export function run(source: PTable, steps: Step[], env: Env = { queries: {} }): { tables: PTable[]; error?: { step: number; msg: string } } {
  const tables = [source];
  for (let i = 0; i < steps.length; i++) {
    try { tables.push(applyStep(tables[i], steps[i], env)); }
    catch (e) { return { tables, error: { step: i, msg: e.message } }; }
  }
  return { tables };
}
const sameCell = (a: Cell, b: Cell) => {
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
};
export function compareTables(u: PTable, r: PTable): { ok: true } | { ok: false; msg: string } {
  const un = u.cols.map(c => c.name), rn = r.cols.map(c => c.name);
  const missing = rn.filter(n => !un.includes(n)), extra = un.filter(n => !rn.includes(n));
  if (missing.length || extra.length) return { ok: false, msg: `В итоговой таблице должны быть столбцы: ${rn.join(', ')}.` + (missing.length ? ` Не хватает: ${missing.join(', ')}.` : '') + (extra.length ? ` Лишние: ${extra.join(', ')}.` : '') };
  const ix = rn.map(n => un.indexOf(n));
  const nested = u.cols.find(c => c.type === 'table');
  if (nested) return { ok: false, msg: `В столбце «${nested.name}» остались вложенные таблицы. Разверните его кнопкой ⇔ в заголовке.` };
  for (let k = 0; k < rn.length; k++) {
    const ut = u.cols[ix[k]].type, rt = r.cols[k].type;
    const okType = ut === rt || (rt === 'number' && ut === 'int' && false);
    if (!okType) return { ok: false, msg: `Столбцу «${rn[k]}» нужен тип «${TYPE_NAME[rt]}», сейчас — «${TYPE_NAME[ut]}». Тип меняется на ленте: «Тип данных» или значок слева в заголовке столбца.` };
  }
  for (let k = 0; k < rn.length; k++) {
    const bad = u.rows.findIndex(row => isErr(row[ix[k]]));
    if (bad >= 0) return { ok: false, msg: `В столбце «${rn[k]}» остались ошибки (строка ${bad + 1}): ${(u.rows[bad][ix[k]] as any).err}` };
  }
  if (u.rows.length !== r.rows.length) {
    const hint = u.rows.length > r.rows.length ? (u.rows.some(row => row.every(c => c === null || c === '')) ? ' Похоже, остались пустые строки.' : u.rows.some(row => row.some(c => typeof c === 'string' && /итог/i.test(c))) ? ' Похоже, осталась строка итогов.' : ' Лишние строки — проверьте фильтры.') : ' Часть нужных строк удалена — проверьте фильтры и удаление строк.';
    return { ok: false, msg: `Строк в результате должно быть ${r.rows.length}, а получилось ${u.rows.length}.${hint}` };
  }
  const rk = (row: Cell[], order: number[]) => order.map(i => key(typeof row[i] === 'number' ? Math.round((row[i] as number) * 1e6) / 1e6 : row[i])).join('\u0001');
  const want = new Map<string, number>(); for (const row of r.rows) { const k = rk(row, rn.map((_, i) => i)); want.set(k, (want.get(k) || 0) + 1); }
  for (const row of u.rows) {
    const k = rk(row, ix); const n = want.get(k);
    if (!n) return { ok: false, msg: `Строка «${ix.map((i, j) => show(row[i], u.cols[i].type)).join(' · ')}» не совпадает с ожидаемым результатом. Проверьте значения в ней.` };
    want.set(k, n - 1);
  }
  return { ok: true };
}
export function checkPq(sources: PTable[], user: Step[], ref: Step[], envs: Env[] = []): { ok: true } | { ok: false; msg: string } {
  for (let v = 0; v < sources.length; v++) {
    const ur = run(sources[v], user, envs[v]), rr = run(sources[v], ref, envs[v]);
    if (rr.error) return { ok: false, msg: 'Ошибка эталона: ' + rr.error.msg };
    if (ur.error) return { ok: false, msg: `Шаг «${stepNames(user)[ur.error.step]}» выдаёт ошибку: ${ur.error.msg}` + (v ? ' Это случилось на проверочной выгрузке с другими данными — шаги должны работать для любой выгрузки такого формата.' : '') };
    const c = compareTables(ur.tables[ur.tables.length - 1], rr.tables[rr.tables.length - 1]);
    if (!c.ok) return v ? { ok: false, msg: 'На вашей выгрузке всё сходится, а на проверочной с другими данными — нет: ' + c.msg + ' Похоже, шаг завязан на конкретные строки или значения.' } : c;
  }
  return { ok: true };
}
