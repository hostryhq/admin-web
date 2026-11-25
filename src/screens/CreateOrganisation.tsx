import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, Dialog, InlineAlert, Input, PageHeader, WizardStepper, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { fieldErrors, outcome, type Failure } from "../api/outcome";
import { useWriteGuard } from "../components/common";
import { RadioGroup, Select, TextArea } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";
import { isIndianMobile, PhoneField } from "../components/phone";
import { STATES } from "../data/states";
import { ROUTES } from "../routes";
import { hasPermission, SessionContext } from "../session/session";
import { rememberCreation } from "./creationStore";

type Schemas = components["schemas"];
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const OUTLET_KINDS: Schemas["OutletKind"][] = ["restaurant", "bakery_outlet", "production_unit", "stall", "property", "service_point"];
const REGIMES: Schemas["TaxRegime"][] = ["regular", "composition", "unregistered"];
const VERIFY_METHODS: Schemas["VerificationMethod"][] = ["certificate_seen", "gst_portal_lookup", "other"];
/** Automatic checks, with the same key, after a network drop (flows 2.3 "result unknown"). */
export const timing = { retryDelayMs: 1500 };
export const MAX_RETRIES = 3;

type Form = {
  name: string;
  outletName: string;
  outletKind: string;
  stateCode: string;
  legalName: string;
  regime: string;
  gstin: string;
  ownerName: string;
  ownerMobile: string;
  verifyMethod: string;
  verifyNote: string;
};
const EMPTY: Form = {
  name: "",
  outletName: "",
  outletKind: "restaurant",
  stateCode: "",
  legalName: "",
  regime: "regular",
  gstin: "",
  ownerName: "",
  ownerMobile: "",
  verifyMethod: "",
  verifyNote: "",
};

/** Maps a server field path to the form field it belongs to. */
const SERVER_FIELD: Record<string, keyof Form> = {
  name: "name",
  "outlet.name": "outletName",
  "outlet.kind": "outletKind",
  "outlet.state_code": "stateCode",
  "tax_registration.legal_name": "legalName",
  "tax_registration.regime": "regime",
  "tax_registration.gstin": "gstin",
  "owner.name": "ownerName",
  "owner.mobile_e164": "ownerMobile",
  "verification.method": "verifyMethod",
  "verification.note": "verifyNote",
};
const KNOWN_CODES = new Set(["gstin_state_mismatch", "gstin_invalid", "gstin_in_use", "unregistered_with_gstin", "mobile_invalid"]);

/**
 * Screen 7: one form, three sections, one submit (AC 22). Required fields are marked; validation is
 * inline on blur and on submit; Ctrl+Enter submits and Esc leaves (asking once if anything was typed).
 * The submit is disabled while in flight so a double click creates one organisation; one idempotency
 * key is made per distinct request body and reused for retries, including the automatic check after a
 * network drop (AC 23, 81). `unregistered` clears and disables the GSTIN (AC 24, 25). The "GSTIN
 * verified" section exists only for users with `admin.registration.verify` (AC 75).
 */
