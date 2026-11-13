import { describe, it, expect } from 'vitest';
import bi from '../src/generated/bi.json';
import { buildModel } from '../src/lib/bi-model';
import { checkDax } from '../src/engine/bi-check';

describe('Power BI: задачи DAX', () => {
  for (const t of (bi.tasks as any[]).filter(t => t.check === 'dax')) {
    it(t.id, () => {
      const models = [1, 2].map(s => buildModel(s, t.measures || []));
      const t0 = Date.now();
      const r = checkDax(models, t.answer, t, t.format);
      expect(r).toEqual({ ok: true });
      expect(Date.now() - t0).toBeLessThan(3000);
      for (const a of t.alt || []) expect(checkDax(models, a, t, t.format), a).toEqual({ ok: true });
      for (const w of t.wrong || []) { let res: any; try { res = checkDax(models, w, t, t.format); } catch (e: any) { res = { ok: false, msg: e.message }; } expect(res.ok, w).toBe(false); }
      expect(checkDax(models, t.measure_name + ' = 0', t, t.format).ok).toBe(false);
      if (t.format) expect(checkDax(models, t.answer, t, undefined).ok).toBe(false);
    });
  }
});
