// @ts-nocheck
// Задача DAX в оболочке Power BI Desktop: строка формул, панель «Данные», матрица, карточка, гистограмма, срезы.
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, insertNewlineAndIndent } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, completionStatus } from '@codemirror/autocomplete';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { buildModel } from '../lib/bi-model';
import { parseMeasure, matrix, evalIn, colFilter, applyFilter, distinctSorted, fmt, low, FUNCTIONS, DaxError } from '../engine/dax';
import { checkDax, userMeasure } from '../engine/bi-check';
import { load, save, markSolved, goal, refreshHeader } from '../lib/progress';
import { esc } from '../lib/sheet';

const task = JSON.parse(document.getElementById('taskdata').textContent);
const KEY = 'bi:' + task.id;
const $ = s => document.querySelector(s);
let S = load(); let started = false;
const start = () => { if (!started) { started = true; goal('trainer_task_start', { module: 'bi', task: task.id }); } };

const m1 = buildModel(1, task.measures || []);
let m2 = null; // проверочная модель строится при первой проверке
const parseField = s => { const r = /^'?([^'\[]+)'?\[(.+)\]$/.exec(s); return r ? { table: r[1], col: r[2] } : null; };

/* ───── состояние отчёта ───── */
const st = {
  rows: parseField(task.visual?.rows || "Клиенты[Город]"),
  values: [...(task.visual?.values || [])],
  user: null,          // имя зафиксированной меры пользователя
  committed: '',       // текст зафиксированной формулы
  fmt: S.drafts[KEY + ':fmt'] || '',
  slicers: (task.slicers || ["Клиенты[Сегмент]", "Календарь[Месяц]"]).map(s => ({ f: parseField(s), sel: new Set() })),
  sel: null,           // выбранная строка матрицы (перекрёстная фильтрация)
  view: 'report', table: 'Продажи', implicit: new Set(),
};

