/**
 * GST state and union-territory codes (two digits) with names. Reference data for the outlet state
 * select and for the "GSTIN state code matches the outlet state" hint; the server validates. Names
 * go through the i18n catalogue (`admin.state.<code>`), so they can be translated later.
 */
export const STATES: readonly (readonly [code: string, name: string])[] = [
  ["01", "Jammu and Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
];

/** Catalogue entries `admin.state.<code>` merged into en.ts. */
export const STATE_MESSAGES: Record<string, string> = Object.fromEntries(STATES.map(([code, name]) => [`admin.state.${code}`, name]));

/** Display name for a state code, falling back to the code itself for one not in the table. */
export function stateName(code: string, t: (key: string) => string): string {
  return STATES.some(([c]) => c === code) ? t(`admin.state.${code}`) : code;
}
