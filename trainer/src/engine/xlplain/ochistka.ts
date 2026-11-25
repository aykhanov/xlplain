// Очистка данных. Перенос modDataCleaner.RX_CleanerProcessArray из XLPlain 1.1.
import { type Cell, type Sheet, isDate, parseDateText, isNumericText, parseNum, vbStr, numText } from './common';

export interface CleanOptions {
  SPACES: boolean; NBSP: boolean; FIO_CASE: boolean; FIO_INITIALS: boolean; DATES: boolean; NUMBERS: boolean;
  EMPTY_ROWS: boolean; PHONES: boolean; EMAIL: boolean; DUPLICATES: boolean; TYPES: boolean;
  DUP_MODE?: 'Полностью одинаковые строки' | 'По выбранным столбцам'; DUP_FIELDS?: string[];
}
export const OPTION_LABELS: [keyof CleanOptions, string][] = [
  ['SPACES', 'Лишние пробелы'], ['NBSP', 'Неразрывные пробелы'], ['FIO_CASE', 'ФИО: регистр'], ['FIO_INITIALS', 'ФИО: инициалы'],
  ['DATES', 'Даты'], ['NUMBERS', 'Числа из текста'], ['TYPES', 'Типы данных'], ['EMPTY_ROWS', 'Пустые строки'],
  ['PHONES', 'Телефоны'], ['EMAIL', 'Email'], ['DUPLICATES', 'Дубли'],
];
export const STAT_NAMES = ['Проверено строк', 'Ячеек к изменению', 'Лишние пробелы', 'Неразрывные пробелы', 'ФИО: регистр', 'ФИО: инициалы', 'Даты', 'Числа из текста', 'Типы данных', 'Пустых строк к удалению', 'Дубли к удалению', 'Телефоны', 'Email'] as const;
export interface CleanExample { row: number; column: string; action: string; was: string; now: string }
export interface CleanResult {
  stats: Record<string, number>; examples: CleanExample[];
  rows: Cell[][]; changed: Set<string>; deleteRows: number[]; output: Cell[][];
}
const MAX_EXAMPLES = 60;
const TYPE_CONFIDENCE = 0.8, TYPE_MIN_SAMPLES = 3;

const low = (s: string) => s.trim().toLowerCase();
export const isFioHeader = (h: string) => low(h).includes('фио') || low(h).includes('фамилия имя отчество');
export const isEmailHeader = (h: string) => ['email', 'e-mail', 'электронн'].some(x => low(h).includes(x));
export const isPhoneHeader = (h: string) => ['телефон', 'phone', 'моб'].some(x => low(h).includes(x));
export const isDateHeader = (h: string) => ['дата', 'date', 'день рождения'].some(x => low(h).includes(x));
export function isProtectedHeader(h: string) {
  const v = low(h);
  if (v === 'id') return true;
  return ['код', 'артикул', 'инн', 'кпп', 'огрн', 'снилс', 'штрих', 'barcode', 'номер', '№'].some(x => v.includes(x)) || isPhoneHeader(h);
}

