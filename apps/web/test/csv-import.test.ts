import { describe, expect, it } from 'vitest';
import type { TimeTypeDto } from '@tallywork/contracts';
import type { Assignment } from '../components/project-task-picker';
import { parseCsv, toCsv } from '../lib/csv';
import { HEADER, toRows } from '../lib/csv-import';

/**
 * CSV time import: the file is parsed and checked in the browser, then each valid row is
 * sent as manual time (POST /manual-time, covered by the API tests). These tests cover the
 * parsing and the row checks that decide what gets sent.
 */
const assignments: Assignment[] = [
  { project_id: 'p-site', project_name: 'Website', color: '#000', client_name: null, tasks: [{ id: 't-design', title: 'Design', status: 'IN_PROGRESS' }] },
  { project_id: 'p-app', project_name: 'Mobile App', color: '#000', client_name: 'Acme', tasks: [] },
];
const types: TimeTypeDto[] = [{ id: 'tt-ot', name: 'Overtime', short_name: 'OT', color: '#000', pay_coefficient: 1.5, bill_coefficient: 1, not_billable: false, is_default: false, archived_at: null }];
const rows = (csv: string) => toRows(parseCsv(csv), assignments, types);

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes, CRLF and a BOM, and drops blank lines', () => {
    const csv = '﻿Date,Note\r\n2026-09-21,"Workshop, day 1"\r\n\r\n2026-09-22,"Said ""hi""\nthen left"\n';
    expect(parseCsv(csv)).toEqual([
      ['Date', 'Note'],
      ['2026-09-21', 'Workshop, day 1'],
      ['2026-09-22', 'Said "hi"\nthen left'],
    ]);
  });

  it('detects semicolon-separated files (spreadsheets in many European locales)', () => {
    expect(parseCsv('Date;Start;Note\n2026-09-21;09:00;a, b')).toEqual([
      ['Date', 'Start', 'Note'],
      ['2026-09-21', '09:00', 'a, b'],
    ]);
  });

  it('round-trips what toCsv writes, with formula-like text neutralised', () => {
    const out = parseCsv(toCsv(['A', 'B'], [['=SUM(A1)', 'x,"y"']]));
    expect(out).toEqual([
      ['A', 'B'],
      ["'=SUM(A1)", 'x,"y"'],
    ]);
  });
});

describe('toRows', () => {
  it('accepts the downloadable template', () => {
    const [r] = rows(toCsv(HEADER, [['2026-09-21', '09:00', '12:30', 'Website', '', 'Client workshop', '']]));
    expect(r).toMatchObject({ line: 2, date: '2026-09-21', start: '09:00', end: '12:30', projectId: 'p-site', taskId: null, timeTypeId: null, note: 'Client workshop', error: null });
  });

  it('maps columns by header name in any order, ignoring case and spacing', () => {
    const [r] = rows(' project ,TASK,date,End,Start,type\nwebsite, design ,2026-09-21,17:00,9:05,ot');
    expect(r).toMatchObject({ projectId: 'p-site', taskId: 't-design', timeTypeId: 'tt-ot', start: '09:05', end: '17:00', error: null });
  });

  it('matches a time type by name or short name', () => {
    expect(rows('2026-09-21,09:00,10:00,Website,,,Overtime')[0]!.timeTypeId).toBe('tt-ot');
    expect(rows('2026-09-21,09:00,10:00,Website,,,ot')[0]!.timeTypeId).toBe('tt-ot');
  });

  it('reads a file without a header in the template column order, numbering lines from 1', () => {
    const r = rows('2026-09-21,09:00,10:00,Mobile App\n2026-09-22,13:00,14:30,Website,Design,Review');
    expect(r.map((x) => [x.line, x.projectId, x.taskId, x.note, x.error])).toEqual([
      [1, 'p-app', null, '', null],
      [2, 'p-site', 't-design', 'Review', null],
    ]);
  });

  it.each([
    ['21/09/2026,09:00,10:00,Website', 'Date must be YYYY-MM-DD'],
    ['2026-13-01,09:00,10:00,Website', 'Date must be YYYY-MM-DD'],
    // Date.parse alone rolls Feb 30 into March, which would log the time on the wrong day.
    ['2026-02-30,09:00,10:00,Website', 'Date must be YYYY-MM-DD'],
    ['2026-09-21,9am,10:00,Website', 'Start and end must be HH:MM (24h)'],
    ['2026-09-21,09:00,24:00,Website', 'Start and end must be HH:MM (24h)'],
    ['2026-09-21,09:60,10:00,Website', 'Start and end must be HH:MM (24h)'],
    ['2026-09-21,10:00,10:00,Website', 'End must be after start'],
    // Overnight rows are not supported: split them at midnight.
    ['2026-09-21,22:00,02:00,Website', 'End must be after start'],
    ['2026-09-21,09:00,10:00,', 'Project is missing'],
    ['2026-09-21,09:00,10:00,Intranet', 'No project “Intranet” you can log to'],
    ['2026-09-21,09:00,10:00,Mobile App,Design', 'No open task “Design” in Mobile App'],
    ['2026-09-21,09:00,10:00,Website,,,Holiday', 'No time type “Holiday”'],
  ])('rejects %s', (csv, error) => {
    expect(rows(csv)[0]!.error).toBe(error);
  });

  it('accepts real leap days', () => {
    expect(rows('2028-02-29,09:00,10:00,Website')[0]!.error).toBeNull();
  });

  it('checks each row on its own, so one bad row does not block the rest', () => {
    const r = rows('Date,Start,End,Project\n2026-09-21,09:00,10:00,Website\nbad,09:00,10:00,Website\n2026-09-22,11:00,12:00,Mobile App');
    expect(r.map((x) => [x.line, x.error === null])).toEqual([
      [2, true],
      [3, false],
      [4, true],
    ]);
  });
});