/* ───── редактор формулы ───── */
const daxLang = StreamLanguage.define({
  name: 'dax',
  token(s) {
    if (s.eatSpace()) return null;
    if (s.match('//') || s.match('--')) { s.skipToEnd(); return 'comment'; }
    if (s.match(/^"(?:[^"]|"")*"?/)) return 'string';
    if (s.match(/^'(?:[^']|'')*'?/)) return 'typeName';
    if (s.match(/^\[[^\]]*\]?/)) return 'propertyName';
    if (s.match(/^\d+(?:[.,]\d+)?/)) return 'number';
    if (s.match(/^[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё.]*/)) {
      const w = s.current().toUpperCase();
      if (['VAR', 'RETURN', 'IN', 'NOT', 'ASC', 'DESC', 'DAY', 'MONTH', 'QUARTER', 'YEAR', 'SKIP', 'DENSE'].includes(w)) return 'keyword';
      if (FUNCTIONS.includes(w) && s.peek() === '(') return 'atom';
      return m1.byName.has(low(s.current())) ? 'typeName' : 'variableName';
    }
    s.next(); return 'operator';
  },
});
const hl = HighlightStyle.define([
  { tag: t.atom, color: '#035aca' }, { tag: t.keyword, color: '#8b1dad', fontWeight: '600' },
  { tag: t.string, color: '#a31515' }, { tag: t.number, color: '#098658' }, { tag: t.comment, color: '#008000', fontStyle: 'italic' },
  { tag: t.typeName, color: '#0f6e6e' }, { tag: t.propertyName, color: '#0b4f9e' }, { tag: t.operator, color: '#444' },
]);
const FN_DOC = {
  SUM: 'SUM(<столбец>) — сумма значений столбца', AVERAGE: 'AVERAGE(<столбец>) — среднее', COUNTROWS: 'COUNTROWS(<таблица>) — число строк',
  DISTINCTCOUNT: 'DISTINCTCOUNT(<столбец>) — число разных значений', DIVIDE: 'DIVIDE(<числитель>; <знаменатель>; [<альтернатива>])',
  CALCULATE: 'CALCULATE(<выражение>; <фильтр1>; ...) — вычисление в изменённом контексте фильтра', FILTER: 'FILTER(<таблица>; <условие>)',
  ALL: 'ALL(<таблица или столбец>) — снять фильтры', ALLSELECTED: 'ALLSELECTED(<столбец>) — вернуть фильтры срезов', REMOVEFILTERS: 'REMOVEFILTERS(<таблица или столбец>)',
  VALUES: 'VALUES(<столбец>) — видимые значения', SUMX: 'SUMX(<таблица>; <выражение>) — сумма выражения по строкам', RELATED: 'RELATED(<столбец>) — значение из связанной таблицы',
  RANKX: 'RANKX(<таблица>; <выражение>; [<значение>]; [<порядок>])', TOTALYTD: 'TOTALYTD(<выражение>; <даты>) — с начала года', PREVIOUSMONTH: 'PREVIOUSMONTH(<даты>) — даты прошлого месяца',
  DATEADD: 'DATEADD(<даты>; <число>; <интервал>)', DATESYTD: 'DATESYTD(<даты>)', SELECTEDVALUE: 'SELECTEDVALUE(<столбец>; [<иначе>])', IF: 'IF(<условие>; <тогда>; [<иначе>])',
};
function completions(ctx) {
  const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 120), ctx.pos);
  let mm = /(?:'([^']+)'|([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*))\[([^\]]*)$/.exec(before);
  if (mm) {
    const tb = m1.byName.get(low(mm[1] || mm[2])); if (!tb) return null;
    return { from: ctx.pos - mm[3].length, options: tb.cols.map(c => ({ label: c.name, type: 'property', apply: c.name + ']', detail: tb.name })), validFor: /^[^\]]*$/ };
  }
  mm = /\[([^\]\[]*)$/.exec(before);
  if (mm) return { from: ctx.pos - mm[1].length, options: [...m1.measures.values()].filter(x => !x.user && !x.ref).map(x => ({ label: x.name, type: 'variable', apply: x.name + ']', detail: 'мера' })), validFor: /^[^\]]*$/ };
  mm = /'([^']*)$/.exec(before);
  if (mm && (before.split("'").length - 1) % 2 === 1) return { from: ctx.pos - mm[1].length - 1, options: m1.tables.map(x => ({ label: "'" + x.name + "'", type: 'class' })), validFor: /^'[^']*$/ };
  const w = ctx.matchBefore(/[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё.]*/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const opts = [
    ...FUNCTIONS.map(f => ({ label: f, type: 'function', apply: f + '(', info: FN_DOC[f], boost: FN_DOC[f] ? 2 : 0 })),
    ...m1.tables.map(x => ({ label: "'" + x.name + "'", type: 'class', apply: "'" + x.name + "'" })),
    ...m1.tables.flatMap(x => x.cols.map(c => ({ label: `'${x.name}'[${c.name}]`, type: 'property', boost: -1 }))),
    ...[...m1.measures.values()].filter(x => !x.ref).map(x => ({ label: '[' + x.name + ']', type: 'variable', detail: 'мера' })),
    { label: 'VAR', type: 'keyword' }, { label: 'RETURN', type: 'keyword' },
  ];
  return { from: w.from, options: opts, validFor: /^[\wА-Яа-яЁё.]*$/ };
}
const initial = S.drafts[KEY] || (S.solved[KEY] && S.solved[KEY].a) || task.starter || task.measure_name + ' = ';
const view = new EditorView({
  parent: $('#ed'),
  state: EditorState.create({
    doc: initial,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), closeBrackets(), lintGutter(),
      daxLang, syntaxHighlighting(hl), autocompletion({ override: [completions], icons: true, activateOnTyping: true }),
      daxLang.data.of({}),
      Prec.high(keymap.of([
        { key: 'Enter', run: v => { if (completionStatus(v.state) === 'active') return false; commit(); return true; } },
        { key: 'Shift-Enter', run: insertNewlineAndIndent },
        { key: 'Escape', run: v => { if (completionStatus(v.state) === 'active') return false; revert(); return true; } },
      ])),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of(u => { if (u.docChanged) { start(); S.drafts[KEY] = text(); save(S); view.dispatch(setDiagnostics(view.state, [])); } }),
      EditorView.domEventHandlers({ drop: () => { setTimeout(() => view.focus(), 0); return false; } }),
    ],
  }),
});
const text = () => view.state.doc.toString();

