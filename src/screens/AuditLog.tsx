import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.audit; the real screen is built in the next wave. */
export function AuditLog(): JSX.Element {
  return <Placeholder route={ROUTES.audit} />;
}
