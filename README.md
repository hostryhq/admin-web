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

`src/generated/` is the admin contract's TypeScript types, copied from `api-specs` (never hand-edited): `pnpm gen:api` runs `scripts/sync-api-types.mjs`, which copies `../api-specs/gen/ts/admin.d.ts` (`API_SPECS_DIR` overrides; `--generate` runs `make generate-ts` in api-specs first). Same approach as client-core. Last synced from api-specs branch `feat/phase1-service-specs` (with the approval operations). The typed client is `client-core`'s `createApiClient` plus the CSRF header and 401 handling in `src/api/client.ts`.

## Layout

- `src/routes.ts`: route table (screen numbers from `docs/design/admin-a0-flows.md`; screen 16 is the approvals queue), per-route permission, nav entries.
- `src/router.tsx`: `createAdminRouter`; every A0 screen is a route. Dialogs (screens 9, 11, 13) have no route.
- `src/screens/`: one file per screen (`SignIn`, `SetupAccount`, `SessionEnded`, `VendorStaff`, `OrganisationList`, `OrganisationDetail` + `InvitationCard` + `VerifyDialog`, `CreateOrganisation`, `CreationResult`, `OrganisationDevices` + `RevokeDialog`, `AuditLog`, `StartSupportDialog`, `SupportSessionView`, `SupportSessionEnded`, `Approvals`).
- `src/shell/`: `AdminLayout` (nav, offline banner, idle warning, toasts, shortcut sheet), `SupportBanner` (fixed banner with countdown while a support session is open), `idle.ts`, `connectivity.ts`, `shortcuts.ts`, `support.ts`.
- `src/api/`: `client.ts` (typed client, no Authorization header), `outcome.ts` (calls return facts, never exceptions; server text is never shown), `query.ts` (loading / ready / error with Retry), `headers.ts`, `context.tsx`.
- `src/components/`: `Select`, `TextArea`, `RadioGroup`, `PhoneField`, `ConfirmDialog`, badges and small helpers the ui-kit scaffold does not have yet (they move to ui-kit with its Phase 2 set).
- `src/session/`: the session shape the backend reports and `hasPermission`. Hiding a control is a convenience; the server re-checks every call.
- `src/i18n/en.ts`: English catalogue (`admin.*` keys); A0 is English only. `catalogue.test.ts` fails if a key used in the source is missing.

Interactive elements carry `data-testid` named `<screen>-<element>` for `ui-tester`.

## Tests

Component and integration tests mount the whole app on a memory history against **a recording of the svc-admin double**, not against Go. `scripts/record-double.mjs` calls every operation on the running double (which serves the spec's own examples and applies the session, CSRF, Origin and Idempotency rules) and writes `src/test/fixtures/admin-double.json`; `src/test/mockAdmin.ts` replays it with the same rules, and a test overrides one operation to drive a state (a refusal, a 503, every device state). CI therefore needs neither Go nor the private svc-admin repository. Re-record after a contract change (`node scripts/record-double.mjs http://127.0.0.1:18431`); the JSON diff is the contract change made visible.

`src/test/live-double.test.ts` runs the generated client and the whole app against the real double process; it is skipped unless `ADMIN_DOUBLE_URL` is set:

```
ADMIN_DOUBLE_URL=http://127.0.0.1:18431 pnpm vitest run src/test/live-double.test.ts
```

## Known gaps (contract or ui-kit, tracked in the work package report)

- No "has unverified registration" filter on the list (the list operation has no such parameter), AC 73/74.
- The staff record has no last sign-in or "can approve from" date, so those two columns are not shown (AC 69).
- The approval record has no `reason`, so the approvals queue does not show it (AC 90).
- The member record has no "new device" caution (AC 96).
- No QR image on account setup (needs a ui-kit `QrCode`); the authenticator key is shown to type in.
- Audit rows expand inline with a plain table; ui-kit's `DataTable` has no expandable rows yet.
