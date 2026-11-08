/** Phone numbers are kept as digits only, international format, no plus (what WhatsApp and Evolution expect). */
export const DEFAULT_COUNTRY_CODE = '265'; // Malawi

export function normalizePhone(input: unknown, defaultCountry: string = DEFAULT_COUNTRY_CODE): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const plus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!plus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!plus && digits.startsWith('0')) digits = defaultCountry + digits.slice(1); // local format 0888 123 456
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  // Malawian numbers are +265 followed by 9 digits; reject obviously malformed ones instead of guessing.
  if (digits.startsWith(defaultCountry) && digits.length !== defaultCountry.length + 9) return null;
  return digits;
}

/** The phone number inside a WhatsApp JID, or null for groups and privacy (@lid) identifiers. */
export function jidToNumber(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const m = jid.match(/^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null;
}

export function maskNumber(number: string): string {
  return number.length <= 6 ? '***' : `${number.slice(0, 5)}***${number.slice(-2)}`;
}
