import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.organisations; the real screen is built in the next wave. */
export function OrganisationList(): JSX.Element {
  return <Placeholder route={ROUTES.organisations} />;
}
