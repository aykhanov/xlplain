import { describe, it, expect } from 'vitest';
import { run, mCode, applyStep } from '../src/engine/pq';
import { parseM, evalM } from '../src/engine/m';

const T = (cols: [string, any][], rows: any[][]) => ({ cols: cols.map(([name, type]) => ({ name, type })), rows });
const sales = T([['Заказ', 'int'], ['Код', 'int'], ['Кол', 'number'], ['Дата', 'date']], [[1, 10, 2, 46174], [2, 20, 1, 46200], [3, 99, 5, 46205], [4, 10, 3, 46210]]);
const prod = T([['Код', 'int'], ['Товар', 'text'], ['Цена', 'number']], [[10, 'Кофе', 500], [20, 'Чай', 300], [30, 'Сахар', 90]]);
const env = { queries: { Товары: prod } };
const last = (steps: any[], src = sales) => { const r = run(src, steps, env); if (r.error) throw new Error(r.error.msg); return r.tables.at(-1)!; };

describe('язык M', () => {
  const ev = (s: string, row: any = {}) => evalM(parseM(s), (n: string) => row[n]);
  it('арифметика, текст, if', () => {
    expect(ev('[a] * [b] + 1', { a: 2, b: 3 })).toBe(7);
    expect(ev('if [a] >= 10 then "Крупный" else "Обычный"', { a: 12 })).toBe('Крупный');
    expect(ev('Text.Upper([x]) & "!"', { x: 'ок' })).toBe('ОК!');
    expect(ev('Number.Round(2.5)')).toBe(2);
    expect(ev('Number.Round(10.125, 2)')).toBeCloseTo(10.12, 6);
    expect(ev('Text.BetweenDelimiters("Счёт № 123 от 01.06", "№ ", " от")')).toBe('123');
    expect(ev('Date.Month(#date(2026, 7, 15))')).toBe(7);
    expect(ev('[a] + 1', { a: null })).toBe(null);
    expect(ev('Text.Combine({[f], [i]}, " ")', { f: 'Иванов', i: 'Иван' })).toBe('Иванов Иван');
  });
  it('ошибки по-русски', () => {
    expect(() => ev('[a] & 1', { a: 'x' })).toThrow(/Text.From/);
    expect(() => ev('[a] * 2', { a: '5' })).toThrow(/Text/);
    expect(() => ev('text.upper([a])', { a: 'x' })).toThrow(/регистр/);
    expect(() => parseM('if [a] > 1 then 2')).toThrow(/else/);
    expect(() => parseM('Number.Round([a]; 2)')).toThrow(/запятой/);
  });
});
describe('новые шаги', () => {
  it('слияние и разворот', () => {
    const t = last([{ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'leftouter' }, { op: 'expand', col: 'Товары', fields: ['Товар', 'Цена'], names: ['Товар', 'Цена'] }]);
    expect(t.rows.length).toBe(4); expect(t.rows[2].slice(-2)).toEqual([null, null]);
    expect(last([{ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'inner' }, { op: 'expand', col: 'Товары', fields: ['Цена'], names: ['Цена'] }]).rows.length).toBe(3);
    expect(last([{ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'leftanti' }]).rows.map(r => r[0])).toEqual([3]);
    expect(last([{ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'fullouter' }]).rows.length).toBe(5);
    expect(mCode({ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'leftouter' }, 'Источник')).toContain('JoinKind.LeftOuter');
  });
  it('свой столбец, условный, тип', () => {
    const t = last([{ op: 'merge', with: 'Товары', left: ['Код'], right: ['Код'], kind: 'inner' }, { op: 'expand', col: 'Товары', fields: ['Цена'], names: ['Цена'] }, { op: 'addCol', name: 'Сумма', expr: '[Кол] * [Цена]', type: 'number' }, { op: 'condCol', name: 'Размер', rules: [{ col: 'Сумма', op: 'ge', value: '1000', out: 'Крупный' }], else: 'Обычный' }]);
    expect(t.rows.map(r => r.slice(-2))).toEqual([[1000, 'Крупный'], [300, 'Обычный'], [1500, 'Крупный']]);
    const d = last([{ op: 'addCol', name: 'Начало', expr: 'Date.StartOfMonth([Дата])' }]);
    expect(d.cols.at(-1)!.type).toBe('date');
  });
  it('добавление, сведение, сортировка, индекс, дубликаты, извлечение', () => {
    expect(applyStep(prod, { op: 'append', queries: ['Товары'] }, env).rows.length).toBe(6);
    expect(applyStep(prod, { op: 'dedupe' }, env).rows.length).toBe(3);
    expect(applyStep(applyStep(prod, { op: 'append', queries: ['Товары'] }, env), { op: 'dedupe', cols: ['Код'] }, env).rows.length).toBe(3);
    expect(applyStep(prod, { op: 'sort', by: [{ col: 'Цена', desc: true }] }).rows.map(r => r[1])).toEqual(['Кофе', 'Чай', 'Сахар']);
    expect(applyStep(prod, { op: 'index' }).rows.map(r => r[3])).toEqual([1, 2, 3]);
    const long = T([['М', 'text'], ['Мес', 'text'], ['С', 'number']], [['А', 'Июнь', 1], ['А', 'Июль', 2], ['Б', 'Июнь', 3], ['А', 'Июнь', 4]]);
    const pv = applyStep(long, { op: 'pivot', col: 'Мес', val: 'С', agg: 'sum' });
    expect(pv.cols.map(c => c.name)).toEqual(['М', 'Июнь', 'Июль']); expect(pv.rows).toEqual([['А', 5, 2], ['Б', 3, null]]);
    expect((applyStep(long, { op: 'pivot', col: 'Мес', val: 'С', agg: 'none' }).rows[0][1] as any).err).toMatch(/Слишком много/);
    expect(applyStep(prod, { op: 'extract', col: 'Товар', mode: 'first', n: 2 }).rows[0][1]).toBe('Ко');
    expect(applyStep(sales, { op: 'dateOp', col: 'Дата', mode: 'month', add: true }).rows[0].at(-1)).toBe(6);
  });
});
