import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Dialog, InlineAlert, useI18n } from "@hostry/ui-kit";
import { useWriteGuard } from "./common";
import { formKeys } from "./formkeys";

/**
 * One-step confirmation (flows principle 4): the dialog states the effect and the confirm button is
 * the only step. `run` resolves to an i18n key to show as an error, or undefined on success (the
 * caller then closes). Initial focus is the safe button unless `focusConfirm` is set.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  run: () => Promise<string | undefined>;
  "data-testid"?: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onClose} data-testid={props["data-testid"]}>
      <Body {...props} />
    </Dialog>
  );
}

function Body(props: {
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  run: () => Promise<string | undefined>;
  "data-testid"?: string;
  children?: JSX.Element;
}): JSX.Element {
  const { t } = useI18n();
  const guard = useWriteGuard();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const id = () => props["data-testid"] ?? "confirm";

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || guard.disabled()) return;
    setBusy(true);
    const err = await props.run();
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys}>
      <p data-testid={`${id()}-body`}>{props.body}</p>
      {props.children}
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid={`${id()}-error`}>
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button data-autofocus data-testid={`${id()}-cancel`} onClick={props.onClose}>
          {t("admin.common.cancel")}
        </Button>
        <Button
          type="submit"
          variant={props.danger ? "danger" : "primary"}
          disabled={busy() || guard.disabled()}
          title={guard.title()}
          data-testid={`${id()}-confirm`}
        >
          {props.confirmLabel}
        </Button>
      </div>
    </form>
  );
}
