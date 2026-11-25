// Сверка двух таблиц. Перенос modReconcileX.RX_RunConfiguredComparisonV15 из XLPlain 1.1.
import { type Cell, type Sheet, normWs, isNumericText, parseNum, isDate, parseDateText, vbStr, display, findCol, headerIndex } from './common';

export const STATUS = { MATCH: 'БЕЗ ИЗМЕНЕНИЙ', CHANGED: 'ИЗМЕНЕНО', NEW: 'ДОБАВЛЕНО', REMOVED: 'УДАЛЕНО' } as const;
export type Status = typeof STATUS[keyof typeof STATUS];
export type CmpMode = 'УМНОЕ' | 'СТРОГОЕ';
export type ReportMode = 'ПОЛНЫЙ' | 'ТОЛЬКО РАЗЛИЧИЯ';

export interface SverkaOptions {
  oldKeys: string[]; newKeys: string[];
  pairs: { old: string; new: string }[];
  mode: CmpMode; report: ReportMode; tolerance?: number;
}
export interface SverkaRow { status: Status; key: string; field: string; was: Cell; now: Cell; oldRow: number | null; newRow: number | null }
export interface KeyStats { rows: number; withKey: number; unique: number; dupGroups: number; repeated: number; blank: number }
export interface SverkaResult {
  rows: SverkaRow[]; match: number; changed: number; added: number; removed: number;
  oldStats: KeyStats; newStats: KeyStats; duplicateKeys: boolean;
}