/* ───── фиксация меры ───── */
function showErr(e) {
  const box = $('#err');
  if (!e) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false; box.innerHTML = '<b>⚠</b> ' + esc(e.message || String(e));
  if (e instanceof DaxError && typeof e.pos === 'number') {
    const L = view.state.doc.length; const from = Math.min(e.pos, L), to = Math.min(L, from + Math.max(1, (/^[^\s;,()]+/.exec(text().slice(from)) || [''])[0].length));
    view.dispatch(setDiagnostics(view.state, [{ from, to: Math.max(to, from), severity: 'error', message: e.message }]));
  }
}
function commit(silent = false) {
  const src = text().trim();
  if (!src) return false;
  try {
    const ms = userMeasure(m1, src, task);
    ms.format = st.fmt || undefined;
    if (st.user && st.user !== ms.name) st.values = st.values.filter(v => v !== st.user);
    st.user = ms.name; st.committed = src;
    if (!st.values.includes(ms.name)) st.values.push(ms.name);
    $('#mname').value = ms.name;
    showErr(null); renderAll();
    return true;
  } catch (e) { if (!silent) showErr(e); return false; }
}
function revert() {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: st.committed || initial } }); showErr(null);
}
$('#fxok').onclick = () => { commit(); view.focus(); };
$('#fxx').onclick = () => { revert(); view.focus(); };
$('#newm').onclick = () => {
  const name = task.measure_name || 'Мера';
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: name + ' = ' }, selection: { anchor: name.length + 3 } });
  view.focus();
};
$('#fmt').value = st.fmt;
$('#fmt').onchange = () => { st.fmt = $('#fmt').value; S.drafts[KEY + ':fmt'] = st.fmt; save(S); const ms = st.user && m1.measures.get(low(st.user)); if (ms) ms.format = st.fmt || undefined; renderAll(); };

