/**
 * Visual design of every Tambala document. This is the one place to change how PDFs look.
 * The default follows the brand palette (navy, blue #2563eb, cyan #38bdf8) with a drawn "TT" monogram.
 * When the final quotation design arrives, change the tokens here and the layout in renderer.ts.
 */
export interface DocDesign {
  colors: { navy: string; primary: string; accent: string; text: string; muted: string; line: string; stripe: string; white: string; success: string };
  fonts: { regular: string; bold: string; mono: string };
  /** Optional PNG/JPG logo as base64. When absent, the geometric TT monogram is drawn. */
  logoBase64: string | null;
  margin: number;
  company: { name: string; tagline: string; address: string; phone: string; email: string; website: string; tpin: string };
  paymentInstructions: string;
  footerNote: string;
}

const env = (name: string, fallback = ''): string => (process.env[name] ?? fallback).trim();

export function loadDesign(): DocDesign {
  return {
    colors: { navy: '#0b1220', primary: '#2563eb', accent: '#38bdf8', text: '#0f172a', muted: '#64748b', line: '#e2e8f0', stripe: '#f1f5f9', white: '#ffffff', success: '#16a34a' },
    fonts: { regular: 'Helvetica', bold: 'Helvetica-Bold', mono: 'Courier' },
    logoBase64: env('TAMBALA_DOC_LOGO_BASE64') || null,
    margin: 48,
    company: {
      name: env('TAMBALA_COMPANY_NAME', 'Tambala Technologies Limited'),
      tagline: env('TAMBALA_COMPANY_TAGLINE', 'Software and digital solutions'),
      address: env('TAMBALA_COMPANY_ADDRESS', 'Ntcheu, Malawi'),
      phone: env('TAMBALA_COMPANY_PHONE'), email: env('TAMBALA_COMPANY_EMAIL'), website: env('TAMBALA_COMPANY_WEBSITE'), tpin: env('TAMBALA_COMPANY_TPIN'),
    },
    paymentInstructions: env('TAMBALA_PAYMENT_INSTRUCTIONS'),
    footerNote: env('TAMBALA_DOC_FOOTER', 'Thank you for choosing Tambala Technologies.'),
  };
}
