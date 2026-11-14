import excel from '../generated/excel.json';
import sql from '../generated/sql.json';
import bi from '../generated/bi.json';
import pq from '../generated/pq.json';
import schema from '../generated/schema.json';

export const MODULES = {
  excel: { id: 'excel', name: 'Excel', title: 'Тренажёр формул Excel', data: excel as any },
  sql: { id: 'sql', name: 'SQL', title: 'Тренажёр SQL', data: sql as any },
  pq: { id: 'pq', name: 'Power Query', title: 'Тренажёр Power Query', data: pq as any },
  bi: { id: 'bi', name: 'Power BI', title: 'Тренажёр Power BI', data: bi as any },
} as const;
export type ModId = keyof typeof MODULES;
export const SCHEMA = schema as { table: string; title: string; cols: string[]; rows: number }[];
export const BASE = import.meta.env.BASE_URL; // '/trenazher-beta/'
export const url = (p = '') => BASE + p;
export const taskUrl = (mod: string, slug: string) => url(`${mod}/${slug}/`);
export const PROD_BASE = 'https://xlplain.ru/trenazher/';

export const plural = (n: number, one: string, few: string, many: string) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };
export const tasksWord = (n: number) => n + ' ' + plural(n, 'задача', 'задачи', 'задач');
export function neighbours(mod: ModId, id: string) {
  const tasks = MODULES[mod].data.tasks;
  const i = tasks.findIndex((t: any) => t.id === id);
  return { i, n: tasks.length, prev: tasks[i - 1], next: tasks[i + 1] };
}
export const trackOf = (mod: ModId, t: any) => MODULES[mod].data.tracks.find((x: any) => x.id === t.track);
export const totalXp = (mod: ModId) => MODULES[mod].data.tasks.reduce((s: number, t: any) => s + trackOf(mod, t).xp, 0);