/* ───── панель «Данные» ───── */
const ICON = {
  measure: '<svg viewBox="0 0 16 16" class="fi"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="#fff" stroke="#605e5c"/><rect x="4.5" y="3.5" width="7" height="2.5" fill="#c8c6c4"/><g fill="#605e5c"><rect x="4.5" y="8" width="1.6" height="1.6"/><rect x="7.2" y="8" width="1.6" height="1.6"/><rect x="9.9" y="8" width="1.6" height="1.6"/><rect x="4.5" y="11" width="1.6" height="1.6"/><rect x="7.2" y="11" width="1.6" height="1.6"/></g></svg>',
  sum: '<span class="fi sig">Σ</span>', date: '<svg viewBox="0 0 16 16" class="fi"><rect x="2" y="3" width="12" height="11" fill="#fff" stroke="#605e5c"/><path d="M2 6h12" stroke="#605e5c"/><path d="M5 1.5v3M11 1.5v3" stroke="#605e5c"/></svg>',
  text: '<span class="fi"></span>', table: '<svg viewBox="0 0 16 16" class="fi"><rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#605e5c"/><path d="M1.5 6h13M1.5 9.5h13M6 2.5v11" stroke="#605e5c"/></svg>',
};
const isNumCol = c => (c.type === 'num' || c.type === 'int') && !c.key && c.name !== 'Номер заказа' && c.name !== 'Год' && c.name !== 'Номер месяца';
const implicitName = c => 'Сумма ' + c;
const open = new Set(['Продажи', (st.rows && st.rows.table) || 'Клиенты']);
function renderFields() {
  const q = low($('#fsearch').value.trim());
  const box = $('#fields');
  const tables = [...m1.tables].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  let h = '';
  for (const tb of tables) {
    const items = [];
    for (const c of tb.cols) items.push({ kind: 'col', name: c.name, c, sort: c.name });
    if (tb.name === 'Продажи') for (const ms of m1.measures.values()) if (!ms.ref && !ms.implicit) items.push({ kind: 'measure', name: ms.name, sort: ms.name });
    items.sort((a, b) => a.sort.localeCompare(b.sort, 'ru'));
    const vis = items.filter(it => !q || low(it.name).includes(q) || low(tb.name).includes(q));
    if (!vis.length) continue;
    const isOpen = open.has(tb.name) || !!q;
    h += `<div class="ftable${isOpen ? ' open' : ''}" data-t="${esc(tb.name)}"><button class="fth" data-toggle="${esc(tb.name)}"><span class="car">${isOpen ? '▾' : '▸'}</span>${ICON.table}<span>${esc(tb.name)}</span></button>`;
    if (isOpen) {
      h += '<ul>';
      for (const it of vis) {
        let checked = false, icon, ref, kind;
        if (it.kind === 'measure') { checked = st.values.includes(it.name); icon = ICON.measure; ref = '[' + it.name + ']'; kind = 'measure'; }
        else { const c = it.c; kind = isNumCol(c) ? 'num' : 'col'; checked = kind === 'num' ? st.values.includes(implicitName(c.name)) && st.implicit.has(tb.name + '|' + c.name) : st.rows && st.rows.table === tb.name && low(st.rows.col) === low(c.name); icon = c.type === 'date' ? ICON.date : kind === 'num' ? ICON.sum : ICON.text; ref = `'${tb.name}'[${c.name}]`; }
        h += `<li draggable="true" data-kind="${kind}" data-t="${esc(tb.name)}" data-n="${esc(it.name)}" data-ref="${esc(ref)}" title="Перетащите в строку формул или в поле визуала. Двойной щелчок вставит ссылку в формулу."><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${esc(it.name)}">${icon}<span class="fnm">${esc(it.name)}</span>${it.kind === 'measure' && it.name === st.user ? '<em>ваша мера</em>' : ''}</li>`;
      }
      h += '</ul>';
    }
    h += '</div>';
  }
  box.innerHTML = h || '<p class="pane-note">Ничего не найдено.</p>';
}
$('#fsearch').oninput = renderFields;
$('#fields').addEventListener('click', e => {
  const tg = e.target.closest('[data-toggle]');
  if (tg) { const n = tg.dataset.toggle; open.has(n) ? open.delete(n) : open.add(n); if (st.view === 'table') { st.table = n; renderTable(); } renderFields(); return; }
  const li = e.target.closest('li'); if (!li) return;
  if (e.target.tagName === 'INPUT' || e.target.closest('.fi') || e.target.classList.contains("fnm")) toggleField(li.dataset);
  if (st.view === 'table') { st.table = li.dataset.t; renderTable(); }
});
$('#fields').addEventListener('dblclick', e => { const li = e.target.closest('li'); if (!li) return; const r = view.state.selection.main; view.dispatch({ changes: { from: r.from, to: r.to, insert: li.dataset.ref }, selection: { anchor: r.from + li.dataset.ref.length } }); view.focus(); });
$('#fields').addEventListener('dragstart', e => {
  const li = e.target.closest('li'); if (!li) return;
  e.dataTransfer.setData('text/plain', li.dataset.ref);
  e.dataTransfer.setData('application/x-pbi-field', JSON.stringify(li.dataset));
  e.dataTransfer.effectAllowed = 'copy';
});
function toggleField(d, force) {
  start();
  if (d.kind === 'measure') { const on = force ?? !st.values.includes(d.n); st.values = st.values.filter(v => v !== d.n); if (on) st.values.push(d.n); }
  else if (d.kind === 'num') {
    const name = implicitName(d.n); const key = d.t + '|' + d.n;
    const on = force ?? !(st.values.includes(name) && st.implicit.has(key));
    st.values = st.values.filter(v => v !== name);
    if (on) { m1.measures.set(low(name), { ...parseMeasure(`${name} = SUM('${d.t}'[${d.n}])`), table: d.t, implicit: true }); st.implicit.add(key); st.values.push(name); }
    else st.implicit.delete(key);
  } else { const same = st.rows && st.rows.table === d.t && low(st.rows.col) === low(d.n); st.rows = (force ?? !same) ? { table: d.t, col: d.n } : null; st.sel = null; }
  renderAll();
}
document.querySelectorAll('.well').forEach(w => {
  w.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-pbi-field')) { e.preventDefault(); w.classList.add('over'); } });
  w.addEventListener('dragleave', () => w.classList.remove('over'));
  w.addEventListener('drop', e => {
    e.preventDefault(); w.classList.remove('over');
    let d; try { d = JSON.parse(e.dataTransfer.getData('application/x-pbi-field')); } catch { return; }
    if (w.dataset.well === 'rows' && d.kind !== 'measure') toggleField({ ...d, kind: 'col' }, true);
    else if (w.dataset.well === 'values' && d.kind !== 'col') toggleField(d, true);
    else if (w.dataset.well === 'values') toast('В «Значения» кладут меры и числовые столбцы.');
    else toast('В «Строки» кладут столбцы, а не меры.');
  });
});
function renderWells() {
  $('#w-rows').innerHTML = st.rows ? `<span class="slot">${esc(st.rows.col)}<button data-x="rows" aria-label="Убрать">✕</button></span>` : '<span class="ph">Добавьте поля данных</span>';
  $('#w-values').innerHTML = st.values.length ? st.values.map(v => `<span class="slot${v === st.user ? ' mine' : ''}">${esc(v)}<button data-x="${esc(v)}" aria-label="Убрать">✕</button></span>`).join('') : '<span class="ph">Добавьте поля данных</span>';
}
document.querySelector('.pbi-panes').addEventListener('click', e => {
  const b = e.target.closest('[data-x]'); if (!b) return;
  if (b.dataset.x === 'rows') st.rows = null; else { st.values = st.values.filter(v => v !== b.dataset.x); for (const k of [...st.implicit]) if (implicitName(k.split('|')[1]) === b.dataset.x) st.implicit.delete(k); }
  st.sel = null; renderAll();
});

