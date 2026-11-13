// @ts-nocheck
import { XL } from '../engine/excel';
import { check as checkTask, preview, parseAddr } from '../engine/excel-check';
import { sheetHtml, fmt, esc } from '../lib/sheet';
import { load, save, markSolved, goal, refreshHeader as rh } from '../lib/progress';

const task = JSON.parse(document.getElementById('taskdata').textContent);
const KEY = 'excel:' + task.id;
const $ = s => document.querySelector(s);
const f = $('#f');
const [tc, tr] = parseAddr(task.target);
const XLURL = '/?utm_source=trenazher&utm_medium=tip&utm_campaign=formulas';
const COLORS = ['#2f6fdf', '#d9480f', '#7b3fe4', '#0b8a6c', '#c2255c', '#a07a00'];
const ERRS = {
  '#Н/Д': 'ВПР не нашла значение. Проверьте, что искомое лежит в первом столбце выбранной таблицы, и что в конце стоит 0 (точное совпадение).',
  '#ЗНАЧ!': 'В вычисление попал текст или у функции неверные аргументы.',
  '#ДЕЛ/0!': 'Где-то деление на ноль или на пустую ячейку.',
  '#ССЫЛКА!': 'Номер столбца больше, чем столбцов в выбранной таблице.',
  '#ЧИСЛО!': 'Получилось слишком большое или невозможное число.',
};
let S = load();
let lastIns = null, drag = null, started = false;
const fmtRes = r => r.err ? r.err : fmt(r.v);
const cell = (c, r) => $('#sheet td[data-c="' + c + '"][data-r="' + r + '"]');

function paint() {
  document.querySelectorAll('#sheet td.hl').forEach(td => { td.classList.remove('hl'); td.style.removeProperty('--hc'); });
  const text = f.value.trim();
  if (text.startsWith('=')) {
    let toks = []; try { toks = XL.tokenize(text.slice(1)); } catch (e) {}
    let k = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]; if (t.type !== 'ref') continue;
      let c1 = t.col, r1 = t.row, c2 = t.col, r2 = t.row;
      if (toks[i + 1] && toks[i + 1].type === ':' && toks[i + 2] && toks[i + 2].type === 'ref') { const u = toks[i + 2]; c1 = Math.min(t.col, u.col); c2 = Math.max(t.col, u.col); r1 = Math.min(t.row, u.row); r2 = Math.max(t.row, u.row); i += 2; }
      const col = COLORS[k++ % COLORS.length];
      for (let r = r1; r <= Math.min(r2, 60); r++) for (let c = c1; c <= Math.min(c2, 30); c++) { const td = cell(c, r); if (td) { td.classList.add('hl'); td.style.setProperty('--hc', col); } }
    }
  }
  const td = cell(tc, tr);
  td.classList.remove('err', 'ok', 'empty');
  const pv = preview(task, text);
  if (!text) { td.textContent = '?'; td.classList.add('empty'); }
  else if (!pv) td.textContent = text.startsWith('=') ? '…' : text;
  else { td.textContent = fmtRes(pv); if (pv.err) td.classList.add('err'); else if (typeof pv.v === 'number') td.classList.add('n'); }
  if (S.solved[KEY]) td.classList.add('ok');
  $('#sheet th[data-col="' + tc + '"]').classList.add('ax');
  $('#sheet th[data-row="' + tr + '"]').classList.add('ax');
}

let blurAt = 0; f.addEventListener('blur', () => { blurAt = Date.now(); });
const editing = () => f.value.trim().startsWith('=') && (document.activeElement === f || Date.now() - blurAt < 700);
function insertRef(text) {
  const v = f.value; let s = f.selectionStart, e = f.selectionEnd;
  if (lastIns && s === e && s === lastIns.start + lastIns.text.length && v.substr(lastIns.start, lastIns.text.length) === lastIns.text) s = lastIns.start;
  f.value = v.slice(0, s) + text + v.slice(e);
  const p = s + text.length; f.setSelectionRange(p, p);
  lastIns = { start: s, text }; onInput();
}
$('#sheet').addEventListener('mousedown', e => {
  const td = e.target.closest('td'); if (!td) return;
  const c = +td.dataset.c, r = +td.dataset.r; const isT = c === tc && r === tr;
  if (editing() && !isT) {
    e.preventDefault(); drag = { c, r };
    if (document.activeElement !== f) { f.focus(); if (lastIns) f.setSelectionRange(lastIns.start + lastIns.text.length, lastIns.start + lastIns.text.length); else { const p = f.value.length; f.setSelectionRange(p, p); } }
    insertRef(XL.addr(c, r));
  } else if (isT || !editing()) {
    e.preventDefault(); if (!f.value) f.value = '=';
    f.focus(); const p = f.value.length; f.setSelectionRange(p, p); onInput();
  }
});
$('#sheet').addEventListener('mouseover', e => {
  if (!drag) return; const td = e.target.closest('td'); if (!td) return;
  const c = +td.dataset.c, r = +td.dataset.r; if (c === tc && r === tr) return;
  const a = XL.addr(Math.min(drag.c, c), Math.min(drag.r, r)), b = XL.addr(Math.max(drag.c, c), Math.max(drag.r, r));
  const text = a === b ? a : a + ':' + b;
  if (lastIns) { const v = f.value; f.value = v.slice(0, lastIns.start) + text + v.slice(lastIns.start + lastIns.text.length); const p = lastIns.start + text.length; f.setSelectionRange(p, p); lastIns.text = text; onInput(); }
});
window.addEventListener('mouseup', () => { drag = null; });
document.querySelectorAll('.keys button').forEach(b => b.addEventListener('mousedown', e => {
  e.preventDefault(); const k = b.dataset.k;
  if (document.activeElement !== f) { f.focus(); const p = f.value.length; f.setSelectionRange(p, p); }
  const s = f.selectionStart, en = f.selectionEnd; f.value = f.value.slice(0, s) + k + f.value.slice(en);
  const p = s + k.length - (k === '""' ? 1 : 0); f.setSelectionRange(p, p); lastIns = null; onInput();
}));
function onInput() {
  if (!started) { started = true; goal('trainer_task_start', { module: 'excel', task: task.id }); }
  S.drafts[KEY] = f.value; save(S); paint();
  if ($('#fb').classList.contains('bad')) { $('#fb').className = 'fb'; $('#fb').innerHTML = ''; }
}
f.addEventListener('input', () => { lastIns = null; onInput(); });
f.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });

