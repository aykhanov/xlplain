// @ts-nocheck
import { XL } from '../engine/excel';
import { parseAddr } from '../engine/excel-check';
export const fmt = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
  return String(v);
};
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function sheetHtml(task) {
  const g = task.grid; const [tc, tr] = parseAddr(task.target);
  const cols = Math.max(5, ...g.map(r => r.length), tc + 1) + 1;
  const rows = Math.max(g.length + 2, 6);
  const header = g[0].every(v => v === null || typeof v === 'string');
  let h = '<thead><tr><th class="corner"></th>';
  for (let c = 0; c < cols; c++) h += '<th data-col="' + c + '">' + XL.colName(c) + '</th>';
  h += '</tr></thead><tbody>';
  for (let r = 0; r < rows; r++) {
    h += '<tr><th data-row="' + r + '">' + (r + 1) + '</th>';
    for (let c = 0; c < cols; c++) {
      const v = g[r] ? g[r][c] : null; const isT = c === tc && r === tr;
      let cls = typeof v === 'number' ? 'n' : '';
      if (header && r === 0 && v !== null && v !== undefined) cls += ' hd';
      if (isT) cls += ' tg';
      h += '<td data-c="' + c + '" data-r="' + r + '" class="' + cls.trim() + '">' + (isT ? '?' : esc(fmt(v))) + '</td>';
    }
    h += '</tr>';
  }
  return h + '</tbody>';
}