/* ───── холст отчёта ───── */
const slicerFilters = () => st.slicers.filter(s => s.sel.size).map(s => colFilter(m1, s.f, [...s.sel]));
const mfmt = name => { const ms = m1.measures.get(low(name)); return ms?.format; };
const fv = (v, name) => fmt(v, mfmt(name));
function renderReport() {
  const page = $('#v-report');
  const sl = slicerFilters();
  let h = '<div class="pg-slicers">';
  st.slicers.forEach((s, k) => {
    const vals = distinctSorted(m1, s.f);
    h += `<div class="vis slicer" data-s="${k}"><div class="vh"><span>${esc(s.f.col)}</span>${s.sel.size ? `<button class="clr" data-clr="${k}" title="Очистить выбор">⌫</button>` : ''}</div><ul>${vals.map(v => `<li data-v="${esc(String(v))}" class="${s.sel.has(v) ? 'on' : ''}"><i></i>${esc(fmt(v))}</li>`).join('')}</ul></div>`;
  });
  h += '</div>';
  const focus = st.user || st.values[st.values.length - 1];
  // карточка
  let cardV = '', cardErr = '';
  if (focus) { try { const fs = st.sel !== null && st.rows ? applyFilter(m1, sl, colFilter(m1, st.rows, [st.sel])) : sl; cardV = fv(evalIn(m1, focus, fs, sl), focus) || '(пусто)'; } catch (e) { cardErr = e.message; } }
  h += `<div class="vis kpi"><div class="cv">${cardErr ? '<span class="verr">Ошибка</span>' : esc(cardV || '—')}</div><div class="cl">${esc(focus || 'Карточка')}${st.sel !== null && st.rows ? ' · ' + esc(fmt(st.sel)) : ''}</div></div>`;
  // матрица
  let mx = null, mxErr = null;
  if (st.values.length || st.rows) { try { mx = matrix(m1, st.rows, st.values, sl); } catch (e) { mxErr = e; } }
  h += '<div class="vis matrix">';
  if (mxErr) h += visErr(mxErr);
  else if (!mx) h += '<div class="empty">Выберите поля в панели «Данные», чтобы построить визуальный элемент</div>';
  else {
    h += `<table><thead><tr>${st.rows ? `<th class="rh">${esc(st.rows.col)}</th>` : ''}${st.values.map(v => `<th class="${v === st.user ? 'mine' : ''}">${esc(v)}</th>`).join('')}</tr></thead><tbody>`;
    for (const r of mx.rows) h += `<tr data-v="${esc(String(r.label))}" class="${st.sel !== null && String(st.sel) === String(r.label) ? 'sel' : ''}"><th>${esc(fmt(r.label))}</th>${r.values.map((v, i) => `<td>${esc(fv(v, st.values[i]))}</td>`).join('')}</tr>`;
    h += `</tbody><tfoot><tr>${st.rows ? '<th>Итог</th>' : ''}${mx.total.map((v, i) => `<td>${esc(fv(v, st.values[i]))}</td>`).join('')}</tr></tfoot></table>`;
  }
  h += '</div>';
  // гистограмма
  h += '<div class="vis chart">';
  if (focus && st.rows && mx && !mxErr) {
    const idx = st.values.indexOf(focus);
    const data = mx.rows.map(r => ({ l: r.label, v: typeof r.values[idx] === 'number' && isFinite(r.values[idx]) ? r.values[idx] : 0 }));
    h += `<div class="vt">${esc(focus)} по полю «${esc(st.rows.col)}»</div>` + bars(data, focus);
  } else h += '<div class="empty">Гистограмма появится, когда в визуале будут строки и мера</div>';
  h += '</div>';
  page.innerHTML = h;
  $('#st').textContent = 'Страница 1 из 1' + (st.sel !== null ? ' · выбрано: ' + fmt(st.sel) : '');
}
function visErr(e) { return `<div class="verr-box"><b>Не удаётся отобразить визуальный элемент.</b><p>${esc(e.message)}</p></div>`; }
function bars(data, name) {
  if (!data.length) return '<div class="empty">Нет данных</div>';
  const W = 520, H = 260, pl = 54, pb = 40, pt = 10;
  const max = Math.max(0, ...data.map(d => d.v)), min = Math.min(0, ...data.map(d => d.v));
  const span = max - min || 1; const step = (W - pl - 8) / data.length; const bw = Math.max(6, step * 0.62);
  const y = v => pt + (H - pt - pb) * (max - v) / span;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(k => min + span * k);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="bars" role="img" aria-label="${esc(name)}">`;
  for (const tv of ticks) s += `<line x1="${pl}" x2="${W - 4}" y1="${y(tv)}" y2="${y(tv)}" stroke="#edebe9"/><text x="${pl - 6}" y="${y(tv) + 4}" text-anchor="end">${esc(short(tv, name))}</text>`;
  data.forEach((d, i) => {
    const x = pl + i * step + (step - bw) / 2, y0 = y(Math.max(0, d.v)), h = Math.abs(y(d.v) - y(0));
    const dim = st.sel !== null && String(st.sel) !== String(d.l);
    s += `<rect data-v="${esc(String(d.l))}" x="${x}" y="${y0}" width="${bw}" height="${Math.max(h, 0.5)}" fill="#118dff" opacity="${dim ? 0.35 : 1}"><title>${esc(fmt(d.l))}: ${esc(fv(d.v, name))}</title></rect>`;
    const lab = fmt(d.l); s += `<text x="${x + bw / 2}" y="${H - pb + 14}" text-anchor="middle" class="xl">${esc(lab.length > 9 ? lab.slice(0, 8) + '…' : lab)}</text>`;
  });
  return s + '</svg>';
}
function short(v, name) {
  if (mfmt(name) === 'percent') return Math.round(v * 100) + ' %';
  const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн'; if (a >= 1e3) return (v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' тыс.';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
$('#v-report').addEventListener('click', e => {
  const clr = e.target.closest('[data-clr]'); if (clr) { st.slicers[+clr.dataset.clr].sel.clear(); st.sel = null; renderAll(); return; }
  const li = e.target.closest('.slicer li');
  if (li) { start(); const s = st.slicers[+li.closest('.slicer').dataset.s]; const v = distinctSorted(m1, s.f).find(x => String(x) === li.dataset.v); s.sel.has(v) ? s.sel.delete(v) : s.sel.add(v); st.sel = null; renderAll(); return; }
  const tr = e.target.closest('.matrix tbody tr, .bars rect'); if (tr && st.rows) { const v = distinctSorted(m1, st.rows).find(x => String(x) === tr.dataset.v); st.sel = st.sel !== null && String(st.sel) === String(v) ? null : v; renderReport(); return; }
  if (!e.target.closest('.vis')) { if (st.sel !== null) { st.sel = null; renderReport(); } }
});

/* ───── представление таблицы ───── */
function renderTable() {
  const tb = m1.byName.get(low(st.table));
  const rows = tb.rows.slice(0, 400);
  let h = `<div class="tbar"><b>${esc(tb.name)}</b> · ${tb.rows.length.toLocaleString('ru-RU')} строк${tb.rows.length > 400 ? ', показаны первые 400' : ''}<span>Выберите таблицу в панели «Данные»</span></div><div class="tscroll"><table><thead><tr>${tb.cols.map(c => `<th class="${c.type === 'text' ? '' : 'n'}">${esc(c.name)}</th>`).join('')}</tr></thead><tbody>`;
  for (const r of rows) h += '<tr>' + r.map((v, i) => `<td class="${tb.cols[i].type === 'text' ? '' : 'n'}">${esc(fmt(v, undefined, tb.cols[i].type))}</td>`).join('') + '</tr>';
  $('#v-table').innerHTML = h + '</tbody></table></div>';
  $('#st').textContent = `Таблица: ${tb.name} (${tb.rows.length.toLocaleString('ru-RU')} строк)`;
}
/* ───── представление модели ───── */
function renderModel() {
  const pos = { 'Клиенты': [30, 30], 'Товары': [470, 30], 'Продажи': [250, 200], 'Календарь': [30, 330] };
  const W = 660, H = 500, bw = 170;
  const box = name => { const tb = m1.byName.get(low(name)); const [x, y] = pos[name]; const h = 30 + tb.cols.length * 20 + (name === 'Продажи' ? [...m1.measures.values()].filter(x => !x.ref && !x.implicit).length * 20 : 0); return { tb, x, y, h }; };
  const B = Object.fromEntries(Object.keys(pos).map(n => [n, box(n)]));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="mdl">`;
  const exitPt = (p, q, extra) => { const cx = p.x + bw / 2, cy = p.y + p.h / 2, dx = q.x + bw / 2 - cx, dy = q.y + q.h / 2 - cy; const k = Math.min(Math.abs((bw / 2) / (dx || 1e-9)), Math.abs((p.h / 2) / (dy || 1e-9))); const L = Math.hypot(dx, dy); return [cx + dx * k + dx / L * extra, cy + dy * k + dy / L * extra]; };
  let labels = '';
  for (const r of m1.rels) {
    const a = B[r.from], b = B[r.to];
    const ax = a.x + bw / 2, ay = a.y + a.h / 2, bx = b.x + bw / 2, by = b.y + b.h / 2;
    s += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#8a8886" stroke-width="1.4"/>`;
    const [e1x, e1y] = exitPt(a, b, 0), [e2x, e2y] = exitPt(b, a, 0);
    const mx = (e1x + e2x) / 2, my = (e1y + e2y) / 2, ang = Math.atan2(ay - by, ax - bx) * 180 / Math.PI;
    s += `<g transform="translate(${mx} ${my}) rotate(${ang})"><path d="M-6 -5 L4 0 L-6 5" fill="none" stroke="#605e5c" stroke-width="1.4"/></g>`;
    const [x1, y1] = exitPt(a, b, 14), [x2, y2] = exitPt(b, a, 14);
    labels += `<text x="${x1}" y="${y1 + 4}" text-anchor="middle" class="crd">*</text><text x="${x2}" y="${y2 + 4}" text-anchor="middle" class="crd">1</text>`;
  }
  for (const n of Object.keys(B)) {
    const { tb, x, y, h } = B[n];
    s += `<g><rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="#fff" stroke="#c8c6c4"/><rect x="${x}" y="${y}" width="${bw}" height="26" rx="6" fill="#f3f2f1"/><text x="${x + 10}" y="${y + 18}" class="tn">${esc(n)}</text>`;
    tb.cols.forEach((c, i) => { s += `<text x="${x + 12}" y="${y + 44 + i * 20}" class="cn${c.key ? ' key' : ''}">${c.type === 'date' ? '📅 ' : isNumCol(c) ? 'Σ ' : ''}${esc(c.name)}</text>`; });
    if (n === 'Продажи') [...m1.measures.values()].filter(x => !x.ref && !x.implicit).forEach((ms, i) => { s += `<text x="${x + 12}" y="${y + 44 + (tb.cols.length + i) * 20}" class="cn ms">▦ ${esc(ms.name)}</text>`; });
    s += '</g>';
  }
  $('#v-model').innerHTML = s + labels + '</svg><p class="mnote">Связи «многие к одному», фильтр идёт от справочников к «Продажам». «Календарь» отмечен как таблица дат.</p>';
  $('#st').textContent = 'Модель: 4 таблицы, 3 связи';
}
document.querySelectorAll('.pbi-rail button').forEach(b => b.onclick = () => {
  st.view = b.dataset.view;
  document.querySelectorAll('.pbi-rail button').forEach(x => x.classList.toggle('on', x === b));
  $('#v-report').hidden = st.view !== 'report'; $('#v-table').hidden = st.view !== 'table'; $('#v-model').hidden = st.view !== 'model';
  renderAll();
});
function renderAll() {
  renderWells(); renderFields();
  if (st.view === 'report') renderReport(); else if (st.view === 'table') renderTable(); else renderModel();
}

