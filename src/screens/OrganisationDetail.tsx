import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.organisationDetail; the real screen is built in the next wave. */
export function OrganisationDetail(): JSX.Element {
  return <Placeholder route={ROUTES.organisationDetail} />;
}
