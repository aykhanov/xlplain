// @ts-nocheck
/* Движок шагов Power Query для тренажёра: применяет шаги к таблице, пишет код M, сравнивает результат. */
export type PType = 'any' | 'text' | 'number' | 'int' | 'date';
export type Cell = string | number | null | { err: string };
export interface PCol { name: string; type: PType }
export interface PTable { cols: PCol[]; rows: Cell[][] }
export interface Step { op: string; [k: string]: any }
export class StepError extends Error {}
const se = (m: string): never => { throw new StepError(m); };
export const isErr = (c: Cell): c is { err: string } => !!c && typeof c === 'object';
export const TYPE_NAME: Record<PType, string> = { any: 'Любой', text: 'Текст', number: 'Десятичное число', int: 'Целое число', date: 'Дата' };
const M_TYPE: Record<PType, string> = { any: 'type any', text: 'type text', number: 'type number', int: 'Int64.Type', date: 'type date' };

const ser = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
export const dstr = (s: number) => { const d = new Date((s - 25569) * 864e5); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); };
export function show(c: Cell, type: PType): string {
  if (c === null) return 'null';
  if (isErr(c)) return 'Error';
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
const key = (c: Cell) => c === null ? '∅' : isErr(c) ? '⚠' : typeof c === 'number' ? 'n' + c : 's' + c;
const blank = (c: Cell) => c === null || c === '';
const proper = (s: string) => s.toLowerCase().replace(/(^|[^A-Za-zА-Яа-яЁё0-9])([A-Za-zА-Яа-яЁё])/g, (_, a, b) => a + b.toUpperCase());

export function applyStep(t: PTable, s: Step): PTable {
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
  }
  return se('Неизвестная операция ' + s.op);
}

/* ───── имена шагов и код M ───── */
const BASE_NAME: Record<string, string> = {
  removeTop: 'Удаленные верхние строки', removeBottom: 'Удаленные нижние строки', removeBlank: 'Удаленные пустые строки', promote: 'Повышенные заголовки', demote: 'Пониженные заголовки',
  type: 'Измененный тип', filter: 'Строки с примененным фильтром', replace: 'Замененное значение', trim: 'Обрезанный текст', clean: 'Очищенный текст', upper: 'Текст в верхнем регистре',
  lower: 'Текст в нижнем регистре', proper: 'Каждое слово с прописной буквы', removeCols: 'Удаленные столбцы', keepCols: 'Другие удаленные столбцы', rename: 'Переименованные столбцы',
  split: 'Разделить столбец по разделителю', fillDown: 'Заполнено вниз', unpivotOther: 'Столбец со снятым свертыванием', unpivot: 'Столбец со снятым свертыванием', group: 'Сгруппированные строки',
};
export function stepNames(steps: Step[]): string[] {
  const used = new Map<string, number>([['Источник', 1]]);
  return steps.map(s => { const b = BASE_NAME[s.op] || s.op; const k = used.get(b) || 0; used.set(b, k + 1); return k ? b + k : b; });
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
export function run(source: PTable, steps: Step[]): { tables: PTable[]; error?: { step: number; msg: string } } {
  const tables = [source];
  for (let i = 0; i < steps.length; i++) {
    try { tables.push(applyStep(tables[i], steps[i])); }
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
export function checkPq(sources: PTable[], user: Step[], ref: Step[]): { ok: true } | { ok: false; msg: string } {
  for (let v = 0; v < sources.length; v++) {
    const ur = run(sources[v], user), rr = run(sources[v], ref);
    if (rr.error) return { ok: false, msg: 'Ошибка эталона: ' + rr.error.msg };
    if (ur.error) return { ok: false, msg: `Шаг «${stepNames(user)[ur.error.step]}» выдаёт ошибку: ${ur.error.msg}` + (v ? ' Это случилось на проверочной выгрузке с другими данными — шаги должны работать для любой выгрузки такого формата.' : '') };
    const c = compareTables(ur.tables[ur.tables.length - 1], rr.tables[rr.tables.length - 1]);
    if (!c.ok) return v ? { ok: false, msg: 'На вашей выгрузке всё сходится, а на проверочной с другими данными — нет: ' + c.msg + ' Похоже, шаг завязан на конкретные строки или значения.' } : c;
  }
  return { ok: true };
}
