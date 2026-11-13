// @ts-nocheck
import { load, save, markSolved, goal, refreshHeader } from '../lib/progress';
import { esc } from '../lib/sheet';
const task = JSON.parse(document.getElementById('taskdata').textContent);
const KEY = 'bi:' + task.id;
const $ = s => document.querySelector(s);
let S = load(); let started = false;
const start = () => { if (!started) { started = true; goal('trainer_task_start', { module: 'bi', task: task.id }); } };
const bad = m => { const fb = $('#fb'); fb.className = 'fb bad'; fb.innerHTML = m; };
function ok(again, gain = 0) {
  const fb = $('#fb'); fb.className = 'fb good';
  const sol = task.solution ? '<div class="learn-row"><span class="lb">Формула</span><p><code style="white-space:pre-wrap">' + esc(task.solution) + '</code></p></div>' : '';
  const ex = task.explanation ? '<div class="learn-row"><span class="lb">Почему так</span><p>' + esc(task.explanation) + '</p></div>' : '';
  fb.innerHTML = (again ? '✓ Кейс решён.' : '<b>Верно!</b> ' + (gain ? '+' + gain + ' XP.' : '')) + '<div class="learn">' + sol + ex + (task.check === 'choice' ? '' : '<div class="learn-row"><span class="lb">Как это работает</span><p>' + esc(task.hint) + '</p></div>') + (task.tip ? '<div class="learn-row"><span class="lb tipb">Лайфхак</span><p>' + esc(task.tip) + '</p></div>' : '') + '</div>';
  $('#next').hidden = false;
  document.querySelectorAll('[data-task="' + task.id + '"]').forEach(el => { el.classList.add('done'); const d = el.querySelector('.dot'); if (d) d.textContent = '✓'; });
}
function solved(answer) { const gain = markSolved(S, KEY, task.xp, answer); refreshHeader(S, 'bi', task.id); if (gain) goal('trainer_solved', { module: 'bi', task: task.id }); ok(false, gain); }

if (task.check === 'number') {
  const inp = $('#num');
  inp.value = S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || '';
  inp.addEventListener('input', () => { start(); S.drafts[KEY] = inp.value; save(S); $('#fb').className = 'fb'; });
  const check = () => {
    const raw = inp.value.replace(/[\s ₽%]/g, '').replace(',', '.');
    if (!raw) return bad('Введите число.');
    const x = Number(raw); if (!isFinite(x)) return bad('Не получилось прочитать число. Пишите цифрами, дробную часть — через запятую.');
    if (Math.abs(x - task.expected) <= task.tolerance + 1e-9) return solved(inp.value);
    const r = x / task.expected;
    let m = 'Не сходится. ';
    if (r > 1.05 && r < 1.4) m += 'Получилось больше нужного — проверьте, отфильтрованы ли отменённые и недоставленные заказы.';
    else if (r > 2) m += 'Слишком много — возможно, считаются строки или период шире нужного.';
    else if (r < 0.95) m += 'Получилось меньше нужного — проверьте период и фильтры.';
    else m += 'Ответ близко, но вне допуска ' + String(task.tolerance).replace('.', ',') + ' ' + task.unit + '. Проверьте округление.';
    bad(m);
  };
  $('#check').onclick = check; inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
  $('#solb').onclick = () => { S.revealed[KEY] = true; save(S); $('#sol').hidden = false; };
  if (S.revealed[KEY]) $('#sol').hidden = false;
}
if (task.check === 'choice') {
  const opts = [...document.querySelectorAll('.opt')];
  opts.forEach(b => b.addEventListener('click', () => {
    start(); const k = +b.dataset.k;
    const why = b.querySelector('.why'); why.hidden = false; why.textContent = task.whys[k];
    if (k === task.correct) { b.classList.add('right'); if (!S.solved[KEY]) solved(String(k)); }
    else { b.classList.add('wrong'); S.revealed[KEY] = true; save(S); bad('Не этот вариант — объяснение под ним. Попробуйте ещё раз.'); }
  }));
  if (S.solved[KEY]) { const b = opts[task.correct]; b.classList.add('right'); const w = b.querySelector('.why'); w.hidden = false; w.textContent = task.whys[task.correct]; }
}
if (task.check === 'order') {
  const ol = $('#steps');
  const num = () => [...ol.children].forEach((li, k) => { li.querySelector('.n').textContent = k + 1; li.querySelector('.up').disabled = k === 0; li.querySelector('.dn').disabled = k === ol.children.length - 1; });
  ol.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; start();
    const li = b.closest('li');
    if (b.classList.contains('up') && li.previousElementSibling) ol.insertBefore(li, li.previousElementSibling);
    if (b.classList.contains('dn') && li.nextElementSibling) ol.insertBefore(li.nextElementSibling, li);
    [...ol.children].forEach(x => x.classList.remove('right', 'wrong')); num(); $('#fb').className = 'fb';
  });
  if (S.solved[KEY]) { const items = [...ol.children].sort((a, b) => +a.dataset.k - +b.dataset.k); items.forEach(li => ol.appendChild(li)); }
  num();
  $('#check').onclick = () => {
    const order = [...ol.children].map(li => +li.dataset.k);
    let right = 0; [...ol.children].forEach((li, k) => { const ok = +li.dataset.k === k; li.classList.toggle('right', ok); li.classList.toggle('wrong', !ok); if (ok) right++; });
    if (right === order.length) solved(order.join(','));
    else { S.revealed[KEY] = true; save(S); bad('На своих местах ' + right + ' из ' + order.length + ' шагов. Красные стоят не там — подумайте, что должно случиться раньше.'); }
  };
}
$('#hintb').onclick = () => { $('#hint').hidden = !$('#hint').hidden; };
if (S.solved[KEY] && task.check !== 'choice') ok(true);
if (S.solved[KEY] && task.check === 'choice') ok(true);
