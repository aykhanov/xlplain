// @ts-nocheck
// Движок формул в синтаксисе русского Excel (перенесён из тренажёра v1 без изменений логики).
export const XL = (() => {
  class XErr { constructor(code) { this.code = code; } }
  class ParseErr { constructor(msg) { this.msg = msg; } }
  const CYR = { 'А':'A','В':'B','С':'C','Е':'E','Н':'H','К':'K','М':'M','О':'O','Р':'P','Т':'T','Х':'X' };
  const L = 'A-Za-zА-Яа-яЁё';

  function colIdx(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function addr(c, r) { return colName(c) + (r + 1); }

  function tokenize(s) {
    const t = []; let i = 0; let m;
    const reNum = /^\d+(?:[.,]\d+)?/;
    const reRef = new RegExp('^\\$?([' + L + ']{1,3})\\$?(\\d+)(?![' + L + '(\\d])');
    const reName = new RegExp('^[' + L + '_][' + L + '_.\\d]*');
    while (i < s.length) {
      const c = s[i], rest = s.slice(i);
      if (/\s/.test(c)) { i++; continue; }
      if ((m = rest.match(reNum))) { t.push({ type: 'num', v: parseFloat(m[0].replace(',', '.')), pos: i, len: m[0].length }); i += m[0].length; continue; }
      if (c === '"') {
        let j = i + 1, str = '';
        for (;;) {
          if (j >= s.length) throw new ParseErr('Не закрыта кавычка — текст в формуле пишется "в кавычках"');
          if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; }
          str += s[j++];
        }
        t.push({ type: 'str', v: str, pos: i, len: j + 1 - i }); i = j + 1; continue;
      }
      if ((m = rest.match(reRef))) {
        let lat = '', ok = true;
        for (const ch of m[1].toUpperCase()) { if (/[A-Z]/.test(ch)) lat += ch; else if (CYR[ch]) lat += CYR[ch]; else { ok = false; break; } }
        if (ok) { t.push({ type: 'ref', col: colIdx(lat), row: +m[2] - 1, pos: i, len: m[0].length }); i += m[0].length; continue; }
      }
      if ((m = rest.match(reName))) { t.push({ type: 'name', v: m[0].toUpperCase().replace(/Ё/g, 'Е'), raw: m[0], pos: i, len: m[0].length }); i += m[0].length; continue; }
      if ((m = rest.match(/^(<=|>=|<>)/))) { t.push({ type: 'op', v: m[0], pos: i, len: 2 }); i += 2; continue; }
      if ('+-*/^&=<>%'.includes(c)) { t.push({ type: 'op', v: c, pos: i, len: 1 }); i++; continue; }
      if (c === '(' || c === ')' || c === ':') { t.push({ type: c, pos: i, len: 1 }); i++; continue; }
      if (c === ';' || c === ',') { t.push({ type: 'sep', pos: i, len: 1 }); i++; continue; }
      throw new ParseErr('Непонятный символ «' + c + '»');
    }
    return t;
  }

  const BOOLS = { 'ИСТИНА': true, 'TRUE': true, 'ЛОЖЬ': false, 'FALSE': false };

  function parse(src) {
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p];
    const isOp = (...ops) => peek() && peek().type === 'op' && ops.includes(peek().v);
    const expect = (type, msg) => { if (!peek() || peek().type !== type) throw new ParseErr(msg); return toks[p++]; };
    function expr() { return compare(); }
    function compare() { let a = concat(); while (isOp('=', '<>', '<', '>', '<=', '>=')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: concat() }; } return a; }
    function concat() { let a = add(); while (isOp('&')) { p++; a = { k: 'bin', op: '&', a, b: add() }; } return a; }
    function add() { let a = mul(); while (isOp('+', '-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: mul() }; } return a; }
    function mul() { let a = pow(); while (isOp('*', '/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: pow() }; } return a; }
    function pow() { let a = unary(); while (isOp('^')) { p++; a = { k: 'bin', op: '^', a, b: unary() }; } return a; }
    function unary() { if (isOp('-')) { p++; return { k: 'neg', a: unary() }; } if (isOp('+')) { p++; return unary(); } return postfix(); }
    function postfix() { let a = primary(); while (isOp('%')) { p++; a = { k: 'pct', a }; } return a; }
    function primary() {
      const t = peek();
      if (!t) throw new ParseErr('Формула оборвалась — чего-то не хватает в конце');
      if (t.type === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.type === 'str') { p++; return { k: 'str', v: t.v }; }
      if (t.type === 'ref') {
        p++;
        if (peek() && peek().type === ':') {
          p++; const t2 = expect('ref', 'После двоеточия нужен адрес ячейки, например B2:B6');
          return { k: 'range', c1: Math.min(t.col, t2.col), r1: Math.min(t.row, t2.row), c2: Math.max(t.col, t2.col), r2: Math.max(t.row, t2.row) };
        }
        return { k: 'ref', c: t.col, r: t.row };
      }
      if (t.type === 'name') {
        p++;
        if (peek() && peek().type === '(') {
          p++; const args = [];
          if (peek() && peek().type === ')') { p++; return { k: 'call', name: t.v, raw: t.raw, args }; }
          for (;;) {
            if (peek() && (peek().type === 'sep' || peek().type === ')')) args.push({ k: 'empty' });
            else args.push(expr());
            if (peek() && peek().type === 'sep') { p++; continue; }
            expect(')', 'Не хватает закрывающей скобки «)»');
            break;
          }
          if (!FN[t.v]) throw new ParseErr('Функция «' + t.raw + '» не найдена. Проверьте написание (например, СУММ, ЕСЛИ, ВПР)');
          return { k: 'call', name: t.v, raw: t.raw, args };
        }
        if (t.v in BOOLS) return { k: 'bool', v: BOOLS[t.v] };
        throw new ParseErr('Непонятное слово «' + t.raw + '». Если это текст — возьмите его в кавычки');
      }
      if (t.type === '(') { p++; const e = expr(); expect(')', 'Не хватает закрывающей скобки «)»'); return e; }
      if (t.type === ')') throw new ParseErr('Лишняя закрывающая скобка');
      throw new ParseErr('Формула составлена неправильно — проверьте знаки и скобки');
    }
    if (!toks.length) throw new ParseErr('Пустая формула');
    const ast = expr();
    if (p < toks.length) {
      const t = toks[p];
      if (t.type === ')') throw new ParseErr('Лишняя закрывающая скобка');
      throw new ParseErr('Формула составлена неправильно — похоже, пропущен знак или точка с запятой');
    }
    return ast;
  }

  // ---- values ----
  const isRange = v => v && v.range === true;
  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const s = v.trim().replace(',', '.'); if (s !== '' && !isNaN(+s)) return +s; throw new XErr('#ЗНАЧ!'); }
    throw new XErr('#ЗНАЧ!');
  }
  function fmtNum(n) { if (Number.isInteger(n)) return String(n); return String(+n.toPrecision(15)).replace('.', ','); }
  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
    return String(v);
  }
  function toBool(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).toUpperCase();
    if (s in BOOLS) return BOOLS[s];
    throw new XErr('#ЗНАЧ!');
  }
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
  function cmp(a, b) {
    if (a === null || a === undefined) a = (typeof b === 'string') ? '' : (typeof b === 'boolean' ? false : 0);
    if (b === null || b === undefined) b = (typeof a === 'string') ? '' : (typeof a === 'boolean' ? false : 0);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    const x = +a, y = +b; return x < y ? -1 : x > y ? 1 : 0;
  }

  function makeCtx(getCell) {
    function ev(n) {
      switch (n.k) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'empty': return null;
        case 'ref': return getCell(n.c, n.r);
        case 'range': return { range: true, ...n };
        case 'neg': return -toNum(scalar(n.a));
        case 'pct': return toNum(scalar(n.a)) / 100;
        case 'bin': {
          const a = scalar(n.a), b = scalar(n.b);
          switch (n.op) {
            case '+': return toNum(a) + toNum(b);
            case '-': return toNum(a) - toNum(b);
            case '*': return toNum(a) * toNum(b);
            case '/': { const d = toNum(b); if (d === 0) throw new XErr('#ДЕЛ/0!'); return toNum(a) / d; }
            case '^': return Math.pow(toNum(a), toNum(b));
            case '&': return toStr(a) + toStr(b);
            case '=': return cmp(a, b) === 0;
            case '<>': return cmp(a, b) !== 0;
            case '<': return cmp(a, b) < 0;
            case '>': return cmp(a, b) > 0;
            case '<=': return cmp(a, b) <= 0;
            case '>=': return cmp(a, b) >= 0;
          }
        }
        case 'call': return FN[n.name](n.args, ctx);
      }
      throw new XErr('#ЗНАЧ!');
    }
    function scalar(n) { const v = ev(n); if (isRange(v)) { if (v.c1 === v.c2 && v.r1 === v.r2) return getCell(v.c1, v.r1); throw new XErr('#ЗНАЧ!'); } return v; }
    function cells(v) { const out = []; for (let r = v.r1; r <= v.r2; r++) for (let c = v.c1; c <= v.c2; c++) out.push(getCell(c, r)); return out; }
    function flat(args) { const out = []; for (const a of args) { const v = ev(a); if (isRange(v)) out.push(...cells(v).map(x => ({ x, fromRange: true }))); else out.push({ x: v, fromRange: false }); } return out; }
    function rng(n) { if (n.k === 'ref') return { range: true, c1: n.c, r1: n.r, c2: n.c, r2: n.r }; const v = ev(n); if (!isRange(v)) throw new XErr('#ЗНАЧ!'); return v; }
    const ctx = { ev, scalar, cells, flat, getCell, rng };
    return ctx;
  }

  function nums(args, ctx) {
    const out = [];
    for (const { x, fromRange } of ctx.flat(args)) {
      if (fromRange) { if (typeof x === 'number') out.push(x); }
      else if (x !== null) out.push(toNum(x));
    }
    return out;
  }
  function need(args, min, max) { if (args.length < min || args.length > max) throw new XErr('#ЗНАЧ!'); }
  function wildcardRe(s) { return new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }
  function matcher(crit) {
    if (typeof crit === 'number') return x => typeof x === 'number' ? x === crit : (typeof x === 'string' && x.trim() !== '' && +x.replace(',', '.') === crit);
    if (typeof crit === 'boolean') return x => x === crit;
    let s = toStr(crit), op = '=';
    const m = s.match(/^(<=|>=|<>|<|>|=)/); if (m) { op = m[1]; s = s.slice(m[1].length); }
    const sn = s.trim().replace(',', '.'); const isN = sn !== '' && !isNaN(+sn);
    if (isN) {
      const n = +sn;
      return x => {
        if (typeof x !== 'number') return op === '<>';
        switch (op) { case '=': return x === n; case '<>': return x !== n; case '<': return x < n; case '>': return x > n; case '<=': return x <= n; case '>=': return x >= n; }
      };
    }
    if (op === '=' || op === '<>') {
      const re = wildcardRe(s);
      const hit = x => (s === '' ? (x === null || x === '') : (x !== null && re.test(toStr(x))));
      return op === '=' ? hit : x => !hit(x);
    }
    return x => { if (typeof x !== 'string') return false; const c = cmp(x, s); return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0; };
  }
  function round(x, d) { const f = Math.pow(10, d); const v = Math.abs(x) * f; return Math.sign(x) * Math.round(+v.toPrecision(15)) / f; }

  const FN = {};
  const def = (names, fn, help) => { for (const n of names) FN[n] = fn; if (help) HELP.push(help); };
  const HELP = [];

  def(['СУММ', 'SUM'], (a, c) => nums(a, c).reduce((s, x) => s + x, 0), ['СУММ(диапазон)', 'Складывает числа', '=СУММ(B2:B6)']);
  def(['СРЗНАЧ', 'AVERAGE'], (a, c) => { const n = nums(a, c); if (!n.length) throw new XErr('#ДЕЛ/0!'); return n.reduce((s, x) => s + x, 0) / n.length; }, ['СРЗНАЧ(диапазон)', 'Среднее арифметическое', '=СРЗНАЧ(B2:B8)']);
  def(['МИН', 'MIN'], (a, c) => { const n = nums(a, c); return n.length ? Math.min(...n) : 0; }, ['МИН(диапазон)', 'Наименьшее число', '=МИН(B2:B8)']);
  def(['МАКС', 'MAX'], (a, c) => { const n = nums(a, c); return n.length ? Math.max(...n) : 0; }, ['МАКС(диапазон)', 'Наибольшее число', '=МАКС(B2:B8)']);
  def(['СЧЕТ', 'COUNT'], (a, c) => c.flat(a).filter(({ x }) => typeof x === 'number').length, ['СЧЁТ(диапазон)', 'Сколько ячеек с числами', '=СЧЁТ(C2:C9)']);
  def(['СЧЕТЗ', 'COUNTA'], (a, c) => c.flat(a).filter(({ x }) => x !== null && x !== '').length, ['СЧЁТЗ(диапазон)', 'Сколько непустых ячеек', '=СЧЁТЗ(A2:A9)']);
  def(['ЕСЛИ', 'IF'], (a, c) => { need(a, 2, 3); const cond = toBool(c.scalar(a[0])); if (cond) return c.scalar(a[1]); return a.length > 2 ? c.scalar(a[2]) : false; }, ['ЕСЛИ(условие; если да; если нет)', 'Выбирает значение по условию', '=ЕСЛИ(C2>=B2;"Да";"Нет")']);
  def(['И', 'AND'], (a, c) => { let r = true; for (const { x } of c.flat(a)) r = r && toBool(x); return r; }, ['И(усл1; усл2; …)', 'ИСТИНА, если выполнены все условия', '=И(B2>0;C2>0)']);
  def(['ИЛИ', 'OR'], (a, c) => { let r = false; for (const { x } of c.flat(a)) r = r || toBool(x); return r; }, ['ИЛИ(усл1; усл2; …)', 'ИСТИНА, если выполнено хотя бы одно', '=ИЛИ(B2>0;C2>0)']);
  def(['НЕ', 'NOT'], (a, c) => { need(a, 1, 1); return !toBool(c.scalar(a[0])); });
  def(['СЧЕТЕСЛИ', 'COUNTIF'], (a, c) => { need(a, 2, 2); const r = c.rng(a[0]); const m = matcher(c.scalar(a[1])); return c.cells(r).filter(m).length; }, ['СЧЁТЕСЛИ(диапазон; критерий)', 'Считает ячейки по условию', '=СЧЁТЕСЛИ(B2:B9;"Москва")']);
  def(['СУММЕСЛИ', 'SUMIF'], (a, c) => {
    need(a, 2, 3); const r = c.rng(a[0]);
    const m = matcher(c.scalar(a[1]));
    const src = c.cells(r); let sum = src;
    if (a.length > 2) { const s = c.rng(a[2]); sum = c.cells({ c1: s.c1, r1: s.r1, c2: s.c1 + (r.c2 - r.c1), r2: s.r1 + (r.r2 - r.r1) }); }
    let t = 0; src.forEach((x, i) => { if (m(x) && typeof sum[i] === 'number') t += sum[i]; }); return t;
  }, ['СУММЕСЛИ(диапазон; критерий; диапазон_суммы)', 'Складывает числа по условию', '=СУММЕСЛИ(B2:B9;"Казань";C2:C9)']);
  def(['ВПР', 'VLOOKUP'], (a, c) => {
    need(a, 3, 4);
    const key = c.scalar(a[0]); const r = c.rng(a[1]);
    const col = Math.trunc(toNum(c.scalar(a[2]))); if (col < 1) throw new XErr('#ЗНАЧ!'); if (col > r.c2 - r.c1 + 1) throw new XErr('#ССЫЛКА!');
    const approx = a.length > 3 && a[3].k !== 'empty' ? toBool(c.scalar(a[3])) : true;
    if (!approx) {
      const m = typeof key === 'string' ? (x => x !== null && wildcardRe(key).test(toStr(x))) : (x => x !== null && cmp(x, key) === 0);
      for (let row = r.r1; row <= r.r2; row++) if (m(c.getCell(r.c1, row))) return c.getCell(r.c1 + col - 1, row);
      throw new XErr('#Н/Д');
    }
    let found = -1;
    for (let row = r.r1; row <= r.r2; row++) { const x = c.getCell(r.c1, row); if (x === null) continue; if (rank(x) === rank(key) && cmp(x, key) <= 0) found = row; else if (rank(x) === rank(key)) break; }
    if (found < 0) throw new XErr('#Н/Д');
    return c.getCell(r.c1 + col - 1, found);
  }, ['ВПР(что ищем; таблица; номер столбца; 0)', 'Находит значение в таблице. 0 — точное совпадение', '=ВПР(E2;A2:B7;2;0)']);
  def(['ОКРУГЛ', 'ROUND'], (a, c) => { need(a, 2, 2); return round(toNum(c.scalar(a[0])), Math.trunc(toNum(c.scalar(a[1])))); }, ['ОКРУГЛ(число; знаков)', 'Округляет до нужного числа знаков', '=ОКРУГЛ(B7;0)']);
  def(['ЦЕЛОЕ', 'INT'], (a, c) => { need(a, 1, 1); return Math.floor(toNum(c.scalar(a[0]))); });
  def(['ABS'], (a, c) => { need(a, 1, 1); return Math.abs(toNum(c.scalar(a[0]))); });
  def(['СЦЕПИТЬ', 'CONCATENATE', 'СЦЕП', 'CONCAT'], (a, c) => c.flat(a).map(({ x }) => toStr(x)).join(''), ['СЦЕПИТЬ(текст1; текст2; …)', 'Склеивает текст. То же делает знак &', '=СЦЕПИТЬ(A2;" ";B2)']);
  def(['ЛЕВСИМВ', 'LEFT'], (a, c) => { need(a, 1, 2); const n = a.length > 1 ? toNum(c.scalar(a[1])) : 1; if (n < 0) throw new XErr('#ЗНАЧ!'); return toStr(c.scalar(a[0])).slice(0, n); }, ['ЛЕВСИМВ(текст; сколько)', 'Первые символы текста', '=ЛЕВСИМВ(A2;3)']);
  def(['ПРАВСИМВ', 'RIGHT'], (a, c) => { need(a, 1, 2); const n = a.length > 1 ? toNum(c.scalar(a[1])) : 1; if (n < 0) throw new XErr('#ЗНАЧ!'); const s = toStr(c.scalar(a[0])); return n === 0 ? '' : s.slice(-n); }, ['ПРАВСИМВ(текст; сколько)', 'Последние символы текста', '=ПРАВСИМВ(A2;5)']);
  def(['ПСТР', 'MID'], (a, c) => { need(a, 3, 3); const s = toStr(c.scalar(a[0])); const st = toNum(c.scalar(a[1])); const n = toNum(c.scalar(a[2])); if (st < 1 || n < 0) throw new XErr('#ЗНАЧ!'); return s.substr(st - 1, n); });
  def(['ДЛСТР', 'LEN'], (a, c) => { need(a, 1, 1); return toStr(c.scalar(a[0])).length; }, ['ДЛСТР(текст)', 'Длина текста', '=ДЛСТР(A2)']);
  def(['ПРОПИСН', 'UPPER'], (a, c) => { need(a, 1, 1); return toStr(c.scalar(a[0])).toUpperCase(); });
  def(['СТРОЧН', 'LOWER'], (a, c) => { need(a, 1, 1); return toStr(c.scalar(a[0])).toLowerCase(); });
  def(['СЖПРОБЕЛЫ', 'TRIM'], (a, c) => { need(a, 1, 1); return toStr(c.scalar(a[0])).trim().replace(/ +/g, ' '); });
  def(['ЕСЛИОШИБКА', 'IFERROR'], (a, c) => { need(a, 2, 2); try { const v = c.scalar(a[0]); return v; } catch (e) { if (e instanceof XErr) return c.scalar(a[1]); throw e; } }, ['ЕСЛИОШИБКА(формула; если ошибка)', 'Заменяет ошибку на ваше значение', '=ЕСЛИОШИБКА(ВПР(…);"Нет")']);

  const rangeLike = (c, r, src) => { const s = c.rng(src); return c.cells({ c1: s.c1, r1: s.r1, c2: s.c1 + (r.c2 - r.c1), r2: s.r1 + (r.r2 - r.r1) }); };
  def(['СЧИТАТЬПУСТОТЫ', 'COUNTBLANK'], (a, c) => { need(a, 1, 1); return c.cells(c.rng(a[0])).filter(x => x === null || x === '').length; }, ['СЧИТАТЬПУСТОТЫ(диапазон)', 'Сколько пустых ячеек', '=СЧИТАТЬПУСТОТЫ(B2:B7)']);
  def(['СРЗНАЧЕСЛИ', 'AVERAGEIF'], (a, c) => {
    need(a, 2, 3); const r = c.rng(a[0]); const m = matcher(c.scalar(a[1])); const src = c.cells(r);
    const av = a.length > 2 ? rangeLike(c, r, a[2]) : src; let t = 0, n = 0;
    src.forEach((x, i) => { if (m(x) && typeof av[i] === 'number') { t += av[i]; n++; } });
    if (!n) throw new XErr('#ДЕЛ/0!'); return t / n;
  }, ['СРЗНАЧЕСЛИ(диапазон; критерий; диапазон_среднего)', 'Среднее по условию', '=СРЗНАЧЕСЛИ(B2:B9;"Казань";C2:C9)']);
  const kth = desc => (a, c) => {
    need(a, 2, 2); const n = c.cells(c.rng(a[0])).filter(x => typeof x === 'number').sort((x, y) => desc ? y - x : x - y);
    const k = Math.trunc(toNum(c.scalar(a[1]))); if (k < 1 || k > n.length) throw new XErr('#ЧИСЛО!'); return n[k - 1];
  };
  def(['НАИБОЛЬШИЙ', 'LARGE'], kth(true), ['НАИБОЛЬШИЙ(диапазон; k)', 'k-е по величине значение', '=НАИБОЛЬШИЙ(B2:B8;2)']);
  def(['НАИМЕНЬШИЙ', 'SMALL'], kth(false), ['НАИМЕНЬШИЙ(диапазон; k)', 'k-е с конца значение', '=НАИМЕНЬШИЙ(B2:B8;1)']);
  const roundDir = up => (a, c) => { need(a, 2, 2); const x = toNum(c.scalar(a[0])), d = Math.trunc(toNum(c.scalar(a[1]))), f = Math.pow(10, d); const v = +(Math.abs(x) * f).toPrecision(15); return Math.sign(x) * (up ? Math.ceil(v) : Math.floor(v)) / f; };
  def(['ОКРУГЛВВЕРХ', 'ROUNDUP'], roundDir(true), ['ОКРУГЛВВЕРХ(число; знаков)', 'Округляет всегда вверх', '=ОКРУГЛВВЕРХ(B1/B2;0)']);
  def(['ОКРУГЛВНИЗ', 'ROUNDDOWN'], roundDir(false));
  def(['ПРОПНАЧ', 'PROPER'], (a, c) => { need(a, 1, 1); return toStr(c.scalar(a[0])).toLowerCase().replace(/(^|[^A-Za-zА-Яа-яЁё])([A-Za-zА-Яа-яЁё])/g, (m, p, ch) => p + ch.toUpperCase()); }, ['ПРОПНАЧ(текст)', 'Каждое слово с заглавной буквы', '=ПРОПНАЧ(A2)']);
  def(['ПОДСТАВИТЬ', 'SUBSTITUTE'], (a, c) => {
    need(a, 3, 4); const s = toStr(c.scalar(a[0])), from = toStr(c.scalar(a[1])), to = toStr(c.scalar(a[2]));
    if (from === '') return s;
    if (a.length > 3) { const n = Math.trunc(toNum(c.scalar(a[3]))); let i = -1; for (let k = 0; k < n; k++) { i = s.indexOf(from, i + 1); if (i < 0) return s; } return s.slice(0, i) + to + s.slice(i + from.length); }
    return s.split(from).join(to);
  }, ['ПОДСТАВИТЬ(текст; что; на что)', 'Заменяет часть текста', '=ПОДСТАВИТЬ(A2;" ";"")']);
  const findFn = ci => (a, c) => {
    need(a, 2, 3); let what = toStr(c.scalar(a[0])), where = toStr(c.scalar(a[1])); const st = a.length > 2 ? Math.trunc(toNum(c.scalar(a[2]))) : 1;
    if (ci) { what = what.toLowerCase(); where = where.toLowerCase(); }
    if (st < 1) throw new XErr('#ЗНАЧ!'); const i = where.indexOf(what, st - 1); if (i < 0) throw new XErr('#ЗНАЧ!'); return i + 1;
  };
  def(['НАЙТИ', 'FIND'], findFn(false), ['НАЙТИ(что; где)', 'Позиция символа в тексте', '=НАЙТИ("@";A2)']);
  def(['ПОИСК', 'SEARCH'], findFn(true));
  def(['СУММЕСЛИМН', 'SUMIFS'], (a, c) => {
    if (a.length < 3 || a.length % 2 === 0) throw new XErr('#ЗНАЧ!');
    const s = c.cells(c.rng(a[0])); const ok = s.map(() => true);
    for (let i = 1; i < a.length; i += 2) { const cs = c.cells(c.rng(a[i])); if (cs.length !== s.length) throw new XErr('#ЗНАЧ!'); const m = matcher(c.scalar(a[i + 1])); cs.forEach((x, j) => { if (!m(x)) ok[j] = false; }); }
    let t = 0; s.forEach((x, j) => { if (ok[j] && typeof x === 'number') t += x; }); return t;
  }, ['СУММЕСЛИМН(что складываем; диапазон1; условие1; …)', 'Сумма по нескольким условиям', '=СУММЕСЛИМН(C2:C9;A2:A9;"Казань";B2:B9;"Кофе")']);
  def(['СЧЕТЕСЛИМН', 'COUNTIFS'], (a, c) => {
    if (a.length < 2 || a.length % 2) throw new XErr('#ЗНАЧ!');
    let ok = null;
    for (let i = 0; i < a.length; i += 2) { const cs = c.cells(c.rng(a[i])); if (!ok) ok = cs.map(() => true); if (cs.length !== ok.length) throw new XErr('#ЗНАЧ!'); const m = matcher(c.scalar(a[i + 1])); cs.forEach((x, j) => { if (!m(x)) ok[j] = false; }); }
    return ok.filter(Boolean).length;
  }, ['СЧЁТЕСЛИМН(диапазон1; условие1; диапазон2; условие2)', 'Счёт по нескольким условиям', '=СЧЁТЕСЛИМН(B2:B9;"Москва";C2:C9;">3000")']);
  def(['ИНДЕКС', 'INDEX'], (a, c) => {
    need(a, 2, 3); const r = c.rng(a[0]); const rows = r.r2 - r.r1 + 1, cols = r.c2 - r.c1 + 1;
    let ri = Math.trunc(toNum(c.scalar(a[1]))), ci = a.length > 2 && a[2].k !== 'empty' ? Math.trunc(toNum(c.scalar(a[2]))) : 1;
    if (a.length === 2 && rows === 1) { ci = ri; ri = 1; }
    if (ri < 1 || ci < 1 || ri > rows || ci > cols) throw new XErr('#ССЫЛКА!');
    return c.getCell(r.c1 + ci - 1, r.r1 + ri - 1);
  }, ['ИНДЕКС(диапазон; номер строки)', 'Значение по номеру позиции', '=ИНДЕКС(A2:A7;3)']);
  def(['ПОИСКПОЗ', 'MATCH'], (a, c) => {
    need(a, 2, 3); const key = c.scalar(a[0]); const cs = c.cells(c.rng(a[1]));
    const type = a.length > 2 && a[2].k !== 'empty' ? Math.trunc(toNum(c.scalar(a[2]))) : 1;
    if (type === 0) {
      const m = typeof key === 'string' ? (x => x !== null && wildcardRe(key).test(toStr(x))) : (x => x !== null && cmp(x, key) === 0);
      const i = cs.findIndex(m); if (i < 0) throw new XErr('#Н/Д'); return i + 1;
    }
    let found = -1;
    cs.forEach((x, i) => { if (x === null || rank(x) !== rank(key)) return; const d = cmp(x, key); if (type > 0 ? d <= 0 : d >= 0) found = i; });
    if (found < 0) throw new XErr('#Н/Д'); return found + 1;
  }, ['ПОИСКПОЗ(что ищем; где ищем; 0)', 'Номер позиции значения в списке', '=ПОИСКПОЗ(D2;B2:B7;0)']);
  def(['СУММПРОИЗВ', 'SUMPRODUCT'], (a, c) => {
    if (!a.length) throw new XErr('#ЗНАЧ!');
    const arrs = a.map(x => c.cells(c.rng(x))); const n = arrs[0].length;
    if (arrs.some(x => x.length !== n)) throw new XErr('#ЗНАЧ!');
    let t = 0; for (let i = 0; i < n; i++) { let p = 1; for (const arr of arrs) p *= typeof arr[i] === 'number' ? arr[i] : 0; t += p; } return t;
  }, ['СУММПРОИЗВ(диапазон1; диапазон2)', 'Сумма попарных произведений', '=СУММПРОИЗВ(B2:B5;C2:C5)']);
  def(['ЗНАЧЕН', 'VALUE'], (a, c) => { need(a, 1, 1); return toNum(c.scalar(a[0])); });
  def(['ЕПУСТО', 'ISBLANK'], (a, c) => { need(a, 1, 1); const v = c.scalar(a[0]); return v === null; });
  def(['ОСТАТ', 'MOD'], (a, c) => { need(a, 2, 2); const x = toNum(c.scalar(a[0])), d = toNum(c.scalar(a[1])); if (d === 0) throw new XErr('#ДЕЛ/0!'); return x - d * Math.floor(x / d); });
  def(['ЕСНД', 'IFNA'], (a, c) => { need(a, 2, 2); try { return c.scalar(a[0]); } catch (e) { if (e instanceof XErr && e.code === '#Н/Д') return c.scalar(a[1]); throw e; } });
  def(['ЕСЛИМН', 'IFS'], (a, c) => { if (a.length < 2 || a.length % 2) throw new XErr('#ЗНАЧ!'); for (let i = 0; i < a.length; i += 2) if (toBool(c.scalar(a[i]))) return c.scalar(a[i + 1]); throw new XErr('#Н/Д'); });

  function evaluate(ast, getCell) {
    const ctx = makeCtx(getCell);
    try {
      const v = ctx.scalar(ast);
      if (typeof v === 'number' && !isFinite(v)) return { err: '#ЧИСЛО!' };
      return { v: v === null ? 0 : v };
    } catch (e) { if (e instanceof XErr) return { err: e.code }; throw e; }
  }

  function refsOf(ast) {
    const out = [];
    (function walk(n) {
      if (!n) return;
      if (n.k === 'ref') out.push({ c1: n.c, r1: n.r, c2: n.c, r2: n.r });
      else if (n.k === 'range') out.push({ c1: n.c1, r1: n.r1, c2: n.c2, r2: n.r2 });
      for (const key of ['a', 'b']) if (n[key]) walk(n[key]);
      if (n.args) n.args.forEach(walk);
    })(ast);
    return out;
  }

  function same(res, exp) {
    if (res.err || exp.err) return res.err === exp.err;
    const a = res.v, b = exp.v;
    if (typeof b === 'number') { const x = typeof a === 'number' ? a : (typeof a === 'string' && a.trim() !== '' && !isNaN(+a.replace(',', '.')) ? +a.replace(',', '.') : NaN); return Math.abs(x - b) <= 1e-6 * Math.max(1, Math.abs(b)); }
    if (typeof b === 'boolean') return a === b;
    return toStr(a).trim().toLowerCase() === toStr(b).trim().toLowerCase();
  }

  return { parse, evaluate, refsOf, same, tokenize, toStr, fmtNum, colName, colIdx, addr, ParseErr, HELP };
})();
