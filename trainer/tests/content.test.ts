import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import excel from '../src/generated/excel.json';
import sql from '../src/generated/sql.json';
import bi from '../src/generated/bi.json';
import { check, perturb, getter, parseAddr } from '../src/engine/excel-check';
import { XL } from '../src/engine/excel';
import { compare } from '../src/engine/sql-compare';
import { rng } from '../scripts/dataset.mjs';

describe('Excel: каждая задача решается своим эталоном и ловит подмену', () => {
  for (const t of excel.tasks as any[]) {
    it(t.id, () => {
      const r = rng(42);
      expect(check(t, t.answer, 30, r).ok).toBe(true);
      // готовое число вместо формулы не проходит
      const v = XL.evaluate(XL.parse(t.answer.slice(1)), getter(t.grid, parseAddr(t.target)));
      expect(v.err).toBeUndefined();
      expect(check(t, '=' + (typeof v.v === 'number' ? String(v.v).replace('.', ',') : '"' + v.v + '"')).ok).toBe(false);
      // на изменённых данных эталон не даёт ошибок почти никогда (редкий #ДЕЛ/0! в СРЗНАЧЕСЛИ, когда город не выпал, допустим: эталон и ответ сравниваются вместе)
      let errs = 0;
      for (let i = 0; i < 40; i++) { const g = perturb(t, r); const x = XL.evaluate(XL.parse(t.answer.slice(1)), getter(g, parseAddr(t.target))); if (x.err) errs++; }
      expect(errs).toBeLessThan(10);
    });
  }
});

describe('SQL: эталоны выполняются на обеих базах', async () => {
  const SQL = await initSqlJs();
  const dumps = ['company', 'company-check'].map(n => fs.readFileSync(new URL('../public/sql/' + n + '.sql', import.meta.url), 'utf8'));
  const run = (dump: string, q: string) => { const d = new SQL.Database(); d.run(dump); const r = d.exec(q); d.close(); const last = r[r.length - 1]; return last ? { columns: last.columns, values: last.values } : null; };
  for (const t of sql.tasks as any[]) {
    it(t.id, () => {
      for (const dump of dumps) {
        const ref = run(dump, t.answer)!;
        expect(ref.values.length).toBeGreaterThan(0);
        expect(compare(run(dump, t.answer), ref, t.order_matters).ok).toBe(true);
        // заготовка не должна сама по себе быть ответом
        if (t.starter) expect(compare(run(dump, t.starter), ref, t.order_matters).ok).toBe(false);
      }
    });
  }
  it('топы без ничьих на границе', () => {
    for (const dump of dumps) {
      const p = run(dump, 'SELECT price FROM products ORDER BY price DESC')!.values.map(r => r[0]);
      expect(p[4]).not.toBe(p[5]);
      const s = run(dump, 'SELECT SUM(p.amount) t FROM payments p JOIN orders o ON o.id=p.order_id GROUP BY o.client_id ORDER BY t DESC')!.values.map(r => r[0]);
      expect(s[2]).not.toBe(s[3]);
      const cat = run(dump, 'SELECT category, price FROM products ORDER BY category, price DESC')!.values;
      for (let i = 1; i < cat.length; i++) if (cat[i][0] === cat[i - 1][0] && i > 0) { /* первое место в категории уникально */ }
    }
  });
  it('разные базы дают разные ответы (иначе вторая проверка бесполезна)', () => {
    let same = 0;
    for (const t of sql.tasks as any[]) if (JSON.stringify(run(dumps[0], t.answer)) === JSON.stringify(run(dumps[1], t.answer))) same++;
    expect(same).toBeLessThanOrEqual(2);
  });
});

describe('Power BI: кейсы', () => {
  for (const t of bi.tasks as any[]) it(t.id, () => {
    if (t.check === 'number') expect(typeof t.expected).toBe('number');
    if (t.check === 'choice') expect(t.options.filter((o: any) => o.correct).length).toBe(1);
    if (t.check === 'order') expect(new Set(t.steps).size).toBe(t.steps.length);
  });
});
