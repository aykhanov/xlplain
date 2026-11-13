// Сравнение результата запроса пользователя с эталоном. Чистая функция: работает и в браузере, и в тестах.
export type Result = { columns: string[]; values: any[][] } | null;
export type Verdict = { ok: true } | { ok: false; reason: 'cols' | 'rows' | 'values' | 'order' | 'empty'; got: number; want: number };

const norm = (v: any) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  if (typeof v === 'bigint') return Number(v);
  return String(v).trim();
};
const key = (row: any[]) => JSON.stringify(row.map(norm));

export function compare(user: Result, ref: Result, orderMatters: boolean): Verdict {
  if (!user || !user.columns.length) return { ok: false, reason: 'empty', got: 0, want: ref ? ref.values.length : 0 };
  const want = ref!;
  if (user.columns.length !== want.columns.length) return { ok: false, reason: 'cols', got: user.columns.length, want: want.columns.length };
  if (user.values.length !== want.values.length) return { ok: false, reason: 'rows', got: user.values.length, want: want.values.length };
  const a = user.values.map(key), b = want.values.map(key);
  if (orderMatters) {
    if (a.every((x, i) => x === b[i])) return { ok: true };
    const sa = [...a].sort(), sb = [...b].sort();
    if (sa.every((x, i) => x === sb[i])) return { ok: false, reason: 'order', got: 0, want: 0 };
    return { ok: false, reason: 'values', got: 0, want: 0 };
  }
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]) ? { ok: true } : { ok: false, reason: 'values', got: 0, want: 0 };
}
