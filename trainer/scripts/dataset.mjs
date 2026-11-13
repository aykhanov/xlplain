// Учебная база «компания». Детерминированный генератор: один и тот же seed даёт одни и те же данные.
// seed 1 — открытая база (её видит пользователь), seed 2 — проверочная (другие значения, та же структура).
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FIRST_M = ['Алексей', 'Игорь', 'Олег', 'Дмитрий', 'Сергей', 'Павел', 'Артём', 'Максим', 'Роман', 'Илья'];
const FIRST_F = ['Анна', 'Мария', 'Ольга', 'Елена', 'Дарья', 'Ирина', 'Юлия', 'Наталья', 'Ксения', 'Вера'];
const LAST = ['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Орлов', 'Гусев', 'Зайцев', 'Павлов', 'Белов'];
const COMPANY = ['ООО «Вектор»', 'ООО «Альфа Строй»', 'ИП Соколов', 'ООО «Кофе Хауз»', 'ООО «Северный склад»', 'ИП Орлова', 'ООО «Реком»', 'ООО «Пекарня №1»', 'ООО «Маяк»', 'ИП Гусев', 'ООО «Термо»', 'ООО «Лидер»'];
const CITIES = ['Москва', 'Москва', 'Москва', 'Казань', 'Казань', 'Пермь', 'Пермь', 'Екатеринбург', 'Новосибирск', 'Самара'];
const PRODUCTS = [
  ['Кофе', 'Кофе в зёрнах 1 кг'], ['Кофе', 'Кофе молотый 250 г'], ['Кофе', 'Кофе в капсулах, 50 шт'], ['Кофе', 'Кофе растворимый 190 г'], ['Кофе', 'Кофе для турки 500 г'],
  ['Чай', 'Чай чёрный 100 пак.'], ['Чай', 'Чай зелёный 100 г'], ['Чай', 'Чай травяной 20 пак.'], ['Чай', 'Чай улун 150 г'],
  ['Посуда', 'Кружка керамическая'], ['Посуда', 'Френч-пресс 0,6 л'], ['Посуда', 'Турка медная'], ['Посуда', 'Термос 0,5 л'],
  ['Сладости', 'Печенье овсяное'], ['Сладости', 'Шоколад горький'], ['Сладости', 'Зефир ванильный'], ['Сладости', 'Мармелад фруктовый'],
  ['Оборудование', 'Кофемолка ручная'], ['Оборудование', 'Капельная кофеварка'], ['Оборудование', 'Чайник электрический'],
];
const BASE_PRICE = { 'Кофе': 900, 'Чай': 350, 'Посуда': 1200, 'Сладости': 250, 'Оборудование': 4500 };
const pad = n => String(n).padStart(2, '0');
const date = (r, from, days) => { const d = new Date(Date.UTC(from[0], from[1] - 1, from[2])); d.setUTCDate(d.getUTCDate() + Math.floor(r() * days)); return d.toISOString().slice(0, 10); };