let toastT; function toast(msg) { let el = $('.pbi-toast'); if (!el) { el = document.createElement('div'); el.className = 'pbi-toast'; $('#pbi').appendChild(el); } el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }
$('#full').onclick = () => { const on = $('#pbi').classList.toggle('fs'); document.body.classList.toggle('pbi-lock', on); $('#full').textContent = on ? '⤡' : '⤢'; $('#full').title = on ? 'Свернуть' : 'Развернуть на весь экран'; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#pbi').classList.contains('fs') && !view.hasFocus) $('#full').click(); });

/* ───── проверка ───── */
const bad = msg => { const fb = $('#fb'); fb.className = 'fb bad'; fb.innerHTML = msg; fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
function ok(again, gain = 0) {
  const fb = $('#fb'); fb.className = 'fb good';
  const rows = [
    ['Эталон', '<code style="white-space:pre-wrap">' + esc(task.answer) + '</code>'],
    task.explanation && ['Почему так', esc(task.explanation)],
    task.tip && ['Лайфхак', esc(task.tip)],
  ].filter(Boolean);
  fb.innerHTML = (again ? '✓ Кейс решён.' : '<b>Верно!</b> Мера считает правильно во всех проверенных разрезах и срезах. ' + (gain ? '+' + gain + ' XP.' : '')) + '<div class="learn">' + rows.map(([l, v]) => `<div class="learn-row"><span class="lb${l === 'Лайфхак' ? ' tipb' : ''}">${l}</span><p>${v}</p></div>`).join('') + '</div>';
  $('#next').hidden = false;
  document.querySelectorAll('[data-task="' + task.id + '"]').forEach(el => { el.classList.add('done'); const d = el.querySelector('.dot'); if (d) d.textContent = '✓'; });
}
$('#check').onclick = () => {
  start();
  if (!commit()) return bad('Сначала исправьте ошибку в формуле — сообщение под строкой формул.');
  if (!m2) m2 = buildModel(2, task.measures || []);
  let r;
  try { r = checkDax([buildModel(1, task.measures || []), m2], st.committed, task, st.fmt || undefined); }
  catch (e) { showErr(e); return bad(esc(e.message)); }
  if (r.ok) { const gain = markSolved(S, KEY, task.xp, st.committed); S.drafts[KEY + ':fmt'] = st.fmt; save(S); refreshHeader(S, 'bi', task.id); if (gain) goal('trainer_solved', { module: 'bi', task: task.id }); ok(false, gain); }
  else bad(esc(r.msg));
};
$('#hintb').onclick = () => { $('#hint').hidden = !$('#hint').hidden; };
$('#solb').onclick = () => {
  if (!S.revealed[KEY]) { S.revealed[KEY] = true; save(S); }
  $('#sol').hidden = false; $('#sol').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};
if (S.revealed[KEY]) $('#sol').hidden = false;

commit(true);
renderAll();
if (S.solved[KEY]) ok(true);
