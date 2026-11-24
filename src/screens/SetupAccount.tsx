import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.setup; the real screen is built in the next wave. */
export function SetupAccount(): JSX.Element {
  return <Placeholder route={ROUTES.setup} />;
}
