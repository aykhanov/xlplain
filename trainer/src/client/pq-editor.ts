// @ts-nocheck
// Редактор Power Query: лента, сетка, фильтры, несколько запросов, слияние, свой столбец, «Примененные шаги».
import { run, stepNames, mCode, fullM, show, isErr, isTbl, isBin, applyStep, checkPq, TYPE_NAME, condM } from '../engine/pq';
import { parseM, M_FUNCTIONS } from '../engine/m';
import { parseQuery, parseStepExpr, lineOf } from '../engine/m-steps';
import { SOURCES, source } from '../lib/pq-sources';
import { load, save, markSolved, goal, refreshHeader } from '../lib/progress';
import { esc } from '../lib/sheet';

const task = JSON.parse(document.getElementById('taskdata').textContent);
const MOD = task.module || 'bi';
const KEY = MOD + ':' + task.id;
const $ = s => document.querySelector(s);
let S = load(); let started = false;
const start = () => { if (!started) { started = true; goal('trainer_task_start', { module: MOD, task: task.id }); } };
const SRC = SOURCES[task.source];
const base = source(task.source, 1);
const qname = task.query_name || SRC.file.replace(/\.\w+$/, '');
const envFor = (v: number) => ({ queries: Object.fromEntries(Object.entries(task.queries || {}).map(([n, k]) => [n, source(k as string, v)])) });
const env = envFor(1);
const OTHERS = Object.keys(env.queries);
let viewQ = null;                // имя другого (готового) запроса, открытого для просмотра
$('#pq-file').textContent = qname; $('#pq-name').value = qname;
function renderQueries() {
  $('#pq-qhead').textContent = `Запросы [${1 + OTHERS.length}]`;
  const helpers = steps.some(s => s.op === 'combineFiles') ? ['Параметр1', 'Пример файла', 'Преобразовать файл', 'Преобразовать пример файла'] : [];
  if (helpers.length) $('#pq-qhead').textContent = `Запросы [${1 + OTHERS.length + helpers.length}]`;
  $('#pq-qlist').innerHTML = (helpers.length ? `<div class="pq-grp">▾ Вспомогательные запросы [${helpers.length}]</div>` + helpers.map(h => `<div class="pq-q helper" data-helper="1">${h === 'Преобразовать файл' ? '<i>fx</i> ' : ''}${esc(h)}</div>`).join('') + `<div class="pq-grp">▾ Другие запросы [${1 + OTHERS.length}]</div>` : '') + [qname, ...OTHERS].map((n, i) => `<div class="pq-q${(i === 0 && !viewQ) || viewQ === n ? ' on' : ''}" data-q="${i ? esc(n) : ''}" title="${i ? 'Готовый запрос, его можно только посмотреть' : 'Запрос, который нужно преобразовать'}">${esc(n)}${i ? '<span class="ro">готов</span>' : ''}</div>`).join('');
}

let steps = []; try { steps = JSON.parse(S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || JSON.stringify(task.starter || [])); } catch { steps = []; }
if (!Array.isArray(steps)) steps = [];
let cur = steps.length;          // выбранный шаг: 0 = «Источник»
let selCols = [];
let tab = 'home';
let res;
const persist = () => { S.drafts[KEY] = JSON.stringify(steps); save(S); };

