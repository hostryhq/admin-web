/** "23 h 40 min", "12 min" or "Expired" for the time left until an RFC 3339 instant. Western digits. */
export function remainingText(untilUtc: string, now: number = Date.now()): { expired: boolean; h: number; min: number } {
  const ms = Date.parse(untilUtc) - now;
  if (Number.isNaN(ms) || ms <= 0) return { expired: true, h: 0, min: 0 };
  const totalMin = Math.ceil(ms / 60_000);
  return { expired: false, h: Math.floor(totalMin / 60), min: totalMin % 60 };
}

export function remainingLabel(t: (k: string, p?: Record<string, string | number>) => string, untilUtc: string, now: number = Date.now()): string {
  const r = remainingText(untilUtc, now);
  if (r.expired) return t("admin.approvals.expired");
  return r.h > 0 ? t("admin.approvals.remaining.hm", { h: r.h, m: r.min }) : t("admin.approvals.remaining.m", { m: r.min });
}
