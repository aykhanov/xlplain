import { describe, it, expect } from 'vitest';
import { build } from '../scripts/dataset.mjs';
import { buildModel, MONTHS } from '../src/lib/bi-model';
import { addMeasure, evalIn, matrix, colFilter, applyFilter, parseMeasure, DaxError } from '../src/engine/dax';

const BASE = ["Выручка = SUM('Продажи'[Сумма])"];
for (const seed of [1, 2]) describe('DAX против прямого расчёта, seed ' + seed, () => {
  const db = build(seed);
  const orders = new Map(db.orders.map((o: any) => [o.id, o]));
  const clients = new Map(db.clients.map((c: any) => [c.id, c]));
  const products = new Map(db.products.map((p: any) => [p.id, p]));
  const lines = db.order_items.map((i: any) => { const o: any = orders.get(i.order_id); const c: any = clients.get(o.client_id); const p: any = products.get(i.product_id); return { order: o.id, date: o.order_date, month: +o.order_date.slice(5, 7), status: o.status, city: c.city, segment: c.segment, cat: p.category, sum: i.qty * i.price, qty: i.qty, pid: p.id }; });
  const S = (f: (l: any) => boolean = () => true) => lines.filter(f).reduce((s: number, l: any) => s + l.sum, 0);
  const m = buildModel(seed, BASE);
  const cityF = (c: string) => [colFilter(m, { table: 'Клиенты', col: 'Город' }, [c])];
  const monthF = (k: number) => [colFilter(m, { table: 'Календарь', col: 'Месяц' }, [MONTHS[k - 1]])];
  const def = (t: string) => addMeasure(m, t);

  it('SUM и фильтр по справочнику', () => {
    expect(evalIn(m, 'Выручка', [])).toBe(S());
    for (const c of ['Москва', 'Казань', 'Пермь']) expect(evalIn(m, 'Выручка', cityF(c))).toBe(S(l => l.city === c));
    expect(evalIn(m, 'Выручка', monthF(8))).toBe(S(l => l.month === 8));
  });
  it('DISTINCTCOUNT, DIVIDE', () => {
    def("Заказы = DISTINCTCOUNT('Продажи'[Номер заказа])");
    def('Средний чек = DIVIDE([Выручка]; [Заказы])');
    const n = new Set(lines.filter(l => l.city === 'Казань').map(l => l.order)).size;
    expect(evalIn(m, 'Заказы', cityF('Казань'))).toBe(n);
    expect(evalIn(m, 'Средний чек', cityF('Казань'))).toBeCloseTo(S(l => l.city === 'Казань') / n, 6);
  });
  it('CALCULATE с условием и переопределение фильтра', () => {
    def('Доставлено = CALCULATE([Выручка]; \'Продажи\'[Статус] = "Доставлен")');
    expect(evalIn(m, 'Доставлено', cityF('Москва'))).toBe(S(l => l.city === 'Москва' && l.status === 'Доставлен'));
    def('Москва всегда = CALCULATE([Выручка]; \'Клиенты\'[Город] = "москва")');
    expect(evalIn(m, 'Москва всегда', cityF('Казань'))).toBe(S(l => l.city === 'Москва'));
    def('Москва и фильтр = CALCULATE([Выручка]; KEEPFILTERS(\'Клиенты\'[Город] = "Москва"))');
    expect(evalIn(m, 'Москва и фильтр', cityF('Казань'))).toBe(null);
  });
  it('ALL, REMOVEFILTERS, ALLEXCEPT, ALLSELECTED', () => {
    def("Доля = DIVIDE([Выручка]; CALCULATE([Выручка]; ALL('Клиенты'[Город])))");
    expect(evalIn(m, 'Доля', cityF('Пермь'))).toBeCloseTo(S(l => l.city === 'Пермь') / S(), 9);
    def("Доля2 = DIVIDE([Выручка]; CALCULATE([Выручка]; REMOVEFILTERS('Клиенты')))");
    const opt = colFilter(m, { table: 'Клиенты', col: 'Сегмент' }, ['Опт']);
    const fs = applyFilter(m, [opt], cityF('Пермь')[0]);
    expect(evalIn(m, 'Доля2', fs)).toBeCloseTo(S(l => l.city === 'Пермь' && l.segment === 'Опт') / S(), 9);
    def("Доля сел = DIVIDE([Выручка]; CALCULATE([Выручка]; ALLSELECTED('Клиенты'[Город])))");
    expect(evalIn(m, 'Доля сел', fs, [opt])).toBeCloseTo(S(l => l.city === 'Пермь' && l.segment === 'Опт') / S(l => l.segment === 'Опт'), 9);
    def("Все кроме = CALCULATE([Выручка]; ALLEXCEPT('Клиенты'; 'Клиенты'[Сегмент]))");
    expect(evalIn(m, 'Все кроме', fs)).toBe(S(l => l.segment === 'Опт'));
    def("Всё = CALCULATE([Выручка]; ALL('Продажи'))");
    expect(evalIn(m, 'Всё', fs)).toBe(S());
  });
  it('SUMX + RELATED, ошибка без RELATED', () => {
    def("Себестоимость продаж = SUMX('Продажи'; 'Продажи'[Количество] * RELATED('Товары'[Себестоимость]))");
    const cost = (m.byName.get('товары') as any).rows; const costOf = new Map(cost.map((r: any) => [r[0], r[4]]));
    expect(evalIn(m, 'Себестоимость продаж', [])).toBe(lines.reduce((s: number, l: any) => s + l.qty * (costOf.get(l.pid) as number), 0));
    def("Плохо = SUMX('Продажи'; 'Продажи'[Количество] * 'Товары'[Себестоимость])");
    expect(() => evalIn(m, 'Плохо', [])).toThrow(/RELATED/);
  });
  it('FILTER по заказам с мерой (переход контекста)', () => {
    def("Крупные = COUNTROWS(FILTER(VALUES('Продажи'[Номер заказа]); [Выручка] >= 10000))");
    const by = new Map<number, number>(); for (const l of lines) by.set(l.order, (by.get(l.order) || 0) + l.sum);
    expect(evalIn(m, 'Крупные', [])).toBe([...by.values()].filter(v => v >= 10000).length);
    def("Крупные плохо = COUNTROWS(FILTER(VALUES('Продажи'[Номер заказа]); SUM('Продажи'[Сумма]) >= 10000))");
    expect(evalIn(m, 'Крупные плохо', [])).not.toBe(evalIn(m, 'Крупные', []));
  });
  it('логика времени', () => {
    def("YTD = TOTALYTD([Выручка]; 'Календарь'[Дата])");
    def("YTD2 = CALCULATE([Выручка]; DATESYTD('Календарь'[Дата]))");
    for (const k of [6, 8, 10, 12]) { expect(evalIn(m, 'YTD', monthF(k))).toBe(S(l => l.month <= k)); expect(evalIn(m, 'YTD2', monthF(k))).toBe(S(l => l.month <= k)); }
    def("Прошлый месяц = CALCULATE([Выручка]; PREVIOUSMONTH('Календарь'[Дата]))");
    def("Сдвиг = CALCULATE([Выручка]; DATEADD('Календарь'[Дата]; -1; MONTH))");
    for (const k of [7, 9, 10]) { expect(evalIn(m, 'Прошлый месяц', monthF(k))).toBe(S(l => l.month === k - 1)); expect(evalIn(m, 'Сдвиг', monthF(k))).toBe(S(l => l.month === k - 1)); }
    expect(evalIn(m, 'Прошлый месяц', monthF(6))).toBe(null);
    def("YTD по факту = TOTALYTD([Выручка]; 'Продажи'[Дата])");
    expect(evalIn(m, 'YTD по факту', monthF(9))).toBe(S(l => l.month === 9));
  });
  it('RANKX, VAR, SWITCH, IN, ISINSCOPE', () => {
    def("Ранг = RANKX(ALL('Клиенты'[Город]); [Выручка])");
    const cities = [...new Set(lines.map(l => l.city))].map(c => [c, S(l => l.city === c)] as [string, number]).sort((a, b) => b[1] - a[1]);
    const mx = matrix(m, { table: 'Клиенты', col: 'Город' }, ['Ранг'], []);
    for (const r of mx.rows) expect(r.values[0]).toBe(cities.findIndex(c => c[0] === r.label) + 1);
    def('Класс = VAR v = [Выручка] RETURN SWITCH(TRUE(); v > 200000; "A"; v > 50000; "B"; "C")');
    expect(['A', 'B', 'C']).toContain(evalIn(m, 'Класс', cityF('Москва')));
    def('Столицы = CALCULATE([Выручка]; \'Клиенты\'[Город] IN {"Москва"; "Казань"})');
    expect(evalIn(m, 'Столицы', [])).toBe(S(l => l.city === 'Москва' || l.city === 'Казань'));
    def("Скоуп = IF(ISINSCOPE('Клиенты'[Город]); 1; 0)");
    const sx = matrix(m, { table: 'Клиенты', col: 'Город' }, ['Скоуп'], []);
    expect(sx.total[0]).toBe(0); expect(sx.rows[0].values[0]).toBe(1);
  });
  it('разделитель запятая и точка', () => {
    def("Запятая = CALCULATE([Выручка], 'Клиенты'[Город] = \"Казань\") * 0.5");
    expect(evalIn(m, 'Запятая', [])).toBeCloseTo(S(l => l.city === 'Казань') * 0.5, 6);
    def("ТочкаЗапятая = ROUND([Выручка] * 0,5; 0)");
    expect(evalIn(m, 'ТочкаЗапятая', [])).toBe(Math.round(S() * 0.5));
  });
});

