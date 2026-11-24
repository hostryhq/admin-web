import { createTranslator, en as uiEn, type Translator } from "@hostry/ui-kit";
import { en } from "./en";

/** One translator for the app: ui-kit strings and admin strings, English only in A0. */
export function createAppTranslator(): Translator {
  return createTranslator({ en: { ...uiEn, ...en } }, "en");
}

export { en };
