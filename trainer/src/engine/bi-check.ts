// @ts-nocheck
// Проверка меры DAX: мера пользователя и эталон считаются в одних и тех же контекстах
// (итог, разрезы по полям, срезы) на открытых данных и на проверочном наборе.
import { parseMeasure, evalIn, colFilter, applyFilter, distinctSorted, low, fmt, DaxError, type Model, type Filter, type Field } from './dax';

export const CHECK_ROWS: Field[] = [
  { table: 'Клиенты', col: 'Город' }, { table: 'Товары', col: 'Категория' }, { table: 'Календарь', col: 'Месяц' }, { table: 'Продажи', col: 'Статус' },
];
export const CHECK_SLICERS: { label: string; f: (m: Model) => Filter[] }[] = [
  { label: '', f: () => [] },
  { label: 'Сегмент = Опт', f: m => [colFilter(m, { table: 'Клиенты', col: 'Сегмент' }, ['Опт'])] },
  { label: 'Месяц = Сентябрь, Октябрь', f: m => [colFilter(m, { table: 'Календарь', col: 'Месяц' }, ['Сентябрь', 'Октябрь'])] },
  { label: 'Город = Москва, Казань', f: m => [colFilter(m, { table: 'Клиенты', col: 'Город' }, ['Москва', 'Казань'])] },
  { label: 'Категория = Кофе, Чай', f: m => [colFilter(m, { table: 'Товары', col: 'Категория' }, ['Кофе', 'Чай'])] },
];
const same = (a, b) => {
  if ((a === null || a === 0 || a === false) && (b === null || b === 0 || b === false)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a === 'string' && typeof b === 'string') return low(a) === low(b);
  return a === b;
};
export function userMeasure(m: Model, text: string, task) {
  const { name, node } = parseMeasure(text);
  const clash = m.measures.get(low(name));
  if (clash && !clash.user) throw new DaxError(`Мера с именем «${name}» уже есть в модели. Выберите другое имя, например «${task.measure_name || name + ' 2'}».`, 0);
  const tcol = m.tables.find(t => t.ci.has(low(name)));
  if (tcol) throw new DaxError(`Имя «${name}» уже занято столбцом таблицы «${tcol.name}». Выберите другое имя меры.`, 0);
  for (const [k, v] of m.measures) if (v.user) m.measures.delete(k);
  const ms = { name, table: 'Продажи', text, node, user: true, format: undefined };
  m.measures.set(low(name), ms);
  return ms;
}
export function refMeasure(m: Model, task) {
  const { node } = parseMeasure(task.answer);
  return { name: '__ref', table: 'Продажи', text: task.answer, node };
}

export type CheckResult = { ok: true } | { ok: false; msg: string; where?: string };
export function checkDax(models: Model[], text: string, task, format?: string): CheckResult {
  const rows: Field[] = task.check_rows ? task.check_rows.map(s => { const [, t, c] = /^'?([^'\[]+)'?\[(.+)\]$/.exec(s); return { table: t, col: c }; }) : CHECK_ROWS;
  for (let mi = 0; mi < models.length; mi++) {
    const m = models[mi];
    const u = userMeasure(m, text, task), r = refMeasure(m, task);
    for (const sl of CHECK_SLICERS) {
      const base = sl.f(m);
      const cells: { label: string; fs: Filter[]; scope?: Set<string> }[] = task.check_total === false ? [] : [{ label: 'Итог', fs: base }];
      for (const f of rows) for (const v of distinctSorted(m, f)) cells.push({ label: `${f.col} = ${fmt(v)}`, fs: applyFilter(m, base, colFilter(m, f, [v])), scope: new Set([low(f.table + '|' + f.col)]) });
      for (const c of cells) {
        const want = evalIn(m, r, c.fs, base, c.scope);
        const got = evalIn(m, u, c.fs, base, c.scope);
        if (same(got, want)) continue;
        const where = c.label + (sl.label ? `, срез «${sl.label}»` : '');
        if (mi > 0) return { ok: false, msg: 'На открытых данных мера даёт верный результат, а на проверочном наборе — нет. Похоже, в формулу вписано готовое число или конкретное значение вместо расчёта.', where };
        if (typeof got === 'number' && typeof want === 'number' && want !== 0 && Math.abs(got / want - 100) < 1e-6) return { ok: false, msg: `Мера в 100 раз больше нужной (${where}). Долю в Power BI оставляют дробью от 0 до 1, а проценты включают форматом меры.`, where };
        const f = v => v === null ? 'пусто' : typeof v === 'number' ? fmt(v, task.format === 'percent' ? 'percent' : Number.isInteger(v) ? 'int' : 'dec2') : String(v);
        return { ok: false, msg: `Не сходится в строке «${where}»: ваша мера даёт ${f(got)}, а нужно ${f(want)}.`, where };
      }
    }
  }
  if (task.format && format !== task.format) {
    const names = { percent: 'Процент', int: 'Целое число', dec2: 'Десятичное число', rub: 'Валюта' };
    return { ok: false, msg: `Значения верные. Осталось выбрать формат меры «${names[task.format]}» на ленте: группа «Форматирование», список «Формат».` };
  }
  return { ok: true };
}
