import type { BreakdownRow } from "@hostry/ui-kit";
import type { components } from "../../generated";

type Charge = components["schemas"]["Charge"];

/**
 * The service's own figures as breakdown rows. Nothing is recalculated here (flows AS11): CGST and
 * SGST for the same state, one IGST row for another state, and a single "not registered" line when
 * no GST was added (AC 28, 30).
 */
export function breakdownRows(c: Charge, t: (k: string, p?: Record<string, string | number>) => string): { rows: BreakdownRow[]; noGst: boolean } {
  const rows: BreakdownRow[] = [{ id: "taxable", label: t("admin.charge.raise.taxable"), amountPaise: c.taxable.amount_paise }];
  const noGst = c.cgst.amount_paise === 0 && c.sgst.amount_paise === 0 && c.igst.amount_paise === 0;
  if (c.igst.amount_paise > 0) rows.push({ id: "igst", label: t("admin.charge.igst"), amountPaise: c.igst.amount_paise });
  else if (!noGst) {
    rows.push({ id: "cgst", label: t("admin.charge.cgst"), amountPaise: c.cgst.amount_paise });
    rows.push({ id: "sgst", label: t("admin.charge.sgst"), amountPaise: c.sgst.amount_paise });
  }
  return { rows, noGst };
}

/** An open charge with something paid is "part paid" (the contract has open, paid, waived, cancelled). */
export function isPartPaid(c: Charge): boolean {
  return c.status === "open" && c.outstanding.amount_paise > 0 && c.outstanding.amount_paise < c.total.amount_paise;
}

/** Whole days past the due date for an open charge with something outstanding, else 0. */
export function overdueDays(c: Charge, today: string, daysBetween: (a: string, b: string) => number): number {
  if (c.status !== "open" || c.outstanding.amount_paise <= 0) return 0;
  const d = daysBetween(c.due_date, today);
  return d > 0 ? d : 0;
}
