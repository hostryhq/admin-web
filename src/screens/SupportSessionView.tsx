import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.supportSession; the real screen is built in the next wave. */
export function SupportSessionView(): JSX.Element {
  return <Placeholder route={ROUTES.supportSession} />;
}