export const replaceNbsp = (s: string) => s.replace(/[    ]/g, ' ');
export function collapseSpaces(s: string) { return s.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim(); }
function properToken(tok: string) {
  tok = tok.trim(); if (!tok) return '';
  if (tok.includes('.')) return tok.toUpperCase();
  return tok.split('-').map(p => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '')).join('-');
}
export function properFio(s: string) {
  const n = collapseSpaces(s); if (!n) return '';
  return n.toLowerCase().split(' ').filter(Boolean).map(properToken).join(' ');
}
function initialOf(part: string) {
  const w = part.trim(); if (!w) return '';
  if (w.includes('.')) return w.toUpperCase();
  if (w.includes('-')) return w.split('-').map(p => (p ? p[0].toUpperCase() + '.' : '')).join('-');
  return w[0].toUpperCase() + '.';
}
export function fioToInitials(s: string) {
  const n = properFio(s); if (!n) return '';
  const parts = n.split(' ');
  if (parts.length < 2) return n;
  if (parts.length === 2 && parts[1].includes('.')) return parts[0] + ' ' + parts[1].toUpperCase();
  const ini = parts.slice(1).filter(Boolean).map(initialOf).join('');
  return ini ? parts[0] + ' ' + ini : parts[0];
}
export function normalizePhone(s: string) {
  let w = s.trim(); if (!w) return '';
  const l = w.toLowerCase();
  let ext = l.indexOf('доб'); if (ext < 0) ext = l.indexOf('ext');
  if (ext >= 0) w = w.slice(0, ext);
  const digits = w.replace(/\D/g, '');
  if (!digits) return '';
  const t = w.trim();
  if (t.startsWith('00') && digits.length > 2) return '+' + digits.slice(2);
  if (t.startsWith('+')) return '+' + digits;
  return digits;
}
export function tryDate(s: string): number | null { return parseDateText(s); }
export function tryNumber(s: string): number | null {
  let w = s.trim(); if (!w) return null;
  w = w.replace(/ /g, '').replace(/ /g, '');
  if (w.startsWith("'")) w = w.slice(1);
  if (!w || w.includes('%')) return null;
  let u = w; if (u[0] === '+' || u[0] === '-') u = u.slice(1);
  const cp = u.lastIndexOf(','), dp = u.lastIndexOf('.');
  const sep = cp >= 0 && dp >= 0 ? Math.max(cp, dp) : cp >= 0 ? cp : dp;
  const intPart = sep >= 0 ? u.slice(0, sep) : u;
  if (intPart.length > 1 && intPart[0] === '0') return null;
  let n = w;
  if (cp >= 0 && dp >= 0) n = cp > dp ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  else if (cp >= 0) n = n.replace(',', '.');
  if (!isNumericText(n)) return null;
  const v = parseNum(n);
  return isFinite(v) ? v : null;
}
const cellText = (v: Cell) => (v === null || v === undefined ? '' : vbStr(v).trim());
const preview = (s: string) => (s.length > 120 ? s.slice(0, 117) + '...' : s);
function rowEmpty(r: Cell[], n: number) { for (let c = 0; c < n; c++) if (cellText(r[c] ?? null)) return false; return true; }

function inferTypes(headers: string[], rows: Cell[][]): Map<number, 'DATE' | 'NUMBER'> {
  const res = new Map<number, 'DATE' | 'NUMBER'>();
  headers.forEach((h, c) => {
    if (isProtectedHeader(h) || isFioHeader(h) || isEmailHeader(h) || isPhoneHeader(h)) return;
    if (isDateHeader(h)) { res.set(c, 'DATE'); return; }
    let ne = 0, dc = 0, nc = 0;
    for (const r of rows) {
      const v = r[c] ?? null; const t = cellText(v); if (!t) continue;
      ne++;
      if (typeof v === 'string') { if (tryDate(t) !== null) dc++; else if (tryNumber(t) !== null) nc++; }
      else if (typeof v === 'number') nc++;
    }
    if (ne >= TYPE_MIN_SAMPLES) { if (dc / ne >= TYPE_CONFIDENCE) res.set(c, 'DATE'); else if (nc / ne >= TYPE_CONFIDENCE) res.set(c, 'NUMBER'); }
  });
  return res;
}
function dupCellKey(v: Cell) {
  if (v === null || v === undefined) return 'Z:';
  if (typeof v === 'number') return 'N:' + numText(v);
  if (isDate(v)) return 'N:' + v.d;
  const t = collapseSpaces(replaceNbsp(v)).toLowerCase();
  return 'S:' + t.length + ':' + t;
}

