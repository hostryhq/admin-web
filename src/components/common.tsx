import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, EmptyState, InlineAlert, formatIst, useI18n } from "@hostry/ui-kit";
import type { Failure } from "../api/outcome";
import { useConnectivity } from "../shell/connectivity";

/** Times are stored UTC and shown IST with the suffix (flows principle 6). Western digits. */
export function ist(utc: string | undefined, withTime = true): string {
  if (!utc) return "";
  try {
    return `${formatIst(utc, withTime)} IST`;
  } catch {
    return "";
  }
}

/** IST wall-clock time only, for countdown ends and "ended at 11:32 IST". */
export function istTime(utc: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(utc))} IST`;
}

/** First 8 characters of an id (flows principle 6); the full id is in the title and the copy button. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Short id with a copy button. The clipboard gets the full id. */
export function CopyId(props: { id: string; "data-testid"?: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available: the full id is still in the title attribute */
    }
  };
  const tid = () => props["data-testid"] ?? "copyid";
  return (
    <span class="hy-copyid">
      <code class="hy-num" title={props.id} data-testid={tid()}>
        {shortId(props.id)}
      </code>
      <Button aria-label={t("admin.common.copy")} data-testid={`${tid()}-copy`} onClick={copy}>
        {copied() ? t("admin.common.copied") : t("admin.common.copy")}
      </Button>
    </span>
  );
}

/** Skeleton rows or blocks while a read is in flight (no bare spinner). */
export function SkeletonBlock(props: { rows?: number; "data-testid"?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class="hy-stack" aria-busy="true" aria-label={t("admin.common.loading")} data-testid={props["data-testid"] ?? "loading"}>
      <For each={Array.from({ length: props.rows ?? 3 }, (_, i) => i)}>{() => <div class="hy-skeleton hy-skeleton--line" />}</For>
    </div>
  );
}

/** What the user is told for a failed read. Server text is never shown; the status picks the key. */
export function failureKey(f: Failure | undefined): string {
  if (!f) return "admin.error.generic";
  if (f.network) return "admin.error.network";
  if (f.status === 503) return "admin.error.upstream";
  if (f.status === 404) return "admin.error.notfound.item";
  if (f.status === 403) return "admin.error.forbidden";
  return "admin.error.generic";
}

/** Error with Retry, no partial data (flows 2.2). */
export function ErrorState(props: { failure: Failure | undefined; onRetry: () => void; "data-testid"?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <InlineAlert
      kind="danger"
      data-testid={props["data-testid"] ?? "error"}
      actions={
        <Button data-testid={`${props["data-testid"] ?? "error"}-retry`} onClick={props.onRetry}>
          {t("admin.common.retry")}
        </Button>
      }
    >
      {t(failureKey(props.failure))}
    </InlineAlert>
  );
}

/** "Stale, loaded 10:42 IST" while offline or unreachable (flows section 1). */
export function StaleTag(props: { at: number | undefined }): JSX.Element {
  const { t } = useI18n();
  const conn = useConnectivity();
  return (
    <Show when={conn.reason() !== undefined && props.at !== undefined}>
      <span class="hy-hint" data-testid="stale-tag">
        {t("admin.offline.stale", { time: istTime(new Date(props.at ?? 0).toISOString()).replace(" IST", "") })}
      </span>
    </Show>
  );
}

export function Empty(props: { title: string; description?: string; children?: JSX.Element; "data-testid"?: string }): JSX.Element {
  return (
    <EmptyState title={props.title} {...(props.description ? { description: props.description } : {})} data-testid={props["data-testid"]}>
      {props.children}
    </EmptyState>
  );
}

/** Label/value rows (a `dl`). */
export function DescriptionList(props: { rows: { label: string; value: JSX.Element; testid?: string }[] }): JSX.Element {
  return (
    <dl class="hy-dl">
      <For each={props.rows}>
        {(r) => (
          <>
            <dt>{r.label}</dt>
            <dd data-testid={r.testid}>{r.value}</dd>
          </>
        )}
      </For>
    </dl>
  );
}

/** Tooltip text on a write control while the network is down (flows section 1). */
export function useWriteGuard(): { disabled: () => boolean; title: () => string | undefined } {
  const { t } = useI18n();
  const conn = useConnectivity();
  return { disabled: () => conn.writesDisabled(), title: () => (conn.writesDisabled() ? t("admin.offline.needs") : undefined) };
}
