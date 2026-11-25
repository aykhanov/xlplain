// Умное объединение таблиц. Перенос modSmartMergeEngine из XLPlain 1.1.
import { type Cell, type Sheet, isDate, isNumericText, parseNum, numText, findCol } from './common';

export type JoinMode = 'LEFT' | 'INNER' | 'FULL';
export const JOIN_LABEL: Record<JoinMode, string> = {
  LEFT: 'Основная таблица + совпадения',
  INNER: 'Только совпавшие во всех таблицах',
  FULL: 'Все строки из всех таблиц',
};
export const JOIN_EXPLAIN: Record<JoinMode, string> = {
  LEFT: 'Основной считается Таблица 1. Все её строки сохраняются. Данные из остальных таблиц добавляются только при совпадении ключа. Если совпадения нет — дополнительные поля пустые.',
  INNER: 'В результат попадают только ключи, которые присутствуют во всех выбранных таблицах.',
  FULL: 'В результат попадают все ключи из всех таблиц. Если для какого-то источника совпадения нет, его поля остаются пустыми.',
};
export interface MergeTable { sheet: Sheet; alias: string; keys: string[]; fields?: string[] }
export interface TableInfo { alias: string; rows: number; keys: string; unique: number; dupKeys: number; dupRows: number; blank: number }
export interface MergeResult { headers: string[]; rows: Cell[][]; empty: boolean[][]; info: TableInfo[]; mode: JoinMode; tooBig?: boolean }
export const MAX_TABLES = 6;

function canonicalNumber(t: string): boolean {
  const w = t.trim(); if (!w) return false;
  if (w.length > 1 && w[0] === '0') return false;
  if (w.includes(' ')) return false;
  return isNumericText(w);
}
/** RX_SM_NormalizeKeyValue */
export function normKeyValue(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return 'N:' + numText(v);
  if (isDate(v)) return 'N:' + v.d;
  let t = String(v).replace(/[  \t]/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!t) return '';
  return canonicalNumber(t) ? 'N:' + numText(parseNum(t)) : 'S:' + t.toLowerCase();
}

interface Loaded { t: MergeTable; keyIdx: number[]; map: Map<string, number[]>; info: TableInfo }
function rowKey(r: Cell[], keyIdx: number[]): string {
  let has = false;
  const s = keyIdx.map(c => { const p = normKeyValue(r[c] ?? null); if (p) has = true; return p.length + ':' + p + '|'; }).join('');
  return has ? s : '';
}

export function smartMerge(tables: MergeTable[], mode: JoinMode, maxRows = 100000): MergeResult {
  if (tables.length < 2 || tables.length > MAX_TABLES) throw new Error('Количество таблиц должно быть от 2 до ' + MAX_TABLES + '.');
  const kc = tables[0].keys.length;
  if (!kc) throw new Error('Выберите ключевые поля для каждой таблицы.');
  if (tables.some(t => t.keys.length !== kc)) throw new Error('Во всех таблицах должно быть одинаковое количество ключевых полей.');
  const L: Loaded[] = tables.map(t => {
    const keyIdx = t.keys.map(k => findCol(t.sheet, k));
    const map = new Map<string, number[]>(); let blank = 0;
    t.sheet.rows.forEach((r, i) => { const k = rowKey(r, keyIdx); if (!k) blank++; else (map.get(k) || map.set(k, []).get(k)!).push(i); });
    let dupKeys = 0, dupRows = 0; map.forEach(v => { if (v.length > 1) { dupKeys++; dupRows += v.length - 1; } });
    return { t, keyIdx, map, info: { alias: t.alias, rows: t.sheet.rows.length, keys: t.keys.join(' + '), unique: map.size, dupKeys, dupRows, blank } };
  });
  // порядок ключей
  const order: string[] = []; const seen = new Set<string>();
  if (mode === 'FULL') {
    for (const l of L) l.t.sheet.rows.forEach(r => { const k = rowKey(r, l.keyIdx); if (k && !seen.has(k)) { seen.add(k); order.push(k); } });
  } else {
    L[0].t.sheet.rows.forEach(r => {
      const k = rowKey(r, L[0].keyIdx);
      if (k && !seen.has(k) && (mode !== 'INNER' || L.every(l => l.map.has(k)))) { seen.add(k); order.push(k); }
    });
  }
  let est = 0;
  for (const k of order) { est += L.reduce((p, l) => p * (l.map.get(k)?.length || 1), 1); if (est > maxRows) break; }
  // состав столбцов
  const used = new Set<string>(); const headers: string[] = []; const src: [number, number][] = [];
  const uniq = (h: string) => { if (!used.has(h.toLowerCase())) return h; let i = 2; while (used.has((h + ' (' + i + ')').toLowerCase())) i++; return h + ' (' + i + ')'; };
  L.forEach((l, ti) => {
    l.t.sheet.headers.forEach((h, c) => {
      if (!h || !h.trim()) return;
      const isKey = l.keyIdx.includes(c);
      if (ti === 0 && isKey) { /* ключи первой таблицы всегда в результате */ }
      else if (isKey) return;
      else if (l.t.fields && !l.t.fields.some(f => f.toLowerCase() === h.toLowerCase())) return;
      let cand = h;
      if (used.has(cand.toLowerCase())) cand = l.t.alias + ' | ' + h;
      cand = uniq(cand);
      used.add(cand.toLowerCase()); headers.push(cand); src.push([ti, c]);
    });
  });
  const res: MergeResult = { headers, rows: [], empty: [], info: L.map(l => l.info), mode };
  if (est > maxRows) { res.tooBig = true; return res; }
  const emit = (k: string, ti: number, combo: number[]) => {
    if (ti === L.length) {
      const row: Cell[] = []; const emp: boolean[] = [];
      src.forEach(([t, c]) => {
        const sr = combo[t]; let v: Cell = null;
        if (sr >= 0) v = L[t].t.sheet.rows[sr][c] ?? null;
        else if (t === 0 && L[0].keyIdx.includes(c)) {
          const pos = L[0].keyIdx.indexOf(c);
          for (let o = 1; o < L.length; o++) if (combo[o] >= 0) { v = L[o].t.sheet.rows[combo[o]][L[o].keyIdx[pos]] ?? null; break; }
        }
        row.push(v); emp.push(sr < 0);
      });
      res.rows.push(row); res.empty.push(emp); return;
    }
    const rows = L[ti].map.get(k);
    if (rows) for (const r of rows) { combo[ti] = r; emit(k, ti + 1, combo); }
    else { combo[ti] = -1; emit(k, ti + 1, combo); }
  };
  for (const k of order) emit(k, 0, new Array(L.length).fill(-1));
  return res;
}
