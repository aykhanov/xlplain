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

const typed = (cols: [string, string][], rows: any[][]): PTable => ({ cols: cols.map(([name, type]) => ({ name, type: type as any })), rows });
const ser = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569; };
const xl = (file: string, sheet = 'Лист1') => `Excel.Workbook(File.Contents("C:\\Отчеты\\${file}"), null, true){[Item="${sheet}",Kind="Sheet"]}[Data]`;
function base(v: number) {
  const db = build(v);
  const cl = new Map(db.clients.map(c => [c.id, c]));
  const pr = new Map(db.products.map(p => [p.id, p]));
  const sums = new Map<number, number>(); for (const it of db.order_items) sums.set(it.order_id, (sums.get(it.order_id) || 0) + it.qty * it.price);
  const emp = new Map(db.employees.map(e => [e.id, e]));
  return { db, cl, pr, sums, emp };
}
const SUR = ['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Соколов', 'Михайлов', 'Новиков', 'Фёдоров', 'Морозов', 'Волков'];
const NAM = ['Алексей', 'Дмитрий', 'Сергей', 'Андрей', 'Павел', 'Максим', 'Илья', 'Роман'];
const PAT = ['Алексеевич', 'Иванович', 'Сергеевич', 'Петрович', 'Андреевич', 'Олегович'];
const POS = ['Менеджер', 'Старший менеджер', 'Бухгалтер', 'Логист', 'Кладовщик'];
const messCase = (s: string, r: () => number) => { const k = r(); return k < 0.25 ? s.toUpperCase() : k < 0.5 ? s.toLowerCase() : s; };
const pad = (s: string, r: () => number) => (r() < 0.4 ? '  ' : '') + s + (r() < 0.4 ? ' ' : '');