/* ───── лента ───── */
const I = {
  close: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="13" height="14" fill="#fff" stroke="#605e5c"/><path d="M14 12h8m-3-3 3 3-3 3" stroke="#f2c811" stroke-width="2" fill="none"/></svg>',
  adv: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="#605e5c"/><path d="M7 8h6M7 12h10M7 16h8" stroke="#0b4f9e"/></svg>',
  delcol: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="7" height="18" fill="#fff" stroke="#605e5c"/><rect x="13" y="3" width="7" height="18" fill="#fff" stroke="#605e5c"/><path d="m5.5 9 4 6m0-6-4 6" stroke="#a4262c" stroke-width="1.6"/></svg>',
  delrow: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" fill="#fff" stroke="#605e5c"/><rect x="3" y="11" width="18" height="5" fill="#fde7e9" stroke="#a4262c"/><rect x="3" y="18" width="18" height="3" fill="#fff" stroke="#605e5c"/></svg>',
  hdr: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" fill="#fff" stroke="#605e5c"/><rect x="3" y="4" width="18" height="5" fill="#c7e0f4" stroke="#605e5c"/><path d="M12 18v-6m-3 3 3-3 3 3" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  repl: '<svg viewBox="0 0 24 24"><path d="M4 7h11m-3-3 3 3-3 3M20 17H9m3-3-3 3 3 3" stroke="#0b4f9e" stroke-width="1.6" fill="none"/></svg>',
  group: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="18" fill="#fff" stroke="#605e5c"/><path d="M3 9h8M3 15h8" stroke="#605e5c"/><path d="M14 12h7M17 8l4 4-4 4" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" fill="#fff" stroke="#605e5c"/><rect x="7" y="3" width="10" height="5" fill="#c7e0f4"/><path d="M12 9v9m-3-3 3 3 3-3" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  unpiv: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="9" height="6" fill="#c7e0f4" stroke="#605e5c"/><rect x="13" y="12" width="8" height="9" fill="#fff" stroke="#605e5c"/><path d="M8 11v5h4" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  ren: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" fill="#fff" stroke="#605e5c"/><path d="M7 10v4M14 9v6M12 9h4M12 15h4" stroke="#252423"/></svg>',
  split: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="16" fill="#fff" stroke="#605e5c"/><rect x="13" y="4" width="8" height="16" fill="#fff" stroke="#605e5c"/><path d="M12 2v20" stroke="#a4262c" stroke-dasharray="2 2"/></svg>',
  fmt: '<svg viewBox="0 0 24 24"><text x="3" y="17" font-size="12" font-family="Segoe UI" fill="#252423">Aa</text><path d="M16 18h5" stroke="#0b4f9e" stroke-width="2"/></svg>',
  merge: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="8" height="10" fill="#fff" stroke="#605e5c"/><rect x="14" y="4" width="8" height="10" fill="#c7e0f4" stroke="#605e5c"/><path d="M6 14v4h12v-4M12 18v3" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  append: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="8" fill="#fff" stroke="#605e5c"/><rect x="5" y="13" width="14" height="8" fill="#c7e0f4" stroke="#605e5c"/><path d="M12 10v3" stroke="#0b4f9e" stroke-width="2"/></svg>',
  custom: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#fff" stroke="#605e5c"/><rect x="14" y="3" width="7" height="18" fill="#c7e0f4"/><text x="5" y="16" font-size="9" font-style="italic" font-family="Georgia" fill="#252423">fx</text></svg>',
  cond: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#fff" stroke="#605e5c"/><path d="M7 8h5l2 4-2 4H7" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  idx: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#fff" stroke="#605e5c"/><text x="6" y="11" font-size="7" fill="#0b4f9e">1</text><text x="6" y="19" font-size="7" fill="#0b4f9e">2</text></svg>',
  extr: '<svg viewBox="0 0 24 24"><text x="2" y="15" font-size="10" fill="#a19f9d">ab</text><text x="12" y="15" font-size="10" fill="#0b4f9e" font-weight="700">c</text><path d="M11 4v16" stroke="#0b4f9e" stroke-dasharray="2 2"/></svg>',
  date: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" fill="#fff" stroke="#605e5c"/><path d="M3 9h18M8 3v4M16 3v4" stroke="#605e5c"/><rect x="6" y="12" width="4" height="3" fill="#0b4f9e"/></svg>',
  sortA: '<svg viewBox="0 0 24 24"><text x="3" y="10" font-size="8" fill="#252423">А</text><text x="3" y="20" font-size="8" fill="#252423">Я</text><path d="M16 4v15m-3-3 3 3 3-3" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  sortZ: '<svg viewBox="0 0 24 24"><text x="3" y="10" font-size="8" fill="#252423">Я</text><text x="3" y="20" font-size="8" fill="#252423">А</text><path d="M16 4v15m-3-3 3 3 3-3" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  keep: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" fill="#dff6dd" stroke="#107c10"/><rect x="3" y="11" width="18" height="5" fill="#fff" stroke="#605e5c"/><rect x="3" y="18" width="18" height="3" fill="#fff" stroke="#605e5c"/></svg>',
  pivot: '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="8" height="9" fill="#fff" stroke="#605e5c"/><rect x="12" y="4" width="9" height="6" fill="#c7e0f4" stroke="#605e5c"/><path d="M7 11V7h4" stroke="#0b4f9e" stroke-width="1.5" fill="none"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1d6b45"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z" fill="#fff3c4" stroke="#8a6d00"/><path d="M9.5 19.5h5M10.5 21.5h3" stroke="#8a6d00"/></svg>',
  sol: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" fill="#fff" stroke="#605e5c"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#605e5c"/></svg>',
};
const TYPES = [['any', 'Любой'], ['number', 'Десятичное число'], ['int', 'Целое число'], ['date', 'Дата'], ['text', 'Текст']];
const typeMenu = () => TYPES.map(([t, l]) => ({ label: l, icon: tIcon(t), run: () => setType(t) }));
const fmtItems = () => [['lower', 'нижний регистр'], ['upper', 'ВЕРХНИЙ РЕГИСТР'], ['proper', 'Каждое Слово С Прописной'], ['trim', 'Усечь'], ['clean', 'Очистка']].map(([op, l]) => ({ label: l, run: () => colOp(op) }));
const extractItems = (addCol) => [
  { label: 'Длина', run: () => extractOp('length', addCol) }, { label: 'Первые символы…', run: () => extractOp('first', addCol) }, { label: 'Последние символы…', run: () => extractOp('last', addCol) },
  { label: 'Текст перед разделителем…', run: () => extractOp('before', addCol) }, { label: 'Текст после разделителя…', run: () => extractOp('after', addCol) }, { label: 'Текст между разделителями…', run: () => extractOp('between', addCol) },
];
const dateItems = (addCol) => [['year', 'Год'], ['quarter', 'Квартал'], ['month', 'Месяц'], ['startOfMonth', 'Начало месяца'], ['endOfMonth', 'Конец месяца'], ['monthName', 'Название месяца'], ['day', 'День']].map(([m, l]) => ({ label: l, run: () => dateOp(m, addCol) }));
const RIBBON = () => ({
  home: [
    ['Запрос', [{ big: 'Расширенный редактор', icon: I.adv, run: () => advanced() }]],
    ['Управление столбцами', [{ big: 'Удалить столбцы', icon: I.delcol, menu: () => [{ label: 'Удалить столбцы', run: () => removeCols(false) }, { label: 'Удалить другие столбцы', run: () => removeCols(true) }] }]],
    ['Сократить строки', [
      { big: 'Сохранить строки', icon: I.keep, menu: () => [{ label: 'Сохранить верхние строки…', run: () => rowsDlg('keepTop') }] },
      { big: 'Удалить строки', icon: I.delrow, menu: () => [{ label: 'Удалить верхние строки…', run: () => rowsDlg('removeTop') }, { label: 'Удалить нижние строки…', run: () => rowsDlg('removeBottom') }, { sep: true }, { label: 'Удалить дубликаты', run: () => dedupe() }, { label: 'Удалить пустые строки', run: () => add({ op: 'removeBlank' }) }, { label: 'Удалить ошибки', run: () => colOp('removeErrors') }] },
    ]],
    ['Сортировка', [{ small: true, items: [{ label: 'По возрастанию', icon: I.sortA, run: () => sortOp(false) }, { label: 'По убыванию', icon: I.sortZ, run: () => sortOp(true) }] }]],
    ['Преобразование', [{ small: true, items: [{ label: 'Тип данных: ' + curTypeName(), menu: typeMenu }, { label: 'Использовать первую строку в качестве заголовков', icon: I.hdr, run: () => add({ op: 'promote' }) }, { label: 'Заменить значения', icon: I.repl, run: () => replaceDlg() }] }]],
    ['Объединить', [{ small: true, items: [{ label: 'Объединить запросы', icon: I.merge, run: () => mergeDlg() }, { label: 'Добавить запросы', icon: I.append, run: () => appendDlg() }, { label: 'Объединить файлы', icon: I.append, run: () => combineDlg() }] }]],
  ],
  tr: [
    ['Таблица', [{ big: 'Группировать по', icon: I.group, run: () => groupDlg() }, { big: 'Использовать первую строку в качестве заголовков', icon: I.hdr, run: () => add({ op: 'promote' }) }]],
    ['Любой столбец', [{ small: true, items: [{ label: 'Тип данных: ' + curTypeName(), menu: typeMenu }, { label: 'Заменить значения', icon: I.repl, run: () => replaceDlg() }, { label: 'Заполнить', icon: I.fill, menu: () => [{ label: 'Вниз', run: () => colOp('fillDown') }, { label: 'Вверх', run: () => colOp('fillUp') }] }] }, { big: 'Отменить свертывание столбцов', icon: I.unpiv, menu: () => [{ label: 'Отменить свертывание столбцов', run: () => colOp('unpivot') }, { label: 'Отменить свертывание других столбцов', run: () => colOp('unpivotOther') }] }, { big: 'Столбец сведения', icon: I.pivot, run: () => pivotDlg() }, { big: 'Переименовать', icon: I.ren, run: () => renameDlg() }]],
    ['Текстовый столбец', [{ big: 'Разделить столбец', icon: I.split, menu: () => [{ label: 'По разделителю…', run: () => splitDlg() }] }, { big: 'Формат', icon: I.fmt, menu: fmtItems }, { big: 'Извлечь', icon: I.extr, menu: () => extractItems(false) }]],
    ['Столбец даты', [{ big: 'Дата', icon: I.date, menu: () => dateItems(false) }]],
  ],
  add: [
    ['Общее', [{ big: 'Настраиваемый столбец', icon: I.custom, run: () => customDlg() }, { big: 'Условный столбец', icon: I.cond, run: () => condDlg() }, { big: 'Столбец индекса', icon: I.idx, menu: () => [{ label: 'От 0', run: () => add({ op: 'index', name: 'Индекс', start: 0 }) }, { label: 'От 1', run: () => add({ op: 'index', name: 'Индекс', start: 1 }) }] }]],
    ['Из текста', [{ big: 'Формат', icon: I.fmt, menu: fmtItems }, { big: 'Извлечь', icon: I.extr, menu: () => extractItems(true) }]],
    ['Из даты и времени', [{ big: 'Дата', icon: I.date, menu: () => dateItems(true) }]],
  ],
});
function TRAIN() { return [{ big: 'Проверить решение', icon: I.check, id: 'pqcheck', cls: 'go', run: () => check() }, { big: 'Подсказка', icon: I.hint, run: () => { $('#hint').hidden = !$('#hint').hidden; } }, { big: 'Показать решение', icon: I.sol, run: () => reveal() }]; }
function renderRibbon() {
  const R = RIBBON(); const groups = R[tab] || R.home;
  let h = '';
  groups.forEach(([label, items], gi) => {
    h += `<div class="rg${label === 'Тренажёр' ? ' grow' : ''}"><div class="rb">`;
    items.forEach((it, ii) => {
      const id = `${gi}-${ii}`;
      if (it.small) h += '<div class="rb col pq-small">' + it.items.map((x, k) => `<button class="sm" data-r="${id}-${k}">${x.icon ? x.icon : ''}<span>${esc(x.label)}</span>${x.menu ? '<b>▾</b>' : ''}</button>`).join('') + '</div>';
      else h += `<button class="big${it.cls ? ' ' + it.cls : ''}"${it.id ? ` id="${it.id}"` : ''} data-r="${id}">${it.icon}<span>${esc(it.big)}${it.menu ? ' ▾' : ''}</span></button>`;
    });
    h += `</div><div class="rl">${esc(label)}</div></div>`;
  });
  if (tab === 'view') h = `<div class="rg"><div class="rb"><p class="pq-na">Эта вкладка в тренажёре не используется. Всё нужное — на вкладках «Главная», «Преобразование» и «Добавить столбец».</p></div><div class="rl">&nbsp;</div></div>`;
  $('#pq-ribbon').innerHTML = h;
}
$('#pq-ribbon').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'); if (!b) return;
  const p = b.dataset.r.split('-');
  let it;
  if (p[0] === 't') it = TRAIN()[+p[1]];
  else { const R = RIBBON(); const g = (R[tab] || R.home)[+p[0]][1][+p[1]]; it = p.length === 3 ? g.items[+p[2]] : g; }
  if (viewQ && p[0] !== 't') { toast(`Запрос «${viewQ}» уже готов. Вернитесь к запросу «${qname}» в панели слева.`); return; }
  if (it.menu) openMenu(b, it.menu()); else it.run();
});
$('#pqcheck').onclick = () => check();
$('#pqhint').onclick = () => { $('#hint').hidden = !$('#hint').hidden; if (!$('#hint').hidden) $('#hint').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
$('#pqsol').onclick = () => reveal();
$('#pq-tabs').addEventListener('click', e => { const s = e.target.closest('[data-tab]'); if (!s) return; tab = s.dataset.tab; document.querySelectorAll('#pq-tabs span').forEach(x => x.classList.toggle('on', x === s)); renderRibbon(); });

/* ───── меню и диалоги ───── */
function openMenu(anchor, items, x?, y?) {
  const m = $('#pq-menu'); const host = $('#pbi').getBoundingClientRect();
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon || '<span class="mi"></span>'}<span>${esc(it.label)}</span>${it.sub ? '<b>▸</b>' : ''}</button>`).join('');
  m.hidden = false;
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, bottom: y };
  m.style.left = Math.min(r.left - host.left, host.width - 260) + 'px'; m.style.top = (r.bottom - host.top + 2) + 'px';
  m.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; if (it.sub) { openMenu(b, it.sub()); return; } closeMenu(); it.run(); };
}
const closeMenu = () => { $('#pq-menu').hidden = true; };
document.addEventListener('mousedown', e => { if (!e.target.closest('#pq-menu') && !e.target.closest('[data-r]') && !e.target.closest('.pq-filter-dd')) closeMenu(); });
function dialog(title, body, onOk, okLabel = 'ОК', cancel = okLabel !== 'Готово') {
  const md = $('#pq-modal'); const d = md.querySelector('.pq-dlg');
  d.innerHTML = `<div class="dh">${esc(title)}<button class="dx" aria-label="Закрыть">✕</button></div><div class="db">${body}</div><div class="df"><button class="pb" data-ok>${okLabel}</button>${cancel ? '<button data-cancel>Отмена</button>' : ''}</div>`;
  md.hidden = false;
  const close = () => { md.hidden = true; };
  d.querySelector('.dx').onclick = close; const cb = d.querySelector('[data-cancel]'); if (cb) cb.onclick = close;
  d.querySelector('[data-ok]').onclick = () => { const err = onOk(d); if (err) { let p = d.querySelector('.derr'); if (!p) { p = document.createElement('p'); p.className = 'derr'; d.querySelector('.db').appendChild(p); } p.textContent = err; return; } close(); };
  d.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') d.querySelector('[data-ok]').click(); if (e.key === 'Escape') close(); });
  setTimeout(() => (d.querySelector('input,select') as HTMLElement)?.focus(), 30);
}
let toastT; function toast(msg) { let el = $('.pbi-toast'); if (!el) { el = document.createElement('div'); el.className = 'pbi-toast'; $('#pbi').appendChild(el); } el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2800); }

/* ───── операции ───── */
const curTable = () => res.tables[Math.min(cur, res.tables.length - 1)];
const curTypeName = () => { const t = res && curTable(); if (!t || selCols.length !== 1) return 'Любой'; const c = t.cols.find(c => c.name === selCols[0]); return c ? TYPE_NAME[c.type] : 'Любой'; };
function needCols(n = 1) { if (selCols.length < n) { toast('Сначала выделите столбец: щёлкните по его заголовку.'); return false; } return true; }
function add(step) {
  start();
  steps.splice(cur, 0, step);
  if (cur < steps.length - 1) toast('Шаг вставлен после «' + (cur ? stepNames(steps)[cur - 1] : 'Источник') + '». Следующие шаги могут выдать ошибку.');
  cur++; persist(); recompute(); clearFb();
}
function setType(t) {
  if (!needCols()) return;
  const last = steps[cur - 1];
  if (last && last.op === 'type' && cur === steps.length) { selCols.forEach(c => last.cols[c] = t); persist(); recompute(); return; }
  add({ op: 'type', cols: Object.fromEntries(selCols.map(c => [c, t])) });
}
function removeCols(other) { if (!needCols()) return; add(other ? { op: 'keepCols', cols: [...selCols] } : { op: 'removeCols', cols: [...selCols] }); if (!other) selCols = []; render(); }
function colOp(op) { if (!needCols()) return; add({ op, cols: [...selCols] }); if (op.startsWith('unpivot')) { selCols = []; render(); } }
function rowsDlg(op) {
  dialog({ removeTop: 'Удалить верхние строки', removeBottom: 'Удалить нижние строки', keepTop: 'Сохранить верхние строки' }[op], `<p>${op === 'keepTop' ? 'Укажите, сколько строк сверху оставить.' : `Укажите, сколько строк нужно удалить ${op === 'removeTop' ? 'сверху' : 'снизу'}.`}</p><label class="dlab">Число строк<input type="number" min="1" value="1" id="dn"></label>`, d => {
    const n = Math.floor(+d.querySelector('#dn').value); if (!(n >= 1)) return 'Введите целое число больше нуля.'; add({ op, n });
  });
}
function replaceDlg() {
  if (!needCols()) return;
  dialog('Заменить значения', `<p>Замена одного значения другим в выделенных столбцах.</p><label class="dlab">Значение для поиска<input id="df" autocomplete="off"></label><label class="dlab">Заменить на<input id="dr" autocomplete="off"></label>`, d => {
    const f = d.querySelector('#df').value; if (f === '') return 'Укажите значение для поиска.'; add({ op: 'replace', cols: [...selCols], find: f, repl: d.querySelector('#dr').value });
  });
}
function renameDlg(col = selCols[0]) {
  if (!col) return needCols();
  dialog('Переименовать столбец', `<label class="dlab">Новое имя<input id="dn" value="${esc(col)}" autocomplete="off"></label>`, d => {
    const to = d.querySelector('#dn').value.trim(); if (!to) return 'Имя не может быть пустым.'; if (to === col) return;
    if (curTable().cols.some(c => c.name === to)) return 'Столбец с таким именем уже есть.';
    const last = steps[cur - 1];
    add({ op: 'rename', col, to }); selCols = [to]; render();
  });
}
function splitDlg() {
  if (!needCols()) return;
  dialog('Разделить столбец по разделителю', `<label class="dlab">Выберите или введите разделитель<select id="ds"><option value=",">Запятая</option><option value=";">Точка с запятой</option><option value=" ">Пробел</option><option value="-">Дефис</option><option value="custom">--Пользовательский--</option></select></label><label class="dlab">Пользовательский<input id="dc" autocomplete="off"></label><p class="dnote">Разделение по каждому вхождению разделителя.</p>`, d => {
    let s = d.querySelector('#ds').value; if (s === 'custom') s = d.querySelector('#dc').value; if (!s) return 'Укажите разделитель.';
    add({ op: 'split', col: selCols[0], delim: s }); selCols = []; render();
  });
}
function groupDlg() {
  const t = curTable();
  const opts = sel => colOpts(t, sel);
  const aggRow = (k, name = 'Количество', op = 'count') => `<div class="grow2" data-g="${k}"><input class="gn" value="${esc(name)}"><select class="go"><option value="count"${op === 'count' ? ' selected' : ''}>Подсчитать строки</option><option value="sum"${op === 'sum' ? ' selected' : ''}>Сумма</option><option value="avg">Среднее</option><option value="min">Минимум</option><option value="max">Максимум</option></select><select class="gc"${op === 'count' ? ' disabled' : ''}>${opts()}</select></div>`;
  dialog('Группировать по', `<p>Укажите столбцы для группировки и нужные выходные данные.</p><div class="gby"><select class="gb">${opts(selCols[0])}</select></div><button type="button" class="addg">Добавить группирование</button><div class="dlab" style="margin-top:10px">Имя нового столбца · Операция · Столбец</div><div id="gaggs">${aggRow(0)}</div><button type="button" class="adda">Добавить агрегирование</button>`, d => {
    const by = [...new Set([...d.querySelectorAll('.gb')].map(x => x.value))];
    const aggs = [...d.querySelectorAll('.grow2')].map(r => { const op = r.querySelector('.go').value; return { name: r.querySelector('.gn').value.trim(), op, ...(op === 'count' ? {} : { col: r.querySelector('.gc').value }) }; });
    if (aggs.some(a => !a.name)) return 'Укажите имя каждого нового столбца.';
    if (new Set(aggs.map(a => a.name)).size !== aggs.length || aggs.some(a => by.includes(a.name))) return 'Имена новых столбцов должны различаться и не совпадать со столбцами группировки.';
    add({ op: 'group', by, aggs }); selCols = []; render();
  });
  const d = $('#pq-modal .pq-dlg');
  const NAMES = { count: 'Количество', sum: 'Сумма', avg: 'Среднее', min: 'Минимум', max: 'Максимум' };
  d.addEventListener('change', e => { const r = e.target.closest('.grow2'); if (!r || !e.target.classList.contains('go')) return; const v = e.target.value; r.querySelector('.gc').disabled = v === 'count'; const n = r.querySelector('.gn'); if (Object.values(NAMES).includes(n.value)) n.value = NAMES[v]; });
  d.querySelector('.addg').onclick = () => d.querySelector('.gby').insertAdjacentHTML('beforeend', `<select class="gb">${opts()}</select>`);
  d.querySelector('.adda').onclick = () => d.querySelector('#gaggs').insertAdjacentHTML('beforeend', aggRow(d.querySelectorAll('.grow2').length, 'Сумма', 'sum'));
}
function advanced() {
  const code = fullM(steps, viewQ ? (SOURCES[task.queries[viewQ]]?.expr || 'Источник') : SRC.expr);
  if (viewQ) return dialog(viewQ, `<p class="dnote">Готовый запрос, только для просмотра.</p><pre class="pq-adv">${esc(code)}</pre>`, () => {}, 'Готово', false);
  dialog(qname, `<p class="dnote">Код M всего запроса. Его можно править: каждый шаг — функция Table.… от предыдущего шага. Шаг «Источник» менять не нужно.</p><div class="adv-wrap"><pre class="adv-ln" aria-hidden="true"></pre><textarea id="adv" class="pq-adv" spellcheck="false" autocomplete="off"></textarea></div><p class="dnote" id="advs"></p>`, d => {
    try { const ns = parseQuery(d.querySelector('#adv').value, OTHERS); start(); steps = ns; cur = steps.length; persist(); recompute(); clearFb(); }
    catch (e) { return lineOf(d.querySelector('#adv').value, e.pos) + e.message; }
  }, 'Готово', true);
  const d = $('#pq-modal .pq-dlg'); const ta = d.querySelector('#adv'); const ln = d.querySelector('.adv-ln');
  ta.value = code;
  const upd = () => { ln.textContent = ta.value.split('\n').map((_, k) => k + 1).join('\n'); ln.scrollTop = ta.scrollTop; const st = d.querySelector('#advs'); try { parseQuery(ta.value, OTHERS); st.className = 'dnote ok'; st.textContent = '✓ Синтаксических ошибок не обнаружено.'; } catch (e) { st.className = 'dnote bad'; st.textContent = '⚠ ' + lineOf(ta.value, e.pos) + e.message; } };
  ta.oninput = upd; ta.onscroll = () => { ln.scrollTop = ta.scrollTop; }; upd();
  ta.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const a2 = ta.selectionStart; ta.value = ta.value.slice(0, a2) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = a2 + 4; upd(); } });
  setTimeout(() => ta.focus(), 40);
}

function dedupe() { if (!needCols()) return; const t = curTable(); add({ op: 'dedupe', cols: selCols.length === t.cols.length ? [] : [...selCols] }); }
function sortOp(desc) {
  if (!needCols()) return;
  const last = steps[cur - 1]; const col = selCols[0];
  if (last && last.op === 'sort' && cur === steps.length) { last.by = last.by.filter(b => b.col !== col); last.by.push({ col, desc }); persist(); recompute(); return; }
  add({ op: 'sort', by: [{ col, desc }] });
}
function extractOp(mode, addCol) {
  if (!needCols()) return; const col = selCols[0];
  const go = (extra = {}) => add({ op: 'extract', col, mode, ...(addCol ? { add: true } : {}), ...extra });
  if (mode === 'length') return go();
  if (mode === 'first' || mode === 'last') return dialog(mode === 'first' ? 'Извлечь первые символы' : 'Извлечь последние символы', `<p>Укажите, сколько символов сохранить.</p><label class="dlab">Количество<input type="number" min="1" value="3" id="dn"></label>`, d => { const n = Math.floor(+d.querySelector('#dn').value); if (!(n >= 1)) return 'Введите целое число больше нуля.'; go({ n }); });
  if (mode === 'between') return dialog('Текст между разделителями', `<label class="dlab">Начальный разделитель<input id="d1" autocomplete="off"></label><label class="dlab">Конечный разделитель<input id="d2" autocomplete="off"></label>`, d => { const a = d.querySelector('#d1').value, b = d.querySelector('#d2').value; if (!a || !b) return 'Укажите оба разделителя.'; go({ delim: a, delim2: b }); });
  dialog(mode === 'before' ? 'Текст перед разделителем' : 'Текст после разделителя', `<label class="dlab">Разделитель<input id="d1" autocomplete="off"></label>`, d => { const a = d.querySelector('#d1').value; if (!a) return 'Укажите разделитель.'; go({ delim: a }); });
}
function dateOp(mode, addCol) {
  if (!needCols()) return; const t = curTable(); const c = t.cols.find(x => x.name === selCols[0]);
  if (c.type !== 'date') return toast(`Команды «Дата» работают со столбцами типа «Дата». Сначала задайте столбцу «${c.name}» тип «Дата».`);
  add({ op: 'dateOp', col: c.name, mode, ...(addCol ? { add: true } : {}) });
}
const colOpts = (t, sel?) => t.cols.filter(c => c.type !== 'table').map(c => `<option${sel === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
const KINDS = [['leftouter', 'Внешнее соединение слева (все из первой, совпадающие из второй)'], ['rightouter', 'Внешнее соединение справа (все из второй, совпадающие из первой)'], ['fullouter', 'Полное внешнее (все строки из обеих)'], ['inner', 'Внутреннее (только совпадающие строки)'], ['leftanti', 'Анти-соединение слева (строки только в первой)'], ['rightanti', 'Анти-соединение справа (строки только во второй)']];
function mergeDlg() {
  if (!OTHERS.length) return toast('В этой задаче нет второго запроса для слияния.');
  const t = curTable();
  dialog('Слияние', `<p>Выберите таблицу и соответствующие столбцы, чтобы создать объединенную таблицу.</p>
    <div class="drow2"><label class="dlab">${esc(qname)} — столбец<select id="ml">${colOpts(t, selCols[0])}</select></label><label class="dlab">Вторая таблица<select id="mq">${OTHERS.map(n => `<option>${esc(n)}</option>`).join('')}</select></label></div>
    <div class="drow2"><span></span><label class="dlab">Столбец второй таблицы<select id="mr"></select></label></div>
    <label class="dlab">Тип соединения<select id="mk">${KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    <p class="dnote" id="mm"></p>`, d => {
    const w = d.querySelector('#mq').value;
    add({ op: 'merge', with: w, left: [d.querySelector('#ml').value], right: [d.querySelector('#mr').value], kind: d.querySelector('#mk').value, as: w });
  });
  const d = $('#pq-modal .pq-dlg');
  const fillR = () => { const o = env.queries[d.querySelector('#mq').value]; const l = d.querySelector('#ml').value; d.querySelector('#mr').innerHTML = colOpts(o, o.cols.some(c => c.name === l) ? l : undefined); stat(); };
  const stat = () => {
    const o = env.queries[d.querySelector('#mq').value]; const li = t.cols.findIndex(c => c.name === d.querySelector('#ml').value), ri = o.cols.findIndex(c => c.name === d.querySelector('#mr').value);
    const keys = new Set(o.rows.map(r => typeof r[ri] + ':' + r[ri])); const n = t.rows.filter(r => r[li] !== null && keys.has(typeof r[li] + ':' + r[li])).length;
    const tl = t.cols[li].type, tr = o.cols[ri].type;
    d.querySelector('#mm').innerHTML = (n ? '✓ ' : '⚠ ') + `Выбор соответствует ${n} из ${t.rows.length} строк первой таблицы.` + (tl !== tr ? ` <b>Типы столбцов различаются: ${TYPE_NAME[tl]} и ${TYPE_NAME[tr]}.</b>` : '');
  };
  d.querySelector('#mq').onchange = fillR; d.querySelector('#ml').onchange = fillR; d.querySelector('#mr').onchange = stat; fillR();
}
function appendDlg() {
  if (!OTHERS.length) return toast('В этой задаче нет других запросов для добавления.');
  dialog('Добавление', `<p>Объедините строки двух или нескольких таблиц.</p><p class="dnote">Первая таблица — текущий запрос «${esc(qname)}».</p><div class="dlab">Добавляемые таблицы${OTHERS.map(n => `<label class="dchk"><input type="checkbox" value="${esc(n)}" checked> ${esc(n)}</label>`).join('')}</div>`, d => {
    const qs = [...d.querySelectorAll('.dchk input:checked')].map(x => x.value); if (!qs.length) return 'Отметьте хотя бы одну таблицу.';
    add({ op: 'append', queries: qs });
  });
}
function expandDlg(col) {
  const t = curTable(); const i = t.cols.findIndex(c => c.name === col);
  const smp = t.rows.find(r => isTbl(r[i]))?.[i]; const fields = smp ? smp.table.cols.map(c => c.name) : [];
  const m = $('#pq-menu'); const host = $('#pbi').getBoundingClientRect(); const th = document.querySelector(`th[data-c="${CSS.escape(col)}"]`).getBoundingClientRect();
  m.innerHTML = `<div class="pq-filter"><div class="xr"><label><input type="radio" name="xm" value="expand" checked> Развернуть</label><label><input type="radio" name="xm" value="agg"> Агрегировать</label></div><hr><label class="fa"><input type="checkbox" data-all> (Выделить все столбцы)</label><div class="fv">${fields.map((f, k) => `<label><input type="checkbox" data-k="${k}"> ${esc(f)}</label>`).join('')}</div><label class="fa"><input type="checkbox" id="xpre" checked> Использовать исходное имя столбца как префикс</label><div class="ff"><button class="pb" data-fa="ok">ОК</button><button data-fa="cancel">Отмена</button></div></div>`;
  m.hidden = false; m.style.left = Math.max(4, Math.min(th.left - host.left, host.width - 280)) + 'px'; m.style.top = (th.bottom - host.top + 2) + 'px';
  const boxes = () => [...m.querySelectorAll('[data-k]')];
  m.querySelector('[data-all]').onchange = e => boxes().forEach(b => b.checked = e.target.checked);
  m.onclick = e => {
    const a = e.target.closest('[data-fa]'); if (!a) return;
    if (a.dataset.fa === 'cancel') return closeMenu();
    const fs = boxes().filter(b => b.checked).map(b => fields[+b.dataset.k]);
    if (!fs.length) return toast('Отметьте хотя бы один столбец.');
    const pre = m.querySelector('#xpre').checked; const mode = m.querySelector('[name=xm]:checked').value; closeMenu();
    if (mode === 'agg') add({ op: 'aggregate', col, aggs: fs.map(f => ({ field: f, op: 'sum', name: (pre ? col + '.' : '') + 'Сумма ' + f })) });
    else add({ op: 'expand', col, fields: fs, names: fs.map(f => pre ? col + '.' + f : f) });
  };
}
function customDlg() {
  const t = curTable();
  dialog('Настраиваемый столбец', `<div class="cust"><div><label class="dlab">Имя нового столбца<input id="cn" value="Пользовательский" autocomplete="off"></label>
    <label class="dlab">Формула настраиваемого столбца<div class="mfx"><span>=</span><textarea id="cf" rows="5" spellcheck="false" autocomplete="off"></textarea></div></label>
    <p class="dnote" id="cs">✓ Синтаксических ошибок не обнаружено.</p>
    <label class="dlab">Тип данных<select id="ct"><option value="">Любой</option><option value="number">Десятичное число</option><option value="int">Целое число</option><option value="text">Текст</option><option value="date">Дата</option></select></label></div>
    <div class="cols"><div class="dlab">Доступные столбцы</div><ul>${t.cols.filter(c => c.type !== 'table').map(c => `<li data-ins="[${esc(c.name)}]">${esc(c.name)}</li>`).join('')}</ul><button type="button" class="ins">&lt;&lt; Вставить</button><p class="dnote">Функции: Text.Upper, Text.Start, Number.Round, Date.Month и другие. Регистр букв важен.</p></div></div>`, d => {
    const name = d.querySelector('#cn').value.trim(), f = d.querySelector('#cf').value.trim().replace(/^=\s*/, '');
    if (!name) return 'Укажите имя столбца.'; if (!f) return 'Напишите формулу.';
    if (t.cols.some(c => c.name === name)) return 'Столбец с таким именем уже есть.';
    try { parseM(f); } catch (e) { return e.message; }
    const ty = d.querySelector('#ct').value;
    add({ op: 'addCol', name, expr: f, ...(ty ? { type: ty } : {}) });
  });
  const d = $('#pq-modal .pq-dlg'); const ta = d.querySelector('#cf'); let picked = null;
  const ins = s2 => { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + s2 + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + s2.length; ta.focus(); validate(); };
  const validate = () => { const v = ta.value.trim(); const st = d.querySelector('#cs'); if (!v) { st.textContent = ''; return; } try { parseM(v.replace(/^=\s*/, '')); st.className = 'dnote ok'; st.textContent = '✓ Синтаксических ошибок не обнаружено.'; } catch (e) { st.className = 'dnote bad'; st.textContent = '⚠ ' + e.message; } };
  ta.oninput = validate;
  d.querySelectorAll('[data-ins]').forEach(li => { li.onclick = () => { d.querySelectorAll('[data-ins]').forEach(x => x.classList.remove('on')); li.classList.add('on'); picked = li.dataset.ins; }; li.ondblclick = () => ins(li.dataset.ins); });
  d.querySelector('.ins').onclick = () => picked && ins(picked);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); });
  setTimeout(() => { d.querySelector('#cn').select(); }, 40);
}
const OPS = [['eq', 'равно'], ['ne', 'не равно'], ['gt', 'больше'], ['ge', 'больше или равно'], ['lt', 'меньше'], ['le', 'меньше или равно'], ['begins', 'начинается с'], ['notbegins', 'не начинается с'], ['ends', 'заканчивается на'], ['contains', 'содержит'], ['notcontains', 'не содержит']];
function condDlg() {
  const t = curTable();
  const row = k => `<div class="crow" data-r="${k}"><span>${k ? 'Иначе если' : 'Если'}</span><select class="cc">${colOpts(t, selCols[0])}</select><select class="co">${OPS.map(([o, l]) => `<option value="${o}">${l}</option>`).join('')}</select><input class="cv" placeholder="Значение"><span>Тогда</span><input class="cout" placeholder="Вывод"></div>`;
  dialog('Добавление условного столбца', `<p>Добавьте условный столбец, который вычисляется по другим столбцам или значениям.</p><label class="dlab">Имя нового столбца<input id="kn" value="Пользовательский" autocomplete="off"></label><div id="crows">${row(0)}</div><button type="button" class="addc">Добавить предложение</button><label class="dl kels">Иначе<input id="kel" placeholder="Вывод"></label>`, d => {
    const name = d.querySelector('#kn').value.trim(); if (!name) return 'Укажите имя столбца.';
    if (t.cols.some(c => c.name === name)) return 'Столбец с таким именем уже есть.';
    const rules = [...d.querySelectorAll('.crow')].map(r => ({ col: r.querySelector('.cc').value, op: r.querySelector('.co').value, value: r.querySelector('.cv').value, out: r.querySelector('.cout').value }));
    if (rules.some(r => r.value === '' || r.out === '')) return 'Заполните значение и вывод в каждом условии.';
    add({ op: 'condCol', name, rules, else: d.querySelector('#kel').value });
  });
  const d = $('#pq-modal .pq-dlg');
  d.querySelector('.addc').onclick = () => { const n = d.querySelectorAll('.crow').length; d.querySelector('#crows').insertAdjacentHTML('beforeend', row(n)); };
}
function pivotDlg() {
  if (!needCols()) return; const t = curTable(); const col = selCols[0];
  dialog('Столбец сведения', `<p>Значения в столбце «${esc(col)}» станут именами новых столбцов.</p><label class="dlab">Столбец значений<select id="pv">${colOpts({ cols: t.cols.filter(c => c.name !== col) })}</select></label><label class="dlab">Функция агрегирования значения<select id="pa"><option value="sum">Сумма</option><option value="count">Количество (все)</option><option value="min">Минимум</option><option value="max">Максимум</option><option value="avg">Среднее</option><option value="none">Не агрегировать</option></select></label>`, d => {
    add({ op: 'pivot', col, val: d.querySelector('#pv').value, agg: d.querySelector('#pa').value }); selCols = []; render();
  });
}
/* ───── сетка ───── */
function tIcon(t) { return `<span class="ti t-${t}">${{ any: 'ABC<br>123', text: 'ABC', number: '1.2', int: '1²3', date: '▦', table: '▤', binary: '01<br>10' }[t]}</span>`; }
function recompute() { res = run(base, steps, env); if (cur > steps.length) cur = steps.length; render(); }
function render() {
  renderRibbon(); renderQueries();
  if (viewQ) return renderOther();
  renderSteps();
  const names = stepNames(steps);
  const errAt = res.error ? res.error.step + 1 : Infinity;
  fxEdit = false; $('#pqfx-ok').disabled = true; $('#pqfx-x').disabled = true;
  $('#pq-formula').textContent = cur === 0 ? '= ' + SRC.expr : '= ' + mCode(steps[cur - 1], cur > 1 ? names[cur - 2] : 'Источник');
  const ep = $('#pq-errpane');
  if (cur >= errAt) {
    ep.hidden = false; ep.innerHTML = `<b>⚠ ${esc(res.error.msg)}</b><p>Ошибка в шаге «${esc(names[res.error.step])}». Удалите шаг или исправьте предыдущие.</p>`;
    $('#pq-grid').innerHTML = ''; $('#st').textContent = '';
    return;
  }
  ep.hidden = true;
  const t = res.tables[cur];
  grid(t);
}
function renderOther() {
  $('#pq-name').value = viewQ;
  $('#pq-steps').innerHTML = '<li class="on"><span>Источник</span></li>';
  $('#pq-formula').textContent = '= ' + (SOURCES[task.queries[viewQ]]?.expr || 'Источник');
  $('#pq-errpane').hidden = true;
  selCols = []; grid(env.queries[viewQ]);
}
function grid(t) {
  selCols = selCols.filter(c => t.cols.some(x => x.name === c));
  const shown = t.rows.slice(0, 300);
  let h = '<table><thead><tr><th class="rn"></th>';
  t.cols.forEach((c, i) => {
    const vals = t.rows.map(r => r[i]); const n = vals.length || 1;
    const er = vals.filter(isErr).length, em = vals.filter(v => v === null || v === '').length, ok = n - er - em;
    h += `<th class="${selCols.includes(c.name) ? 'sel' : ''}" data-c="${esc(c.name)}"><div class="hc"><button class="tbtn" data-type="${esc(c.name)}" title="Тип: ${TYPE_NAME[c.type]}">${tIcon(c.type)}</button><span class="hn">${esc(c.name)}</span>${c.type === 'binary' ? `<button class="fbtn pq-filter-dd xbtn" data-combine="1" title="Объединить файлы">⇓⇓</button>` : c.type === 'table' ? `<button class="fbtn pq-filter-dd xbtn" data-expand="${esc(c.name)}" title="Развернуть">⇔</button>` : `<button class="fbtn pq-filter-dd" data-filter="${esc(c.name)}" title="Фильтр">▾</button>`}</div><div class="q" title="Допустимые: ${Math.round(ok / n * 100)} %, ошибки: ${Math.round(er / n * 100)} %, пустые: ${Math.round(em / n * 100)} %"><i style="width:${ok / n * 100}%" class="qv"></i><i style="width:${er / n * 100}%" class="qe"></i><i style="width:${em / n * 100}%" class="qn"></i></div></th>`;
  });
  h += '</tr></thead><tbody>';
  shown.forEach((r, k) => {
    h += `<tr><th class="rn">${k + 1}</th>` + r.map((v, i) => { const ty = t.cols[i].type; const cls = v === null ? 'nul' : isErr(v) ? 'err' : isTbl(v) || isBin(v) ? 'tbl' : (ty === 'number' || ty === 'int' || ty === 'date') ? 'n' : ''; return `<td class="${cls}${selCols.includes(t.cols[i].name) ? ' sel' : ''}"${isErr(v) ? ` data-err="${esc(v.err)}"` : ''}>${esc(show(v, ty))}</td>`; }).join('') + '</tr>';
  });
  h += '</tbody></table>';
  if (!t.rows.length) h += '<p class="pq-empty">В таблице нет строк.</p>';
  $('#pq-grid').innerHTML = h;
  $('#st').textContent = `${t.cols.length} ${pl(t.cols.length, 'СТОЛБЕЦ', 'СТОЛБЦА', 'СТОЛБЦОВ')}, ${t.rows.length} ${pl(t.rows.length, 'СТРОКА', 'СТРОКИ', 'СТРОК')}`;
}
const pl = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
function updateSel() {
  const t = curTable(); const on = new Set(t.cols.map((c, i) => selCols.includes(c.name) ? i : -1));
  document.querySelectorAll('#pq-grid thead th[data-c]').forEach((th, i) => th.classList.toggle('sel', on.has(i)));
  document.querySelectorAll('#pq-grid tbody tr').forEach(tr => [...tr.querySelectorAll('td')].forEach((td, i) => td.classList.toggle('sel', on.has(i))));
  renderRibbon();
}
function renderSteps() {
  const names = stepNames(steps); const errAt = res.error ? res.error.step : -1;
  $('#pq-steps').innerHTML = [`<li data-s="0" class="${cur === 0 ? 'on' : ''}"><span>Источник</span></li>`, ...names.map((n, i) => `<li data-s="${i + 1}" class="${cur === i + 1 ? 'on' : ''}${i === errAt ? ' bad' : ''}">${i === errAt ? '<b class="w">⚠</b>' : ''}<span>${esc(n)}</span><button data-del="${i}" title="Удалить шаг" aria-label="Удалить шаг">✕</button></li>`)].join('');
}
$('#pq-qlist').addEventListener('click', e => { const q = e.target.closest('.pq-q'); if (!q) return; if (q.dataset.helper) return toast('Вспомогательные запросы Power Query создал сам при объединении файлов. Их менять не нужно.'); viewQ = q.dataset.q || null; if (!viewQ) $('#pq-name').value = qname; closeMenu(); render(); });
$('#pq-steps').addEventListener('click', e => {
  if (viewQ) return;
  const del = e.target.closest('[data-del]');
  if (del) { const i = +del.dataset.del; steps.splice(i, 1); if (cur > i) cur--; persist(); recompute(); clearFb(); return; }
  const li = e.target.closest('[data-s]'); if (li) { cur = +li.dataset.s; render(); }
});
$('#pq-grid').addEventListener('click', e => {
  if (viewQ) { if (e.target.closest('button')) toast(`Запрос «${viewQ}» уже готов. Вернитесь к запросу «${qname}» в панели слева.`); return; }
  const xb = e.target.closest('[data-expand]'); if (xb) { expandDlg(xb.dataset.expand); return; }
  if (e.target.closest('[data-combine]')) { combineDlg(); return; }
  const tb = e.target.closest('[data-type]'); if (tb) { const rc = tb.getBoundingClientRect(); selCols = [tb.dataset.type]; updateSel(); openMenu(null, typeMenu(), rc.left, rc.bottom); return; }
  const fb = e.target.closest('[data-filter]'); if (fb) { filterMenu(fb.dataset.filter, fb); return; }
  const th = e.target.closest('thead th[data-c]');
  if (th) { const c = th.dataset.c; if (e.ctrlKey || e.metaKey || e.shiftKey) selCols = selCols.includes(c) ? selCols.filter(x => x !== c) : [...selCols, c]; else selCols = [c]; updateSel(); return; }
  const td = e.target.closest('td[data-err]'); if (td) { toast(td.dataset.err); }
});
$('#pq-grid').addEventListener('dblclick', e => { const th = e.target.closest('thead th[data-c]'); if (th && !e.target.closest('button')) renameDlg(th.dataset.c); });
$('#pq-grid').addEventListener('contextmenu', e => {
  const th = e.target.closest('thead th[data-c]'); if (!th || viewQ) return;
  e.preventDefault(); const c = th.dataset.c; if (!selCols.includes(c)) selCols = [c]; updateSel();
  const fmtSub = () => [['lower', 'нижний регистр'], ['upper', 'ВЕРХНИЙ РЕГИСТР'], ['proper', 'Каждое Слово С Прописной'], ['trim', 'Усечь'], ['clean', 'Очистка']].map(([op, l]) => ({ label: l, run: () => colOp(op) }));
  openMenu(null, [
    { label: 'Удалить', run: () => removeCols(false) }, { label: 'Удалить другие столбцы', run: () => removeCols(true) }, { sep: true },
    { label: 'Тип изменения', sub: typeMenu }, { label: 'Преобразование', sub: fmtSub }, { sep: true },
    { label: 'Заменить значения…', run: () => replaceDlg() }, { label: 'Заполнить', sub: () => [{ label: 'Вниз', run: () => colOp('fillDown') }, { label: 'Вверх', run: () => colOp('fillUp') }] }, { label: 'Удалить дубликаты', run: () => dedupe() }, { label: 'Удалить ошибки', run: () => colOp('removeErrors') }, { label: 'Группировать по…', run: () => groupDlg() }, { sep: true },
    { label: 'Сортировка по возрастанию', run: () => sortOp(false) }, { label: 'Сортировка по убыванию', run: () => sortOp(true) }, { label: 'Извлечь', sub: () => extractItems(false) }, { sep: true },
    { label: 'Отменить свертывание других столбцов', run: () => colOp('unpivotOther') }, { label: 'Отменить свертывание только выделенного столбца', run: () => colOp('unpivot') }, { sep: true },
    { label: 'Переименовать…', run: () => renameDlg(c) }, { label: 'Разделить столбец по разделителю…', run: () => splitDlg() },
  ], e.clientX, e.clientY);
});
function filterMenu(col, anchor) {
  const t = curTable(); const i = t.cols.findIndex(c => c.name === col); const ty = t.cols[i].type;
  const seen = new Map(); for (const r of t.rows) { const v = r[i]; if (isErr(v)) continue; const k = v === null ? '∅' : typeof v + ':' + v; if (!seen.has(k)) seen.set(k, v); }
  const vals = [...seen.values()].sort((a, b) => a === null ? -1 : b === null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ru')).slice(0, 500);
  const m = $('#pq-menu'); const host = $('#pbi').getBoundingClientRect(); const r = anchor.getBoundingClientRect();
  m.innerHTML = `<div class="pq-filter"><button class="fl" data-fa="asc">↑ Сортировка по возрастанию</button><button class="fl" data-fa="desc">↓ Сортировка по убыванию</button><hr><button class="fl" data-fa="rmempty">Удалить пустые</button><button class="fl" data-fa="cond">${ty === 'number' || ty === 'int' ? 'Числовые фильтры…' : ty === 'date' ? 'Фильтры дат…' : 'Текстовые фильтры…'}</button><hr><input class="fs" placeholder="Поиск"><label class="fa"><input type="checkbox" checked data-all> (Выделить все)</label><div class="fv">${vals.map((v, k) => `<label><input type="checkbox" checked data-k="${k}"> ${v === null ? '<i>(null)</i>' : esc(show(v, ty))}</label>`).join('')}</div><div class="ff"><button class="pb" data-fa="ok">ОК</button><button data-fa="cancel">Отмена</button></div></div>`;
  m.hidden = false; m.style.left = Math.min(r.left - host.left - 160, host.width - 280) + 'px'; m.style.top = (r.bottom - host.top + 2) + 'px';
  const boxes = () => [...m.querySelectorAll('[data-k]')];
  m.querySelector('[data-all]').onchange = e => boxes().forEach(b => { if (b.closest('label').style.display !== 'none') b.checked = e.target.checked; });
  m.querySelector('.fs').oninput = e => { const q = e.target.value.toLowerCase(); boxes().forEach(b => { b.closest('label').style.display = b.closest('label').textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  m.onclick = e => {
    const a = e.target.closest('[data-fa]'); if (!a) return;
    if (a.dataset.fa === 'cancel') return closeMenu();
    if (a.dataset.fa === 'asc' || a.dataset.fa === 'desc') { closeMenu(); selCols = [col]; return sortOp(a.dataset.fa === 'desc'); }
    if (a.dataset.fa === 'cond') { closeMenu(); return condFilterDlg(col, ty); }
    if (a.dataset.fa === 'rmempty') { closeMenu(); return add({ op: 'filter', col, exclude: [null, ''] }); }
    const keep = boxes().filter(b => b.checked).map(b => vals[+b.dataset.k]), drop = boxes().filter(b => !b.checked).map(b => vals[+b.dataset.k]);
    closeMenu();
    if (!drop.length) return;
    if (!keep.length) return toast('Нужно оставить хотя бы одно значение.');
    add(drop.length <= keep.length ? { op: 'filter', col, exclude: drop } : { op: 'filter', col, keep });
  };
}
$('#full').onclick = () => { const on = $('#pbi').classList.toggle('fs'); document.body.classList.toggle('pbi-lock', on); $('#full').textContent = on ? '⤡' : '⤢'; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#pbi').classList.contains('fs') && $('#pq-modal').hidden && $('#pq-menu').hidden) $('#full').click(); if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement?.closest?.('#pbi') && steps.length && $('#pq-modal').hidden) { e.preventDefault(); steps.splice(cur - 1, 1); cur = Math.max(0, cur - 1); persist(); recompute(); } });

function combineDlg() {
  const t = curTable(); const ci = t.cols.findIndex(c => c.type === 'binary');
  if (ci < 0) return toast('Объединять файлы можно, когда источник — папка и в таблице есть столбец Content с двоичными данными.');
  const files = t.rows.filter(r => isBin(r[ci])).map(r => r[ci].bin);
  if (!files.length) return toast('В таблице не осталось файлов.');
  const prev = k => { const f = files[k]; if (!/\.(xlsx|xls|csv)$/i.test(f.name)) return `<p class="dnote bad">⚠ «${esc(f.name)}» — не книга Excel. Такой файл сломает объединение: отфильтруйте его по столбцу Extension.</p>`; const pt = applyStep(f.table, { op: 'promote' }); return `<div class="cprev"><table><thead><tr>${pt.cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${pt.rows.slice(0, 5).map(r => `<tr>${r.map(v => `<td>${esc(show(v, 'any'))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };
  dialog('Объединение файлов', `<p>Выберите пример файла: по нему Power Query определит структуру и применит те же шаги ко всем файлам папки.</p><label class="dlab">Пример файла<select id="cfx">${files.map((f, k) => `<option value="${k}">${k ? esc(f.name) : 'Первый файл (' + esc(f.name) + ')'}</option>`).join('')}</select></label><div id="cfp">${prev(0)}</div>`, () => { add({ op: 'combineFiles' }); selCols = []; render(); });
  const d = $('#pq-modal .pq-dlg'); d.querySelector('#cfx').onchange = e => { d.querySelector('#cfp').innerHTML = prev(+e.target.value); };
}
function condFilterDlg(col, ty) {
  const num = ty === 'number' || ty === 'int', dt = ty === 'date';
  const ops = num ? [['=', 'равно'], ['<>', 'не равно'], ['>', 'больше'], ['>=', 'больше или равно'], ['<', 'меньше'], ['<=', 'меньше или равно']]
    : dt ? [['=', 'равно'], ['<', 'до'], ['>', 'после'], ['>=', 'не ранее'], ['<=', 'не позднее']]
    : [['=', 'равно'], ['<>', 'не равно'], ['begins', 'начинается с'], ['notbegins', 'не начинается с'], ['ends', 'заканчивается на'], ['contains', 'содержит'], ['notcontains', 'не содержит']];
  const row = k => `<div class="frow"><select class="fo">${k ? '<option value="">—</option>' : ''}${ops.map(([o, l]) => `<option value="${o}">${l}</option>`).join('')}</select><input class="fvv" placeholder="${dt ? 'дд.мм.гггг' : num ? 'число' : 'значение'}" autocomplete="off"></div>`;
  dialog('Фильтрация строк', `<p>Оставьте строки, где «${esc(col)}»:</p>${row(0)}<div class="fandor"><label><input type="radio" name="fj" value="and" checked> И</label><label><input type="radio" name="fj" value="or"> Или</label></div>${row(1)}`, d => {
    const f = `[${col}]`;
    const conds = [...d.querySelectorAll('.frow')].map(r => ({ o: r.querySelector('.fo').value, v: r.querySelector('.fvv').value.trim() })).filter(c => c.o);
    const parts = [];
    for (const c of conds) {
      if (c.v === '') return 'Укажите значение для каждого условия.';
      let lit;
      if (num) { const x = Number(c.v.replace(/\s/g, '').replace(',', '.')); if (!isFinite(x)) return `«${c.v}» — не число.`; lit = String(x); }
      else if (dt) { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(c.v); if (!m) return 'Дату пишите так: 01.07.2026.'; lit = `#date(${+m[3]}, ${+m[2]}, ${+m[1]})`; }
      else lit = '"' + c.v.replace(/"/g, '""') + '"';
      parts.push(c.o === 'begins' ? `Text.StartsWith(${f}, ${lit})` : c.o === 'notbegins' ? `not Text.StartsWith(${f}, ${lit})` : c.o === 'ends' ? `Text.EndsWith(${f}, ${lit})` : c.o === 'contains' ? `Text.Contains(${f}, ${lit})` : c.o === 'notcontains' ? `not Text.Contains(${f}, ${lit})` : `${f} ${c.o} ${lit}`);
    }
    const j = d.querySelector('[name=fj]:checked').value;
    add({ op: 'selectRows', expr: parts.length > 1 ? parts.join(` ${j} `) : parts[0] });
  });
}
/* ───── строка формул ───── */
let fxEdit = false;
function fxOpen() {
  if (viewQ) return toast(`Запрос «${viewQ}» уже готов, его формулы не меняются.`);
  if (cur === 0) return toast('Шаг «Источник» подключает файл, в тренажёре его менять не нужно.');
  if (fxEdit) return;
  fxEdit = true; const box = $('#pq-formula'); const txt = box.textContent;
  box.innerHTML = '<input id="pqfin" spellcheck="false" autocomplete="off">'; const inp = $('#pqfin'); inp.value = txt; inp.focus();
  $('#pqfx-ok').disabled = false; $('#pqfx-x').disabled = false;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fxApply(); } if (e.key === 'Escape') { e.preventDefault(); fxClose(); } });
}
function fxClose() { fxEdit = false; $('#pqfx-ok').disabled = true; $('#pqfx-x').disabled = true; render(); }
function fxApply() {
  const inp = $('#pqfin'); if (!inp) return;
  const names = stepNames(steps); const prev = cur > 1 ? names[cur - 2] : 'Источник';
  try {
    const st = parseStepExpr(inp.value, prev, OTHERS);
    if (steps[cur - 1].step) st.step = steps[cur - 1].step;
    start(); steps[cur - 1] = st; persist(); res = run(base, steps, env); clearFb(); fxClose();
  } catch (e) { inp.classList.add('bad'); toast((e.message || String(e)).slice(0, 220)); }
}
$('#pq-formula').addEventListener('click', fxOpen);
$('#pqfx-ok').onclick = fxApply; $('#pqfx-x').onclick = fxClose;
/* ───── проверка ───── */
const clearFb = () => { const fb = $('#fb'); if (fb.classList.contains('bad')) { fb.className = 'fb'; fb.innerHTML = ''; } };
const bad = msg => { const fb = $('#fb'); fb.className = 'fb bad'; fb.innerHTML = msg; fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
function ok(again, gain = 0) {
  const fb = $('#fb'); fb.className = 'fb good';
  const rows = [
    ['Эталонные шаги', '<code style="white-space:pre-wrap">' + esc(stepNames(task.answer).map((n, i) => (i + 1) + '. ' + n).join('\n')) + '</code>'],
    task.explanation && ['Почему так', esc(task.explanation)],
    task.tip && ['Лайфхак', esc(task.tip)],
  ].filter(Boolean);
  fb.innerHTML = (again ? '✓ Кейс решён.' : '<b>Верно!</b> Шаги дают нужную таблицу и на вашей выгрузке, и на проверочной. ' + (gain ? '+' + gain + ' XP.' : '')) + '<div class="learn">' + rows.map(([l, v]) => `<div class="learn-row"><span class="lb${l === 'Лайфхак' ? ' tipb' : ''}">${l}</span><p>${v}</p></div>`).join('') + '</div>';
  $('#next').hidden = false;
  document.querySelectorAll('[data-task="' + task.id + '"]').forEach(el => { el.classList.add('done'); const d = el.querySelector('.dot'); if (d) d.textContent = '✓'; });
}
function check() {
  start();
  if (!steps.length) return bad('Пока нет ни одного шага. Начните с ленты или с меню по правому щелчку на заголовке столбца.');
  const r = checkPq([base, source(task.source, 2)], steps, task.answer, [env, envFor(2)]);
  if (r.ok) { const gain = markSolved(S, KEY, task.xp, JSON.stringify(steps)); refreshHeader(S, MOD, task.id); if (gain) goal('trainer_solved', { module: MOD, task: task.id }); ok(false, gain); }
  else bad(esc(r.msg));
}
function reveal() { if (!S.revealed[KEY]) { S.revealed[KEY] = true; save(S); } $('#sol').hidden = false; $('#sol').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
$('#sol pre').textContent = stepNames(task.answer).map((n, i) => (i + 1) + '. ' + n).join('\n') + '\n\n' + fullM(task.answer, SRC.expr);
if (S.revealed[KEY]) $('#sol').hidden = false;

recompute();
if (S.solved[KEY]) ok(true);
