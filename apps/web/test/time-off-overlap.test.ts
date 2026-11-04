import { describe, expect, it } from 'vitest';
import { overlappingNames } from '../components/people/overlap';

const r = (id: string, member: string, name: string, start: string, end: string, status = 'APPROVED') => ({ id, membership_id: member, worker_name: name, start_date: start, end_date: end, status });

describe('who else is away (time-off approvals)', () => {
  const req = r('x', 'm1', 'Ana', '2027-03-02', '2027-03-04', 'PENDING');
  it('lists other members whose absence touches any of the days, approved and requested apart', () => {
    const others = [
      r('a', 'm2', 'Ben', '2027-03-04', '2027-03-06'), // last day overlaps
      r('b', 'm3', 'Cy', '2027-02-25', '2027-03-01'), // ends the day before
      r('c', 'm4', 'Di', '2027-03-03', '2027-03-03', 'PENDING'),
      r('d', 'm2', 'Ben', '2027-03-02', '2027-03-02'), // Ben twice: listed once
      r('e', 'm1', 'Ana', '2027-03-03', '2027-03-03'), // the requester themselves
      req,
    ];
    expect(overlappingNames(req, others)).toEqual({ away: ['Ben'], requested: ['Di'] });
  });
  it('is empty when nobody else is away', () => {
    expect(overlappingNames(req, [r('b', 'm3', 'Cy', '2027-04-01', '2027-04-02')])).toEqual({ away: [], requested: [] });
  });
});
