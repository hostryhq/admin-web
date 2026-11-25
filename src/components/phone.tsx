import { createUniqueId, omit, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * India-only mobile field: "+91" prefix plus 10 digits. Digits only, Western numerals. The value is
 * typed once here and is never shown again in full anywhere (masked after saving).
 */
export function PhoneField(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "type" | "value" | "onInput"> & {
    label: string;
    prefix: string;
    value: string;
    onValue: (digits: string) => void;
    error?: string | undefined;
  },
): JSX.Element {
  const id = createUniqueId();
  const rest = omit(props, "label", "prefix", "value", "onValue", "error", "id");
  return (
    <div class="hy-field">
      <label for={props.id ?? id}>{props.label}</label>
      <div class="hy-phone">
        <span class="hy-phone__prefix" aria-hidden="true">
          {props.prefix}
        </span>
        <input
          {...rest}
          id={props.id ?? id}
          class="hy-input"
          type="tel"
          inputmode="numeric"
          autocomplete="off"
          maxlength={10}
          value={props.value}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={props.error ? `${props.id ?? id}-error` : undefined}
          onInput={(e) => {
            const el = e.currentTarget as HTMLInputElement;
            const digits = el.value.replace(/\D/g, "").slice(0, 10);
            if (digits !== el.value) el.value = digits;
            props.onValue(digits);
          }}
        />
      </div>
      <Show when={props.error}>
        <span id={`${props.id ?? id}-error`} class="hy-field__error" role="alert">
          {props.error}
        </span>
      </Show>
    </div>
  );
}

/** A valid Indian mobile: 10 digits starting 6 to 9 (the contract's `^\+91[6-9][0-9]{9}$`). */
export function isIndianMobile(digits: string): boolean {
  return /^[6-9][0-9]{9}$/.test(digits);
}
