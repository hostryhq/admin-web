import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.supportSessionEnded; the real screen is built in the next wave. */
export function SupportSessionEnded(): JSX.Element {
  return <Placeholder route={ROUTES.supportSessionEnded} />;
}
