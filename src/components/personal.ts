/**
 * The ledger holds no personal data (BR-A1-38): a note that looks like an email address or a phone
 * number is refused with a field message before it is sent (AC 58). The server checks too.
 */
export function looksPersonal(text: string): boolean {
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return true;
  const digits = text.replace(/[\s().-]/g, "");
  return /\+?\d{10,}/.test(digits);
}
