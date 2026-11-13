// @ts-nocheck
// Задача Power Query: редактор с лентой, сеткой, фильтрами столбцов и «Примененными шагами».
import { run, stepNames, mCode, fullM, show, isErr, checkPq, TYPE_NAME } from '../engine/pq';
import { SOURCES, source } from '../lib/pq-sources';
import { load, save, markSolved, goal, refreshHeader } from '../lib/progress';
import { esc } from '../lib/sheet';

const task = JSON.parse(document.getElementById('taskdata').textContent);
const KEY = 'bi:' + task.id;
const $ = s => document.querySelector(s);
let S = load(); let started = false;
const start = () => { if (!started) { started = true; goal('trainer_task_start', { module: 'bi', task: task.id }); } };
const SRC = SOURCES[task.source];
const base = source(task.source, 1);
const qname = SRC.file.replace(/\.\w+$/, '');
$('#pq-file').textContent = qname; $('#pq-qname').textContent = qname; $('#pq-name').value = qname;

let steps = []; try { steps = JSON.parse(S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || '[]'); } catch { steps = []; }
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
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1d6b45"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z" fill="#fff3c4" stroke="#8a6d00"/><path d="M9.5 19.5h5M10.5 21.5h3" stroke="#8a6d00"/></svg>',
  sol: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" fill="#fff" stroke="#605e5c"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#605e5c"/></svg>',
};
const TYPES = [['any', 'Любой'], ['number', 'Десятичное число'], ['int', 'Целое число'], ['date', 'Дата'], ['text', 'Текст']];
const typeMenu = () => TYPES.map(([t, l]) => ({ label: l, icon: tIcon(t), run: () => setType(t) }));
const RIBBON = () => ({
  home: [
    ['Запрос', [{ big: 'Расширенный редактор', icon: I.adv, run: () => advanced() }]],
    ['Управление столбцами', [{ big: 'Удалить столбцы', icon: I.delcol, menu: () => [{ label: 'Удалить столбцы', run: () => removeCols(false) }, { label: 'Удалить другие столбцы', run: () => removeCols(true) }] }]],
    ['Сократить строки', [{ big: 'Удалить строки', icon: I.delrow, menu: () => [{ label: 'Удалить верхние строки…', run: () => removeRows('removeTop') }, { label: 'Удалить нижние строки…', run: () => removeRows('removeBottom') }, { label: 'Удалить пустые строки', run: () => add({ op: 'removeBlank' }) }] }]],
    ['Преобразование', [{ small: true, items: [{ label: 'Тип данных: ' + curTypeName(), menu: typeMenu }, { label: 'Использовать первую строку в качестве заголовков', icon: I.hdr, run: () => add({ op: 'promote' }) }, { label: 'Заменить значения', icon: I.repl, run: () => replaceDlg() }] }]],
    ['Тренажёр', TRAIN()],
  ],
  tr: [
    ['Таблица', [{ big: 'Группировать по', icon: I.group, run: () => groupDlg() }, { big: 'Использовать первую строку в качестве заголовков', icon: I.hdr, run: () => add({ op: 'promote' }) }]],
    ['Любой столбец', [{ small: true, items: [{ label: 'Тип данных: ' + curTypeName(), menu: typeMenu }, { label: 'Заменить значения', icon: I.repl, run: () => replaceDlg() }, { label: 'Заполнить', icon: I.fill, menu: () => [{ label: 'Вниз', run: () => colOp('fillDown') }] }] }, { big: 'Отменить свертывание столбцов', icon: I.unpiv, menu: () => [{ label: 'Отменить свертывание столбцов', run: () => colOp('unpivot') }, { label: 'Отменить свертывание других столбцов', run: () => colOp('unpivotOther') }] }, { big: 'Переименовать', icon: I.ren, run: () => renameDlg() }]],
    ['Текстовый столбец', [{ big: 'Разделить столбец', icon: I.split, menu: () => [{ label: 'По разделителю…', run: () => splitDlg() }] }, { big: 'Формат', icon: I.fmt, menu: () => [['lower', 'нижний регистр'], ['upper', 'ВЕРХНИЙ РЕГИСТР'], ['proper', 'Каждое Слово С Прописной'], ['trim', 'Усечь'], ['clean', 'Очистка']].map(([op, l]) => ({ label: l, run: () => colOp(op) })) }]],
    ['Тренажёр', TRAIN()],
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
  if (tab === 'add' || tab === 'view') h = `<div class="rg"><div class="rb"><p class="pq-na">Эта вкладка в тренажёре не используется. Всё нужное — на вкладках «Главная» и «Преобразование».</p></div><div class="rl">&nbsp;</div></div><div class="rg grow"><div class="rb">${TRAIN().map((it, k) => `<button class="big${it.cls ? ' ' + it.cls : ''}"${it.id ? ` id="${it.id}"` : ''} data-r="t-${k}">${it.icon}<span>${esc(it.big)}</span></button>`).join('')}</div><div class="rl">Тренажёр</div></div>`;
  $('#pq-ribbon').innerHTML = h;
}
$('#pq-ribbon').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'); if (!b) return;
  const p = b.dataset.r.split('-');
  let it;
  if (p[0] === 't') it = TRAIN()[+p[1]];
  else { const R = RIBBON(); const g = (R[tab] || R.home)[+p[0]][1][+p[1]]; it = p.length === 3 ? g.items[+p[2]] : g; }
  if (it.menu) openMenu(b, it.menu()); else it.run();
});
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
function dialog(title, body, onOk, okLabel = 'ОК') {
  const md = $('#pq-modal'); const d = md.querySelector('.pq-dlg');
  d.innerHTML = `<div class="dh">${esc(title)}<button class="dx" aria-label="Закрыть">✕</button></div><div class="db">${body}</div><div class="df"><button class="pb" data-ok>${okLabel}</button>${okLabel === 'Готово' ? '' : '<button data-cancel>Отмена</button>'}</div>`;
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
function removeRows(op) {
  dialog(op === 'removeTop' ? 'Удалить верхние строки' : 'Удалить нижние строки', `<p>Укажите, сколько строк нужно удалить ${op === 'removeTop' ? 'сверху' : 'снизу'}.</p><label class="dl">Число строк<input type="number" min="1" value="1" id="dn"></label>`, d => {
    const n = Math.floor(+d.querySelector('#dn').value); if (!(n >= 1)) return 'Введите целое число больше нуля.'; add({ op, n });
  });
}
function replaceDlg() {
  if (!needCols()) return;
  dialog('Заменить значения', `<p>Замена одного значения другим в выделенных столбцах.</p><label class="dl">Значение для поиска<input id="df" autocomplete="off"></label><label class="dl">Заменить на<input id="dr" autocomplete="off"></label>`, d => {
    const f = d.querySelector('#df').value; if (f === '') return 'Укажите значение для поиска.'; add({ op: 'replace', cols: [...selCols], find: f, repl: d.querySelector('#dr').value });
  });
}
function renameDlg(col = selCols[0]) {
  if (!col) return needCols();
  dialog('Переименовать столбец', `<label class="dl">Новое имя<input id="dn" value="${esc(col)}" autocomplete="off"></label>`, d => {
    const to = d.querySelector('#dn').value.trim(); if (!to) return 'Имя не может быть пустым.'; if (to === col) return;
    if (curTable().cols.some(c => c.name === to)) return 'Столбец с таким именем уже есть.';
    const last = steps[cur - 1];
    add({ op: 'rename', col, to }); selCols = [to]; render();
  });
}
function splitDlg() {
  if (!needCols()) return;
  dialog('Разделить столбец по разделителю', `<label class="dl">Выберите или введите разделитель<select id="ds"><option value=",">Запятая</option><option value=";">Точка с запятой</option><option value=" ">Пробел</option><option value="-">Дефис</option><option value="custom">--Пользовательский--</option></select></label><label class="dl">Пользовательский<input id="dc" autocomplete="off"></label><p class="dnote">Разделение по каждому вхождению разделителя.</p>`, d => {
    let s = d.querySelector('#ds').value; if (s === 'custom') s = d.querySelector('#dc').value; if (!s) return 'Укажите разделитель.';
    add({ op: 'split', col: selCols[0], delim: s }); selCols = []; render();
  });
}
function groupDlg() {
  const t = curTable();
  const opts = t.cols.map(c => `<option${selCols[0] === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  dialog('Группировать по', `<p>Укажите столбец для группировки и нужные выходные данные.</p><label class="dl">Группировать по<select id="gb">${opts}</select></label><div class="drow"><label class="dl">Имя нового столбца<input id="gn" value="Количество"></label><label class="dl">Операция<select id="go"><option value="count">Подсчитать строки</option><option value="sum">Сумма</option><option value="avg">Среднее</option><option value="min">Минимум</option><option value="max">Максимум</option></select></label><label class="dl">Столбец<select id="gc" disabled>${opts}</select></label></div>`, d => {
    const op = d.querySelector('#go').value, name = d.querySelector('#gn').value.trim(); if (!name) return 'Укажите имя нового столбца.';
    add({ op: 'group', by: [d.querySelector('#gb').value], aggs: [{ name, op, ...(op === 'count' ? {} : { col: d.querySelector('#gc').value }) }] }); selCols = []; render();
  });
  const d = $('#pq-modal .pq-dlg');
  d.querySelector('#go').onchange = e => { const v = e.target.value; d.querySelector('#gc').disabled = v === 'count'; const n = d.querySelector('#gn'); if (['Количество', 'Сумма', 'Среднее', 'Минимум', 'Максимум'].includes(n.value)) n.value = { count: 'Количество', sum: 'Сумма', avg: 'Среднее', min: 'Минимум', max: 'Максимум' }[v]; };
}
function advanced() {
  const code = fullM(steps, SRC.expr);
  dialog(qname, `<p class="dnote">Расширенный редактор показывает код M, который Power Query записал по вашим шагам. В тренажёре он только для чтения.</p><pre class="pq-adv">${esc(code)}</pre>`, () => {}, 'Готово');
}

/* ───── сетка ───── */
function tIcon(t) { return `<span class="ti t-${t}">${{ any: 'ABC<br>123', text: 'ABC', number: '1.2', int: '1²3', date: '▦' }[t]}</span>`; }
function recompute() { res = run(base, steps); if (cur > steps.length) cur = steps.length; render(); }
function render() {
  renderRibbon(); renderSteps();
  const names = stepNames(steps);
  const errAt = res.error ? res.error.step + 1 : Infinity;
  $('#pq-formula').textContent = cur === 0 ? '= ' + SRC.expr : '= ' + mCode(steps[cur - 1], cur > 1 ? names[cur - 2] : 'Источник');
  const ep = $('#pq-errpane');
  if (cur >= errAt) {
    ep.hidden = false; ep.innerHTML = `<b>⚠ ${esc(res.error.msg)}</b><p>Ошибка в шаге «${esc(names[res.error.step])}». Удалите шаг или исправьте предыдущие.</p>`;
    $('#pq-grid').innerHTML = ''; $('#st').textContent = '';
    return;
  }
  ep.hidden = true;
  const t = res.tables[cur];
  selCols = selCols.filter(c => t.cols.some(x => x.name === c));
  const shown = t.rows.slice(0, 300);
  let h = '<table><thead><tr><th class="rn"></th>';
  t.cols.forEach((c, i) => {
    const vals = t.rows.map(r => r[i]); const n = vals.length || 1;
    const er = vals.filter(isErr).length, em = vals.filter(v => v === null || v === '').length, ok = n - er - em;
    h += `<th class="${selCols.includes(c.name) ? 'sel' : ''}" data-c="${esc(c.name)}"><div class="hc"><button class="tbtn" data-type="${esc(c.name)}" title="Тип: ${TYPE_NAME[c.type]}">${tIcon(c.type)}</button><span class="hn">${esc(c.name)}</span><button class="fbtn pq-filter-dd" data-filter="${esc(c.name)}" title="Фильтр">▾</button></div><div class="q" title="Допустимые: ${Math.round(ok / n * 100)} %, ошибки: ${Math.round(er / n * 100)} %, пустые: ${Math.round(em / n * 100)} %"><i style="width:${ok / n * 100}%" class="qv"></i><i style="width:${er / n * 100}%" class="qe"></i><i style="width:${em / n * 100}%" class="qn"></i></div></th>`;
  });
  h += '</tr></thead><tbody>';
  shown.forEach((r, k) => {
    h += `<tr><th class="rn">${k + 1}</th>` + r.map((v, i) => { const ty = t.cols[i].type; const cls = v === null ? 'nul' : isErr(v) ? 'err' : (ty === 'number' || ty === 'int' || ty === 'date') ? 'n' : ''; return `<td class="${cls}${selCols.includes(t.cols[i].name) ? ' sel' : ''}"${isErr(v) ? ` data-err="${esc(v.err)}"` : ''}>${esc(show(v, ty))}</td>`; }).join('') + '</tr>';
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
$('#pq-steps').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { const i = +del.dataset.del; steps.splice(i, 1); if (cur > i) cur--; persist(); recompute(); clearFb(); return; }
  const li = e.target.closest('[data-s]'); if (li) { cur = +li.dataset.s; render(); }
});
$('#pq-grid').addEventListener('click', e => {
  const tb = e.target.closest('[data-type]'); if (tb) { const rc = tb.getBoundingClientRect(); selCols = [tb.dataset.type]; updateSel(); openMenu(null, typeMenu(), rc.left, rc.bottom); return; }
  const fb = e.target.closest('[data-filter]'); if (fb) { filterMenu(fb.dataset.filter, fb); return; }
  const th = e.target.closest('thead th[data-c]');
  if (th) { const c = th.dataset.c; if (e.ctrlKey || e.metaKey || e.shiftKey) selCols = selCols.includes(c) ? selCols.filter(x => x !== c) : [...selCols, c]; else selCols = [c]; updateSel(); return; }
  const td = e.target.closest('td[data-err]'); if (td) { toast(td.dataset.err); }
});
$('#pq-grid').addEventListener('dblclick', e => { const th = e.target.closest('thead th[data-c]'); if (th && !e.target.closest('button')) renameDlg(th.dataset.c); });
$('#pq-grid').addEventListener('contextmenu', e => {
  const th = e.target.closest('thead th[data-c]'); if (!th) return;
  e.preventDefault(); const c = th.dataset.c; if (!selCols.includes(c)) selCols = [c]; updateSel();
  const fmtSub = () => [['lower', 'нижний регистр'], ['upper', 'ВЕРХНИЙ РЕГИСТР'], ['proper', 'Каждое Слово С Прописной'], ['trim', 'Усечь'], ['clean', 'Очистка']].map(([op, l]) => ({ label: l, run: () => colOp(op) }));
  openMenu(null, [
    { label: 'Удалить', run: () => removeCols(false) }, { label: 'Удалить другие столбцы', run: () => removeCols(true) }, { sep: true },
    { label: 'Тип изменения', sub: typeMenu }, { label: 'Преобразование', sub: fmtSub }, { sep: true },
    { label: 'Заменить значения…', run: () => replaceDlg() }, { label: 'Заполнить вниз', run: () => colOp('fillDown') }, { label: 'Группировать по…', run: () => groupDlg() }, { sep: true },
    { label: 'Отменить свертывание других столбцов', run: () => colOp('unpivotOther') }, { label: 'Отменить свертывание только выделенного столбца', run: () => colOp('unpivot') }, { sep: true },
    { label: 'Переименовать…', run: () => renameDlg(c) }, { label: 'Разделить столбец по разделителю…', run: () => splitDlg() },
  ], e.clientX, e.clientY);
});
function filterMenu(col, anchor) {
  const t = curTable(); const i = t.cols.findIndex(c => c.name === col); const ty = t.cols[i].type;
  const seen = new Map(); for (const r of t.rows) { const v = r[i]; if (isErr(v)) continue; const k = v === null ? '∅' : typeof v + ':' + v; if (!seen.has(k)) seen.set(k, v); }
  const vals = [...seen.values()].sort((a, b) => a === null ? -1 : b === null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ru')).slice(0, 500);
  const m = $('#pq-menu'); const host = $('#pbi').getBoundingClientRect(); const r = anchor.getBoundingClientRect();
  m.innerHTML = `<div class="pq-filter"><button class="fl" data-fa="rmempty">Удалить пустые</button><hr><input class="fs" placeholder="Поиск"><label class="fa"><input type="checkbox" checked data-all> (Выделить все)</label><div class="fv">${vals.map((v, k) => `<label><input type="checkbox" checked data-k="${k}"> ${v === null ? '<i>(null)</i>' : esc(show(v, ty))}</label>`).join('')}</div><div class="ff"><button class="pb" data-fa="ok">ОК</button><button data-fa="cancel">Отмена</button></div></div>`;
  m.hidden = false; m.style.left = Math.min(r.left - host.left - 160, host.width - 280) + 'px'; m.style.top = (r.bottom - host.top + 2) + 'px';
  const boxes = () => [...m.querySelectorAll('[data-k]')];
  m.querySelector('[data-all]').onchange = e => boxes().forEach(b => { if (b.closest('label').style.display !== 'none') b.checked = e.target.checked; });
  m.querySelector('.fs').oninput = e => { const q = e.target.value.toLowerCase(); boxes().forEach(b => { b.closest('label').style.display = b.closest('label').textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  m.onclick = e => {
    const a = e.target.closest('[data-fa]'); if (!a) return;
    if (a.dataset.fa === 'cancel') return closeMenu();
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
  const r = checkPq([base, source(task.source, 2)], steps, task.answer);
  if (r.ok) { const gain = markSolved(S, KEY, task.xp, JSON.stringify(steps)); refreshHeader(S, 'bi', task.id); if (gain) goal('trainer_solved', { module: 'bi', task: task.id }); ok(false, gain); }
  else bad(esc(r.msg));
}
function reveal() { if (!S.revealed[KEY]) { S.revealed[KEY] = true; save(S); } $('#sol').hidden = false; $('#sol').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
$('#sol pre').textContent = stepNames(task.answer).map((n, i) => (i + 1) + '. ' + n).join('\n') + '\n\n' + fullM(task.answer, SRC.expr);
if (S.revealed[KEY]) $('#sol').hidden = false;

recompute();
if (S.solved[KEY]) ok(true);
