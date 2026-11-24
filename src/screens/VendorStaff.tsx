import type { JSX } from "@solidjs/web";
import { ROUTES } from "../routes";
import { Placeholder } from "./Placeholder";

/** Placeholder for ROUTES.staff; the real screen is built in the next wave. */
export function VendorStaff(): JSX.Element {
  return <Placeholder route={ROUTES.staff} />;
}
