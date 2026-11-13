// @ts-nocheck
// Исходные «грязные» выгрузки для задач Power Query. Вариант 1 видит пользователь, вариант 2 — проверочный.
import { build, rng } from '../../scripts/dataset.mjs';
import type { PTable } from '../engine/pq';

const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, ' ');
const ddmm = (iso: string) => iso.split('-').reverse().join('.');
const raw = (rows: any[][]): PTable => { const w = Math.max(...rows.map(r => r.length)); return { cols: Array.from({ length: w }, (_, i) => ({ name: 'Column' + (i + 1), type: 'any' })), rows: rows.map(r => Array.from({ length: w }, (_, i) => r[i] ?? null)) }; };

export const SOURCES = {
  // Отчёт из 1С: шапка, заголовки, пустые строки между блоками, строка «Итого», суммы текстом с пробелами
  export1c: {
    file: 'Продажи_1С.xlsx', expr: 'Excel.Workbook(File.Contents("C:\\Отчеты\\Продажи_1С.xlsx"), null, true){[Item="TDSheet",Kind="Sheet"]}[Data]',
    make(v: number): PTable {
      const db = build(v); const r = rng(v * 31 + 7);
      const cl = new Map(db.clients.map(c => [c.id, c.name]));
      const sums = new Map(); for (const it of db.order_items) sums.set(it.order_id, (sums.get(it.order_id) || 0) + it.qty * it.price);
      const orders = db.orders.filter(o => o.status === 'Доставлен').slice(0, v === 1 ? 18 : 25);
      const rows: any[][] = [['Отчёт «Продажи по заказам»'], ['Период: ' + ddmm(orders[0].order_date) + ' – ' + ddmm(orders[orders.length - 1].order_date)], [], ['Дата', 'Номер', 'Клиент', 'Сумма']];
      let total = 0;
      orders.forEach((o, i) => {
        if (i && i % (v === 1 ? 6 : 7) === 0) rows.push([]);
        const s = sums.get(o.id); total += s;
        rows.push([ddmm(o.order_date), 'ЗК-' + o.id, cl.get(o.client_id), money(s)]);
      });
      rows.push([]); rows.push(['Итого', null, null, money(total)]);
      return raw(rows);
    },
  },
  // План продаж по месяцам «в ширину»
  plan: {
    file: 'План_продаж.xlsx', expr: 'Excel.Workbook(File.Contents("C:\\Отчеты\\План_продаж.xlsx"), null, true){[Item="План",Kind="Sheet"]}[Data]',
    make(v: number): PTable {
      const db = build(v); const r = rng(v * 17 + 3);
      const months = ['Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь'];
      const mgr = db.employees.filter(e => e.position === 'Менеджер').slice(0, v === 1 ? 5 : 6);
      const rows: any[][] = [['Менеджер', ...months]];
      mgr.forEach((e, i) => rows.push([e.name, ...months.map((_, k) => (i === 2 && k === 0) || (v === 2 && i === 4 && k === 1) ? null : Math.round((300 + r() * 500)) * 100)]));
      return raw(rows);
    },
  },
  // Остатки из 1С: категория указана только в первой строке группы
  stock: {
    file: 'Остатки_1С.xlsx', expr: 'Excel.Workbook(File.Contents("C:\\Отчеты\\Остатки_1С.xlsx"), null, true){[Item="TDSheet",Kind="Sheet"]}[Data]',
    make(v: number): PTable {
      const db = build(v); const r = rng(v * 7 + 1);
      const rows: any[][] = [['Категория', 'Товар', 'Остаток, шт', 'Сумма']];
      const cats = [...new Set(db.products.map(p => p.category))];
      for (const c of (v === 1 ? cats : [...cats].reverse())) {
        db.products.filter(p => p.category === c).forEach((p, i) => { const q = 1 + Math.floor(r() * 40); rows.push([i === 0 ? c : null, p.name, q, money(q * p.price)]); });
      }
      return raw(rows);
    },
  },
};
export const source = (name: string, v: number): PTable => SOURCES[name].make(v);
