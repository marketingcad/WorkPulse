import type { z } from 'zod';

/**
 * Plain-language validation messages (audit 30 Oct 2026, VF-01). zod's own wording ("Too small:
 * expected string to have >=1 characters") is written for developers; these say what to do instead.
 * A message set on the schema itself (e.g. 'Use at least 10 characters') still wins.
 *
 * Pass as the per-parse error map: `schema.safeParse(data, { error: issueMessage })`.
 */
export function issueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  const n = (v: number | bigint) => (typeof v === 'bigint' ? v.toString() : v.toLocaleString('en-US'));
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null) return 'This field is required';
      const expected: Record<string, string> = {
        string: 'Enter text',
        number: 'Enter a number',
        int: 'Enter a whole number',
        boolean: 'Choose yes or no',
        array: 'Choose one or more options',
        object: 'Send the details as a JSON object',
        date: 'Enter a date',
      };
      return expected[issue.expected] ?? 'Enter a valid value';
    }
    case 'too_small': {
      const min = issue.minimum;
      if (issue.origin === 'string') return Number(min) <= 1 ? 'This field is required' : `Use at least ${n(min)} characters`;
      if (issue.origin === 'array' || issue.origin === 'set') return Number(min) <= 1 ? 'Choose at least one' : `Choose at least ${n(min)}`;
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') return issue.inclusive ? `Enter ${n(min)} or more` : `Enter more than ${n(min)}`;
      return undefined;
    }
    case 'too_big': {
      const max = issue.maximum;
      if (issue.origin === 'string') return `Use at most ${n(max)} characters`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Choose at most ${n(max)}`;
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') return issue.inclusive ? `Enter ${n(max)} or less` : `Enter less than ${n(max)}`;
      return undefined;
    }
    case 'invalid_format': {
      if (issue.input === '') return 'This field is required';
      const formats: Record<string, string> = {
        email: 'Enter a valid email address, like name@example.com',
        url: 'Enter a valid web address, like https://example.com',
        uuid: 'This reference is not valid. Reload the page and try again',
        date: 'Enter a real date (YYYY-MM-DD)',
        datetime: 'Enter a valid date and time',
        time: 'Enter a valid time (HH:MM)',
      };
      return formats[issue.format] ?? 'Use the expected format';
    }
    case 'invalid_value':
      return issue.values.length <= 6 ? `Choose one of: ${issue.values.map(String).join(', ')}` : 'Choose one of the listed options';
    case 'unrecognized_keys':
      return `Unknown ${issue.keys.length > 1 ? 'options' : 'option'}: ${issue.keys.join(', ')}`;
    case 'invalid_union':
      return 'Enter a valid value';
    case 'not_multiple_of':
      return `Use a multiple of ${n(issue.divisor)}`;
    default:
      return undefined;
  }
}

/** Labels that read better than the key; an empty label means the message stands alone (a link's token is not something people see). */
const LABELS: Record<string, string> = { ipAllowlist: 'IP allowlist', url: 'URL', iban: 'IBAN', swift: 'SWIFT', tax_id: 'Tax ID', totp: 'Code', token: '' };

/** A field path as people read it: `amount_minor` → "Amount", `extra_lines.0.quantity` → "Quantity (row 1)". */
export function fieldLabel(path: ReadonlyArray<PropertyKey>): string | null {
  const names = path.filter((p): p is string => typeof p === 'string');
  const last = names.at(-1);
  if (!last || LABELS[last] === '') return null;
  const row = path.find((p): p is number => typeof p === 'number');
  const words =
    LABELS[last] ??
    last
      .replace(/_(minor|ids?|seconds|bps)$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return row === undefined ? label : `${label} (row ${row + 1})`;
}
