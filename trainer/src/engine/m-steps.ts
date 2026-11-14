// @ts-nocheck
/* Разбор кода M из расширенного редактора и строки формул обратно в шаги тренажёра.
   Поддерживается цепочка let … in, где каждый шаг — вызов Table.* от предыдущего шага. */
import { parseM } from './m';
import { stepNames, type Step, type PType } from './pq';

export class MCodeError extends Error { pos?: number; constructor(m: string, pos?: number) { super(m); this.pos = pos; } }
const fail = (m: string, p?: number): never => { throw new MCodeError(m, p); };

type Tok = { k: 'str' | 'num' | 'id' | 'p' | 'eof'; v: any; p: number; e: number };
function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const p = i;
    if (c === '"' || (c === '#' && src[i + 1] === '"')) {
      const quoted = c === '#'; i += quoted ? 2 : 1; let s = '';
      for (;;) { if (i >= src.length) fail('Текст не закрыт: не хватает кавычки «"».', p); if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; } s += src[i++]; }
      out.push({ k: quoted ? 'id' : 'str', v: s, p, e: i }); continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || '') && /[(,{=]\s*$/.test(src.slice(0, i)))) { const m = /^-?\d+(\.\d+)?/.exec(src.slice(i)); out.push({ k: 'num', v: Number(m[0]), p, e: i + m[0].length }); i += m[0].length; continue; }
    if (c === '#' && /^#(date|datetime|table)\b/.test(src.slice(i))) { const m = /^#\w+/.exec(src.slice(i)); out.push({ k: 'id', v: m[0], p, e: i + m[0].length }); i += m[0].length; continue; }
    if (/[A-Za-zА-Яа-яЁё_]/.test(c)) { const m = /^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*(\.[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)*/.exec(src.slice(i)); out.push({ k: 'id', v: m[0], p, e: i + m[0].length }); i += m[0].length; continue; }
    if (src.startsWith('=>', i)) fail('Функции вида (x) => … в тренажёре пока не поддерживаются. Используйте each.', p);
    if ('(){}[],=;'.includes(c)) { out.push({ k: 'p', v: c, p, e: i + 1 }); i++; continue; }
    if ('<>&+-*/'.includes(c)) { out.push({ k: 'p', v: c, p, e: i + 1 }); i++; continue; }
    fail(`Неожиданный символ «${c}».`, p);
  }
  out.push({ k: 'eof', v: '', p: src.length, e: src.length });
  return out;
}

