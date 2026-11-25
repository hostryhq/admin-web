import { createUniqueId, For, omit, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * Small form controls the ui-kit scaffold does not have yet (Select, TextArea, RadioGroup).
 * They reuse the ui-kit classes (`hy-field`, `hy-input`) so they look the same; they move to
 * ui-kit when its Phase 2 component set lands (noted in the work package report).
 */

export type Option = { value: string; label: string };

function FieldError(props: { id: string; error?: string | undefined }): JSX.Element {
  return (
    <Show when={props.error}>
      <span id={props.id} class="hy-field__error" role="alert">
        {props.error}
      </span>
    </Show>
  );
}

export function Select(
  props: Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "class" | "children"> & {
    label: string;
    options: Option[];
    error?: string | undefined;
  },
): JSX.Element {
  const id = createUniqueId();
  const rest = omit(props, "label", "options", "error", "id");
  return (
    <div class="hy-field">
      <label for={props.id ?? id}>{props.label}</label>
      <select
        {...rest}
        id={props.id ?? id}
        class="hy-input"
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${props.id ?? id}-error` : undefined}
      >
        <For each={props.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
      </select>
      <FieldError id={`${props.id ?? id}-error`} error={props.error} />
    </div>
  );
}

export function TextArea(
  props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class"> & {
    label: string;
    error?: string | undefined;
    /** Already-translated counter text, for example "3/10". */
    counter?: string;
  },
): JSX.Element {
  const id = createUniqueId();
  const rest = omit(props, "label", "error", "id", "counter");
  return (
    <div class="hy-field">
      <label for={props.id ?? id}>{props.label}</label>
      <textarea
        {...rest}
        id={props.id ?? id}
        class="hy-input"
        rows={props.rows ?? 3}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${props.id ?? id}-error` : undefined}
      />
      <Show when={props.counter}>
        <span class="hy-hint hy-num">{props.counter}</span>
      </Show>
      <FieldError id={`${props.id ?? id}-error`} error={props.error} />
    </div>
  );
}

export function RadioGroup(props: {
  /** Already-translated group label. */
  legend: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  "data-testid"?: string;
  error?: string | undefined;
}): JSX.Element {
  return (
    <fieldset class="hy-fieldset" data-testid={props["data-testid"]}>
      <legend>{props.legend}</legend>
      <For each={props.options}>
        {(o) => (
          <label class="hy-radio">
            <input
              type="radio"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
              data-testid={`${props["data-testid"] ?? props.name}-${o.value}`}
            />
            <span>{o.label}</span>
          </label>
        )}
      </For>
      <Show when={props.error}>
        <span class="hy-field__error" role="alert">
          {props.error}
        </span>
      </Show>
    </fieldset>
  );
}
