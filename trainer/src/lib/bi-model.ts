// @ts-nocheck
// Модель «Продажи» для тренажёра Power BI: факт + три справочника, строится из учебной базы.
import { build, rng } from '../../scripts/dataset.mjs';
import { makeTable, makeModel, addMeasure, ser, type Model } from '../engine/dax';

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const toSer = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return ser(y, m, d); };

export function buildModel(seed: number, measures: string[] = []): Model {
  const db = build(seed);
  const r = rng(seed * 977 + 13);
  const orders = new Map(db.orders.map(o => [o.id, o]));
  const sales = db.order_items.map(it => { const o = orders.get(it.order_id); return [o.id, toSer(o.order_date), o.client_id, it.product_id, it.qty, it.price, it.qty * it.price, o.status]; })
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const prod = makeTable('Продажи', [
    { name: 'Номер заказа', type: 'int' }, { name: 'Дата', type: 'date' }, { name: 'Код клиента', type: 'int', key: true, hidden: false },
    { name: 'Код товара', type: 'int', key: true }, { name: 'Количество', type: 'int' }, { name: 'Цена', type: 'num' }, { name: 'Сумма', type: 'num' }, { name: 'Статус', type: 'text' },
  ], sales);
  const cl = makeTable('Клиенты', [
    { name: 'Код клиента', type: 'int', key: true }, { name: 'Клиент', type: 'text' }, { name: 'Город', type: 'text' }, { name: 'Сегмент', type: 'text' },
  ], db.clients.map(c => [c.id, c.name, c.city, c.segment]));
  const pr = makeTable('Товары', [
    { name: 'Код товара', type: 'int', key: true }, { name: 'Товар', type: 'text' }, { name: 'Категория', type: 'text' }, { name: 'Цена по прайсу', type: 'num' }, { name: 'Себестоимость', type: 'num' },
  ], db.products.map(p => [p.id, p.name, p.category, p.price, Math.round(p.price * (0.62 + r() * 0.13) / 10) * 10]));
  const cal: any[] = [];
  for (let s = ser(2026, 1, 1); s <= ser(2026, 12, 31); s++) {
    const d = new Date((s - 25569) * 864e5); const m = d.getUTCMonth() + 1;
    cal.push([s, 2026, m, MONTHS[m - 1], 'Кв' + Math.ceil(m / 3)]);
  }
  const ca = makeTable('Календарь', [
    { name: 'Дата', type: 'date', key: true }, { name: 'Год', type: 'int' }, { name: 'Номер месяца', type: 'int' }, { name: 'Месяц', type: 'text', sortBy: 'Номер месяца' }, { name: 'Квартал', type: 'text' },
  ], cal);
  const m = makeModel([prod, cl, pr, ca], [
    { from: 'Продажи', fromCol: 'Код клиента', to: 'Клиенты', toCol: 'Код клиента' },
    { from: 'Продажи', fromCol: 'Код товара', to: 'Товары', toCol: 'Код товара' },
    { from: 'Продажи', fromCol: 'Дата', to: 'Календарь', toCol: 'Дата' },
  ], { table: 'Календарь', col: 'Дата' });
  for (const t of measures) addMeasure(m, t);
  return m;
}