/** NormalizeKey: trim и неразрывные пробелы; регистр учитывается. */
function normKey(v: Cell): string {
  if (v === null || v === undefined) return '';
  return vbStr(v).replace(/ /g, ' ').trim();
}
function rowKey(r: Cell[], cols: number[]): string {
  let has = false;
  const parts = cols.map(c => { const p = normKey(r[c] ?? null); if (p) has = true; return p; });
  return has ? parts.join('\u001f') : '';
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
function tryDate(v: Cell): number | null {
  if (isDate(v)) return v.d;
  if (typeof v === 'string') { const d = parseDateText(v); if (d !== null) return d; }
  const n = tryNumber(v);
  if (n !== null && n >= 1 && n <= 2958465) return n;
  return null;
}
const blankLike = (v: Cell) => v === null || v === undefined || normWs(vbStr(v)) === '';

/** ValuesEqual из надстройки. */
export function valuesEqual(a: Cell, b: Cell, mode: CmpMode, tol = 0): boolean {
  if (mode === 'СТРОГОЕ') return vbStr(a) === vbStr(b);
  if (blankLike(a) && blankLike(b)) return true;
  const na = tryNumber(a), nb = tryNumber(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) <= Math.abs(tol) + 1e-10;
  const da = tryDate(a), db = tryDate(b);
  if (da !== null && db !== null) return Math.abs(da - db) < 1e-10;
  return normWs(vbStr(a)).toLowerCase() === normWs(vbStr(b)).toLowerCase();
}

function keyStats(rows: Cell[][], cols: number[]): KeyStats {
  const counts = new Map<string, number>(); let blank = 0;
  for (const r of rows) { const k = rowKey(r, cols); if (!k) blank++; else counts.set(k, (counts.get(k) || 0) + 1); }
  let dupGroups = 0, repeated = 0;
  counts.forEach(n => { if (n > 1) { dupGroups++; repeated += n - 1; } });
  return { rows: rows.length, withKey: rows.length - blank, unique: counts.size, dupGroups, repeated, blank };
}
function lastRow(rows: Cell[][], cols: number[]) {
  let last = -1;
  rows.forEach((r, i) => { if (cols.some(c => !blankLike(r[c] ?? null))) last = i; });
  return rows.slice(0, last + 1);
}
function occurrence(map: Map<string, number>, k: string) { const n = (map.get(k) || 0) + 1; map.set(k, n); return k + '\u001e' + n; }

/** Поля, общие для двух таблиц (кроме ключевых), — как BuildCommonCompareHeaders. */
export function commonFields(a: Sheet, b: Sheet, aKeys: string[], bKeys: string[]): string[] {
  const bi = headerIndex(b); const ak = new Set(aKeys.map(k => k.toLowerCase())); const bk = new Set(bKeys.map(k => k.toLowerCase()));
  return a.headers.filter(h => h && bi.has(h.trim().toLowerCase()) && !ak.has(h.trim().toLowerCase()) && !bk.has(h.trim().toLowerCase()));
}

export function reconcile(oldS: Sheet, newS: Sheet, opt: SverkaOptions): SverkaResult {
  if (!opt.oldKeys.length) throw new Error('Выберите ключевое поле или несколько полей составного ключа.');
  if (opt.oldKeys.length !== opt.newKeys.length) throw new Error('Для составного ключа нужно выбрать одинаковое количество полей в старом и новом файле.');
  if (!opt.pairs.length) throw new Error('Не найдено общих полей для сравнения.');
  const mode = opt.mode, tol = opt.tolerance || 0;
  const ok = opt.oldKeys.map(k => findCol(oldS, k)), nk = opt.newKeys.map(k => findCol(newS, k));
  const oc = opt.pairs.map(p => findCol(oldS, p.old)), nc = opt.pairs.map(p => findCol(newS, p.new));
  const oldRows = lastRow(oldS.rows, ok), newRows = lastRow(newS.rows, nk);
  const oldStats = keyStats(oldRows, ok), newStats = keyStats(newRows, nk);
  const dups = oldStats.repeated > 0 || newStats.repeated > 0;

  const index = (rows: Cell[][], cols: number[]) => {
    const m = new Map<string, number>(); const occ = new Map<string, number>();
    rows.forEach((r, i) => { let k = rowKey(r, cols); if (!k) return; if (dups) k = occurrence(occ, k); if (!m.has(k)) m.set(k, i); });
    return m;
  };
  const oldIdx = index(oldRows, ok), newIdx = index(newRows, nk);
  const res: SverkaResult = { rows: [], match: 0, changed: 0, added: 0, removed: 0, oldStats, newStats, duplicateKeys: dups };
  const dispKey = (r: Cell[], cols: number[]) => cols.map(c => display(r[c] ?? null)).join(' | ');

  const occOld = new Map<string, number>();
  oldRows.forEach((r, i) => {
    let k = rowKey(r, ok); if (!k) return;
    if (dups) k = occurrence(occOld, k);
    const key = dispKey(r, ok);
    const j = newIdx.get(k);
    if (j !== undefined) {
      const nr = newRows[j]; let changed = false;
      opt.pairs.forEach((p, f) => {
        const a = r[oc[f]] ?? null, b = nr[nc[f]] ?? null;
        if (!valuesEqual(a, b, mode, tol)) {
          const field = p.old.toLowerCase() === p.new.toLowerCase() ? p.old : p.old + ' -> ' + p.new;
          res.rows.push({ status: STATUS.CHANGED, key, field, was: a, now: b, oldRow: i + 2, newRow: j + 2 });
          changed = true;
        }
      });
      if (changed) res.changed++;
      else { res.match++; if (opt.report === 'ПОЛНЫЙ') res.rows.push({ status: STATUS.MATCH, key, field: '', was: null, now: null, oldRow: i + 2, newRow: j + 2 }); }
    } else {
      res.rows.push({ status: STATUS.REMOVED, key, field: '', was: null, now: null, oldRow: i + 2, newRow: null });
      res.removed++;
    }
  });
  const occNew = new Map<string, number>();
  newRows.forEach((r, j) => {
    let k = rowKey(r, nk); if (!k) return;
    if (dups) k = occurrence(occNew, k);
    if (!oldIdx.has(k)) { res.rows.push({ status: STATUS.NEW, key: dispKey(r, nk), field: '', was: null, now: null, oldRow: null, newRow: j + 2 }); res.added++; }
  });
  return res;
}
