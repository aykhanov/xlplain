// @ts-nocheck
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { sql, SQLite } from '@codemirror/lang-sql';
import { SqlRunner, ruError } from '../lib/sql-runner';
import { compare } from '../engine/sql-compare';
import { load, save, markSolved, goal, refreshHeader } from '../lib/progress';
import { esc } from '../lib/sheet';

const task = JSON.parse(document.getElementById('taskdata').textContent);
const KEY = 'sql:' + task.id;
const $ = s => document.querySelector(s);
const runner = new SqlRunner(task.workerUrl);
let S = load();
let started = false;
const schema = Object.fromEntries(task.schema.map(t => [t.table, t.cols]));

const view = new EditorView({
  doc: S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || task.starter,
  parent: $('#ed'),
  extensions: [
    basicSetup,
    sql({ dialect: SQLite, schema, upperCaseKeywords: true }),
    keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true; } }]),
    EditorView.lineWrapping,
    EditorView.updateListener.of(u => { if (u.docChanged) { if (!started) { started = true; goal('trainer_task_start', { module: 'sql', task: task.id }); } S.drafts[KEY] = view.state.doc.toString(); save(S); clearBad(); } }),
  ],
});
const text = () => view.state.doc.toString().trim();
const clearBad = () => { if ($('#fb').classList.contains('bad')) { $('#fb').className = 'fb'; $('#fb').innerHTML = ''; } };

function table(r, note = '') {
  const box = $('#result'); box.hidden = false;
  if (!r.ok) { box.innerHTML = '<div class="sqlerr">' + esc(ruError(r.error)) + '</div>'; return; }
  if (!r.columns.length) { box.innerHTML = '<div class="meta">Запрос выполнен, но ничего не вернул.</div>'; return; }
  const shown = r.values.slice(0, 200);
  let h = '<div class="meta">' + r.values.length + ' ' + plural(r.values.length) + (r.values.length > 200 ? ', показаны первые 200' : '') + note + '</div><table><thead><tr><th class="corner"></th>' + r.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
  shown.forEach((row, i) => { h += '<tr><th>' + (i + 1) + '</th>' + row.map(v => '<td class="' + (typeof v === 'number' ? 'n' : '') + '">' + (v === null ? '<span style="color:var(--mute)">NULL</span>' : esc(typeof v === 'number' ? v.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : v)) + '</td>').join('') + '</tr>'; });
  box.innerHTML = h + '</tbody></table>';
}
const plural = n => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'строка' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'строки' : 'строк'; };

async function run() {
  if (!text()) return;
  try { const [r] = await runner.run('company', [text()]); table(r); }
  catch (e) { bad(e.message === 'timeout' ? 'Запрос выполнялся дольше 3 секунд и был остановлен. Возможно, JOIN без условия ON перемножил таблицы.' : 'Не удалось запустить базу: ' + e.message); }
}

function bad(msg) { const fb = $('#fb'); fb.className = 'fb bad'; fb.innerHTML = msg; }
async function check() {
  if (!text()) return bad('Напишите запрос в редакторе.');
  let open, hidden;
  try { [open, hidden] = await Promise.all([runner.run('company', [text(), task.answer]), runner.run('company-check', [text(), task.answer])]); }
  catch (e) { return bad(e.message === 'timeout' ? 'Запрос выполнялся дольше 3 секунд и был остановлен.' : 'Не удалось запустить базу: ' + e.message); }
  const [u, ref] = open;
  table(u);
  if (!u.ok) return bad(esc(ruError(u.error)));
  const v = compare(u, ref, task.order_matters);
  if (!v.ok) {
    const msg = {
      empty: 'Запрос ничего не вернул. Нужна таблица с результатом.',
      cols: `В результате ${v.got} ${cols(v.got)}, а нужно ${v.want}. Проверьте, что перечислено после SELECT.`,
      rows: `У вас ${v.got} ${plural(v.got)}, а должно быть ${v.want}. Проверьте условие WHERE${/JOIN/i.test(task.answer) ? ', JOIN' : ''}${/GROUP/i.test(task.answer) ? ' и GROUP BY' : ''}.`,
      values: 'Число строк совпало, но значения отличаются. Сравните свой результат с условием задачи.',
      order: 'Строки верные, но порядок не тот. Проверьте ORDER BY и направление сортировки (ASC или DESC).',
    }[v.reason];
    return bad(msg);
  }
  const v2 = compare(hidden[0], hidden[1], task.order_matters);
  if (!v2.ok) return bad('На учебной базе ответ сошёлся, но мы проверили запрос на второй базе с другими данными — и он ошибся. Похоже, условие подогнано под конкретные значения (например, номер или число вместо условия).');
  const gain = markSolved(S, KEY, task.xp, text()); refreshHeader(S, 'sql', task.id);
  if (gain) goal('trainer_solved', { module: 'sql', task: task.id });
  ok(false, gain);
}
const cols = n => n % 10 === 1 && n % 100 !== 11 ? 'столбец' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'столбца' : 'столбцов';
function ok(again, gain = 0) {
  const fb = $('#fb'); fb.className = 'fb good';
  const learn = '<div class="learn"><div class="learn-row"><span class="lb">Как это работает</span><p>' + esc(task.hint) + '</p></div>'
    + '<div class="learn-row"><span class="lb" style="background:#2f6fdf">А в Excel</span><p>' + esc(task.excel) + '</p></div>'
    + (task.tip ? '<div class="learn-row"><span class="lb tipb">Лайфхак</span><p>' + esc(task.tip) + '</p></div>' : '') + '</div>';
  const xl = task.xlplain ? '<div class="xltip"><span class="xlb">XLPlain</span><p>' + esc(task.xlplain) + ' <a class="toxl" href="/?utm_source=trenazher&utm_medium=tip&utm_campaign=sql&utm_content=' + task.id + '">Подробнее →</a></p></div>' : '';
  fb.innerHTML = (again ? '✓ Задача решена. Можно попробовать другой вариант запроса.' : '<b>Верно!</b> ' + (gain ? '+' + gain + ' XP. ' : '') + 'Запрос проверен на двух базах с разными данными.') + learn + xl;
  fb.querySelectorAll('.toxl').forEach(a => a.addEventListener('click', () => goal('trainer_to_xlplain', { task: task.id })));
  $('#next').hidden = false;
  document.querySelectorAll('[data-task="' + task.id + '"]').forEach(el => { el.classList.add('done'); const d = el.querySelector('.dot'); if (d) d.textContent = '✓'; });
}

$('#run').onclick = run;
$('#check').onclick = check;
$('#hintb').onclick = () => { $('#hint').hidden = !$('#hint').hidden; };
$('#solb').onclick = () => { S.revealed[KEY] = true; save(S); $('#sol').hidden = false; };
document.querySelectorAll('[data-ins]').forEach(c => c.addEventListener('click', () => { const sel = view.state.selection.main; view.dispatch({ changes: { from: sel.from, to: sel.to, insert: c.dataset.ins }, selection: { anchor: sel.from + c.dataset.ins.length } }); view.focus(); }));
if (S.revealed[KEY]) $('#sol').hidden = false;
if (S.solved[KEY]) ok(true);
