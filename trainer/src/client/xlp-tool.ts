// @ts-nocheck
// Раздел «XLPlain онлайн»: редактируемые таблицы, загрузка своего файла и запуск движков надстройки.
import { display, fromInput, toCell, isDate, type Sheet } from '../engine/xlplain/common';
import { reconcile, commonFields } from '../engine/xlplain/sverka';
import { findDuplicates } from '../engine/xlplain/dubli';
import { clean, OPTION_LABELS, STAT_NAMES } from '../engine/xlplain/ochistka';
import { smartMerge, JOIN_LABEL, JOIN_EXPLAIN } from '../engine/xlplain/merge';
import { SVERKA_OLD, SVERKA_NEW, MERGE_ORDERS, MERGE_CLIENTS, CLEAN_SHEET, DUBLI_SHEET } from '../lib/xlp-samples';

const ROW_LIMIT = 30;
const root = document.querySelector('[data-tool]');
const TOOL = root.dataset.tool;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const goal = (name, params) => { try { window.ym && window.ym(113091081, 'reachGoal', name, params); } catch (e) {} };
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const clone = (s: Sheet): Sheet => JSON.parse(JSON.stringify(s));
const cellCls = v => (typeof v === 'number' || isDate(v) ? 'n' : '');
const headersOf = sh => sh.headers.map(h => (h || '').trim()).filter(Boolean);

// ---------- исходные таблицы ----------
const SAMPLES = {
  sverka: [['Старый файл', SVERKA_OLD], ['Новый файл', SVERKA_NEW]],
  obedinenie: [['Таблица 1 — основная', MERGE_ORDERS], ['Таблица 2', MERGE_CLIENTS]],
  ochistka: [['Исходный лист', CLEAN_SHEET]],
  dubli: [['Исходный лист', DUBLI_SHEET]],
}[TOOL];
const sheets: Sheet[] = SAMPLES.map(([, s]) => clone(s));
const fileNames = SAMPLES.map(() => 'пример');

function sheetTable(sh: Sheet, editable: boolean) {
  const cols = Math.max(sh.headers.length, 1);
  let h = '<thead><tr><th class="corner"></th>';
  for (let c = 0; c < cols; c++) h += '<th>' + colName(c) + '</th>';
  h += '</tr></thead><tbody><tr><th>1</th>';
  for (let c = 0; c < cols; c++) h += '<td class="hd"' + (editable ? ' contenteditable="true" data-h="' + c + '"' : '') + '>' + esc(sh.headers[c] || '') + '</td>';
  h += '</tr>';
  sh.rows.forEach((r, ri) => {
    h += '<tr><th>' + (ri + 2) + '</th>';
    for (let c = 0; c < cols; c++) { const v = r[c] ?? null; h += '<td class="' + cellCls(v) + '"' + (editable ? ' contenteditable="true" data-r="' + ri + '" data-c="' + c + '"' : '') + '>' + esc(display(v)) + '</td>'; }
    h += '</tr>';
  });
  return h + '</tbody>';
}

