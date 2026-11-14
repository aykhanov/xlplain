import { describe, it, expect } from 'vitest';
import pqm from '../src/generated/pq.json';
import bim from '../src/generated/bi.json';
import { source, SOURCES } from '../src/lib/pq-sources';
import { fullM, checkPq, stepNames } from '../src/engine/pq';
import { parseQuery, parseStepExpr } from '../src/engine/m-steps';

const tasks = [...(pqm.tasks as any[]), ...(bim.tasks as any[]).filter(t => t.check === 'pq')];
const envFor = (t: any, v: number) => ({ queries: Object.fromEntries(Object.entries(t.queries || {}).map(([n, k]) => [n, source(k as string, v)])) });
describe('код M → шаги → тот же результат', () => {
  for (const t of tasks) it(t.id, () => {
    const code = fullM(t.answer, SOURCES[t.source].expr);
    const steps = parseQuery(code, Object.keys(t.queries || {}));
    expect(steps.length).toBe(t.answer.length);
    expect(checkPq([source(t.source, 1), source(t.source, 2)], steps, t.answer, [envFor(t, 1), envFor(t, 2)])).toEqual({ ok: true });
    expect(stepNames(steps)).toEqual(stepNames(t.answer));
  });
});
describe('ручная правка кода', () => {
  it('свой фильтр, переименование шага, ошибки', () => {
    const code = `let\n    Источник = Excel.Workbook(File.Contents("C:\\\\a.xlsx"), null, true){[Item="Заказы",Kind="Sheet"]}[Data],\n    #"Крупные заказы" = Table.SelectRows(Источник, each [Сумма] > 10000 and [Город] = "Москва"),\n    Итог = Table.Sort(#"Крупные заказы", {{"Сумма", Order.Descending}})\nin\n    Итог`;
    const s = parseQuery(code);
    expect(s).toEqual([{ op: 'selectRows', expr: '[Сумма] > 10000 and [Город] = "Москва"', step: 'Крупные заказы' }, { op: 'sort', by: [{ col: 'Сумма', desc: true }], step: 'Итог' }]);
    expect(() => parseQuery(code.replace('#"Крупные заказы", {{', 'Источник, {{'))).toThrow(/цепочкой/);
    expect(() => parseQuery(code.replace('in\n    Итог', 'in\n    Источник'))).toThrow(/последнего шага/);
    expect(() => parseQuery(code.replace('[Сумма] > 10000 and', '[Сумма] > 10000 and and'))).toThrow();
    expect(() => parseQuery(code.replace('),\n    Итог', ')\n    Итог'))).toThrow(/запятая/);
    expect(parseStepExpr('= Table.SelectRows(#"Шаг", each Text.StartsWith([Клиент], "ООО"))', 'Шаг')).toEqual({ op: 'selectRows', expr: 'Text.StartsWith([Клиент], "ООО")' });
    expect(() => parseStepExpr('= Table.Buffer(Шаг)', 'Шаг')).toThrow(/не поддерживается/);
  });
});
