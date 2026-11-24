# admin-web

Hostry platform admin panel (vendor side). Browser-only SolidJS 2.0 app, built as static files and served from the same origin as the `admin` backend (ADR-0013 V6): no Tauri, no local database, no offline queue, and **no token in the browser**. The backend holds tokens; the browser carries a same-origin session cookie.

## Run

`ui-kit` and `client-core` are consumed through `link:` dependencies (sibling folders, not published yet). Build them first.

```
(cd ../ui-kit && pnpm install && pnpm build)
(cd ../client-core && pnpm install && pnpm build)
pnpm install
pnpm dev                    # Vite; /v1 is proxied to ADMIN_API_URL (default http://127.0.0.1:8080, the svc-admin double)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

In `pnpm dev` only, a development session with every A0 permission is created so placeholder screens can be seen; set `VITE_DEV_PERMISSIONS=admin.org.read,...` to try a smaller role. Production builds have no such session.

## Layout

- `src/routes.ts`: route table (screen numbers from `docs/design/admin-a0-flows.md`), per-route permission, nav entries.
- `src/router.tsx`: `createAdminRouter`; every A0 screen is a route. Dialogs (screens 9, 11, 13) have no route.
- `src/screens/`: one file per screen. `SignIn` (layout and generic error path) and `SessionEnded` are real; the rest are `Placeholder`s replaced in the next wave.
- `src/shell/`: `AdminLayout` (nav, offline banner, idle warning, toasts, shortcut sheet), `idle.ts` (28 min warning, 30 min sign-out, 12 h limit), `connectivity.ts` (offline / server unreachable), `shortcuts.ts` (global keyboard map).
- `src/session/`: the session shape the backend reports and `hasPermission`. Hiding a control is a convenience; the server re-checks every call.
- `src/api/client.ts`: typed client over `client-core` with no Authorization header.
- `src/i18n/en.ts`: English catalogue (`admin.*` keys). A0 is English only.

Interactive elements carry `data-testid` named `<screen>-<element>` for `ui-tester`.