function renderInputs() {
  const box = $('#inputs');
  box.innerHTML = SAMPLES.map(([label], i) => `
    <div class="xin" data-i="${i}">
      <div class="xin-bar"><b>${esc(label)}</b><span class="fname">${esc(fileNames[i] === 'пример' ? 'пример: ' + sheets[i].name : fileNames[i])}</span>
        <span class="xin-act"><button class="btn sm" data-act="upload">Загрузить свой файл</button><button class="btn sm" data-act="row">+ строка</button><button class="btn sm" data-act="reset">Вернуть пример</button></span></div>
      <div class="sheetbox"><table>${sheetTable(sheets[i], true)}</table></div>
      <div class="tabs"><span class="on">${esc(sheets[i].name)}</span></div>
    </div>`).join('');
  box.querySelectorAll('.xin').forEach(el => {
    const i = +el.dataset.i;
    el.querySelectorAll('td[contenteditable]').forEach(td => {
      td.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
      td.addEventListener('blur', () => {
        const text = td.textContent.trim();
        if (td.dataset.h !== undefined) { sheets[i].headers[+td.dataset.h] = text; renderForm(); }
        else { const r = +td.dataset.r, c = +td.dataset.c; const v = fromInput(text, sheets[i].rows[r][c] ?? null); sheets[i].rows[r][c] = v; td.textContent = display(v); td.className = cellCls(v); }
      });
    });
    el.querySelector('[data-act=upload]').onclick = () => upload(i);
    el.querySelector('[data-act=row]').onclick = () => { sheets[i].rows.push(sheets[i].headers.map(() => null)); renderInputs(); };
    el.querySelector('[data-act=reset]').onclick = () => { sheets[i] = clone(SAMPLES[i][1]); fileNames[i] = 'пример'; renderInputs(); renderForm(); clearOut(); };
  });
}

// ---------- загрузка своего файла (SheetJS, грузится только при первом выборе файла) ----------
let xlsxReady = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxReady) xlsxReady = new Promise((ok, fail) => { const s = document.createElement('script'); s.src = '/assets/vendor/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => fail(new Error('Не удалось загрузить модуль чтения Excel.')); document.head.appendChild(s); });
  return xlsxReady;
}
function upload(i) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xls,.csv';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const note = $('#upnote');
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: false, cellNF: true, dense: false });
      let name = wb.SheetNames[0];
      if (wb.SheetNames.length > 1) {
        const pick = prompt('В файле несколько листов: ' + wb.SheetNames.join(', ') + '\nКакой открыть?', name);
        if (pick && wb.SheetNames.includes(pick.trim())) name = pick.trim();
      }
      const ws = wb.Sheets[name];
      const ref = ws['!ref']; if (!ref) throw new Error('Лист пустой.');
      const rg = XLSX.utils.decode_range(ref);
      const grid = [];
      for (let r = rg.s.r; r <= rg.e.r; r++) {
        const row = [];
        for (let c = rg.s.c; c <= Math.min(rg.e.c, rg.s.c + 25); c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          let v = null;
          if (cell) {
            if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) v = { d: Math.floor(cell.v) };
            else if (cell.t === 'd') v = toCell(cell.v);
            else if (cell.t === 'n') v = cell.v;
            else if (cell.t === 'b') v = cell.v ? 'ИСТИНА' : 'ЛОЖЬ';
            else if (cell.t === 'e') v = cell.w || '#ОШИБКА';
            else v = toCell(cell.v);
          }
          row.push(v);
        }
        grid.push(row);
      }
      const hi = grid.findIndex(r => r.some(v => v !== null && String(display(v)).trim() !== ''));
      if (hi < 0) throw new Error('Лист пустой.');
      let headers = grid[hi].map(v => display(v).trim());
      let last = headers.length; while (last > 0 && !headers[last - 1]) last--;
      headers = headers.slice(0, last);
      let rows = grid.slice(hi + 1).map(r => r.slice(0, last));
      while (rows.length && rows[rows.length - 1].every(v => v === null)) rows.pop();
      const total = rows.length;
      rows = rows.slice(0, ROW_LIMIT);
      sheets[i] = { name, headers, rows };
      fileNames[i] = f.name;
      renderInputs(); renderForm(); clearOut();
      note.hidden = false;
      note.innerHTML = total > ROW_LIMIT
        ? `Загружено ${ROW_LIMIT} строк из ${total}: в онлайн-версии обрабатываются первые ${ROW_LIMIT}. Надстройка XLPlain в Excel работает с файлами любого размера. Файл прочитан в браузере и никуда не отправлялся.`
        : `Файл «${esc(f.name)}» прочитан в браузере и никуда не отправлялся. Выберите настройки ниже и запустите.`;
      goal('xlp_upload', { tool: TOOL });
    } catch (e) { note.hidden = false; note.textContent = 'Не получилось открыть файл: ' + e.message; }
  };
  inp.click();
}

