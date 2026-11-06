import type { DurationLine, PayInput, Shift } from './math';

/**
 * What is typed in the calculator. It lives in the launcher (always loaded, and kept across pages) while
 * the panel that edits it is loaded the first time the calculator opens. Type-only imports keep the
 * arithmetic out of the launcher's bundle.
 */
export type Mode = 'hours' | 'sum' | 'pay' | 'convert';

export interface CalcState {
  mode: Mode;
  shifts: Shift[];
  lines: DurationLine[];
  pay: PayInput;
  convert: string;
}

export const EMPTY_SHIFT: Shift = { start: '', end: '', breakText: '' };
export const EMPTY_LINE: DurationLine = { op: '+', text: '' };

export const INITIAL_STATE: CalcState = {
  mode: 'hours',
  shifts: [EMPTY_SHIFT],
  lines: [EMPTY_LINE, EMPTY_LINE],
  pay: { hours: '', payRate: '', billRate: '' },
  convert: '',
};

/** The mode's inputs back to empty; the other modes keep theirs. */
export function clearMode(s: CalcState): CalcState {
  switch (s.mode) {
    case 'hours':
      return { ...s, shifts: INITIAL_STATE.shifts };
    case 'sum':
      return { ...s, lines: INITIAL_STATE.lines };
    case 'pay':
      return { ...s, pay: INITIAL_STATE.pay };
    case 'convert':
      return { ...s, convert: '' };
  }
}

/** True when the current mode has nothing typed (Clear is then disabled). */
export function modeIsEmpty(s: CalcState): boolean {
  switch (s.mode) {
    case 'hours':
      return s.shifts.every((x) => !x.start && !x.end && !x.breakText) && s.shifts.length === 1;
    case 'sum':
      return s.lines.every((l) => !l.text && l.op === '+') && s.lines.length === INITIAL_STATE.lines.length;
    case 'pay':
      return !s.pay.hours && !s.pay.payRate && !s.pay.billRate;
    case 'convert':
      return !s.convert;
  }
}
