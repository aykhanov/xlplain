// Поиск дублей. Перенос modDuplicates.RX_RunDuplicateSearch из XLPlain 1.1.
import { type Cell, type Sheet, normWs, isNumericText, parseNum, isDate, numText, display, findCol, vbStr } from './common';

export type DupMode = 'УМНОЕ' | 'СТРОГОЕ';
export interface DupOptions { keys: string[]; mode: DupMode; onlyRepeated?: boolean }
export interface DupRow { group: number; key: string; count: number; type: 'ПЕРВОЕ ВХОЖДЕНИЕ' | 'ДУБЛЬ'; sourceRow: number; values: Cell[] }
export interface DupResult {
  rows: DupRow[]; headers: string[];
  groups: number; rowsInGroups: number; excess: number; blankKeys: number; checked: number;
  tooFew?: boolean;
}

function tryNumber(v: Cell): number | null {
  if (typeof v === 'number') return v;
  if (isDate(v)) return v.d;
  if (typeof v === 'string') {
    const t = normWs(v).replace(/ /g, '');
    if (t && isNumericText(t)) return parseNum(t);
  }
  return null;
}

function normPart(v: Cell, mode: DupMode): string {
  if (v === null || v === undefined || v === '') return '';
  if (mode === 'СТРОГОЕ') {
    const type = typeof v === 'number' ? 5 : isDate(v) ? 7 : 8;
    return type + ':' + vbStr(v);
  }
  const n = tryNumber(v);
  if (n !== null) return 'N:' + numText(n);
  return 'T:' + normWs(vbStr(v)).toLowerCase();
}

function internalKey(row: Cell[], cols: number[], mode: DupMode): string {
  let has = false;
  const parts = cols.map(c => { const p = normPart(row[c] ?? null, mode); if (p) has = true; return p; });
  return has ? parts.join('\u001f') : '';
}

export function findDuplicates(sheet: Sheet, opt: DupOptions): DupResult {
  if (!opt.keys.length) throw new Error('Выберите хотя бы одно ключевое поле.');
  const mode: DupMode = opt.mode === 'СТРОГОЕ' ? 'СТРОГОЕ' : 'УМНОЕ';
  const cols = opt.keys.map(k => findCol(sheet, k));
  // как в надстройке: последняя строка — по последнему заполненному ключевому полю
  let last = -1;
  sheet.rows.forEach((r, i) => { if (cols.some(c => r[c] !== null && r[c] !== undefined && r[c] !== '')) last = i; });
  const data = sheet.rows.slice(0, last + 1);
  const res: DupResult = { rows: [], headers: sheet.headers, groups: 0, rowsInGroups: 0, excess: 0, blankKeys: 0, checked: data.length };
  if (data.length < 2) { res.tooFew = true; return res; }
  const counts = new Map<string, number>();
  for (const r of data) {
    const k = internalKey(r, cols, mode);
    if (!k) res.blankKeys++;
    else counts.set(k, (counts.get(k) || 0) + 1);
  }
  const groupNo = new Map<string, number>(); const started = new Set<string>();
  data.forEach((r, i) => {
    const k = internalKey(r, cols, mode);
    if (!k) return;
    const cnt = counts.get(k)!;
    if (cnt <= 1) return;
    if (!groupNo.has(k)) { groupNo.set(k, groupNo.size + 1); res.groups++; res.rowsInGroups += cnt; res.excess += cnt - 1; }
    let type: DupRow['type'];
    if (started.has(k)) type = 'ДУБЛЬ'; else { type = 'ПЕРВОЕ ВХОЖДЕНИЕ'; started.add(k); }
    if (opt.onlyRepeated && type !== 'ДУБЛЬ') return;
    res.rows.push({
      group: groupNo.get(k)!, key: cols.map(c => display(r[c] ?? null)).join(' | '), count: cnt, type,
      sourceRow: i + 2, values: sheet.headers.map((_, c) => r[c] ?? null),
    });
  });
  return res;
}
