// Общие функции для браузерной версии инструментов XLPlain.
// Перенесены из VBA-надстройки XLPlain 1.1 (modReconcileX, modDuplicates, modDataCleaner, modSmartMergeEngine).

/** Значение ячейки: текст, число, дата (серийный номер Excel) или пусто. */
export type XDate = { d: number };
export type Cell = string | number | XDate | null;
export interface Sheet { name: string; headers: string[]; rows: Cell[][] }

export const isDate = (v: Cell): v is XDate => !!v && typeof v === 'object' && 'd' in v;
export const isEmpty = (v: Cell) => v === null || v === undefined || v === '';

// Excel: серийный номер 1 = 01.01.1900, с ошибкой 1900 года; для дат после 01.03.1900 базой служит 30.12.1899.
const EPOCH = Date.UTC(1899, 11, 30);
export function dmyToSerial(d: number, m: number, y: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return null;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1) return null;
  return Math.round((t - EPOCH) / 86400000);
}
export function serialToDmy(serial: number): string {
  const dt = new Date(EPOCH + Math.floor(serial) * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return p(dt.getUTCDate()) + '.' + p(dt.getUTCMonth() + 1) + '.' + dt.getUTCFullYear();
}

/** Число в русской записи, как CStr в русском Excel: 1250,5 */
export function numText(n: number): string {
  if (!isFinite(n)) return String(n);
  let s = String(Number(n.toPrecision(15)));
  if (/e/i.test(s)) s = n.toLocaleString('ru-RU', { useGrouping: false, maximumFractionDigits: 15 });
  return s.replace('.', ',');
}
/** CStr(value) для русской локали. */
export function vbStr(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numText(v);
  if (isDate(v)) return serialToDmy(v.d);
  return String(v);
}
/** Текст для показа в ячейке. */
export function display(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numText(v); // общий формат Excel: без разделителей разрядов
  if (isDate(v)) return serialToDmy(v.d);
  return String(v);
}

/** NormalizeWhitespace из надстройки: неразрывные пробелы, табы и переводы строк → пробел, trim, без двойных пробелов. */
export function normWs(s: string): string {
  return s.replace(/[ \t\r\n]/g, ' ').trim().replace(/ {2,}/g, ' ');
}

/** Приближение VBA IsNumeric для русской локали. */
export function isNumericText(s: string): boolean {
  const t = s.trim();
  return /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(t);
}
export const parseNum = (s: string) => Number(s.trim().replace(',', '.'));

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};
/** Приближение VBA IsDate/CDate для русской локали: 01.02.1985, 1.2.85, 01/02/1985, 1985-02-01, 15 марта 1990. */
export function parseDateText(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const yy = (y: string) => (y.length <= 2 ? (+y < 30 ? 2000 + +y : 1900 + +y) : +y);
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/);
  if (m) return dmyToSerial(+m[1], +m[2], yy(m[3]));
  m = t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/);
  if (m) return dmyToSerial(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})\s+([а-яё]+)\.?\s+(\d{2}|\d{4})(\s*г\.?)?$/);
  if (m) {
    const key = Object.keys(MONTHS).find(k => m![2].startsWith(k));
    if (key) return dmyToSerial(+m[1], MONTHS[key], yy(m[3]));
  }
  return null;
}

/** Строка из файла: аккуратно приводит значение к Cell. */
export function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
  if (v instanceof Date) {
    const s = dmyToSerial(v.getDate(), v.getMonth() + 1, v.getFullYear());
    return s === null ? null : { d: s };
  }
  if (typeof v === 'object' && v && 'd' in (v as any)) return v as XDate;
  const s = String(v);
  return s === '' ? null : s;
}

/** Ввод в ячейку как в Excel: чистое число становится числом, остальное — текстом. */
export function fromInput(text: string, prev: Cell): Cell {
  if (text === '') return null;
  if (isDate(prev)) { const d = parseDateText(text); if (d !== null) return { d }; }
  if (/^-?(0|[1-9]\d*)(,\d+)?$/.test(text)) return parseNum(text);
  return text;
}

export function headerIndex(sheet: Sheet): Map<string, number> {
  const m = new Map<string, number>();
  sheet.headers.forEach((h, i) => { const k = (h || '').trim().toLowerCase(); if (k && !m.has(k)) m.set(k, i); });
  return m;
}
export function findCol(sheet: Sheet, name: string): number {
  const i = headerIndex(sheet).get(name.trim().toLowerCase());
  if (i === undefined) throw new Error('Не найдено поле «' + name + '».');
  return i;
}
export const cleanHeaders = (sheet: Sheet) => sheet.headers.map(h => (h || '').trim()).filter(Boolean);
