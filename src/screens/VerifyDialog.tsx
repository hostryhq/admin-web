import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Dialog, InlineAlert, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { useWriteGuard } from "../components/common";
import { RadioGroup, TextArea } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";

type Method = components["schemas"]["VerificationMethod"];
const METHODS: Method[] = ["certificate_seen", "gst_portal_lookup", "other"];
const MIN_NOTE = 10;

/**
 * Verify a registration (A0-S17, AC 70-72): method, and a note of 10+ characters for "other". The
 * control is shown only to users with `admin.registration.verify`. A GSTIN verified by another
 * organisation is refused (`gstin_in_use`) and both registrations stay as they were.
 */
export function VerifyDialog(props: {
  open: boolean;
  organisationId: string;
  registration: components["schemas"]["DirectoryRegistration"];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} title={t("admin.registration.verify.title")} onClose={props.onClose} data-testid="verify-dialog">
      <VerifyForm {...props} />
    </Dialog>
  );
}

function VerifyForm(props: {
  organisationId: string;
  registration: components["schemas"]["DirectoryRegistration"];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [method, setMethod] = createSignal<Method>("certificate_seen");
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const key = newIntentKey();
  const valid = () => method() !== "other" || note().trim().length >= MIN_NOTE;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.PUT("/v1/organisations/{organisation_id}/tax-registrations/{registration_id}/verification", {
        params: { path: { organisation_id: props.organisationId, registration_id: props.registration.id }, header: mut(key) },
        body: { method: method(), ...(method() === "other" ? { note: note().trim() } : {}) },
      }),
    );
    setBusy(false);
    if (r.ok) {
      toasts.show(t("admin.registration.verified"));
      props.onDone();
      return;
    }
    setError(r.failure.code === "gstin_in_use" ? "admin.create.gstin.in_use" : "admin.error.generic");
  };

  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys}>
      <p>{props.registration.legal_name}</p>
      <RadioGroup
        legend={t("admin.registration.method")}
        name="method"
        value={method()}
        onChange={(v) => setMethod(v as Method)}
        options={METHODS.map((m) => ({ value: m, label: t(`admin.registration.method.${m}`) }))}
        data-testid="verify-method"
      />
      <Show when={method() === "other"}>
        <TextArea
          name="note"
          label={`${t("admin.registration.note")} *`}
          value={note()}
          counter={t("admin.common.min.chars", { n: note().trim().length, min: MIN_NOTE })}
          onInput={(e: InputEvent) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid="verify-note"
        />
      </Show>
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="verify-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-testid="verify-cancel">
          {t("admin.common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid() || busy() || guard.disabled()} data-testid="verify-submit">
          {t("admin.registration.verify")}
        </Button>
      </div>
    </form>
  );
}