export function parseQuery(src: string, queryNames: string[] = []): Step[] {
  const t = lex(src); let i = 0;
  const pk = () => t[i];
  const isP = (v: string) => pk().k === 'p' && pk().v === v;
  const isId = (v: string) => pk().k === 'id' && pk().v === v;
  const expP = (v: string) => { if (!isP(v)) fail(`Ожидалось «${v}», а найдено «${pk().k === 'eof' ? 'конец кода' : pk().v}».`, pk().p); i++; };
  if (!isId('let')) fail('Запрос начинается со слова let.', pk().p);
  i++;
  const binds: { name: string; p: number; start: number; end: number }[] = [];
  for (;;) {
    const n = pk(); if (n.k !== 'id') fail(`Ожидалось имя шага, а найдено «${n.v || 'конец кода'}». Имя с пробелами пишется так: #"Имя шага".`, n.p);
    i++; expP('=');
    const start = pk().p; let depth = 0;
    while (pk().k !== 'eof') { const x = pk(); if (x.k === 'p' && '({['.includes(x.v)) depth++; else if (x.k === 'p' && ')}]'.includes(x.v)) depth--; else if (depth === 0 && ((x.k === 'p' && x.v === ',') || (x.k === 'id' && x.v === 'in'))) break; if (depth < 0) fail(`Лишняя закрывающая скобка «${x.v}».`, x.p); if (depth === 0 && x.p > start && x.k === 'id' && t[i + 1].k === 'p' && t[i + 1].v === '=') fail(`Пропущена запятая перед шагом «${x.v}»: шаги разделяются запятыми.`, x.p); i++; }
    if (depth !== 0) fail('Скобки не сбалансированы: не хватает закрывающей скобки.', start);
    binds.push({ name: n.v, p: n.p, start, end: t[i - 1].e });
    if (isP(',')) { i++; continue; }
    if (isId('in')) { i++; break; }
    fail('После шага нужна запятая или in.', pk().p);
  }
  const ret = pk(); if (ret.k !== 'id') fail('После in укажите имя последнего шага.', ret.p);
  if (t[i + 1].k !== 'eof') fail('После имени последнего шага ничего быть не должно.', t[i + 1].p);
  if (!binds.length) fail('В запросе нет шагов.');
  if (binds[0].name !== 'Источник') fail('Первый шаг должен называться «Источник» и подключать файл. Его в тренажёре менять не нужно.', binds[0].p);
  if (ret.v !== binds[binds.length - 1].name) fail(`После in должно стоять имя последнего шага: ${q(binds[binds.length - 1].name)}.`, ret.p);
  const steps: Step[] = [];
  const seen = new Set(['Источник']);
  for (let k = 1; k < binds.length; k++) {
    const b = binds[k];
    if (seen.has(b.name)) fail(`Имя шага «${b.name}» повторяется.`, b.p);
    seen.add(b.name);
    steps.push(parseStepExpr(src.slice(b.start, b.end), binds[k - 1].name, queryNames, b.start));
  }
  const auto = stepNames(steps);
  steps.forEach((s, k) => { if (binds[k + 1].name !== auto[k]) s.step = binds[k + 1].name; });
  return steps;
}
const q = (n: string) => /^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*$/.test(n) ? n : '#"' + n + '"';

/* ───── одно выражение шага ───── */
export function parseStepExpr(src: string, prev: string, queryNames: string[] = [], offset = 0): Step {
  const body = src.replace(/^\s*=\s*/, '');
  const shift = offset + (src.length - body.length);
  const t = lex(body); let i = 0;
  const pk = () => t[i];
  const isP = (v: string) => pk().k === 'p' && pk().v === v;
  const expP = (v: string) => { if (!isP(v)) fail(`Ожидалось «${v}», а найдено «${pk().k === 'eof' ? 'конец выражения' : pk().v}».`, pk().p + shift); i++; };
  function rawEach(): any {
    const start = pk().p; i++; let depth = 0;
    while (pk().k !== 'eof') { const x = pk(); if (x.k === 'p' && '({['.includes(x.v)) depth++; else if (x.k === 'p' && ')}]'.includes(x.v)) { if (depth === 0) break; depth--; } else if (depth === 0 && x.k === 'p' && x.v === ',') break; i++; }
    const text = body.slice(start, t[i - 1].e).trim();
    if (!text.includes('Преобразовать файл')) try { parseM(text); } catch (e) { fail('Ошибка в выражении each: ' + e.message, start + shift); }
    return { t: 'each', text: text.replace(/^each\s+/, ''), p: start };
  }
  function value(): any {
    const x = pk();
    if (x.k === 'id' && x.v === 'each') return rawEach();
    if (x.k === 'str') { i++; return { t: 'str', v: x.v, p: x.p }; }
    if (x.k === 'num') { i++; return { t: 'num', v: x.v, p: x.p }; }
    if (x.k === 'id' && ['null', 'true', 'false'].includes(x.v)) { i++; return { t: 'lit', v: x.v === 'null' ? null : x.v === 'true', p: x.p }; }
    if (x.k === 'id' && x.v === 'type') { i++; let n = pk(); if (n.k === 'id' && n.v === 'nullable') { i++; n = pk(); } if (n.k !== 'id') fail('После type нужно имя типа: type text, type number, type date.', n.p + shift); i++; return { t: 'type', v: n.v, p: x.p }; }
    if (isP('{')) { i++; const items = []; if (!isP('}')) for (;;) { items.push(value()); if (isP(',')) { i++; continue; } break; } expP('}'); return post({ t: 'list', items, p: x.p }); }
    if (isP('[')) { i++; const rec = {}; if (!isP(']')) for (;;) { const k = pk(); if (k.k !== 'id') fail('Ожидалось имя поля записи.', k.p + shift); i++; expP('='); rec[k.v] = value(); if (isP(',')) { i++; continue; } break; } expP(']'); return post({ t: 'rec', v: rec, p: x.p }); }
    if (isP('(')) { i++; const v = value(); expP(')'); return v; }
    if (x.k === 'id') { i++; let node: any = { t: 'id', v: x.v, p: x.p }; if (isP('(')) { i++; const args = []; if (!isP(')')) for (;;) { args.push(value()); if (isP(',')) { i++; continue; } break; } expP(')'); node = { t: 'call', f: x.v, args, p: x.p }; } return post(node); }
    return fail(`Неожиданное «${x.k === 'eof' ? 'конец выражения' : x.v}».`, x.p + shift);
  }
  function post(n: any) {
    for (;;) {
      if (isP('{') ) { i++; const v = value(); expP('}'); n = { t: 'item', of: n, v }; continue; }
      if (isP('[')) { const save = i; i++; const k = pk(); if ((k.k === 'id' || k.k === 'str') && t[i + 1].k === 'p' && t[i + 1].v === ']') { i += 2; n = { t: 'field', of: n, v: k.v }; continue; } i = save; }
      return n;
    }
  }
  const n = value();
  if (pk().k !== 'eof') fail(`Неожиданное «${pk().v}» после конца выражения.`, pk().p + shift);
  try { return toStep(n, prev, queryNames); }
  catch (e) { if (e instanceof MCodeError && e.pos !== undefined) e.pos += shift; throw e; }
}

