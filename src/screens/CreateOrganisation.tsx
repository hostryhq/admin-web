import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.organisationNew; the real screen is built in the next wave. */
export function CreateOrganisation(): JSX.Element {
  return <Placeholder route={ROUTES.organisationNew} />;
}
