import { describe, it, expect } from 'vitest';
import bi from '../src/generated/bi.json';
import { source } from '../src/lib/pq-sources';
import { checkPq, run, fullM, stepNames } from '../src/engine/pq';

const tasks = Object.fromEntries((bi.tasks as any[]).filter(t => t.check === 'pq').map(t => [t.id, t]));
const srcs = (t: any) => [source(t.source, 1), source(t.source, 2)];
const ok = (t: any, steps: any[]) => checkPq(srcs(t), steps, t.answer);

describe('Power Query: эталоны и варианты', () => {
  it('эталоны проходят, источник сам по себе — нет', () => {
    for (const t of Object.values(tasks) as any[]) {
      expect(ok(t, t.answer)).toEqual({ ok: true });
      expect(ok(t, []).ok).toBe(false);
      const r = run(source(t.source, 1), t.answer); expect(r.error).toBeUndefined();
      expect(r.tables.at(-1)!.rows.length).toBeGreaterThan(3);
      expect(fullM(t.answer, 'X')).toContain(stepNames(t.answer).at(-1)!.split(' ')[0]);
    }
  });
  it('очистка 1С: альтернативы и ошибки', () => {
    const t = tasks['pq-clean'];
    expect(ok(t, [{ op: 'removeTop', n: 3 }, { op: 'promote' }, { op: 'removeBlank' }, { op: 'removeBottom', n: 1 }, { op: 'type', cols: { Дата: 'date', Сумма: 'number' } }, { op: 'type', cols: { Номер: 'text', Клиент: 'text' } }])).toEqual({ ok: true });
    expect(ok(t, [{ op: 'removeTop', n: 3 }, { op: 'promote' }, { op: 'filter', col: 'Дата', exclude: [null, 'Итого'] }, { op: 'type', cols: { Дата: 'date', Номер: 'text', Клиент: 'text', Сумма: 'number' } }])).toEqual({ ok: true });
    const noBlank = ok(t, [{ op: 'removeTop', n: 3 }, { op: 'promote' }, { op: 'filter', col: 'Дата', exclude: ['Итого'] }, { op: 'type', cols: { Дата: 'date', Номер: 'text', Клиент: 'text', Сумма: 'number' } }]);
    expect(noBlank.ok).toBe(false);
    const typeFirst: any = ok(t, [{ op: 'removeTop', n: 3 }, { op: 'promote' }, { op: 'removeBlank' }, { op: 'type', cols: { Дата: 'date', Номер: 'text', Клиент: 'text', Сумма: 'number' } }, { op: 'filter', col: 'Дата', exclude: ['Итого'] }]);
    expect(typeFirst.ok).toBe(false); expect(typeFirst.msg).toMatch(/ошибки/);
    const noType: any = ok(t, [{ op: 'removeTop', n: 3 }, { op: 'promote' }, { op: 'removeBlank' }, { op: 'filter', col: 'Дата', exclude: ['Итого'] }]);
    expect(noType.msg).toMatch(/тип/);
    const missingCol: any = ok(t, [{ op: 'removeTop', n: 3 }, { op: 'removeBlank' }, { op: 'filter', col: 'Дата', exclude: ['Итого'] }]);
    expect(missingCol.msg).toMatch(/Столбец «Дата» таблицы не найден/);
  });
  it('unpivot: «только выделенные» тоже подходит для этой выгрузки', () => {
    const t = tasks['pq-unpivot'];
    const months = (run(source('plan', 1), [{ op: 'promote' }]).tables[1].cols.map(c => c.name)).slice(1);
    expect(ok(t, [{ op: 'promote' }, { op: 'unpivot', cols: months }, { op: 'rename', col: 'Атрибут', to: 'Месяц' }, { op: 'rename', col: 'Значение', to: 'План' }, { op: 'type', cols: { Менеджер: 'text', Месяц: 'text', План: 'number' } }]).ok).toBe(true);
    expect(ok(t, [{ op: 'promote' }, { op: 'unpivotOther', cols: ['Менеджер'] }, { op: 'type', cols: { Менеджер: 'text', Атрибут: 'text', Значение: 'number' } }]).ok).toBe(false);
  });
  it('группировка: без заполнения вниз и без типа — ошибка', () => {
    const t = tasks['pq-group'];
    expect(ok(t, [{ op: 'promote' }, { op: 'type', cols: { Категория: 'text', Сумма: 'number' } }, { op: 'group', by: ['Категория'], aggs: [{ name: 'Сумма', op: 'sum', col: 'Сумма' }] }]).ok).toBe(false);
    const r: any = ok(t, [{ op: 'promote' }, { op: 'fillDown', cols: ['Категория'] }, { op: 'type', cols: { Категория: 'text' } }, { op: 'group', by: ['Категория'], aggs: [{ name: 'Сумма', op: 'sum', col: 'Сумма' }] }]);
    expect(r.ok).toBe(false);
  });
});