Object.assign(SOURCES, {
  // Справочник клиентов из CRM: разный регистр, лишние пробелы, «г.» перед городом, дубли
  clientsRaw: { file: 'Клиенты_CRM.xlsx', expr: xl('Клиенты_CRM.xlsx'), make(v: number): PTable {
    const { db } = base(v); const r = rng(v * 41 + 5);
    const people = db.clients.filter(c => !/«/.test(c.name)).slice(0, v === 1 ? 14 : 18);
    const rows: any[][] = [['Клиент', 'Город', 'Сегмент']];
    people.forEach((c, i) => { rows.push([pad(messCase(c.name, r), r), (r() < 0.6 ? 'г. ' : '') + c.city, c.segment]); if (i % 4 === 1) rows.push([pad(messCase(c.name, r), r), 'г. ' + c.city, c.segment]); });
    return raw(rows);
  } },
  // Список сотрудников: ФИО одной строкой
  staff: { file: 'Сотрудники.xlsx', expr: xl('Сотрудники.xlsx'), make(v: number): PTable {
    const r = rng(v * 13 + 2); const rows: any[][] = [['ФИО', 'Должность']]; const seen = new Set();
    while (rows.length < (v === 1 ? 11 : 15)) { const f = `${SUR[Math.floor(r() * SUR.length)]} ${NAM[Math.floor(r() * NAM.length)]} ${PAT[Math.floor(r() * PAT.length)]}`; if (seen.has(f)) continue; seen.add(f); rows.push([f, POS[Math.floor(r() * POS.length)]]); }
    return raw(rows);
  } },
  // Выписка банка: номер счёта спрятан в назначении платежа
  bank: { file: 'Выписка.xlsx', expr: xl('Выписка.xlsx'), make(v: number): PTable {
    const { db, cl } = base(v); const rows: any[][] = [['Дата', 'Плательщик', 'Сумма', 'Назначение платежа']];
    db.payments.slice(0, v === 1 ? 16 : 22).forEach((p, i) => { const o = db.orders.find(x => x.id === p.order_id); rows.push([ddmm(p.paid_date), cl.get(o.client_id).name, money(p.amount), `Оплата по счёту № ${p.order_id} от ${ddmm(o.order_date)}, ${i % 3 ? 'в т.ч. НДС 22%' : 'без НДС'}`]); });
    return raw(rows);
  } },
  // Прайс поставщика: цена текстом с «руб.», у части товаров цены нет
  priceText: { file: 'Прайс_поставщика.xlsx', expr: xl('Прайс_поставщика.xlsx'), make(v: number): PTable {
    const { db } = base(v); const rows: any[][] = [['Товар', 'Категория', 'Цена']];
    db.products.slice(0, v === 1 ? 14 : 20).forEach((p, i) => rows.push([p.name, p.category, i % 6 === 4 ? 'по запросу' : money(p.price) + ' руб.']));
    return raw(rows);
  } },
  // Строки заказов и справочники — уже типизированные таблицы
  lines: { file: 'Строки_заказов.csv', expr: 'Csv.Document(File.Contents("C:\\Отчеты\\Строки_заказов.csv"),[Delimiter=";", Encoding=65001])', make(v: number): PTable {
    const { db } = base(v); const od = new Map(db.orders.map(o => [o.id, o]));
    const items = db.order_items.filter(it => od.get(it.order_id).status !== 'Отменён').slice(0, v === 1 ? 40 : 60);
    if (v === 2) items.push({ order_id: items[items.length - 1].order_id, product_id: 999, qty: 1, price: 100 });
    return typed([['Номер заказа', 'int'], ['Дата', 'date'], ['Код товара', 'int'], ['Количество', 'int']], items.map(it => [it.order_id, ser(od.get(it.order_id).order_date), it.product_id, it.qty]));
  } },
  products: { file: 'Товары.xlsx', expr: xl('Товары.xlsx', 'Товары'), make(v: number): PTable {
    const { db } = base(v); return typed([['Код товара', 'int'], ['Товар', 'text'], ['Категория', 'text'], ['Цена', 'number']], db.products.map(p => [p.id, p.name, p.category, p.price]));
  } },
  clients: { file: 'Клиенты.xlsx', expr: xl('Клиенты.xlsx', 'Клиенты'), make(v: number): PTable {
    const { db } = base(v); return typed([['Код клиента', 'int'], ['Клиент', 'text'], ['Город', 'text'], ['Сегмент', 'text']], db.clients.map(c => [c.id, c.name, c.city, c.segment]));
  } },
  // Заказы с суммой — для условных столбцов, дат и группировки
  orders: { file: 'Заказы.xlsx', expr: xl('Заказы.xlsx', 'Заказы'), make(v: number): PTable {
    const { db, cl, sums, emp } = base(v);
    const os = db.orders.filter(o => o.status !== 'Отменён').slice(0, v === 1 ? 60 : 90);
    return typed([['Номер заказа', 'int'], ['Дата', 'date'], ['Клиент', 'text'], ['Город', 'text'], ['Менеджер', 'text'], ['Сумма', 'number']], os.map(o => [o.id, ser(o.order_date), cl.get(o.client_id).name, cl.get(o.client_id).city, emp.get(o.employee_id).name, sums.get(o.id)]));
  } },
  ordersCodes: { file: 'Заказы_с_кодами.xlsx', expr: xl('Заказы_с_кодами.xlsx', 'Заказы'), make(v: number): PTable {
    const { db, sums } = base(v); const os = db.orders.filter(o => o.status !== 'Отменён').slice(0, v === 1 ? 40 : 55);
    return typed([['Номер заказа', 'int'], ['Дата', 'date'], ['Код клиента', 'int'], ['Сумма', 'number']], os.map(o => [o.id, ser(o.order_date), o.client_id, sums.get(o.id)]));
  } },
  // Продажи за месяц — одинаковая структура для добавления запросов
  salesJune: { file: 'Продажи_июнь.xlsx', expr: xl('Продажи_июнь.xlsx'), make: (v: number) => monthSales(v, 6) },
  salesJuly: { file: 'Продажи_июль.xlsx', expr: xl('Продажи_июль.xlsx'), make: (v: number) => monthSales(v, 7) },
  salesAug: { file: 'Продажи_август.xlsx', expr: xl('Продажи_август.xlsx'), make: (v: number) => monthSales(v, 8) },
  // Счета и оплаты — для поиска неоплаченных
  invoices: { file: 'Счета.xlsx', expr: xl('Счета.xlsx', 'Счета'), make(v: number): PTable {
    const { db, cl, sums } = base(v); const os = db.orders.filter(o => o.status !== 'Отменён').slice(-(v === 1 ? 30 : 45));
    return typed([['Номер счёта', 'int'], ['Дата', 'date'], ['Клиент', 'text'], ['Сумма', 'number']], os.map(o => [o.id, ser(o.order_date), cl.get(o.client_id).name, sums.get(o.id)]));
  } },
  payments: { file: 'Оплаты.xlsx', expr: xl('Оплаты.xlsx', 'Оплаты'), make(v: number): PTable {
    const { db } = base(v); return typed([['Номер счёта', 'int'], ['Дата оплаты', 'date'], ['Сумма оплаты', 'number']], db.payments.filter(p => p.order_id % (v === 1 ? 6 : 5) !== 2).map(p => [p.order_id, ser(p.paid_date), p.amount]));
  } },
  // Продажи менеджеров по месяцам в «длинном» виде
  salesLong: { file: 'Продажи_по_менеджерам.xlsx', expr: xl('Продажи_по_менеджерам.xlsx'), make(v: number): PTable {
    const { db, sums, emp } = base(v); const M = ['', '', '', '', '', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь'];
    const os = db.orders.filter(o => o.status !== 'Отменён' && +o.order_date.slice(5, 7) <= (v === 1 ? 8 : 9));
    return typed([['Менеджер', 'text'], ['Месяц', 'text'], ['Сумма', 'number']], os.map(o => [emp.get(o.employee_id).name, M[+o.order_date.slice(5, 7) - 1], sums.get(o.id)]));
  } },
});
const MONTH_FILES = { 6: 'июнь', 7: 'июль', 8: 'август', 9: 'сентябрь', 10: 'октябрь' };
Object.assign(SOURCES, {
  // Папка с ежемесячными выгрузками и лишним текстовым файлом
  folder: { file: 'Продажи', expr: 'Folder.Files("C:\\Отчеты\\Продажи")', make(v: number): PTable {
    const months = v === 1 ? [6, 7, 8] : [6, 7, 8, 9];
    const rows: any[][] = months.map(m => { const t = monthSales(v, m); const name = `Продажи_${MONTH_FILES[m]}.xlsx`; return [{ bin: { name, table: raw([t.cols.map(c => c.name), ...t.rows.map(r => [ddmm(isoOf(r[0])), r[1], r[2], r[3]])]) } }, name, '.xlsx', ser(`2026-${String(m + 1).padStart(2, '0')}-02`), 'C:\\Отчеты\\Продажи\\']; });
    rows.splice(1, 0, [{ bin: { name: 'Прочитай меня.txt', table: raw([['Выгрузки кладём сюда первого числа']]) } }, 'Прочитай меня.txt', '.txt', ser('2026-06-01'), 'C:\\Отчеты\\Продажи\\']);
    return typed([['Content', 'binary'], ['Name', 'text'], ['Extension', 'text'], ['Date modified', 'date'], ['Folder Path', 'text']], rows);
  } },
});
const isoOf = (s: number) => new Date((s - 25569) * 864e5).toISOString().slice(0, 10);
function monthSales(v: number, m: number): PTable {
  const { db, cl, sums } = base(v);
  const os = db.orders.filter(o => o.status !== 'Отменён' && +o.order_date.slice(5, 7) === m).slice(0, v === 1 ? 15 : 22);
  return typed([['Дата', 'date'], ['Номер заказа', 'int'], ['Клиент', 'text'], ['Сумма', 'number']], os.map(o => [ser(o.order_date), o.id, cl.get(o.client_id).name, sums.get(o.id)]));
}
export const source = (name: string, v: number): PTable => SOURCES[name].make(v);
