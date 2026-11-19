import { phoneProblem } from '@tallywork/contracts/phone';
import { emailProblem, optionalNameProblem } from './form-checks';

/**
 * Form validation audit, 20 Nov 2026: the personal info form sent names of digits, malformed emails,
 * future birth dates and any text as a phone number. What is wrong with the changed fields about to be
 * sent (null clears a field), by the server's rules, so each problem shows beside its field first.
 */
export function personalInfoProblems(body: Record<string, string | null>, today: string): Array<{ field: string; message: string }> {
  const out: Array<{ field: string; message: string }> = [];
  const add = (field: string, message: string | null) => void (message && out.push({ field, message }));
  for (const [k, max] of [['first_name', 100], ['last_name', 100], ['emergency_contact_name', 150]] as const) if (body[k]) add(k, optionalNameProblem(body[k]!, max));
  if (body.personal_email) add('personal_email', emailProblem(body.personal_email));
  for (const k of ['phone', 'emergency_contact_phone']) if (body[k]) add(k, phoneProblem(body[k]!));
  const birth = body.birth_date;
  if (birth) add('birth_date', birth >= today ? 'Choose a date in the past' : birth < '1900-01-01' ? 'Choose a date from 1900 on' : null);
  return out;
}
