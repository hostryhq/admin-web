import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, DateField, InlineAlert, PageHeader, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { outcome } from "../../api/outcome";
import { addDays, todayIst } from "../../components/dates";
import { useWriteGuard } from "../../components/common";

/** First day of the month of an IST business date. */
function monthStart(d: string): string {
  return `${d.slice(0, 8)}01`;
}

/**
 * AS16: ledger CSV export (A1-S14, Should; AC 60). Needs `admin.report.ledger`. The file has
 * organisation ids and names only, no GSTIN, phone or email, and every export is audited by the
 * service. The summary tables of the design (subscriptions by plan, payments by month) have no API in
 * this contract, so they are not drawn; the work lists carry the reconciled overdue totals.
 */
export function LedgerReports(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [from, setFrom] = createSignal(monthStart(todayIst()));
  const [to, setTo] = createSignal(todayIst());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [done, setDone] = createSignal(false);
  const valid = () => from() !== "" && to() >= from();

  const download = async () => {
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    setDone(false);
    const r = await outcome(api.GET("/v1/ledger-exports", { params: { query: { from: from(), to: to() } }, parseAs: "text" }));
    setBusy(false);
    if (!r.ok) {
      setError(writeError(r.failure));
      return;
    }
    const blob = new Blob([String(r.data)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${from()}-to-${to()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
  };

  return (
    <>
      <PageHeader title={t("admin.ledger.title")} />
      <form class="hy-stack" onSubmit={(e: SubmitEvent) => e.preventDefault()} data-testid="ledger-form">
        <div class="hy-filterbar">
          <DateField label={t("admin.ledger.from")} value={from()} max={addDays(todayIst(), 0)} onChange={setFrom} data-testid="ledger-from" />
          <DateField label={t("admin.ledger.to")} value={to()} max={todayIst()} onChange={setTo} data-testid="ledger-to" />
        </div>
        <p class="hy-hint">{t("admin.ledger.csv.note")}</p>
        <Show when={error()}>
          <InlineAlert kind="danger" data-testid="ledger-error">
            {t(error() ?? "")}
          </InlineAlert>
        </Show>
        <Show when={done()}>
          <InlineAlert kind="success" data-testid="ledger-done">
            {t("admin.ledger.done")}
          </InlineAlert>
        </Show>
        <div class="hy-actions">
          <Button variant="primary" disabled={!valid() || busy() || guard.disabled()} title={guard.title()} data-testid="ledger-export" onClick={download}>
            {t("admin.ledger.csv")}
          </Button>
        </div>
      </form>
    </>
  );
}