/* ───── вызов Table.* → шаг ───── */
const TYPES: Record<string, PType> = { text: 'text', number: 'number', date: 'date', any: 'any', datetime: 'date', 'Int64.Type': 'int', 'Currency.Type': 'number', 'Percentage.Type': 'number', 'Number.Type': 'number', 'Text.Type': 'text', 'Date.Type': 'date' };
const KINDS = { 'JoinKind.LeftOuter': 'leftouter', 'JoinKind.RightOuter': 'rightouter', 'JoinKind.FullOuter': 'fullouter', 'JoinKind.Inner': 'inner', 'JoinKind.LeftAnti': 'leftanti', 'JoinKind.RightAnti': 'rightanti' };
const SIMPLE = { 'Text.Trim': 'trim', 'Text.Clean': 'clean', 'Text.Upper': 'upper', 'Text.Lower': 'lower', 'Text.Proper': 'proper' };
const DATEF = { 'Date.Year': 'year', 'Date.Month': 'month', 'Date.Day': 'day', 'Date.QuarterOfYear': 'quarter', 'Date.StartOfMonth': 'startOfMonth', 'Date.EndOfMonth': 'endOfMonth' };
const AGG = { 'List.Sum': 'sum', 'List.Average': 'avg', 'List.Min': 'min', 'List.Max': 'max', 'List.Count': 'count', 'List.NonNullCount': 'count' };
function toStep(n: any, prev: string, qn: string[]): Step {
  if (n.t !== 'call') fail('Шаг должен быть вызовом функции, например Table.SelectRows(' + q(prev) + ', each …).', n.p);
  const a = n.args; const f = n.f;
  const need = (k: number) => { if (a.length < k) fail(`Не хватает аргументов в ${f}.`, n.p); };
  const str = (x: any, what = 'текст в кавычках') => x && x.t === 'str' ? x.v : fail(`В ${f} ожидался ${what}.`, x?.p ?? n.p);
  const num = (x: any) => x && x.t === 'num' ? x.v : fail(`В ${f} ожидалось число.`, x?.p ?? n.p);
  const strs = (x: any) => x && x.t === 'list' ? x.items.map(y => str(y)) : x && x.t === 'str' ? [x.v] : fail(`В ${f} ожидался список имён столбцов в фигурных скобках: {"Столбец"}.`, x?.p ?? n.p);
  const lit = (x: any) => x.t === 'str' || x.t === 'num' || x.t === 'lit' ? x.v : fail(`В ${f} ожидалось значение.`, x.p);
  const ty = (x: any) => { if (!x) return undefined; const k = x.t === 'type' ? x.v : x.t === 'id' ? x.v : null; const r = TYPES[k]; if (!r) fail(`Тип «${k ?? '?'}» в тренажёре не поддерживается. Доступны: type text, type number, Int64.Type, type date, type any.`, x.p); return r; };
  if (!f.startsWith('Table.')) fail(`Функция ${f} как шаг запроса в тренажёре не поддерживается. Шаг должен начинаться с Table.…`, n.p);
  need(1);
  const src = a[0];
  const isCombine = f === 'Table.ExpandTableColumn' && src.t === 'call' && JSON.stringify(src).includes('Преобразовать файл');
  if (f === 'Table.Combine') {
    const l = src.t === 'list' ? src.items : fail('Table.Combine принимает список таблиц: Table.Combine({' + q(prev) + ', Запрос2}).', src.p);
    if (l[0]?.t !== 'id' || l[0].v !== prev) fail(`Первой в списке Table.Combine должна стоять предыдущая таблица ${q(prev)}.`, src.p);
    return { op: 'append', queries: l.slice(1).map(x => x.t === 'id' && qn.includes(x.v) ? x.v : fail(`Запрос «${x.v}» не найден. Доступны: ${qn.join(', ') || 'других запросов нет'}.`, x.p)) };
  }
  if (!isCombine && (src.t !== 'id' || src.v !== prev)) fail(`Шаг должен ссылаться на предыдущий шаг ${q(prev)}${src.t === 'id' ? `, а ссылается на «${src.v}»` : ''}. В тренажёре шаги идут цепочкой.`, src.p);
  switch (f) {
    case 'Table.Skip': case 'Table.RemoveFirstN': need(2); return { op: 'removeTop', n: num(a[1]) };
    case 'Table.RemoveLastN': need(2); return { op: 'removeBottom', n: num(a[1]) };
    case 'Table.FirstN': need(2); return { op: 'keepTop', n: num(a[1]) };
    case 'Table.PromoteHeaders': return { op: 'promote' };
    case 'Table.DemoteHeaders': return { op: 'demote' };
    case 'Table.SelectRows': {
      need(2); if (a[1].t !== 'each') fail('Второй аргумент Table.SelectRows — условие: each [Столбец] > 0.', a[1].p);
      if (/List\.IsEmpty\(List\.RemoveMatchingItems\(Record\.FieldValues\(_\)/.test(a[1].text)) return { op: 'removeBlank' };
      return { op: 'selectRows', expr: a[1].text };
    }
    case 'Table.TransformColumnTypes': {
      need(2); const l = a[1].t === 'list' ? a[1].items : fail('Типы задаются списком: {{"Столбец", type text}}.', a[1].p);
      const cols = {}; for (const p of l) { if (p.t !== 'list' || p.items.length < 2) fail('Каждый элемент — пара {"Столбец", тип}.', p.p); cols[str(p.items[0])] = ty(p.items[1]); }
      return { op: 'type', cols };
    }
    case 'Table.ReplaceValue': {
      need(5); const how = a[3].t === 'id' ? a[3].v : '';
      if (!['Replacer.ReplaceText', 'Replacer.ReplaceValue'].includes(how)) fail('Четвёртый аргумент — Replacer.ReplaceText или Replacer.ReplaceValue.', a[3].p);
      const find = lit(a[1]), repl = lit(a[2]);
      if (how === 'Replacer.ReplaceValue') return { op: 'replace', cols: strs(a[4]), find, repl, mode: 'value' };
      return { op: 'replace', cols: strs(a[4]), find: find === null ? 'null' : String(find), repl: repl === null ? '' : String(repl) };
    }
    case 'Table.TransformColumns': {
      need(2); const l = a[1].t === 'list' ? (a[1].items[0]?.t === 'list' ? a[1].items : [a[1]]) : fail('Преобразования задаются списком: {{"Столбец", Text.Trim, type text}}.', a[1].p);
      const parts = l.map(p => { if (p.t !== 'list' || p.items.length < 2) fail('Каждый элемент — {"Столбец", функция, тип}.', p.p); const fn = p.items[1]; return { col: str(p.items[0]), fn: fn.t === 'id' ? fn.v : fn.t === 'each' ? 'each ' + fn.text : fail('Функция преобразования: Text.Trim или each … .', fn.p), type: p.items[2] ? ty(p.items[2]) : undefined }; });
      const fns = new Set(parts.map(p => p.fn));
      if (fns.size === 1 && SIMPLE[parts[0].fn]) return { op: SIMPLE[parts[0].fn], cols: parts.map(p => p.col) };
      if (parts.length === 1 && DATEF[parts[0].fn]) return { op: 'dateOp', col: parts[0].col, mode: DATEF[parts[0].fn] };
      return { op: 'transform', cols: parts };
    }
    case 'Table.RemoveColumns': need(2); return { op: 'removeCols', cols: strs(a[1]) };
    case 'Table.SelectColumns': need(2); return { op: 'keepCols', cols: strs(a[1]) };
    case 'Table.RenameColumns': {
      need(2); const l = a[1].t === 'list' ? (a[1].items[0]?.t === 'list' ? a[1].items : [a[1]]) : fail('Переименование задаётся парами: {{"Старое", "Новое"}}.', a[1].p);
      const pairs = l.map(p => p.t === 'list' && p.items.length === 2 ? [str(p.items[0]), str(p.items[1])] : fail('Каждая пара — {"Старое имя", "Новое имя"}.', p.p));
      return pairs.length === 1 ? { op: 'rename', col: pairs[0][0], to: pairs[0][1] } : { op: 'rename', pairs };
    }
    case 'Table.SplitColumn': {
      need(3); const sp = a[2]; if (sp.t !== 'call' || sp.f !== 'Splitter.SplitTextByDelimiter') fail('В тренажёре поддерживается Splitter.SplitTextByDelimiter("разделитель", QuoteStyle.Csv).', sp.p);
      const st: Step = { op: 'split', col: str(a[1]), delim: str(sp.args[0]) };
      if (a[3] && a[3].t === 'list') st.names = strs(a[3]);
      return st;
    }
    case 'Table.FillDown': need(2); return { op: 'fillDown', cols: strs(a[1]) };
    case 'Table.FillUp': need(2); return { op: 'fillUp', cols: strs(a[1]) };
    case 'Table.UnpivotOtherColumns': case 'Table.Unpivot': {
      need(4); const st: Step = { op: f === 'Table.Unpivot' ? 'unpivot' : 'unpivotOther', cols: strs(a[1]) };
      const at = str(a[2]), vl = str(a[3]); if (at !== 'Атрибут') st.attr = at; if (vl !== 'Значение') st.value = vl; return st;
    }
    case 'Table.Group': {
      need(3); const by = strs(a[1]); const l = a[2].t === 'list' ? (a[2].items[0]?.t === 'list' ? a[2].items : [a[2]]) : fail('Агрегаты задаются списком: {{"Имя", each List.Sum([Столбец]), type number}}.', a[2].p);
      const aggs = l.map(p => {
        if (p.t !== 'list' || p.items.length < 2) fail('Каждый агрегат — {"Имя", each …, тип}.', p.p);
        const name = str(p.items[0]); const e = p.items[1];
        if (e.t !== 'each') fail('Агрегат задаётся через each: each List.Sum([Столбец]) или each Table.RowCount(_).', e.p);
        if (/^Table\.RowCount\(\s*_\s*\)$/.test(e.text)) return { name, op: 'count' };
        const m = /^(List\.\w+)\(\s*\[([^\]]+)\]\s*\)$/.exec(e.text);
        if (!m || !AGG[m[1]]) fail('В группировке тренажёра поддерживаются List.Sum, List.Average, List.Min, List.Max и Table.RowCount(_).', e.p);
        return AGG[m[1]] === 'count' ? { name, op: 'count' } : { name, op: AGG[m[1]], col: m[2] };
      });
      return { op: 'group', by, aggs };
    }
    case 'Table.Distinct': return { op: 'dedupe', cols: a[1] ? strs(a[1]) : [] };
    case 'Table.RemoveRowsWithErrors': return { op: 'removeErrors', cols: a[1] ? strs(a[1]) : [] };
    case 'Table.Sort': {
      need(2); const l = a[1].t === 'list' ? a[1].items : [a[1]];
      return { op: 'sort', by: l.map(p => p.t === 'str' ? { col: p.v, desc: false } : p.t === 'list' ? { col: str(p.items[0]), desc: p.items[1]?.t === 'id' && p.items[1].v === 'Order.Descending' } : fail('Сортировка задаётся так: {{"Столбец", Order.Descending}}.', p.p)) };
    }
    case 'Table.AddIndexColumn': { need(2); const st: Step = { op: 'index', name: str(a[1]), start: a[2] ? num(a[2]) : 0 }; if (a[3] && num(a[3]) !== 1) fail('Шаг индекса в тренажёре — только 1.', a[3].p); return st; }
    case 'Table.AddColumn': {
      need(3); if (a[2].t !== 'each') fail('Третий аргумент Table.AddColumn — формула через each: each [Количество] * [Цена].', a[2].p);
      const st: Step = { op: 'addCol', name: str(a[1]), expr: a[2].text }; const tt = ty(a[3]); if (tt && tt !== 'any') st.type = tt; return st;
    }
    case 'Table.Pivot': {
      need(4); const st: Step = { op: 'pivot', col: str(a[2]), val: str(a[3]), agg: 'none' };
      if (a[4]) { const k = a[4].t === 'id' ? AGG[a[4].v] : null; if (!k) fail('Агрегирование сведения: List.Sum, List.Count, List.Min, List.Max или List.Average.', a[4].p); st.agg = k; }
      return st;
    }
    case 'Table.NestedJoin': {
      need(6); const w = a[2]; if (w.t !== 'id' || !qn.includes(w.v)) fail(`Запрос «${w.v ?? '?'}» не найден. Доступны: ${qn.join(', ') || 'других запросов нет'}.`, w.p);
      const kind = a[5].t === 'id' ? KINDS[a[5].v] : null; if (!kind) fail('Тип соединения: JoinKind.LeftOuter, Inner, FullOuter, RightOuter, LeftAnti или RightAnti.', a[5].p);
      return { op: 'merge', with: w.v, left: strs(a[1]), right: strs(a[3]), kind, as: str(a[4]) };
    }
    case 'Table.ExpandTableColumn': {
      if (isCombine) return { op: 'combineFiles', cols: a[2] ? strs(a[2]) : undefined };
      need(3); const st: Step = { op: 'expand', col: str(a[1]), fields: strs(a[2]) }; st.names = a[3] ? strs(a[3]) : st.fields; return st;
    }
    case 'Table.AggregateTableColumn': {
      need(3); const l = a[2].t === 'list' ? a[2].items : [];
      return { op: 'aggregate', col: str(a[1]), aggs: l.map(p => { const fn = p.items[1]; const name = str(p.items[2]); return fn.t === 'id' && fn.v === 'Table.RowCount' ? { op: 'count', field: str(p.items[0]), name } : { op: 'sum', field: str(p.items[0]), name }; }) };
    }
  }
  return fail(`Функция ${f} в тренажёре пока не поддерживается.`, n.p);
}
export function lineOf(src: string, pos?: number) { if (pos === undefined) return ''; const l = src.slice(0, pos).split('\n').length; return `Строка ${l}: `; }
