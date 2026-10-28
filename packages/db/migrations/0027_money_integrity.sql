-- Money integrity (audit 28 Oct 2026, phase 3). Additive and re-runnable.
-- Q8: each time-off request keeps the hours it takes on each day.
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "day_hours" jsonb;--> statement-breakpoint
-- Q10: the time type multipliers a billing entry was priced with (null for entries approved before).
ALTER TABLE "billing_entries" ADD COLUMN IF NOT EXISTS "bill_coefficient" real;--> statement-breakpoint
ALTER TABLE "billing_entries" ADD COLUMN IF NOT EXISTS "pay_coefficient" real;--> statement-breakpoint
-- F9: what a payroll line needs looked at before paying.
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing requests: their hours spread over their weekdays outside holidays (the rule payroll used),
-- over every day when none is a weekday. The last day takes the rounding, so the days add up to the
-- request exactly and nothing already paid changes for a request inside one period.
WITH days AS (
	SELECT r.id, g::date AS d,
		(extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.organization_id = r.organization_id AND h.date = to_char(g, 'YYYY-MM-DD'))) AS working
	FROM time_off_requests r, generate_series(r.start_date::date, r.end_date::date, interval '1 day') g
	WHERE r.day_hours IS NULL
), chosen AS (
	SELECT dd.id, dd.d FROM days dd
	WHERE dd.working OR NOT EXISTS (SELECT 1 FROM days d2 WHERE d2.id = dd.id AND d2.working)
), numbered AS (
	SELECT c.id, c.d, row_number() OVER (PARTITION BY c.id ORDER BY c.d) AS n, count(*) OVER (PARTITION BY c.id) AS cnt FROM chosen c
), shares AS (
	SELECT n.id, n.d,
		CASE WHEN n.n < n.cnt THEN round(r.hours / n.cnt, 2) ELSE r.hours - round(r.hours / n.cnt, 2) * (n.cnt - 1) END AS h
	FROM numbered n JOIN time_off_requests r ON r.id = n.id
)
UPDATE "time_off_requests" r SET "day_hours" = s.dh
FROM (SELECT id, jsonb_object_agg(to_char(d, 'YYYY-MM-DD'), h) AS dh FROM shares GROUP BY id) s
WHERE r.id = s.id AND r."day_hours" IS NULL;
