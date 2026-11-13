// Обёртка над воркером: обрывает зависший запрос через 3 секунды и поднимает воркер заново.
type R = { ok: true; columns: string[]; values: any[][] } | { ok: false; error: string };
export class SqlRunner {
  private w: Worker | null = null; private seq = 0; private url: string;
  constructor(url: string) { this.url = url; }
  private worker() { if (!this.w) this.w = new Worker(this.url); return this.w; }
  run(db: string, queries: string[], timeout = 3000): Promise<R[]> {
    const id = ++this.seq; const w = this.worker();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { w.terminate(); this.w = null; reject(new Error('timeout')); }, timeout);
      const on = (e: MessageEvent) => { if (e.data.id !== id) return; clearTimeout(t); w.removeEventListener('message', on); e.data.fatal ? reject(new Error(e.data.fatal)) : resolve(e.data.results); };
      w.addEventListener('message', on);
      w.postMessage({ id, db, queries });
    });
  }
}
export function ruError(msg: string): string {
  let m;
  if ((m = msg.match(/no such table: (\S+)/))) return `Таблицы «${m[1]}» нет. Проверьте название — список таблиц справа.`;
  if ((m = msg.match(/no such column: (\S+)/))) return `Столбца «${m[1]}» нет. Проверьте название и таблицу — список столбцов справа.`;
  if ((m = msg.match(/ambiguous column name: (\S+)/))) return `Столбец «${m[1]}» есть в нескольких таблицах. Укажите, из какой: например, c.${m[1].split('.').pop()}.`;
  if ((m = msg.match(/near "([^"]*)": syntax error/))) return `Синтаксическая ошибка рядом с «${m[1]}». Проверьте запятые, кавычки и порядок частей запроса.`;
  if (/incomplete input/.test(msg)) return 'Запрос оборвался — чего-то не хватает в конце (скобки или кавычки).';
  if (/misuse of aggregate/.test(msg)) return 'Агрегатная функция (SUM, COUNT…) стоит там, где её нельзя использовать. Условие на неё пишется в HAVING, а не в WHERE.';
  if (/unrecognized token/.test(msg)) return 'Непонятный символ в запросе. Текст берётся в одинарные кавычки: \'Казань\'.';
  return 'Ошибка базы: ' + msg;
}
