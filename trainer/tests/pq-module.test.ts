import { describe, it, expect } from 'vitest';
import pq from '../src/generated/pq.json';
import { source } from '../src/lib/pq-sources';
import { checkPq, run } from '../src/engine/pq';

const envFor = (t: any, v: number) => ({ queries: Object.fromEntries(Object.entries(t.queries || {}).map(([n, k]) => [n, source(k as string, v)])) });
const check = (t: any, steps: any[]) => checkPq([source(t.source, 1), source(t.source, 2)], steps, t.answer, [envFor(t, 1), envFor(t, 2)]);
const tasks = pq.tasks as any[];
const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

describe('модуль Power Query: каждая задача', () => {
  for (const t of tasks) it(t.id, () => {
    for (const v of [1, 2]) { const r = run(source(t.source, v), t.answer, envFor(t, v)); expect(r.error, t.id).toBeUndefined(); const fin = r.tables.at(-1)!; expect(fin.rows.length).toBeGreaterThan(2); expect(fin.rows.flat().some((c: any) => c && typeof c === 'object')).toBe(false); }
    expect(check(t, t.answer)).toEqual({ ok: true });
    expect(check(t, []).ok).toBe(false);
    if (t.answer.length > 1 && t.answer.at(-1).op !== 'sort') expect(check(t, t.answer.slice(0, -1)).ok, 'без последнего шага').toBe(false);
  });
});
describe('модуль Power Query: другие верные пути и типичные ошибки', () => {
  const ok = (id: string, s: any[]) => check(byId[id], s);
  it('столбцы: «удалить другие» вместо «удалить»', () => expect(ok('pq-cols', [{ op: 'keepCols', cols: ['Клиент', 'Город', 'Сумма'] }, { op: 'rename', col: 'Сумма', to: 'Выручка' }]).ok).toBe(true));
  it('цены: фильтр «по запросу» вместо удаления ошибок', () => expect(ok('pq-price', [{ op: 'promote' }, { op: 'filter', col: 'Цена', exclude: ['по запросу'] }, { op: 'replace', cols: ['Цена'], find: ' руб.', repl: '' }, { op: 'type', cols: { Товар: 'text', Категория: 'text', Цена: 'number' } }]).ok).toBe(true));
  it('извлечение: новый столбец, потом удалить исходный', () => expect(ok('pq-extract', [{ op: 'promote' }, { op: 'extract', col: 'Назначение платежа', mode: 'between', delim: '№ ', delim2: ' от', add: true }, { op: 'removeCols', cols: ['Назначение платежа'] }, { op: 'rename', col: 'Текст между разделителями', to: 'Номер счёта' }, { op: 'type', cols: { Дата: 'date', Плательщик: 'text', Сумма: 'number', 'Номер счёта': 'int' } }]).ok).toBe(true));
  it('условный столбец формулой M', () => expect(ok('pq-abc', [{ op: 'addCol', name: 'Группа', expr: 'if [Сумма] >= 15000 then "A" else if [Сумма] >= 7000 then "B" else "C"' }]).ok).toBe(true));
  it('ABC в неверном порядке условий — ошибка', () => expect(ok('pq-abc', [{ op: 'condCol', name: 'Группа', rules: [{ col: 'Сумма', op: 'ge', value: '7000', out: 'B' }, { col: 'Сумма', op: 'ge', value: '15000', out: 'A' }], else: 'C' }]).ok).toBe(false));
  it('дубликаты до очистки текста не удаляются', () => expect(ok('pq-dedupe', [{ op: 'promote' }, { op: 'dedupe', cols: [] }, { op: 'trim', cols: ['Клиент'] }, { op: 'proper', cols: ['Клиент'] }, { op: 'replace', cols: ['Город'], find: 'г. ', repl: '' }]).ok).toBe(false));
  it('слияние с префиксом — неверные имена; внутреннее соединение теряет строку на проверке', () => {
    expect(ok('pq-merge', [{ op: 'merge', with: 'Товары', left: ['Код товара'], right: ['Код товара'], kind: 'leftouter', as: 'Товары' }, { op: 'expand', col: 'Товары', fields: ['Товар', 'Цена'], names: ['Товары.Товар', 'Товары.Цена'] }]).ok).toBe(false);
    const inner: any = ok('pq-merge', [{ op: 'merge', with: 'Товары', left: ['Код товара'], right: ['Код товара'], kind: 'inner', as: 'Товары' }, { op: 'expand', col: 'Товары', fields: ['Товар', 'Цена'], names: ['Товар', 'Цена'] }]);
    expect(inner.ok).toBe(false); expect(inner.msg).toMatch(/проверочн/);
  });
  it('сумма строки: свой столбец без типа — подсказка про тип', () => { const r: any = ok('pq-merge-sum', [{ op: 'merge', with: 'Товары', left: ['Код товара'], right: ['Код товара'], kind: 'leftouter', as: 'Товары' }, { op: 'expand', col: 'Товары', fields: ['Цена'], names: ['Цена'] }, { op: 'addCol', name: 'Сумма', expr: '[Количество] * [Цена]' }]); expect(r.msg).toMatch(/тип/); });
  it('неразвёрнутый столбец', () => { const r: any = ok('pq-merge-clients', [{ op: 'merge', with: 'Клиенты', left: ['Код клиента'], right: ['Код клиента'], kind: 'leftouter', as: 'Клиенты' }]); expect(r.ok).toBe(false); });
  it('добавление одной таблицы из двух', () => expect(ok('pq-append', [{ op: 'append', queries: ['Продажи_июль'] }]).ok).toBe(false));
  it('сведение без агрегирования — ошибки', () => { const r: any = ok('pq-pivot', [{ op: 'pivot', col: 'Месяц', val: 'Сумма', agg: 'none' }]); expect(r.msg).toMatch(/ошибки/); });
  it('топ без сортировки', () => expect(ok('pq-top', [{ op: 'group', by: ['Клиент'], aggs: [{ name: 'Выручка', op: 'sum', col: 'Сумма' }] }, { op: 'keepTop', n: 5 }]).ok).toBe(false));
  it('папка: без фильтра .txt — ошибка объединения', () => { const r: any = ok('pq-folder', [{ op: 'combineFiles' }, { op: 'type', cols: { Дата: 'date', 'Номер заказа': 'int', Клиент: 'text', Сумма: 'number' } }]); expect(r.msg).toMatch(/не является книгой Excel/); });
  it('папка: месяц двумя заменами', () => expect(ok('pq-folder-month', [{ op: 'filter', col: 'Extension', exclude: ['.txt'] }, { op: 'combineFiles' }, { op: 'replace', cols: ['Source.Name'], find: 'Продажи_', repl: '' }, { op: 'replace', cols: ['Source.Name'], find: '.xlsx', repl: '' }, { op: 'rename', col: 'Source.Name', to: 'Месяц' }, { op: 'type', cols: { Дата: 'date', 'Номер заказа': 'int', Клиент: 'text', Сумма: 'number' } }]).ok).toBe(true));
  it('код M: исходный запрос коллеги не подходит, List.Contains подходит', () => {
    expect(ok('pq-m-edit', byId['pq-m-edit'].starter).ok).toBe(false);
    expect(ok('pq-m-edit', [{ op: 'selectRows', expr: 'List.Contains({"Москва", "Казань"}, [Город])' }, ...byId['pq-m-edit'].starter.slice(1)]).ok).toBe(true);
  });
  it('условный фильтр одной формулой', () => expect(ok('pq-cond-filter', [{ op: 'selectRows', expr: '[Сумма] > 10000 and [Город] = "Москва"' }]).ok).toBe(true));
  it('даты: преобразование вместо добавления', () => expect(ok('pq-dates', [{ op: 'dateOp', col: 'Дата', mode: 'year' }]).ok).toBe(false));
});
