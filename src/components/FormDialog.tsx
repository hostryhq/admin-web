import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Dialog, InlineAlert, useI18n } from "@hostry/ui-kit";
import { useWriteGuard } from "./common";
import { formKeys, newIntentKey } from "./formkeys";

/** Automatic checks, with the same idempotency key, after a dropped answer (flows 0, "result unknown, checking"). */
export const writeRetry = { delayMs: 1500, max: 3 };

/** A write whose answer was lost may be repeated (same key) even while the connection is flagged down. */
export const UNKNOWN = "admin.write.unknown";

type Props = {
  open: boolean;
  title: string;
  submitLabel: string;
  danger?: boolean;
  /** False keeps the submit button disabled. */
  valid?: boolean;
  onClose: () => void;
  /** Resolves to an i18n error key, or undefined on success. */
  onSubmit: (idempotencyKey: string) => Promise<string | undefined>;
  /** When set, replaces the form (after a successful submit) with this result and a Close button. */
  done?: JSX.Element;
  "data-testid": string;
  children?: JSX.Element;
};

/**
 * One dialog, one confirmation (flows principle 7): the form's own submit is the confirmation and
 * Ctrl+Enter submits; a plain Enter in a single-line field does not. `onSubmit` receives the intent's
 * idempotency key (new per opening, reused for every retry of the same intent) and resolves to an i18n
 * error key, or undefined on success (the caller then closes, or sets `done` to show the result).
 * When the answer never arrives the dialog says "Result unknown, checking", repeats the request with the
 * same key a few times, and if that fails leaves the button enabled so the person can try again: the
 * service returns the first answer instead of writing twice. Writes are disabled offline (BR-70) and
 * while one is in flight (AC 43).
 */
export function FormDialog(props: Props): JSX.Element {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onClose} data-testid={props["data-testid"]}>
      <Body {...props} />
    </Dialog>
  );
}

function Body(props: Props): JSX.Element {
  const { t } = useI18n();
  const guard = useWriteGuard();
  const key = newIntentKey();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const id = props["data-testid"];
  const ok = () => props.valid !== false;
  const blocked = () => guard.disabled() && error() !== UNKNOWN;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !ok() || blocked()) return;
    setBusy(true);
    setError(undefined);
    let err = await props.onSubmit(key);
    for (let n = 0; err === UNKNOWN && n < writeRetry.max; n++) {
      setError("admin.write.checking");
      await new Promise((r) => setTimeout(r, writeRetry.delayMs));
      err = await props.onSubmit(key);
    }
    setBusy(false);
    setError(err);
  };

  return (
    <Show
      when={props.done}
      fallback={
        <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
          {props.children}
          <Show when={error()}>
            <InlineAlert kind={error() === UNKNOWN || error() === "admin.write.checking" ? "warning" : "danger"} data-testid={`${id}-error`}>
              {t(error() ?? "")}
            </InlineAlert>
          </Show>
          <div class="hy-actions">
            <Button onClick={props.onClose} data-testid={`${id}-cancel`}>
              {t("admin.common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={props.danger ? "danger" : "primary"}
              disabled={!ok() || busy() || blocked()}
              title={guard.title()}
              data-testid={`${id}-submit`}
            >
              {props.submitLabel}
            </Button>
          </div>
        </form>
      }
    >
      <div class="hy-stack" data-testid={`${id}-done`}>
        {props.done}
        <div class="hy-actions">
          <Button variant="primary" data-autofocus data-testid={`${id}-close`} onClick={props.onClose}>
            {t("admin.common.close")}
          </Button>
        </div>
      </div>
    </Show>
  );
}