export function CreateOrganisation(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const canVerify = () => hasPermission(state.session(), "admin.registration.verify");

  const [f, setF] = createSignal<Form>({ ...EMPTY });
  const [touched, setTouched] = createSignal<Partial<Record<keyof Form, boolean>>>({});
  const [submitted, setSubmitted] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [serverErrors, setServerErrors] = createSignal<Partial<Record<keyof Form, string>>>({});
  const [formError, setFormError] = createSignal<string | undefined>();
  const [discardOpen, setDiscardOpen] = createSignal(false);
  const [duplicate, setDuplicate] = createSignal<{ id: string } | undefined>();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((cur) => ({ ...cur, [k]: v }));
    setServerErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const blur = (k: keyof Form) => setTouched((s) => ({ ...s, [k]: true }));
  const dirty = () => JSON.stringify(f()) !== JSON.stringify(EMPTY);

  const gstinRequired = () => f().regime !== "unregistered";

  const clientErrors = (): Partial<Record<keyof Form, string>> => {
    const v = f();
    const e: Partial<Record<keyof Form, string>> = {};
    const req = (k: keyof Form, val: string) => {
      if (val.trim() === "") e[k] = "admin.create.error.required";
    };
    req("name", v.name);
    req("outletName", v.outletName);
    req("stateCode", v.stateCode);
    req("legalName", v.legalName);
    req("ownerName", v.ownerName);
    if (v.ownerMobile === "") e.ownerMobile = "admin.create.error.required";
    else if (!isIndianMobile(v.ownerMobile)) e.ownerMobile = "admin.create.mobile.invalid";
    if (gstinRequired()) {
      if (v.gstin === "") e.gstin = "admin.create.error.required";
      else if (!GSTIN_PATTERN.test(v.gstin)) e.gstin = "admin.create.gstin.invalid";
      else if (v.stateCode && v.gstin.slice(0, 2) !== v.stateCode) e.gstin = "admin.create.error.gstin_state_mismatch";
    }
    if (canVerify() && v.verifyMethod === "other" && v.verifyNote.trim().length < 10) e.verifyNote = "admin.create.error.note";
    return e;
  };
  const errorFor = (k: keyof Form): string | undefined => {
    const server = serverErrors()[k];
    if (server) return t(server);
    const c = clientErrors()[k];
    return c && (touched()[k] || submitted()) ? t(c) : undefined;
  };
  const valid = () => Object.keys(clientErrors()).length === 0;

  const body = (): Schemas["CreateOrganisationForm"] => {
    const v = f();
    return {
      name: v.name.trim(),
      outlet: { name: v.outletName.trim(), kind: v.outletKind as Schemas["OutletKind"], state_code: v.stateCode },
      tax_registration: {
        legal_name: v.legalName.trim(),
        regime: v.regime as Schemas["TaxRegime"],
        ...(v.regime !== "unregistered" ? { gstin: v.gstin } : {}),
      },
      ...(canVerify() && v.verifyMethod
        ? {
            verification: {
              method: v.verifyMethod as Schemas["VerificationMethod"],
              ...(v.verifyMethod === "other" ? { note: v.verifyNote.trim() } : {}),
            },
          }
        : {}),
      owner: { name: v.ownerName.trim(), mobile_e164: `+91${v.ownerMobile}` },
    };
  };

  // One key per distinct request body; the same key is reused for every retry of that body.
  let keyFor = { fingerprint: "", key: "" };
  const intentKey = (fingerprint: string) => {
    if (keyFor.fingerprint !== fingerprint) keyFor = { fingerprint, key: newIntentKey() };
    return keyFor.key;
  };

  const applyFailure = (fail: Failure) => {
    const mapped: Partial<Record<keyof Form, string>> = {};
    for (const [field, code] of Object.entries(fieldErrors(fail))) {
      const target = SERVER_FIELD[field];
      if (target) mapped[target] = KNOWN_CODES.has(code) ? `admin.create.error.${code}` : "admin.create.error.invalid";
    }
    if (fail.code === "gstin_in_use") mapped.gstin = "admin.create.gstin.in_use";
    setServerErrors(mapped);
    if (Object.keys(mapped).length === 0) {
      setFormError(fail.status === 503 ? "admin.error.upstream" : fail.status === 403 ? "admin.error.forbidden" : "admin.error.generic");
    } else setFormError(undefined);
  };

  const send = async (attempt: number): Promise<void> => {
    const payload = body();
    const r = await outcome(
      api.POST("/v1/organisations", {
        params: { header: mut(intentKey(JSON.stringify(payload))) },
        body: payload,
      }),
    );
    if (r.ok) {
      setBusy(false);
      setChecking(false);
      rememberCreation(r.data);
      navigate(ROUTES.organisationCreated.path.replace(":orgId", r.data.created.organisation.id));
      return;
    }
    if (r.failure.network && attempt < MAX_RETRIES) {
      setChecking(true);
      await new Promise((res) => setTimeout(res, timing.retryDelayMs));
      return send(attempt + 1);
    }
    setBusy(false);
    setChecking(false);
    if (r.failure.network) setFormError("admin.error.network");
    else applyFailure(r.failure);
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || guard.disabled()) return;
    setSubmitted(true);
    setFormError(undefined);
    if (!valid()) return;
    setBusy(true);
    await send(0);
  };

  const checkDuplicate = async () => {
    blur("name");
    const name = f().name.trim();
    if (!name) {
      setDuplicate(undefined);
      return;
    }
    const r = await outcome(api.GET("/v1/organisations", { params: { query: { q: name, limit: 5 } } }));
    const hit = r.ok ? r.data.items.find((o) => o.name.toLowerCase() === name.toLowerCase()) : undefined;
    setDuplicate(hit ? { id: hit.id } : undefined);
  };

  const leave = () => (dirty() ? setDiscardOpen(true) : navigate(ROUTES.organisations.path));
  const onKeyDown = (e: KeyboardEvent) => {
    formKeys(e);
    if (e.key === "Escape" && !discardOpen()) {
      e.preventDefault();
      leave();
    }
  };

  const err = () => !!formError();
  const stateOptions = () => [
    { value: "", label: t("admin.create.choose") },
    ...STATES.map(([code]) => ({ value: code, label: t(`admin.state.${code}`) })),
  ];

  return (
    <>
      <PageHeader title={t("admin.create.title")} />
      <WizardStepper
        label={t("admin.wizard.title")}
        steps={[
          { id: "org", label: t("admin.wizard.step.org"), status: "current" },
          { id: "gstin", label: t("admin.wizard.step.gstin"), status: "next" },
          { id: "plan", label: t("admin.wizard.step.plan"), status: "next" },
          { id: "golive", label: t("admin.wizard.step.golive"), status: "next" },
        ]}
        onOpen={() => undefined}
      />
      <p class="hy-hint">{t("admin.wizard.stepof", { n: 1 })}</p>
      <p class="hy-hint">{t("admin.create.required.note")}</p>
      <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={onKeyDown} novalidate data-testid="create-form">
        <Show when={(submitted() && !valid()) || err()}>
          <InlineAlert kind="danger" data-testid="create-summary">
            {t(err() ? (formError() ?? "") : "admin.create.summary")}
          </InlineAlert>
        </Show>

        <fieldset class="hy-section">
          <legend>{`1 ${t("admin.create.section.org")}`}</legend>
          <Input
            name="name"
            required
            autocomplete="off"
            label={`${t("admin.create.org.name")} *`}
            value={f().name}
            error={errorFor("name")}
            onInput={(e: InputEvent) => set("name", (e.currentTarget as HTMLInputElement).value)}
            onBlur={checkDuplicate}
            data-testid="create-name"
          />
          <Show when={duplicate()}>
            {(d) => (
              <InlineAlert kind="warning" data-testid="create-duplicate">
                {t("admin.create.duplicate")}{" "}
                <a href={ROUTES.organisationDetail.path.replace(":orgId", d().id)} data-testid="create-duplicate-link">
                  {t("admin.create.duplicate.view")}
                </a>
              </InlineAlert>
            )}
          </Show>
          <Input
            name="outlet-name"
            required
            autocomplete="off"
            label={`${t("admin.create.outlet.name")} *`}
            value={f().outletName}
            error={errorFor("outletName")}
            onInput={(e: InputEvent) => set("outletName", (e.currentTarget as HTMLInputElement).value)}
            onBlur={() => blur("outletName")}
            data-testid="create-outlet-name"
          />
          <Select
            name="outlet-kind"
            label={`${t("admin.create.outlet.kind")} *`}
            options={OUTLET_KINDS.map((k) => ({ value: k, label: t(`admin.create.kind.${k}`) }))}
            value={f().outletKind}
            onChange={(e: Event) => set("outletKind", (e.currentTarget as HTMLSelectElement).value)}
            data-testid="create-outlet-kind"
          />
          <Select
            name="outlet-state"
            required
            label={`${t("admin.create.outlet.state")} *`}
            options={stateOptions()}
            value={f().stateCode}
            error={errorFor("stateCode")}
            onChange={(e: Event) => set("stateCode", (e.currentTarget as HTMLSelectElement).value)}
            onBlur={() => blur("stateCode")}
            data-testid="create-outlet-state"
          />
        </fieldset>

        <fieldset class="hy-section">
          <legend>{`2 ${t("admin.create.section.tax")}`}</legend>
          <Input
            name="legal-name"
            required
            autocomplete="off"
            label={`${t("admin.create.tax.legalname")} *`}
            value={f().legalName}
            error={errorFor("legalName")}
            onInput={(e: InputEvent) => set("legalName", (e.currentTarget as HTMLInputElement).value)}
            onBlur={() => blur("legalName")}
            data-testid="create-legal-name"
          />
          <RadioGroup
            legend={`${t("admin.create.tax.regime")} *`}
            name="regime"
            value={f().regime}
            onChange={(v) => {
              set("regime", v);
              if (v === "unregistered") set("gstin", "");
            }}
            options={REGIMES.map((r) => ({ value: r, label: t(`admin.create.regime.${r}`) }))}
            data-testid="create-regime"
          />
          <Input
            name="gstin"
            autocomplete="off"
            maxlength={15}
            disabled={!gstinRequired()}
            label={`${t("admin.create.gstin")}${gstinRequired() ? " *" : ""}`}
            value={f().gstin}
            error={errorFor("gstin")}
            onInput={(e: InputEvent) => {
              const el = e.currentTarget as HTMLInputElement;
              const up = el.value.toUpperCase().replace(/\s/g, "");
              if (up !== el.value) el.value = up;
              set("gstin", up);
            }}
            onBlur={() => blur("gstin")}
            data-testid="create-gstin"
          />
          <p class="hy-hint">{gstinRequired() ? t("admin.create.gstin.help") : t("admin.create.gstin.unregistered")}</p>
          <Show when={canVerify()}>
            <div class="hy-stack" data-testid="create-verify-section">
              <Select
                name="verify-method"
                label={t("admin.create.verified.method")}
                options={[
                  { value: "", label: t("admin.create.verified.none") },
                  ...VERIFY_METHODS.map((m) => ({ value: m, label: t(`admin.registration.method.${m}`) })),
                ]}
                value={f().verifyMethod}
                onChange={(e: Event) => set("verifyMethod", (e.currentTarget as HTMLSelectElement).value)}
                data-testid="create-verify-method"
              />
              <Show when={f().verifyMethod === "other"}>
                <TextArea
                  name="verify-note"
                  label={`${t("admin.registration.note")} *`}
                  value={f().verifyNote}
                  error={errorFor("verifyNote")}
                  onInput={(e: InputEvent) => set("verifyNote", (e.currentTarget as HTMLTextAreaElement).value)}
                  onBlur={() => blur("verifyNote")}
                  data-testid="create-verify-note"
                />
              </Show>
            </div>
          </Show>
        </fieldset>

        <fieldset class="hy-section">
          <legend>{`3 ${t("admin.create.section.owner")}`}</legend>
          <Input
            name="owner-name"
            required
            autocomplete="off"
            label={`${t("admin.create.owner.name")} *`}
            value={f().ownerName}
            error={errorFor("ownerName")}
            onInput={(e: InputEvent) => set("ownerName", (e.currentTarget as HTMLInputElement).value)}
            onBlur={() => blur("ownerName")}
            data-testid="create-owner-name"
          />
          <PhoneField
            name="owner-mobile"
            required
            label={`${t("admin.create.owner.mobile")} *`}
            prefix="+91"
            value={f().ownerMobile}
            error={errorFor("ownerMobile")}
            onValue={(d) => set("ownerMobile", d)}
            onBlur={() => blur("ownerMobile")}
            data-testid="create-owner-mobile"
          />
          <p class="hy-hint">{t("admin.create.owner.mobile.help")}</p>
        </fieldset>

        <Show when={checking()}>
          <InlineAlert kind="info" data-testid="create-checking">
            {t("admin.create.checking")}
          </InlineAlert>
        </Show>
        <div class="hy-actions">
          <Button data-testid="create-cancel" onClick={leave}>
            {t("admin.common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy() || guard.disabled()} title={guard.title()} data-testid="create-submit">
            {busy() ? t("admin.create.submitting") : t("admin.create.submit")}
          </Button>
        </div>
      </form>

      <Dialog open={discardOpen()} title={t("admin.create.discard.title")} onClose={() => setDiscardOpen(false)} data-testid="create-discard-dialog">
        <div class="hy-stack">
          <p>{t("admin.create.discard.body")}</p>
          <div class="hy-actions">
            <Button data-autofocus data-testid="create-discard-keep" onClick={() => setDiscardOpen(false)}>
              {t("admin.create.discard.keep")}
            </Button>
            <Button variant="danger" data-testid="create-discard-confirm" onClick={() => navigate(ROUTES.organisations.path)}>
              {t("admin.create.discard.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