export function clean(sheet: Sheet, opt: CleanOptions): CleanResult {
  const headers = sheet.headers; const n = headers.length;
  const rows = sheet.rows.map(r => headers.map((_, c) => r[c] ?? null));
  const stats: Record<string, number> = Object.fromEntries(STAT_NAMES.map(s => [s, 0]));
  const examples: CleanExample[] = []; const changed = new Set<string>(); const del: number[] = [];
  const reg = (row: number, col: number, action: string, was: string, now: string) => {
    stats[action]++; changed.add(row + '|' + col);
    if (examples.length < MAX_EXAMPLES) examples.push({ row, column: headers[col], action, was: preview(was), now: preview(now) });
  };
  const types = opt.TYPES ? inferTypes(headers, rows) : new Map();
  rows.forEach((r, ri) => {
    const sheetRow = ri + 2; stats['Проверено строк']++;
    for (let c = 0; c < n; c++) {
      const h = (headers[c] || '').trim();
      const fio = isFioHeader(h), email = isEmailHeader(h), phone = isPhoneHeader(h), date = isDateHeader(h), prot = isProtectedHeader(h);
      const inferred = types.get(c) || '';
      let v: Cell = r[c];
      if (typeof v === 'string') {
        const step = (on: boolean, fn: (s: string) => string, action: string, keepEmpty = true) => {
          if (!on || typeof v !== 'string') return;
          const b = v; const a = fn(b);
          if (!keepEmpty && !a) return;
          if (a !== b) { v = a; reg(sheetRow, c, action, b, a); }
        };
        step(opt.NBSP, replaceNbsp, 'Неразрывные пробелы');
        step(opt.SPACES, collapseSpaces, 'Лишние пробелы');
        step(fio && opt.FIO_CASE, properFio, 'ФИО: регистр');
        step(fio && opt.FIO_INITIALS, fioToInitials, 'ФИО: инициалы');
        step(email && opt.EMAIL, s => s.trim().toLowerCase(), 'Email');
        step(phone && opt.PHONES, normalizePhone, 'Телефоны', false);
      }
      if (typeof v === 'string' && date && opt.DATES) {
        const b = v; const d = tryDate(b);
        if (d !== null) { v = { d }; reg(sheetRow, c, 'Даты', b, vbStr(v)); }
      }
      if (typeof v === 'string' && opt.TYPES && !prot && !fio && !email && !phone) {
        const b = v;
        if (inferred === 'DATE') { const d = tryDate(b); if (d !== null) { v = { d }; reg(sheetRow, c, 'Типы данных', b, vbStr(v)); } }
        else if (inferred === 'NUMBER') { const x = tryNumber(b); if (x !== null) { v = x; reg(sheetRow, c, 'Типы данных', b, numText(x)); } }
      }
      if (typeof v === 'string' && opt.NUMBERS && !prot && !fio && !email && !phone && !date) {
        const b = v; const x = tryNumber(b);
        if (x !== null) { v = x; reg(sheetRow, c, 'Числа из текста', b, numText(x)); }
      }
      r[c] = v;
    }
    if (opt.EMPTY_ROWS && rowEmpty(r, n) && !del.includes(sheetRow)) { del.push(sheetRow); stats['Пустых строк к удалению']++; }
  });
  if (opt.DUPLICATES) {
    const byFields = opt.DUP_MODE === 'По выбранным столбцам';
    const cols = byFields ? (opt.DUP_FIELDS || []).map(f => headers.findIndex(h => low(h) === low(f))).filter(i => i >= 0) : headers.map((_, i) => i);
    if (cols.length) {
      const seen = new Map<string, number>();
      const colsText = byFields ? (opt.DUP_FIELDS || []).join('; ') : 'Вся строка';
      rows.forEach((r, ri) => {
        if (rowEmpty(r, n)) return;
        const sheetRow = ri + 2;
        const k = cols.map(c => { const p = dupCellKey(r[c]); return p.length + ':' + p + '|'; }).join('');
        if (seen.has(k)) {
          if (!del.includes(sheetRow)) {
            del.push(sheetRow); stats['Дубли к удалению']++;
            if (examples.length < MAX_EXAMPLES) examples.push({ row: sheetRow, column: colsText, action: 'Дубликат', was: 'Совпадает со строкой ' + seen.get(k), now: 'Строка будет удалена' });
          }
        } else seen.set(k, sheetRow);
      });
    }
  }
  stats['Ячеек к изменению'] = changed.size;
  const output = rows.filter((_, i) => !del.includes(i + 2));
  return { stats, examples, rows, changed, deleteRows: del.sort((a, b) => a - b), output };
}
