# admin-web

Hostry platform admin panel (vendor side). Browser-only SolidJS 2.0 app, built as static files and served from the same origin as the `admin` backend (ADR-0013 V6): no Tauri, no local database, no offline queue, and **no token in the browser**. The backend holds tokens; the browser carries a same-origin session cookie (`__Host-` prefixed, HttpOnly) and the app sends the per-session CSRF token (`X-CSRF-Token`, held in memory only) on every state-changing call.

## Run

`ui-kit` and `client-core` are consumed through `link:` dependencies (sibling folders, not published yet). Build them first.

```
(cd ../ui-kit && pnpm install && pnpm build)
(cd ../client-core && pnpm install && pnpm build)
pnpm install
pnpm dev                    # Vite; /v1 is proxied to ADMIN_API_URL (default http://127.0.0.1:8080)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Against the svc-admin test double (a local process, no real services). The pre-authenticated seed session is the cookie `__Host-hostry-admin=double-seed-session`; sign-in accounts are in the double's `cmd/admin-double/main.go` header.

```
(cd ../svc-admin && go run ./cmd/admin-double -addr 127.0.0.1:18431 -static ../admin-web/dist)
```

The double's cookie is `Secure` and `__Host-` prefixed, which most browsers accept only over https or on `localhost`: open `http://localhost:18431` (not 127.0.0.1) and sign in with the double's platform-admin account. Not yet checked in a browser by this work package (`ui-tester` does that).

## API types

`src/generated/` is the admin contract's TypeScript types, copied from `api-specs` (never hand-edited): `pnpm gen:api` runs `scripts/sync-api-types.mjs`, which copies `../api-specs/gen/ts/admin.d.ts` (`API_SPECS_DIR` overrides; `--generate` runs `make generate-ts` in api-specs first). Same approach as client-core. Last synced from api-specs-p2 branch `feat/phase2-specs` at `1462fb8` (`API_SPECS_DIR=../api-specs-p2 pnpm gen:api`): the 74-operation Phase 2 admin contract. The typed client is `client-core`'s `createApiClient` plus the CSRF header and 401 handling in `src/api/client.ts`.

CI pins the sibling ui-kit to `feat/phase2-components` (`.github/workflows/ci.yml`); the A1 screens use its `WizardStepper`, `MoneyField`, `BasisPointField`, `DateField`, `AmountBreakdown`, `InvoiceRefField`, `RuleGrid`, `DiffList`, `ChecklistPanel`, `StatTile`, `Panel`, `OneTimeReveal`, `CheckRow`. ui-kit still has no `Select`, `TextArea`, `RadioGroup`, `PhoneField` or `ConfirmDialog`, so the local ones in `src/components/` stay.

## Layout

