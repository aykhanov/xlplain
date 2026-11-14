// Собирает файлы задач из content/ в src/generated/*.json, строит учебную базу и датасет,
// считает эталонные ответы кейсов Power BI. Падает с понятной ошибкой, если в задаче что-то не так.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import initSqlJs from 'sql.js';
import { build, toSql, SCHEMA, DESCR } from './dataset.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'src/generated');
fs.mkdirSync(out, { recursive: true });
const errors = [];
const fail = (f, m) => errors.push(`${f}: ${m}`);

function loadModule(mod, required) {
  const dir = path.join(root, 'content', mod);
  const tracks = YAML.parse(fs.readFileSync(path.join(dir, '_tracks.yaml'), 'utf8'));
  const tasks = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml') && !f.startsWith('_')).sort()) {
    const t = YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const k of required) if (t[k] === undefined || t[k] === null || t[k] === '') fail(`${mod}/${f}`, `нет поля ${k}`);
    if (t.module !== mod) fail(`${mod}/${f}`, `module должен быть ${mod}`);
    if (!tracks.some(x => x.id === t.track)) fail(`${mod}/${f}`, `нет трека ${t.track}`);
    if (!/^[a-z0-9-]+$/.test(t.slug || '')) fail(`${mod}/${f}`, `адрес (slug) только латиница, цифры и дефис`);
    t._file = `${mod}/${f}`;
    tasks.push(t);
  }
  const ids = new Set(), slugs = new Set();
  for (const t of tasks) { if (ids.has(t.id)) fail(t._file, 'id повторяется'); if (slugs.has(t.slug)) fail(t._file, 'slug повторяется'); ids.add(t.id); slugs.add(t.slug); }
  tasks.sort((a, b) => a.order - b.order);
  return { tracks, tasks };
}

const base = ['id', 'slug', 'module', 'track', 'order', 'title', 'seo_title', 'story', 'goal', 'hint'];
const excel = loadModule('excel', [...base, 'fn', 'grid', 'target', 'answer']);
const sql = loadModule('sql', [...base, 'answer', 'excel']);
const bi = loadModule('bi', [...base, 'check']);
const pq = loadModule('pq', [...base, 'check', 'source', 'answer', 'explanation']);
for (const t of pq.tasks) { if (t.check !== 'pq') fail(t._file, 'в модуле pq check должен быть pq'); if (!Array.isArray(t.answer) || !t.answer.length) fail(t._file, 'answer — список шагов'); }

// --- учебная база ---
const SQL = await initSqlJs();
const dumps = {};
for (const [name, seed] of [['company', 1], ['company-check', 2]]) {
  const db = build(seed);
  dumps[name] = { db, sql: toSql(db) };
  fs.writeFileSync(path.join(root, 'public/sql', name + '.sql'), dumps[name].sql);
}
const run = (dump, q) => { const d = new SQL.Database(); d.run(dump); const r = d.exec(q); d.close(); return r; };

for (const t of sql.tasks) {
  for (const name of ['company', 'company-check']) {
    let r;
    try { r = run(dumps[name].sql, t.answer); } catch (e) { fail(t._file, `эталонный запрос падает на базе ${name}: ${e.message}`); continue; }
    if (!r.length || !r[r.length - 1].values.length) fail(t._file, `эталонный запрос ничего не вернул на базе ${name}`);
  }
}

// --- Power BI: датасет и эталонные числа ---
const db1 = dumps.company.db;
const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
const C = byId(db1.clients), P = byId(db1.products), O = byId(db1.orders);
const rows = [['Дата', 'Номер заказа', 'Клиент', 'Город', 'Сегмент', 'Категория', 'Товар', 'Количество', 'Цена', 'Сумма', 'Статус']];
for (const it of db1.order_items) {
  const o = O[it.order_id], c = C[o.client_id], p = P[it.product_id];
  rows.push([o.order_date.split('-').reverse().join('.'), o.id, c.name, c.city, c.segment, p.category, p.name, it.qty, it.price, it.qty * it.price, o.status]);
}
const csvCell = v => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.writeFileSync(path.join(root, 'public/data/prodazhi.csv'), '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n');
for (const t of bi.tasks) {
  if (t.check === 'number') {
    try { const r = run(dumps.company.sql, t.compute); t.expected = r[0].values[0][0]; } catch (e) { fail(t._file, 'compute падает: ' + e.message); }
    if (typeof t.expected !== 'number') fail(t._file, 'compute должен вернуть число');
    delete t.compute;
  } else if (t.check === 'choice') {
    if (!Array.isArray(t.options) || t.options.filter(o => o.correct).length !== 1) fail(t._file, 'в choice нужен ровно один верный вариант');
    if ((t.options || []).some(o => !o.why)) fail(t._file, 'у каждого варианта нужно объяснение why');
  } else if (t.check === 'order') {
    if (!Array.isArray(t.steps) || t.steps.length < 3) fail(t._file, 'в order нужно минимум 3 шага');
  } else if (t.check === 'dax') {
    for (const k of ['measure_name', 'answer', 'visual']) if (!t[k]) fail(t._file, 'в задаче dax нет поля ' + k);
    if (t.answer && !t.answer.startsWith(t.measure_name + ' =')) fail(t._file, 'answer должен начинаться с «' + t.measure_name + ' =»');
    // формулы проверяются в tests/bi.test.ts движком DAX
  } else if (t.check === 'pq') {
    for (const k of ['source', 'answer']) if (!t[k]) fail(t._file, 'в задаче pq нет поля ' + k);
  } else fail(t._file, 'неизвестный check ' + t.check);
}

if (errors.length) { console.error('Ошибки в задачах:\n' + errors.join('\n')); process.exit(1); }

const schema = Object.entries(SCHEMA).map(([t, cols]) => ({ table: t, title: DESCR[t], cols: cols.map(([c]) => c), rows: db1[t].length }));
const strip = ({ _file, ...t }) => t;
for (const [name, m] of Object.entries({ excel, sql, bi, pq })) fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ tracks: m.tracks, tasks: m.tasks.map(strip) }));
fs.writeFileSync(path.join(out, 'schema.json'), JSON.stringify(schema));
console.log(`OK: Excel ${excel.tasks.length}, SQL ${sql.tasks.length}, Power BI ${bi.tasks.length}, Power Query ${pq.tasks.length}; строк в датасете ${rows.length - 1}`);
for (const t of bi.tasks.filter(t => t.check === 'number')) console.log('  ', t.id, '=', t.expected);
