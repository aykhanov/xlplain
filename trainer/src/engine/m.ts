// @ts-nocheck
/* Подмножество языка M для «Настраиваемого столбца» и «Условного столбца»:
   литералы, [Поля], операторы, if/then/else, and/or/not, функции Text.*, Number.*, Date.*. */

export type MVal = number | string | boolean | null | { date: number } | { err: string } | MVal[];
export class MError extends Error { pos?: number; constructor(m: string, pos?: number) { super(m); this.pos = pos; } }
const fail = (m: string, p?: number): never => { throw new MError(m, p); };
const isDate = (v: any): v is { date: number } => v && typeof v === 'object' && 'date' in v;
const isErrV = (v: any): v is { err: string } => v && typeof v === 'object' && 'err' in v;
const ser = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
const ymd = (s: number) => { const d = new Date((s - 25569) * 864e5); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const tname = (v: any) => v === null ? 'Null' : typeof v === 'number' ? 'Number' : typeof v === 'string' ? 'Text' : typeof v === 'boolean' ? 'Logical' : isDate(v) ? 'Date' : Array.isArray(v) ? 'List' : 'Value';

/* ───── разбор ───── */
type Tok = { k: string; v: any; p: number };
function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    const p = i;
    if (c === '"') { let s = ''; i++; for (;;) { if (i >= src.length) fail('Текст не закрыт: не хватает кавычки «"».', p); if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; } s += src[i++]; } out.push({ k: 'str', v: s, p }); continue; }
    if (c === '[') { const e = src.indexOf(']', i); if (e < 0) fail('Не хватает закрывающей скобки «]».', p); let n = src.slice(i + 1, e).trim(); const q = /^#"(.*)"$/.exec(n); if (q) n = q[1].replace(/""/g, '"'); out.push({ k: 'field', v: n, p }); i = e + 1; continue; }
    if (/[0-9]/.test(c)) { const m = /^\d+(\.\d+)?/.exec(src.slice(i)); out.push({ k: 'num', v: Number(m[0]), p }); i += m[0].length; if (src[i] === ',' && /\d/.test(src[i + 1] || '')) fail('В M дробная часть пишется через точку: 0.5, а не 0,5.', i); continue; }
    if (c === '#') { const m = /^#date\b/.exec(src.slice(i)); if (m) { out.push({ k: 'id', v: '#date', p }); i += 5; continue; } if (src.startsWith('#"', i)) fail('Имя столбца с пробелами пишется в квадратных скобках: [Имя столбца].', p); fail('Неожиданный символ «#».', p); }
    if (/[A-Za-zА-Яа-яЁё_]/.test(c)) { const m = /^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*(\.[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)*/.exec(src.slice(i)); out.push({ k: 'id', v: m[0], p }); i += m[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['<>', '<=', '>=', '=>'].includes(two)) { out.push({ k: 'op', v: two, p }); i += 2; continue; }
    if ('+-*/&=<>(),{}'.includes(c)) { out.push({ k: 'op', v: c, p }); i++; continue; }
    if (c === ';') fail('В M аргументы функций разделяются запятой, а не точкой с запятой.', p);
    fail(`Неожиданный символ «${c}».`, p);
  }
  out.push({ k: 'eof', v: '', p: src.length });
  return out;
}
export function parseM(src: string): any {
  const t = lex(src); let i = 0;
  const pk = () => t[i], nx = () => t[i++];
  const isOp = (v: string) => pk().k === 'op' && pk().v === v;
  const isKw = (v: string) => pk().k === 'id' && pk().v === v;
  const show = (x: Tok) => x.k === 'eof' ? 'конец формулы' : x.k === 'str' ? `"${x.v}"` : x.k === 'field' ? `[${x.v}]` : String(x.v);
  const exp = (v: string) => { if (!isOp(v)) fail(`Ожидалось «${v}», а найдено «${show(pk())}».`, pk().p); nx(); };
  function expr(): any {
    if (isKw('each')) { nx(); return expr(); }
    if (isKw('if')) {
      const p = nx().p; const c = expr();
      if (!isKw('then')) fail(`После условия if нужно then, а найдено «${show(pk())}».`, pk().p); nx();
      const a = expr();
      if (!isKw('else')) fail('В M у if обязательно есть else: if … then … else ….', pk().p); nx();
      return { t: 'if', c, a, b: expr(), p };
    }
    return or();
  }
  const bin = (next, ops, kw = false) => () => { let a = next(); for (;;) { const k = pk(); if ((kw ? k.k === 'id' : k.k === 'op') && ops.includes(k.v)) { nx(); a = { t: 'bin', op: k.v, a, b: next(), p: k.p }; } else return a; } };
  const unary = () => { if (isKw('not')) { const p = nx().p; return { t: 'un', op: 'not', a: unary(), p }; } return cmp(); };
  const prim = () => {
    const k = pk();
    if (isOp('-')) { nx(); return { t: 'un', op: '-', a: prim(), p: k.p }; }
    if (k.k === 'num') { nx(); return { t: 'lit', v: k.v }; }
    if (k.k === 'str') { nx(); return { t: 'lit', v: k.v }; }
    if (k.k === 'field') { nx(); return { t: 'field', n: k.v, p: k.p }; }
    if (isOp('(')) { nx(); const e = expr(); exp(')'); return e; }
    if (isOp('{')) { nx(); const items = []; if (!isOp('}')) for (;;) { items.push(expr()); if (isOp(',')) { nx(); continue; } break; } exp('}'); return { t: 'list', items }; }
    if (k.k === 'id') {
      nx();
      if (k.v === 'null') return { t: 'lit', v: null };
      if (k.v === 'true') return { t: 'lit', v: true };
      if (k.v === 'false') return { t: 'lit', v: false };
      if (k.v === '_') return { t: 'self', p: k.p };
      if (/^RoundingMode\.(AwayFromZero|ToEven|Up|Down|TowardZero)$/.test(k.v)) return { t: 'lit', v: k.v };
      if (isOp('(')) { nx(); const args = []; if (!isOp(')')) for (;;) { args.push(expr()); if (isOp(',')) { nx(); continue; } break; } exp(')'); return { t: 'call', f: k.v, args, p: k.p }; }
      if (['then', 'else', 'and', 'or'].includes(k.v)) fail(`Неверный синтаксис рядом с «${k.v}».`, k.p);
      fail(`Не удалось распознать «${k.v}». Имя столбца пишется в квадратных скобках: [${k.v}]. Функции пишутся с большой буквы: Text.Upper(…).`, k.p);
    }
    if (k.k === 'eof') fail('Формула оборвалась: не хватает значения или скобки.', k.p);
    return fail(`Неверный синтаксис рядом с «${show(k)}».`, k.p);
  };
  const mul = bin(prim, ['*', '/']), add = bin(mul, ['+', '-']), cat = bin(add, ['&']);
  const cmp = bin(cat, ['=', '<>', '<', '>', '<=', '>=']);
  const and = bin(unary, ['and'], true), or = bin(and, ['or'], true);
  const e = expr();
  if (pk().k !== 'eof') fail(`Неверный синтаксис рядом с «${show(pk())}».`, pk().p);
  return e;
}

/* ───── вычисление ───── */
const num = (v, f) => typeof v === 'number' ? v : fail(`Expression.Error: ${f} ожидает число, а получено значение типа ${tname(v)}.`);
const txt = (v, f) => typeof v === 'string' ? v : fail(`Expression.Error: ${f} ожидает текст, а получено значение типа ${tname(v)}. Используйте Text.From.`);
const dte = (v, f) => isDate(v) ? v.date : fail(`Expression.Error: ${f} ожидает дату, а получено значение типа ${tname(v)}. Задайте столбцу тип «Дата».`);
const nn = (f: Function) => (...a) => a[0] === null ? null : f(...a);
const FN: Record<string, Function> = {
  'Text.Upper': nn(v => txt(v, 'Text.Upper').toUpperCase()),
  'Text.Lower': nn(v => txt(v, 'Text.Lower').toLowerCase()),
  'Text.Proper': nn(v => txt(v, 'Text.Proper').toLowerCase().replace(/(^|[^A-Za-zА-Яа-яЁё0-9])([A-Za-zА-Яа-яЁё])/g, (_, a, b) => a + b.toUpperCase())),
  'Text.Trim': nn(v => txt(v, 'Text.Trim').trim()),
  'Text.Clean': nn(v => txt(v, 'Text.Clean').replace(/[\x00-\x1f\x7f]/g, '')),
  'Text.Length': nn(v => txt(v, 'Text.Length').length),
  'Text.Start': nn((v, n) => txt(v, 'Text.Start').slice(0, num(n, 'Text.Start'))),
  'Text.End': nn((v, n) => { const s = txt(v, 'Text.End'); const k = num(n, 'Text.End'); return k ? s.slice(-k) : ''; }),
  'Text.Middle': nn((v, s, n) => txt(v, 'Text.Middle').substr(num(s, 'Text.Middle'), n === undefined || n === null ? undefined : num(n, 'Text.Middle'))),
  'Text.Range': nn((v, s, n) => txt(v, 'Text.Range').substr(num(s, 'Text.Range'), n === undefined || n === null ? undefined : num(n, 'Text.Range'))),
  'Text.Contains': nn((v, s) => txt(v, 'Text.Contains').includes(txt(s, 'Text.Contains'))),
  'Text.StartsWith': nn((v, s) => txt(v, 'Text.StartsWith').startsWith(txt(s, 'Text.StartsWith'))),
  'Text.EndsWith': nn((v, s) => txt(v, 'Text.EndsWith').endsWith(txt(s, 'Text.EndsWith'))),
  'Text.Replace': nn((v, a, b) => txt(v, 'Text.Replace').split(txt(a, 'Text.Replace')).join(txt(b, 'Text.Replace'))),
  'Text.BeforeDelimiter': nn((v, d) => { const s = txt(v, 'Text.BeforeDelimiter'); const k = s.indexOf(txt(d, 'Text.BeforeDelimiter')); return k < 0 ? s : s.slice(0, k); }),
  'Text.AfterDelimiter': nn((v, d) => { const s = txt(v, 'Text.AfterDelimiter'); const dd = txt(d, 'Text.AfterDelimiter'); const k = s.indexOf(dd); return k < 0 ? '' : s.slice(k + dd.length); }),
  'Text.BetweenDelimiters': nn((v, a, b) => { const s = txt(v, 'Text.BetweenDelimiters'); const x = s.indexOf(txt(a, 'Text.BetweenDelimiters')); if (x < 0) return ''; const r = s.slice(x + a.length); const y = r.indexOf(txt(b, 'Text.BetweenDelimiters')); return y < 0 ? r : r.slice(0, y); }),
  'Text.PadStart': nn((v, n, c = ' ') => txt(v, 'Text.PadStart').padStart(num(n, 'Text.PadStart'), c)),
  'Text.From': v => v === null ? null : typeof v === 'number' ? String(v).replace('.', ',') : isDate(v) ? (() => { const [y, m, d] = ymd(v.date); return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`; })() : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v,
  'Text.Combine': (l, sep = '') => (Array.isArray(l) ? l : fail('Expression.Error: Text.Combine ожидает список в фигурных скобках: Text.Combine({[Фамилия], [Имя]}, " ").')).filter(x => x !== null).map(x => txt(x, 'Text.Combine')).join(sep ?? ''),
  'Number.Round': nn((v, d = 0, mode = 'RoundingMode.ToEven') => { const f = Math.pow(10, num(d ?? 0, 'Number.Round')); const x = num(v, 'Number.Round') * f; const ax = Math.abs(x), fl = Math.floor(ax + 1e-9), half = Math.abs(ax - fl - 0.5) < 1e-9; let r = half ? (mode === 'RoundingMode.AwayFromZero' || mode === 'RoundingMode.Up' && x > 0 ? fl + 1 : mode === 'RoundingMode.ToEven' ? (fl % 2 ? fl + 1 : fl) : fl) : Math.round(ax); return Math.sign(x) * r / f; }),
  'Number.RoundUp': nn((v, d = 0) => { const f = Math.pow(10, d ?? 0); return Math.ceil(num(v, 'Number.RoundUp') * f - 1e-9) / f; }),
  'Number.RoundDown': nn((v, d = 0) => { const f = Math.pow(10, d ?? 0); return Math.floor(num(v, 'Number.RoundDown') * f + 1e-9) / f; }),
  'Number.Abs': nn(v => Math.abs(num(v, 'Number.Abs'))),
  'Number.Mod': nn((v, d) => { const a = num(v, 'Number.Mod'), b = num(d, 'Number.Mod'); return a - b * Math.trunc(a / b); }),
  'Number.IntegerDivide': nn((v, d) => Math.trunc(num(v, 'Number.IntegerDivide') / num(d, 'Number.IntegerDivide'))),
  'Number.From': v => v === null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : isDate(v) ? v.date : (() => { const s = String(v).replace(/[\s ]/g, '').replace(',', '.'); if (!/^[-+]?\d+(\.\d+)?$/.test(s)) fail(`DataFormat.Error: Не удалось преобразовать в тип Number. Подробности: ${v}`); return Number(s); })(),
  'Date.Year': nn(v => ymd(dte(v, 'Date.Year'))[0]),
  'Date.Month': nn(v => ymd(dte(v, 'Date.Month'))[1]),
  'Date.Day': nn(v => ymd(dte(v, 'Date.Day'))[2]),
  'Date.QuarterOfYear': nn(v => Math.ceil(ymd(dte(v, 'Date.QuarterOfYear'))[1] / 3)),
  'Date.MonthName': nn(v => MONTHS[ymd(dte(v, 'Date.MonthName'))[1] - 1]),
  'Date.StartOfMonth': nn(v => { const [y, m] = ymd(dte(v, 'Date.StartOfMonth')); return { date: ser(y, m, 1) }; }),
  'Date.EndOfMonth': nn(v => { const [y, m] = ymd(dte(v, 'Date.EndOfMonth')); return { date: ser(y, m, dim(y, m)) }; }),
  'Date.AddDays': nn((v, n) => ({ date: dte(v, 'Date.AddDays') + num(n, 'Date.AddDays') })),
  'Date.AddMonths': nn((v, n) => { const [y, m, d] = ymd(dte(v, 'Date.AddMonths')); const k = m - 1 + num(n, 'Date.AddMonths'); const ny = y + Math.floor(k / 12), nm = ((k % 12) + 12) % 12 + 1; return { date: ser(ny, nm, Math.min(d, dim(ny, nm))) }; }),
  'Date.From': v => { if (v === null) return null; if (isDate(v)) return v; if (typeof v === 'number') return { date: Math.floor(v) }; const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v).trim()) || null; if (m) return { date: ser(+m[3], +m[2], +m[1]) }; const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim()); if (m2) return { date: ser(+m2[1], +m2[2], +m2[3]) }; return fail(`DataFormat.Error: Не удалось выполнить синтаксический анализ значения как Date. Подробности: ${v}`); },
};
FN['#date'] = (y, m, d) => ({ date: ser(num(y, '#date'), num(m, '#date'), num(d, '#date')) });
export const M_FUNCTIONS = Object.keys(FN).filter(f => f !== '#date').sort();

function eq(a, b) {
  if (a === null || b === null) return a === b;
  if (isDate(a) && isDate(b)) return a.date === b.date;
  if (typeof a !== typeof b) return false;
  return a === b;
}
function order(a, b, op) {
  if (a === null || b === null) return null;
  const x = isDate(a) ? a.date : a, y = isDate(b) ? b.date : b;
  if (typeof x !== typeof y || isDate(a) !== isDate(b)) fail(`Expression.Error: Не удается применить оператор ${op} к типам ${tname(a)} и ${tname(b)}.`);
  const c = typeof x === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
  return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
}
const logic = (v, op) => v === null ? null : typeof v === 'boolean' ? v : fail(`Expression.Error: Не удается преобразовать значение типа ${tname(v)} в тип Logical (оператор ${op}).`);
export function evalM(n: any, row: (name: string) => MVal, self?: MVal): MVal {
  const ev = (x: any) => evalM(x, row, self);
  switch (n.t) {
    case 'lit': return n.v;
    case 'field': return row(n.n);
    case 'self': return self === undefined ? fail('Символ «_» здесь не определён.') : self;
    case 'list': return n.items.map(ev);
    case 'if': { const c = ev(n.c); if (c === null) fail('Expression.Error: Условие if вернуло null. Проверьте пустые значения в столбце.'); if (typeof c !== 'boolean') fail(`Expression.Error: Условие if должно давать true или false, а получено ${tname(c)}.`); return c ? ev(n.a) : ev(n.b); }
    case 'un': { const v = ev(n.a); if (n.op === 'not') { const l = logic(v, 'not'); return l === null ? null : !l; } if (v === null) return null; return -num(v, 'Оператор −'); }
    case 'call': {
      const f = FN[n.f];
      if (!f) { const near = Object.keys(FN).find(k => k.toLowerCase() === n.f.toLowerCase()); fail(near ? `Имя «${n.f}» не распознано. В M важен регистр букв: ${near}.` : `Функция «${n.f}» не найдена или пока не поддерживается в тренажёре.`, n.p); }
      return f(...n.args.map(ev));
    }
    case 'bin': {
      const op = n.op;
      if (op === 'and') { const a = logic(ev(n.a), 'and'); if (a === false) return false; const b = logic(ev(n.b), 'and'); return a === null || b === null ? (b === false ? false : null) : b; }
      if (op === 'or') { const a = logic(ev(n.a), 'or'); if (a === true) return true; const b = logic(ev(n.b), 'or'); return a === null || b === null ? (b === true ? true : null) : b; }
      const a = ev(n.a), b = ev(n.b);
      if (op === '=') return eq(a, b);
      if (op === '<>') return !eq(a, b);
      if (['<', '>', '<=', '>='].includes(op)) return order(a, b, op);
      if (op === '&') { if (a === null || b === null) return null; if (typeof a === 'string' && typeof b === 'string') return a + b; if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]; fail(`Expression.Error: Не удается применить оператор & к типам ${tname(a)} и ${tname(b)}. Числа превращайте в текст через Text.From.`); }
      if (a === null || b === null) return null;
      if (typeof a !== 'number' || typeof b !== 'number') fail(`Expression.Error: Не удается применить оператор ${op} к типам ${tname(a)} и ${tname(b)}.${typeof a === 'string' || typeof b === 'string' ? ' Похоже, у столбца текстовый тип — задайте ему числовой.' : ''}`);
      if (op === '+') return a + b; if (op === '-') return a - b; if (op === '*') return a * b;
      if (op === '/') return b === 0 ? (a === 0 ? NaN : a > 0 ? Infinity : -Infinity) : a / b;
    }
  }
  return fail('Не удалось вычислить выражение.');
}
export { isDate, isErrV };
