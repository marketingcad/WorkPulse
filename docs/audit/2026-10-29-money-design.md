# Money integrity (design note, 29 Oct 2026)

This is Phase 3 of [the 28 Oct audit plan](2026-10-28-product-qa-audit.md#h-prioritized-plan). It covers Q8, Q9, Q10 and F5–F11. The decisions in section 3 were approved on 29 Oct 2026, all as recommended: Q9 (a) bill rate always; F9 (a) $0 and flag the line; F10 (a) round per line; F5 (a) one total per currency.

## 1. Order of work

1. **Reconciliation tests come first.** They run on one dataset and are added before any money code changes, so every later change is measured against them. Each one compares figures that must agree:
   - **Pay:** approved pay on the billing entries, the payroll run line, the pay stub (JSON and PDF) and the Payroll Export.
   - **Invoices:** the sum of the invoice lines, the invoice total, the invoice PDF and the Invoices CSV.
   - **Totals:** totals per currency in the Billing report, the Invoices report and the dashboard widget.
2. Then the fixes below, one at a time. Each fix keeps the reconciliation tests green.

## 2. Proposed changes

### Q8: time off across pay periods (migration)
- `time_off_requests.day_hours` (jsonb, `{date: hours}`) is written when a request is made. It uses the same working-day rule as the request's total, including schedules (Q2).
- Payroll, Insights and the Payroll Export pay the stored hours of the days inside each period. Today they re-derive Monday to Friday × hours per day, which is what pays 32 h for a 40 h request.
- A paid holiday added after approval does not reduce the time off. The day is paid once, as time off, and holiday pay already skips days on paid time off. The 40 h request then pays 40 h.
- Older requests have no stored days. The migration fills them by spreading the request's hours over its weekdays outside holidays (the current rule), so their pay doesn't change.

### Q10: invoice lines use the multiplier the time was priced at (migration)
- `billing_entries.bill_coefficient` and `pay_coefficient` (real, nullable) are stored at approval.
- Invoice lines group by the stored multiplier, so "Overtime ×2, 1 h × $200 = $200" stays right after the time type is changed to ×3.
- Older entries have no stored multiplier. Their unit price comes from amount ÷ hours, which is what they were billed at.

### Mechanical fixes (no decision needed)
- **F5:** finance exports, the Invoices report and the dashboard invoices widget add up money **per currency** and leave **drafts and void invoices** out of totals, as the Invoices page already does.
- **F6:** the Billing report adds up approved amounts per currency. It no longer adds a foreign amount into the org-currency total.
- **F7:** money budgets count only amounts in the budget's currency, and round once per budget instead of once per rollup row.
- **F8:** the pay stub's "of which overtime" comes from the same approved time as "approved", so it can never be larger.
- **F10 (part):**
  - the PDF prints quantities to 4 decimals, like the line;
  - custom lines are priced from the rounded quantity.
- **F11:** Summary credits approved money to the client it was billed to, as the Billing report and invoices do.
- **F9 (part):** time off is paid at the pay rate in effect **on each day**, so a raise in the middle of a request is respected.

## 3. Decisions

1. **Q9, money budgets with non-billable time:** today, non-billable time is valued at the bill rate until it is approved, then at $0, so $200 becomes $0.
   - (a) Value it at the bill rate in effect on the day it was worked, approved or not. $200 stays $200. Recommended.
   - (b) Value it at $0 always, so "include non-billable" only affects hours budgets.
2. **F9, time off for people paid only by project rates:** today their time off pays $0, with no warning.
   - (a) Keep $0, but flag the payroll line "time off has no pay rate" so the admin adds one. Recommended.
   - (b) Pay at the average of the project pay rates on their approved time in the period.
3. **F10, invoice rounding:** six 10-minute entries at $100/h bill $100.02, but the invoice shows 1.0000 h × $100.
   - (a) Price each line as quantity × unit price, rounded once. The invoice always multiplies out, but it can differ from the sum of approved amounts by a few cents, and the difference is shown in the Billing report. Recommended, because clients check the arithmetic.
   - (b) Keep the per-entry amounts, which match approved billing to the cent, and show a "rounding" line on the invoice for the difference.
4. **F5, reports with several currencies:**
   - (a) One total per currency. Recommended; there are no exchange rates in the product.
   - (b) An org-currency total only, with foreign amounts listed but left out.