// ---------- настройки ----------
const state = {
  oldKeys: ['ID'], newKeys: ['ID'], fields: null, mode: 'УМНОЕ', report: 'ПОЛНЫЙ', tol: 0,
  keys: [['Клиент ID'], ['ID клиента']], aliases: ['Заказы', 'Клиенты'], mfields: [null, null], join: 'LEFT',
  opts: { SPACES: true, NBSP: true, FIO_CASE: true, FIO_INITIALS: false, DATES: true, NUMBERS: true, TYPES: false, EMPTY_ROWS: true, PHONES: true, EMAIL: true, DUPLICATES: false, DUP_MODE: 'Полностью одинаковые строки', DUP_FIELDS: [] },
  dkeys: ['ФИО', 'Дата рождения'], dmode: 'УМНОЕ', only: false,
};
function keep(list, hs) { return (list || []).filter(k => hs.includes(k)); }
function chips(id, all, selected, ordered) {
  return '<div class="chips" id="' + id + '">' + all.map(h => { const i = selected.indexOf(h); return '<button type="button" class="chip-b' + (i >= 0 ? ' on' : '') + '" data-v="' + esc(h) + '">' + (ordered && i >= 0 ? '<i>' + (i + 1) + '</i>' : '') + esc(h) + '</button>'; }).join('') + '</div>';
}
function bindChips(id, list, rerender = true) {
  document.querySelectorAll('#' + id + ' .chip-b').forEach(b => b.onclick = () => { const v = b.dataset.v; const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); if (rerender) renderForm(); });
}
function radio(name, items, cur) { return '<div class="seg">' + items.map(([v, l]) => '<label><input type="radio" name="' + name + '" value="' + esc(v) + '"' + (v === cur ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') + '</div>'; }
function bindRadio(name, fn) { document.querySelectorAll('input[name=' + name + ']').forEach(r => r.onchange = () => { fn(r.value); renderForm(); }); }

function renderForm() {
  const f = $('#form'); let h = '';
  if (TOOL === 'sverka') {
    const ho = headersOf(sheets[0]), hn = headersOf(sheets[1]);
    state.oldKeys = keep(state.oldKeys, ho); state.newKeys = keep(state.newKeys, hn);
    const common = commonFields(sheets[0], sheets[1], state.oldKeys, state.newKeys).map(x => x.trim());
    if (!state.fields) state.fields = [...common];
    state.fields = keep(state.fields, common);
    h += '<div class="frow"><span class="fl">Ключ в старом файле</span>' + chips('k-old', ho, state.oldKeys, true) + '</div>';
    h += '<div class="frow"><span class="fl">Ключ в новом файле</span>' + chips('k-new', hn, state.newKeys, true) + '<small>Можно выбрать несколько полей — составной ключ. Порядок полей должен совпадать.</small></div>';
    h += '<div class="frow"><span class="fl">Сравнивать поля</span>' + (common.length ? chips('k-f', common, state.fields, false) : '<small>Общих полей нет: проверьте заголовки.</small>') + '</div>';
    h += '<div class="frow"><span class="fl">Режим сравнения</span>' + radio('mode', [['УМНОЕ', 'Умное — рекомендуется'], ['СТРОГОЕ', 'Строгое']], state.mode) + '<small>' + (state.mode === 'УМНОЕ' ? 'Не считает изменением лишние и неразрывные пробелы, регистр, одинаковые числа и даты в разном представлении.' : 'Сравнивает значения максимально буквально.') + '</small></div>';
    h += '<div class="frow"><span class="fl">Отчёт</span>' + radio('rep', [['ПОЛНЫЙ', 'Полный'], ['ТОЛЬКО РАЗЛИЧИЯ', 'Только различия']], state.report) + '</div>';
    h += '<div class="frow"><span class="fl">Допуск чисел</span><input id="tol" type="number" min="0" step="any" value="' + state.tol + '"><small>Например, 0,01 — копейки округления не считаются расхождением.</small></div>';
    f.innerHTML = h;
    bindChips('k-old', state.oldKeys); bindChips('k-new', state.newKeys); if (common.length) bindChips('k-f', state.fields);
    bindRadio('mode', v => state.mode = v); bindRadio('rep', v => state.report = v);
    $('#tol').onchange = e => state.tol = Math.abs(parseFloat(String(e.target.value).replace(',', '.')) || 0);
  }
  if (TOOL === 'obedinenie') {
    sheets.forEach((sh, i) => {
      const hs = headersOf(sh); state.keys[i] = keep(state.keys[i], hs);
      if (state.mfields[i]) state.mfields[i] = keep(state.mfields[i], hs);
      const nonKey = hs.filter(x => !state.keys[i].includes(x));
      h += '<div class="tblset"><div class="frow"><span class="fl">Таблица ' + (i + 1) + '</span><input class="alias" data-i="' + i + '" value="' + esc(state.aliases[i]) + '" aria-label="Имя таблицы"><small>Имя используется, если в таблицах есть столбцы с одинаковым названием.</small></div>';
      h += '<div class="frow"><span class="fl">Ключевые поля</span>' + chips('mk' + i, hs, state.keys[i], true) + '</div>';
      h += '<div class="frow"><span class="fl">Поля в результат</span>' + chips('mf' + i, nonKey, state.mfields[i] || nonKey, false) + (i === 0 ? '<small>Ключи основной таблицы попадают в результат всегда.</small>' : '') + '</div></div>';
    });
    h += '<div class="frow"><span class="fl">Как объединить</span>' + radio('join', Object.entries(JOIN_LABEL), state.join) + '<small>' + esc(JOIN_EXPLAIN[state.join]) + '</small></div>';
    h += '<p class="small">В надстройке можно объединять до шести таблиц сразу. В онлайн-версии — две.</p>';
    f.innerHTML = h;
    sheets.forEach((sh, i) => {
      bindChips('mk' + i, state.keys[i]);
      const nonKey = headersOf(sh).filter(x => !state.keys[i].includes(x));
      if (!state.mfields[i]) state.mfields[i] = [...nonKey];
      bindChips('mf' + i, state.mfields[i]);
    });
    f.querySelectorAll('.alias').forEach(inp => inp.onchange = () => state.aliases[+inp.dataset.i] = inp.value.trim() || 'Таблица ' + (+inp.dataset.i + 1));
    bindRadio('join', v => state.join = v);
  }
  if (TOOL === 'ochistka') {
    const hs = headersOf(sheets[0]); state.opts.DUP_FIELDS = keep(state.opts.DUP_FIELDS, hs);
    h += '<div class="frow"><span class="fl">Что исправить</span><div class="checks">' + OPTION_LABELS.map(([k, l]) => '<label><input type="checkbox" data-o="' + k + '"' + (state.opts[k] ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') + '</div><small>Столбцы определяются по заголовкам, как в надстройке: «ФИО», «Телефон», «Email», «Дата…». Коды, артикулы, ИНН и номера не превращаются в числа.</small></div>';
    if (state.opts.DUPLICATES) {
      h += '<div class="frow"><span class="fl">Дубли</span>' + radio('dm', [['Полностью одинаковые строки', 'Полностью одинаковые строки'], ['По выбранным столбцам', 'По выбранным столбцам']], state.opts.DUP_MODE) + (state.opts.DUP_MODE === 'По выбранным столбцам' ? chips('df', hs, state.opts.DUP_FIELDS, true) : '') + '</div>';
    }
    f.innerHTML = h;
    f.querySelectorAll('input[data-o]').forEach(c => c.onchange = () => { state.opts[c.dataset.o] = c.checked; if (c.dataset.o === 'DUPLICATES') renderForm(); });
    if (state.opts.DUPLICATES) { bindRadio('dm', v => state.opts.DUP_MODE = v); if (state.opts.DUP_MODE === 'По выбранным столбцам') bindChips('df', state.opts.DUP_FIELDS); }
  }
  if (TOOL === 'dubli') {
    const hs = headersOf(sheets[0]); state.dkeys = keep(state.dkeys, hs);
    h += '<div class="frow"><span class="fl">Искать повторы по полям</span>' + chips('dk', hs, state.dkeys, true) + '<small>Одно поле или комбинация, например ФИО + дата рождения.</small></div>';
    h += '<div class="frow"><span class="fl">Режим сравнения</span>' + radio('dmode', [['УМНОЕ', 'Умное'], ['СТРОГОЕ', 'Строгое']], state.dmode) + '<small>' + (state.dmode === 'УМНОЕ' ? 'Не различает регистр, лишние пробелы и одинаковые числа, записанные по-разному.' : 'Значения должны совпадать буквально.') + '</small></div>';
    h += '<div class="frow"><span class="fl">Отчёт</span><label class="ck"><input type="checkbox" id="only"' + (state.only ? ' checked' : '') + '> только повторные строки (без первого вхождения)</label></div>';
    f.innerHTML = h;
    bindChips('dk', state.dkeys); bindRadio('dmode', v => state.dmode = v);
    $('#only').onchange = e => state.only = e.target.checked;
  }
}

// ---------- результат ----------
function clearOut() { $('#out').innerHTML = ''; $('#cta').hidden = true; }
function outTable(headers, rows, rowCls = () => '', cellClsFn = (r, c, v) => cellCls(v), firstRow = 1) {
  let h = '<thead><tr><th class="corner"></th>' + headers.map((_, c) => '<th>' + colName(c) + '</th>').join('') + '</tr></thead><tbody>';
  h += '<tr><th>' + firstRow + '</th>' + headers.map(x => '<td class="hd rh">' + esc(x) + '</td>').join('') + '</tr>';
  rows.forEach((r, ri) => { h += '<tr class="' + rowCls(ri) + '"><th>' + (ri + firstRow + 1) + '</th>' + headers.map((_, c) => '<td class="' + cellClsFn(ri, c, r[c] ?? null) + '">' + esc(display(r[c] ?? null)) + '</td>').join('') + '</tr>'; });
  return h + '</tbody>';
}
function showBook(tabs, summary) {
  const out = $('#out');
  out.innerHTML = (summary ? '<div class="sum">' + summary + '</div>' : '') +
    '<div class="book">' + tabs.map((t, i) => '<div class="sheetbox page" data-p="' + i + '"' + (i ? ' hidden' : '') + '>' + t.html + '</div>').join('') +
    '<div class="tabs">' + tabs.map((t, i) => '<button class="' + (i ? '' : 'on') + '" data-p="' + i + '">' + esc(t.name) + '</button>').join('') + '</div></div>';
  out.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { out.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); out.querySelectorAll('.page').forEach(p => p.hidden = p.dataset.p !== b.dataset.p); });
  $('#cta').hidden = false;
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const pill = (label, n, cls = '') => '<span class="pill ' + cls + '"><b>' + n + '</b> ' + esc(label) + '</span>';
const info = (pairs) => '<table class="info">' + pairs.map(([a, b]) => '<tr><td>' + esc(a) + '</td><td>' + esc(b) + '</td></tr>').join('') + '</table>';
const ST_CLS = { 'БЕЗ ИЗМЕНЕНИЙ': 'st-ok', 'ИЗМЕНЕНО': 'st-ch', 'ДОБАВЛЕНО': 'st-new', 'УДАЛЕНО': 'st-del' };

function run() {
  const err = $('#err'); err.hidden = true;
  try {
    if (TOOL === 'sverka') {
      const pairs = state.fields.map(x => ({ old: x, new: x }));
      const r = reconcile(sheets[0], sheets[1], { oldKeys: state.oldKeys, newKeys: state.newKeys, pairs, mode: state.mode, report: state.report, tolerance: state.tol });
      const rows = r.rows.map(x => [x.status, x.key, x.field, x.was, x.now, x.oldRow, x.newRow]);
      const res = outTable(['Статус', 'Ключ', 'Поле', 'Было', 'Стало', 'Строка старого', 'Строка нового'], rows, i => ST_CLS[r.rows[i].status], (ri, c, v) => (c >= 5 ? 'n c' : cellCls(v)));
      const dupNote = r.duplicateKeys ? '<p class="small warn">В файлах есть повторяющиеся ключи (старый: ' + r.oldStats.repeated + ', новый: ' + r.newStats.repeated + '). Надстройка в этом случае предлагает показать отчёт по ключам или продолжить: повторы сопоставляются по порядку появления. Здесь сверка продолжена так же.</p>' : '';
      showBook([
        { name: 'Результат', html: '<table>' + res + '</table>' },
        { name: 'Параметры', html: info([['Старый файл', fileNames[0] + ' / ' + sheets[0].name], ['Ключевые поля', state.oldKeys.join(' + ')], ['Новый файл', fileNames[1] + ' / ' + sheets[1].name], ['Ключевые поля', state.newKeys.join(' + ')], ['Сопоставление полей', state.fields.join(', ')], ['Режим сравнения', state.mode], ['Режим отчёта', state.report], ['Допуск чисел', String(state.tol)], ['Строк в старом файле', String(r.oldStats.rows)], ['Строк в новом файле', String(r.newStats.rows)]]) },
      ], pill('без изменений', r.match, 'st-ok') + pill('изменено', r.changed, 'st-ch') + pill('добавлено', r.added, 'st-new') + pill('удалено', r.removed, 'st-del') + dupNote);
    }
    if (TOOL === 'obedinenie') {
      const tables = sheets.map((sh, i) => ({ sheet: sh, alias: state.aliases[i], keys: state.keys[i], fields: state.mfields[i] }));
      const r = smartMerge(tables, state.join, 5000);
      if (r.tooBig) throw new Error('Результат получается слишком большим. Причина обычно в повторяющихся ключах.');
      const res = outTable(r.headers, r.rows, () => '', (ri, c, v) => cellCls(v) + (r.empty[ri][c] ? ' miss' : ''));
      const missRows = r.empty.filter(e => e.some(Boolean)).length;
      const rep = info([['Режим', JOIN_LABEL[r.mode]], ['Строк в результате', String(r.rows.length)], ...r.info.flatMap((t, i) => [[(i + 1) + '. ' + t.alias, 'строк: ' + t.rows + ' · ключ: ' + t.keys], ['', 'уникальных ключей: ' + t.unique + ' · ключей с повторами: ' + t.dupKeys + ' · пустых ключей: ' + t.blank]]), ['', JOIN_EXPLAIN[r.mode]], ['', 'Исходные таблицы не изменяются.']]);
      const dupNote = r.info.some(t => t.dupKeys) ? '<p class="small">Повторы ключей создают все допустимые комбинации совпадающих строк — так же, как в надстройке.</p>' : '';
      showBook([{ name: 'Результат', html: '<table>' + res + '</table>' }, { name: 'Отчёт', html: rep }],
        pill('строк в результате', r.rows.length, 'st-ok') + pill('строк без совпадения', missRows, missRows ? 'st-del' : '') + '<p class="small">Где совпадения нет, ячейки пустые и подсвечены — без #Н/Д.</p>' + dupNote);
    }
    if (TOOL === 'ochistka') {
      const r = clean(sheets[0], state.opts);
      const statsRows = STAT_NAMES.map(n => [n, r.stats[n]]);
      const ex = r.examples.map(x => [x.row, x.column, x.action, x.was, x.now]);
      const changedCls = (ri, c, v) => cellCls(v) + (r.changed.has((ri + 2) + '|' + c) ? ' chg' : '');
      const delSet = new Set(r.deleteRows);
      const preview = '<div class="prev"><div><p class="pt">Предварительный результат</p><table class="info">' + statsRows.map(([a, b]) => '<tr><td>' + esc(a) + '</td><td class="n">' + b + '</td></tr>').join('') + '</table></div>';
      showBook([
        { name: 'Предпросмотр', html: preview + '<div class="pex"><p class="pt">Примеры изменений</p><table>' + outTable(['Строка', 'Столбец', 'Действие', 'Было', 'Стало'], ex, () => '', (ri, c, v) => (c === 0 ? 'n c' : '')) + '</table></div></div>' },
        { name: sheets[0].name + '_очищено', html: '<table>' + outTable(sheets[0].headers, r.rows, i => (delSet.has(i + 2) ? 'del' : ''), changedCls) + '</table>' },
      ], pill('ячеек к изменению', r.stats['Ячеек к изменению'], 'st-ch') + pill('строк к удалению', r.deleteRows.length, r.deleteRows.length ? 'st-del' : '') + '<p class="small">Исходный лист не меняется: надстройка создаёт очищенную копию в новой книге. Изменённые ячейки подсвечены, строки к удалению зачёркнуты.</p>');
    }
    if (TOOL === 'dubli') {
      const r = findDuplicates(sheets[0], { keys: state.dkeys, mode: state.dmode, onlyRepeated: state.only });
      if (r.tooFew) throw new Error('Для поиска дублей недостаточно строк данных.');
      if (!r.groups) { $('#out').innerHTML = '<div class="sum">' + pill('дубли не найдены', '✓', 'st-ok') + '<p class="small">Проверено строк: ' + r.checked + '. Пропущено строк с пустым ключом: ' + r.blankKeys + '.</p></div>'; $('#cta').hidden = false; goal('xlp_run', { tool: TOOL }); return; }
      const rows = r.rows.map(x => [x.group, x.key, x.count, x.type, x.sourceRow, ...x.values]);
      const res = outTable(['Группа', 'Ключ', 'Количество', 'Тип строки', 'Строка источника', ...r.headers], rows, i => (r.rows[i].type === 'ДУБЛЬ' ? 'st-ch' : 'st-ok'), (ri, c, v) => (c === 0 || c === 2 || c === 4 ? 'n c' : cellCls(v)), 8);
      const head = info([['Ключевые поля', state.dkeys.join(' + ')], ['Режим', state.dmode], ['Отчёт', state.only ? 'ТОЛЬКО ПОВТОРНЫЕ СТРОКИ' : 'ВСЕ СТРОКИ ГРУПП'], ['Групп дублей', String(r.groups)], ['Строк в группах', String(r.rowsInGroups)], ['Лишних повторов', String(r.excess)], ['Пустых ключей пропущено', String(r.blankKeys)], ['Проверено строк', String(r.checked)]]);
      showBook([{ name: 'Дубли', html: '<table>' + res + '</table>' }, { name: 'Параметры', html: head }],
        pill('групп дублей', r.groups, 'st-ch') + pill('строк в группах', r.rowsInGroups) + pill('лишних повторов', r.excess, 'st-del') + '<p class="small">Ничего не удалено: отчёт показывает группы, а решение — за вами.</p>');
    }
    goal('xlp_run', { tool: TOOL });
  } catch (e) { err.hidden = false; err.textContent = e.message; $('#out').innerHTML = ''; }
}

renderInputs(); renderForm();
$('#run').onclick = run;
document.querySelectorAll('.tobuy').forEach(a => a.addEventListener('click', () => goal('xlp_buy_click', { tool: TOOL })));
