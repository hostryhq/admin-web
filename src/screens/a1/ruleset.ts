import type { ChecklistItem, DiffRow } from "@hostry/ui-kit";
import type { components } from "../../generated";

type S = components["schemas"];
export type TaxRule = S["TaxRule"];

/** The rate columns of the grid; document type, applicability and SAC are shown in the row label. */
export const RATE_COLUMNS = ["cgst_bp", "sgst_bp", "igst_bp"] as const;
export type RateColumn = (typeof RATE_COLUMNS)[number];

export const LEAD_HOURS = 24;

export const rowId = (i: number): string => `r${i}`;
export const rowIndex = (id: string): number => Number(id.slice(1));

/** What a rule is a mapping FOR: class, regime, specified-premises flag and channel. */
export function identity(r: TaxRule): string {
  return [r.tax_class, r.regime, r.specified_premises ? "premises" : "plain", r.order_channel].join("|");
}

export function ruleLabel(r: TaxRule, t: (k: string) => string): string {
  const parts = [r.tax_class, t(`admin.create.regime.${r.regime}`), t(r.specified_premises ? "admin.ruleset.premises.yes" : "admin.ruleset.premises.no"), t(`admin.ruleset.channel.${r.order_channel}`), t(`admin.ruleset.doc.${r.doc_type}`)];
  if (r.sac) parts.push(r.sac);
  return parts.join(" / ");
}

/** Grid values keyed `rowId:column`. */
export function gridValues(rules: readonly TaxRule[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  rules.forEach((r, i) => {
    for (const c of RATE_COLUMNS) out[`${rowId(i)}:${c}`] = r[c];
  });
  return out;
}

/** The version in force, matched row by row on identity, as grid values; a new mapping has no previous value. */
export function previousGrid(rules: readonly TaxRule[], previous: readonly TaxRule[] | undefined): Record<string, number | undefined> | undefined {
  if (!previous) return undefined;
  const byId = new Map(previous.map((p) => [identity(p), p]));
  const out: Record<string, number | undefined> = {};
  rules.forEach((r, i) => {
    const p = byId.get(identity(r));
    for (const c of RATE_COLUMNS) out[`${rowId(i)}:${c}`] = p ? p[c] : undefined;
  });
  return out;
}

/** One cell edit. A cleared or invalid cell (undefined) keeps the old value and is left to validation. */
export function applyEdit(rules: readonly TaxRule[], row: string, col: string, bp: number | undefined): TaxRule[] {
  const i = rowIndex(row);
  return rules.map((r, k) => (k === i && bp !== undefined && (RATE_COLUMNS as readonly string[]).includes(col) ? { ...r, [col]: bp } : r));
}

/** Changed or new mappings against the version in force, as before/after lines for the publication dialog. */
export function diffRows(rules: readonly TaxRule[], previous: readonly TaxRule[] | undefined, t: (k: string) => string): DiffRow[] {
  const byId = new Map((previous ?? []).map((p) => [identity(p), p]));
  const rows: DiffRow[] = [];
  rules.forEach((r, i) => {
    const p = byId.get(identity(r));
    for (const c of RATE_COLUMNS) {
      const before = p ? String(p[c]) : t("admin.ruleset.diff.new");
      const after = String(r[c]);
      if (before !== after) rows.push({ id: `${rowId(i)}-${c}`, label: `${ruleLabel(r, t)} - ${t(`admin.ruleset.col.${c}`)}`, before, after });
    }
  });
  return rows;
}

/** Row indexes whose CGST and SGST are not equal halves (checked in the browser only to point at the row; the service decides). */
export function unequalHalves(rules: readonly TaxRule[]): number[] {
  return rules.flatMap((r, i) => (r.cgst_bp !== r.sgst_bp ? [i] : []));
}

/** The earliest effective moment a publication may be requested for: 24 hours after `now`. */
export function earliestEffective(now: Date): Date {
  return new Date(now.getTime() + LEAD_HOURS * 3_600_000);
}

/** The effective date takes effect at 00:00 IST; it must be at least the lead time ahead of `now`. */
export function leadTimeOk(effectiveDate: string, now: Date): boolean {
  return Date.parse(`${effectiveDate}T00:00:00+05:30`) >= earliestEffective(now).getTime();
}

export type CheckId = "mapping" | "halves" | "integer" | "vectors";
const GROUP: [CheckId, RegExp][] = [
  ["mapping", /mapping|missing|coverage/i],
  ["halves", /half|equal|cgst_sgst|component/i],
  ["integer", /integer|whole|basis/i],
  ["vectors", /vector|conformance/i],
];

/** Groups the service's validation errors into the four named checks (BR-A1-82); unmatched ones are returned as `other`. */
export function checkResults(v: S["TaxRuleSetValidation"]): { byCheck: Record<CheckId, string[]>; other: string[] } {
  const byCheck: Record<CheckId, string[]> = { mapping: [], halves: [], integer: [], vectors: [] };
  const other: string[] = [];
  for (const e of v.errors) {
    const hit = GROUP.find(([, re]) => re.test(e.code));
    if (hit) byCheck[hit[0]].push(e.detail);
    else other.push(e.detail);
  }
  if (v.vectors_passed < v.vectors_total && byCheck.vectors.length === 0) byCheck.vectors.push("");
  return { byCheck, other };
}

export function checkItems(v: S["TaxRuleSetValidation"], t: (k: string, p?: Record<string, string | number>) => string): ChecklistItem[] {
  const { byCheck, other } = checkResults(v);
  const item = (id: CheckId, label: string, extra?: string): ChecklistItem => {
    const bad = byCheck[id];
    const detail = [extra, ...bad.filter(Boolean)].filter(Boolean).join(" ");
    return { id, label, status: bad.length > 0 ? "blocking" : "done", ...(detail ? { detail } : {}) };
  };
  const items = [
    item("mapping", t("admin.ruleset.check.mapping")),
    item("halves", t("admin.ruleset.check.halves")),
    item("integer", t("admin.ruleset.check.integer")),
    item("vectors", t("admin.ruleset.check.vectors"), t("admin.ruleset.check.vectors.count", { n: v.vectors_passed, m: v.vectors_total })),
  ];
  if (other.length > 0) items.push({ id: "other", label: t("admin.ruleset.check.other"), status: "blocking", detail: other.join(" ") });
  return items;
}