- `src/routes.ts`: route table (A0 screen numbers from `docs/design/admin-a0-flows.md`; A1 screens AS01 to AS24 are 101 to 124 in `admin-a1-flows.md`), per-route permission, nav entries.
- `src/router.tsx`: `createAdminRouter`; every screen is a route. Dialogs (A0 9, 11, 13; A1 AS11, AS13, AS14, AS19, AS20, AS22) have no route.
- `src/screens/a1/`: the Admin A1 screens. Onboarding: `OnboardingBoard` (AS01), `UnverifiedQueue` (AS04), `WizardFrame` + `GstinStep` (AS03) + `PlanStep` (AS05) + `GoLive` (AS06); AS02 is A0's `CreateOrganisation` inside the wizard stepper. Plans: `Plans` (AS07), `PlanEditor` (AS08), `BillingConfig` (AS09). Billing: `OrgSubscription` (AS10), `RaiseChargeDialog` (AS11), `OrgCharges` + `ChargeDetail` (AS12), `PaymentDialogs` (AS13, AS14), `WorkLists` (AS15), `LedgerReports` (AS16). Tax rules: `TaxRules` (AS17), `RuleSetEditor` (AS18 to AS20, rules in `ruleset.ts`). `LifecycleDialog` (AS22), `MenuLoading` (AS23), `SignInCodes` (AS24). AS21 is `src/screens/Approvals.tsx` (approval execution in `a1/approvalExec.ts`).
- `src/screens/`: one file per screen (`SignIn`, `SetupAccount`, `SessionEnded`, `VendorStaff`, `OrganisationList`, `OrganisationDetail` + `InvitationCard` + `VerifyDialog`, `CreateOrganisation`, `CreationResult`, `OrganisationDevices` + `RevokeDialog`, `AuditLog`, `StartSupportDialog`, `SupportSessionView`, `SupportSessionEnded`, `Approvals`).
- `src/shell/`: `AdminLayout` (nav, offline banner, idle warning, toasts, shortcut sheet), `SupportBanner` (fixed banner with countdown while a support session is open), `idle.ts`, `connectivity.ts`, `shortcuts.ts`, `support.ts`.
- `src/api/`: `client.ts` (typed client, no Authorization header), `outcome.ts` (calls return facts, never exceptions; server text is never shown), `query.ts` (loading / ready / error with Retry), `headers.ts`, `context.tsx`.
- `src/components/`: `Select`, `TextArea`, `RadioGroup`, `PhoneField`, `ConfirmDialog` (not in ui-kit yet), `FormDialog` (one dialog, one confirmation, with "result unknown, checking" retries on the same idempotency key), badges, date and countdown helpers.
- `src/session/`: the session shape the backend reports and `hasPermission`. Hiding a control is a convenience; the server re-checks every call.
- `src/i18n/en.ts`: English catalogue (`admin.*` keys); A0 is English only. `catalogue.test.ts` fails if a key used in the source is missing.

Interactive elements carry `data-testid` named `<screen>-<element>` for `ui-tester`.

## Tests

Component and integration tests mount the whole app on a memory history against **a recording of the svc-admin double**, not against Go. `scripts/record-double.mjs` calls every operation on the running double (which serves the spec's own examples and applies the session, CSRF, Origin and Idempotency rules) and writes `src/test/fixtures/admin-double.json`; `src/test/mockAdmin.ts` replays it with the same rules, and a test overrides one operation to drive a state (a refusal, a 503, every device state). CI therefore needs neither Go nor the private svc-admin repository. Re-record after a contract change (`node scripts/record-double.mjs http://127.0.0.1:18431`); the JSON diff is the contract change made visible.

`src/test/live-double.test.ts` and `live-double-a1.test.ts` run the generated client and the whole app against the real double process; they are skipped unless `ADMIN_DOUBLE_URL` is set. The recording covers all 74 operations; the double remembers executed approvals, so restart it between recordings:

```
ADMIN_DOUBLE_URL=http://127.0.0.1:18431 pnpm vitest run src/test/live-double.test.ts src/test/live-double-a1.test.ts
```

## Known gaps (contract or ui-kit, tracked in the work package report)

Admin A1 (the contract has no operation for these, so the screen shows what exists and says so):
- No raise-charge preview operation: the GST split is shown from the stored result right after the write (and on the charge), not before it (P2D-11; ADR needed: preview or dry-run).
- No go-live reads for C7 to C9 (first bill synced, first day closed, first payment): the checklist shows them as Unknown and never says an organisation is live. The board derives "not live" from a trial status and the first unmet item from the list and the unverified filter (no plan column).
- No cross-organisation charge search, no subscription count per plan version, no payments-by-month or subscriptions-by-plan report (only the CSV and the work lists), no plan add-on pricing (add-ons are shown, not offered), no review date on a pilot subscription, no edit call for a draft plan version (a draft is activated as saved or replaced).
- No owner-code or menu-import operation (AS23 requests an act session and shows the disabled notice on `mode_not_supported`); no approval count badge in the nav.
- The ledger has one `reason` field, so a credit-note number typed on Reverse or Cancel is kept inside the reason text.

Admin A0:
- The staff record has no last sign-in date, so that column is not shown (AC 69).
- The member record has no "new device" caution (AC 96).
- No QR image on account setup (needs a ui-kit `QrCode`); the authenticator key is shown to type in.
- Audit rows expand inline with a plain table; ui-kit's `DataTable` has no expandable rows yet.
