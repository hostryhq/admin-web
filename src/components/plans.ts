/** Display name of a plan: its `name_key` when the catalogue has it, else the key made readable ("table_service" -> "Table service"). */
export function planName(t: (k: string) => string, plan: { key: string; name_key: string }): string {
  const s = t(plan.name_key);
  if (s !== plan.name_key) return s;
  const words = plan.key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