function check() {
  const r = checkTask(task, f.value);
  const fb = $('#fb');
  if (r.ok) {
    const gain = markSolved(S, KEY, task.xp, f.value.trim());
    if (gain) goal('trainer_solved', { module: 'excel', task: task.id });
    showOk(false, gain); cell(tc, tr).classList.add('ok', 'pop');
    $('#next').hidden = false; paint(); refreshHeader();
    return;
  }
  let msg = '';
  switch (r.kind) {
    case 'empty': msg = 'Введите формулу в строку над таблицей — или кликните по ячейке ' + task.target + '.'; break;
    case 'noeq': msg = 'Формула начинается со знака «=». Без него Excel считает введённое обычным текстом.'; break;
    case 'parse': msg = esc(r.msg) + '.'; break;
    case 'hardcode': msg = 'Здесь только числа, без адресов ячеек. Такая формула не пересчитается, когда данные изменятся, — используйте ссылки на ячейки.'; break;
    case 'circular': msg = 'Формула ссылается на ' + task.target + ' — ту самую ячейку, где стоит. Excel назовёт это циклической ссылкой.'; break;
    case 'wrong': msg = 'Получилось <b>' + esc(fmtRes(r.got)) + '</b>, а нужно <b>' + esc(fmtRes(r.want)) + '</b>.'; if (r.got.err && ERRS[r.got.err]) msg += ' ' + ERRS[r.got.err]; break;
    case 'fragile': msg = 'На этих данных ответ сошёлся, но мы подставили в таблицу другие числа — и формула ошиблась. Скорее всего, где-то вписано готовое число вместо ссылки на ячейку, или условие сработает не во всех случаях.'; break;
  }
  fb.className = 'fb bad'; fb.innerHTML = msg;
  f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
}
function showOk(again, gain) {
  const fb = $('#fb');
  const learn = '<div class="learn"><div class="learn-row"><span class="lb">Как это работает</span><p>' + esc(task.hint) + '</p></div>' + (task.tip ? '<div class="learn-row"><span class="lb tipb">Лайфхак</span><p>' + esc(task.tip) + '</p></div>' : '') + '</div>';
  const tip = task.xlplain ? '<div class="xltip"><span class="xlb">XLPlain</span><p>' + esc(task.xlplain) + ' <a class="toxl" href="' + XLURL + '&utm_content=' + task.id + '">Подробнее →</a></p></div>' : '';
  fb.className = 'fb good';
  if (again) fb.innerHTML = '✓ Задача решена' + (S.solved[KEY].xp ? ' · +' + S.solved[KEY].xp + ' XP' : '') + '. Можно потренировать другой вариант формулы.' + learn + tip;
  else fb.innerHTML = '<b>Верно!</b> ' + (gain ? '+' + gain + ' XP' + (S.revealed[KEY] ? ' (половина — решение было подсмотрено)' : '') + '. ' : '') + 'Формула пересчитается при любых данных — мы проверили на 12 вариантах таблицы.' + learn + tip;
  fb.querySelectorAll('.toxl').forEach(a => a.addEventListener('click', () => goal('trainer_to_xlplain', { task: task.id })));
}
function refreshHeader() { rh(S, 'excel', task.id); }

$('#check').onclick = check;
$('#hintb').onclick = () => { $('#hint').hidden = !$('#hint').hidden; };
$('#solb').onclick = () => { S.revealed[KEY] = true; save(S); $('#sol').hidden = false; };

f.value = S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || '';
if (S.revealed[KEY]) $('#sol').hidden = false;
if (S.solved[KEY]) { showOk(true); $('#next').hidden = false; }
paint();
if (window.matchMedia('(min-width: 900px)').matches) setTimeout(() => f.focus(), 0);