describe('DAX: ошибки как в Power BI', () => {
  const m = buildModel(1, BASE);
  const e = (t: string) => { try { addMeasure(m, t); evalIn(m, parseMeasure(t).name, []); return ''; } catch (x: any) { expect(x).toBeInstanceOf(DaxError); return x.message; } };
  it('сообщения', () => {
    expect(e("Х = 'Продажи'[Сумма]")).toMatch(/Невозможно определить одно значение/);
    expect(e('Х = SUM([Выручка])')).toMatch(/это мера/);
    expect(e("Х = SUM('Продажи'[Сумма]")).toMatch(/скобк|оборвалась/);
    expect(e("Х = SUMM('Продажи'[Сумма])")).toMatch(/не найдена/);
    expect(e("Х = CALCULATE([Выручка]; [Выручка] > 100)")).toMatch(/FILTER/);
    expect(e('Х = SUM(\'Продажи\'[Сумма]) + "а"')).toMatch(/Text/);
    expect(e("Х = VALUES('Клиенты'[Город])")).toMatch(/нескольких значений/);
    expect(e("SUM('Продажи'[Сумма])")).toMatch(/имени/);
    expect(e("Х = [Х] + 1")).toMatch(/циклическая/);
    expect(e("Х = CALCULATE([Выручка]; 'Клиенты'[Город] = \"Москва\"; 'Продажи'[Статус] = \"Доставлен\" , 1)")).toMatch(/точкой с запятой/);
  });
});
