/** The parts of a time-off request the overlap check needs. */
interface Absence {
  id: string;
  membership_id: string;
  start_date: string;
  end_date: string;
}

/**
 * Who else is away on any day of `req` (other members only, each once), for the approver: approved
 * absences, and other requests waiting for a decision.
 */
export function overlappingNames(req: Absence, others: Array<Absence & { worker_name: string; status: string }>): { away: string[]; requested: string[] } {
  const hits = others.filter((o) => o.id !== req.id && o.membership_id !== req.membership_id && o.start_date <= req.end_date && o.end_date >= req.start_date);
  const names = (st: string) => [...new Set(hits.filter((o) => o.status === st).map((o) => o.worker_name))];
  return { away: names('APPROVED'), requested: names('PENDING') };
}
