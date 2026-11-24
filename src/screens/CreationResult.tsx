import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.organisationCreated; the real screen is built in the next wave. */
export function CreationResult(): JSX.Element {
  return <Placeholder route={ROUTES.organisationCreated} />;
}
