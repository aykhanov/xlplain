import { describe, it, expect } from 'vitest';
import { reconcile, commonFields, valuesEqual } from '../src/engine/xlplain/sverka';
import { findDuplicates } from '../src/engine/xlplain/dubli';
import { clean, tryNumber, normalizePhone, properFio, fioToInitials } from '../src/engine/xlplain/ochistka';
import { smartMerge, normKeyValue } from '../src/engine/xlplain/merge';
import { parseDateText, serialToDmy } from '../src/engine/xlplain/common';
import { SVERKA_OLD, SVERKA_NEW, MERGE_ORDERS, MERGE_CLIENTS, CLEAN_SHEET, DUBLI_SHEET } from '../src/lib/xlp-samples';

const allOpts = { SPACES: true, NBSP: true, FIO_CASE: true, FIO_INITIALS: false, DATES: true, NUMBERS: true, EMPTY_ROWS: true, PHONES: true, EMAIL: true, DUPLICATES: false, TYPES: false };

describe('сверка', () => {
  const pairs = commonFields(SVERKA_OLD, SVERKA_NEW, ['ID'], ['ID']).map(h => ({ old: h, new: h }));
  it('умный режим: пробелы, регистр и «95 000» не считаются изменением', () => {
    const r = reconcile(SVERKA_OLD, SVERKA_NEW, { oldKeys: ['ID'], newKeys: ['ID'], pairs, mode: 'УМНОЕ', report: 'ПОЛНЫЙ' });
    expect([r.match, r.changed, r.added, r.removed]).toEqual([3, 2, 1, 1]);
    const ch = r.rows.filter(x => x.status === 'ИЗМЕНЕНО').map(x => x.key + ':' + x.field);
    expect(ch).toEqual(['1001:Должность', '1001:Зарплата', '1004:Подразделение']);
    expect(r.rows.find(x => x.status === 'УДАЛЕНО')!.oldRow).toBe(6);
    expect(r.rows.find(x => x.status === 'ДОБАВЛЕНО')!.newRow).toBe(7);
  });
  it('строгий режим видит больше различий', () => {
    const r = reconcile(SVERKA_OLD, SVERKA_NEW, { oldKeys: ['ID'], newKeys: ['ID'], pairs, mode: 'СТРОГОЕ', report: 'ТОЛЬКО РАЗЛИЧИЯ' });
    expect(r.changed).toBe(3);
    expect(r.rows.some(x => x.status === 'БЕЗ ИЗМЕНЕНИЙ')).toBe(false);
  });
  it('даты и числа в разном виде равны', () => {
    expect(valuesEqual('01.02.2025', { d: 45689 }, 'УМНОЕ')).toBe(true);
    expect(valuesEqual('1 250,50', 1250.5, 'УМНОЕ')).toBe(true);
    expect(valuesEqual('Москва ', 'москва', 'УМНОЕ')).toBe(true);
  });
});

describe('дубли', () => {
  it('ФИО + дата рождения, умный режим', () => {
    const r = findDuplicates(DUBLI_SHEET, { keys: ['ФИО', 'Дата рождения'], mode: 'УМНОЕ' });
    expect([r.groups, r.rowsInGroups, r.excess]).toEqual([2, 4, 2]);
    expect(r.rows.map(x => x.sourceRow + x.type[0])).toEqual(['2П', '4Д', '5П', '7Д']);
  });
  it('строгий режим не склеивает разный регистр', () => {
    const r = findDuplicates(DUBLI_SHEET, { keys: ['ФИО', 'Дата рождения'], mode: 'СТРОГОЕ' });
    expect(r.groups).toBe(1);
  });
});

describe('очистка', () => {
  it('функции как в надстройке', () => {
    expect(tryNumber('1 250,50')).toBe(1250.5);
    expect(tryNumber('00125')).toBeNull();
    expect(tryNumber('15%')).toBeNull();
    expect(tryNumber('1,234.5')).toBe(1234.5);
    expect(normalizePhone('8 (916) 555-44-33')).toBe('89165554433');
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizePhone('8-912-000-11-22 доб. 15')).toBe('89120001122');
    expect(properFio('ИВАНОВ иван  иванович')).toBe('Иванов Иван Иванович');
    expect(properFio('кузнецова-петрова мария')).toBe('Кузнецова-Петрова Мария');
    expect(fioToInitials('Иванов Иван Иванович')).toBe('Иванов И.И.');
    expect(serialToDmy(parseDateText('21 марта 1988')!)).toBe('21.03.1988');
  });
  it('пример выгрузки', () => {
    const r = clean(CLEAN_SHEET, allOpts);
    expect(r.stats['Проверено строк']).toBe(6);
    expect(r.stats['Пустых строк к удалению']).toBe(1);
    expect(r.stats['Даты']).toBe(5);
    expect(r.stats['Числа из текста']).toBe(4);
    expect(r.output.length).toBe(5);
    expect(r.rows[0][0]).toBe('00125');
    expect(r.rows[5][3]).toBe('15%');
  });
});

describe('объединение', () => {
  const t = (mode: any) => smartMerge([
    { sheet: MERGE_ORDERS, alias: 'Заказы', keys: ['Клиент ID'] },
    { sheet: MERGE_CLIENTS, alias: 'Клиенты', keys: ['ID клиента'] },
  ], mode);
  it('ключ « 103 » текстом находит клиента 103', () => {
    expect(normKeyValue(' 103 ')).toBe(normKeyValue(103));
    expect(normKeyValue('0103')).not.toBe(normKeyValue(103));
    const r = t('LEFT');
    expect(r.headers).toEqual(['Номер заказа', 'Клиент ID', 'Дата', 'Сумма', 'Клиент', 'Город', 'Менеджер']);
    expect(r.rows.length).toBe(5);
    expect(r.rows.map(x => x[0])).toEqual(['ORD-001', 'ORD-004', 'ORD-002', 'ORD-003', 'ORD-005']); // строки группируются по ключу, как в надстройке
    const byOrder = Object.fromEntries(r.rows.map(x => [x[0], x[4]]));
    expect(byOrder['ORD-003']).toBe('Гамма');
  });
  it('режимы', () => {
    expect(t('INNER').rows.length).toBe(4);
    const full = t('FULL');
    expect(full.rows.length).toBe(6);
    expect(full.rows[full.rows.length - 1][1]).toBe(104);
  });
});
