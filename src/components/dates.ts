/** Business date `YYYY-MM-DD` shown as "8 Dec 2026" (no time zone shift: it is a date, not an instant). */
export function fmtDate(d: string | undefined): string {
  if (!d) return "";
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) return d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(t));
}

/** Today's business date in IST as `YYYY-MM-DD`. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `YYYY-MM-DD` plus whole days (calendar arithmetic in UTC, which is exact for dates). */
export function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The last day of the period that starts on `start`: one month or one year later, minus a day. */
export function periodEnd(start: string, cycle: "monthly" | "annual"): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const months = cycle === "annual" ? 12 : 1;
  const next = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(d, last));
  return addDays(next.toISOString().slice(0, 10), -1);
}
