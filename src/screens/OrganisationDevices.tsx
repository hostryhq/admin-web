import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.organisationDevices; the real screen is built in the next wave. */
export function OrganisationDevices(): JSX.Element {
  return <Placeholder route={ROUTES.organisationDevices} />;
}