export function build(seed) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const person = () => { const f = r() < 0.5; return (f ? pick(LAST) + 'а' : pick(LAST)) + ' ' + (f ? pick(FIRST_F) : pick(FIRST_M)); };

  const employees = [
    { id: 1, name: person(), position: 'Директор по продажам', manager_id: null, hired: '2021-03-01' },
    { id: 2, name: person(), position: 'Руководитель отдела', manager_id: 1, hired: '2022-02-14' },
    { id: 3, name: person(), position: 'Руководитель отдела', manager_id: 1, hired: '2022-09-05' },
  ];
  for (let i = 4; i <= 9; i++) employees.push({ id: i, name: person(), position: 'Менеджер', manager_id: i <= 6 ? 2 : 3, hired: date(r, [2023, 1, 10], 900) });

  const clients = []; const used = new Set();
  for (let i = 1; i <= 40; i++) {
    let name; do { name = r() < 0.45 ? pick(COMPANY) : person(); } while (used.has(name)); used.add(name);
    clients.push({ id: i, name, city: pick(CITIES), segment: name.startsWith('ООО') || name.startsWith('ИП') ? 'Опт' : 'Розница', registered: date(r, [2025, 1, 15], 560) });
  }

  const usedPrice = new Set();
  const products = PRODUCTS.map(([category, name], i) => {
    let price; do { price = Math.round(BASE_PRICE[category] * (0.6 + r() * 1.2) / 10) * 10; } while (usedPrice.has(price)); usedPrice.add(price);
    return { id: i + 1, name, category, price };
  });

  const orders = [], items = [], payments = [];
  let pid = 1;
  const silent = new Set([3, 11, 19, 27, 35].map(x => ((x + seed * 7) % 40) + 1)); // клиенты без заказов
  const dates = Array.from({ length: 220 }, () => date(r, [2026, 6, 1], 153)).sort();
  for (let i = 1; i <= 220; i++) {
    let client; do { client = clients[Math.floor(r() * clients.length)]; } while (silent.has(client.id));
    const od = dates[i - 1];
    const status = r() < 0.08 ? 'Отменён' : (od >= '2026-10-22' && r() < 0.6 ? 'В пути' : 'Доставлен');
    const o = { id: 1000 + i, client_id: client.id, employee_id: 4 + Math.floor(r() * 6), order_date: od, status };
    orders.push(o);
    const n = 1 + Math.floor(r() * 4); const taken = new Set(); let total = 0;
    for (let k = 0; k < n; k++) {
      let p; do { p = pick(products); } while (taken.has(p.id)); taken.add(p.id);
      const qty = client.segment === 'Опт' ? 2 + Math.floor(r() * 12) : 1 + Math.floor(r() * 3);
      items.push({ order_id: o.id, product_id: p.id, qty, price: p.price }); total += qty * p.price;
    }
    if (status === 'Доставлен' || (status === 'В пути' && r() < 0.5)) {
      const d = new Date(o.order_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.floor(r() * 10));
      payments.push({ id: pid++, order_id: o.id, paid_date: d.toISOString().slice(0, 10), amount: total });
    }
  }
  orders.sort((a, b) => a.id - b.id);
  return { employees, clients, products, orders, order_items: items, payments };
}

export const SCHEMA = {
  employees: [['id', 'INTEGER PRIMARY KEY'], ['name', 'TEXT'], ['position', 'TEXT'], ['manager_id', 'INTEGER'], ['hired', 'TEXT']],
  clients: [['id', 'INTEGER PRIMARY KEY'], ['name', 'TEXT'], ['city', 'TEXT'], ['segment', 'TEXT'], ['registered', 'TEXT']],
  products: [['id', 'INTEGER PRIMARY KEY'], ['name', 'TEXT'], ['category', 'TEXT'], ['price', 'INTEGER']],
  orders: [['id', 'INTEGER PRIMARY KEY'], ['client_id', 'INTEGER'], ['employee_id', 'INTEGER'], ['order_date', 'TEXT'], ['status', 'TEXT']],
  order_items: [['order_id', 'INTEGER'], ['product_id', 'INTEGER'], ['qty', 'INTEGER'], ['price', 'INTEGER']],
  payments: [['id', 'INTEGER PRIMARY KEY'], ['order_id', 'INTEGER'], ['paid_date', 'TEXT'], ['amount', 'INTEGER']],
};
export const DESCR = {
  employees: 'Сотрудники отдела продаж', clients: 'Клиенты', products: 'Товары', orders: 'Заказы', order_items: 'Строки заказов', payments: 'Оплаты',
};
const lit = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
export function toSql(db) {
  let out = '';
  for (const [t, cols] of Object.entries(SCHEMA)) {
    out += `CREATE TABLE ${t} (${cols.map(([c, ty]) => c + ' ' + ty).join(', ')});\n`;
    const rows = db[t];
    for (let i = 0; i < rows.length; i += 50) out += `INSERT INTO ${t} VALUES ${rows.slice(i, i + 50).map(row => '(' + cols.map(([c]) => lit(row[c])).join(',') + ')').join(',')};\n`;
  }
  return out;
}
