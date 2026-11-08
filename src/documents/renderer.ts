import PDFDocument from 'pdfkit';
import { formatMoney, KIND_TITLE, type StoredDocument } from './model.js';
import type { DocDesign } from './design.js';

export interface Signer { employeeNumber: string; title: string; fingerprint: string | null }

/** The built-in PDF fonts only cover Windows-1252. Anything else would print as garbage, so map it to '?'. */
export function pdfSafe(input: string): string {
  const extras = new Set('\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u2022\u20AC\u2122');
  return Array.from(input.normalize('NFC')).map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || extras.has(ch)) return ch;
    return '?';
  }).join('');
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Blantyre' });

export function renderDocument(doc: StoredDocument, design: DocDesign, signer: Signer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const c = design.colors;
    const m = design.margin;
    const pdf = new PDFDocument({ size: 'A4', margin: m, bufferPages: true, info: { Title: `${KIND_TITLE[doc.kind]} ${doc.number}`, Author: design.company.name, Creator: 'Tambala MCP' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (d: Buffer) => chunks.push(d));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const W = pdf.page.width; const right = W - m; const contentW = W - m * 2;
    const t = (s: string) => pdfSafe(s);

    // ---- header band ----
    pdf.rect(0, 0, W, 112).fill(c.navy);
    pdf.rect(0, 112, W, 4).fill(c.accent);
    if (design.logoBase64) {
      try { pdf.image(Buffer.from(design.logoBase64, 'base64'), m, 28, { fit: [56, 56] }); } catch { /* fall back to the monogram below */ }
    } else {
      pdf.roundedRect(m, 28, 56, 56, 10).fill(c.primary);
      pdf.fillColor(c.white).font(design.fonts.bold).fontSize(26).text('TT', m, 44, { width: 56, align: 'center', lineBreak: false });
    }
    pdf.fillColor(c.white).font(design.fonts.bold).fontSize(15).text(t(design.company.name), m + 70, 34, { lineBreak: false });
    pdf.fillColor(c.accent).font(design.fonts.regular).fontSize(9).text(t(design.company.tagline), m + 70, 55, { lineBreak: false });
    const contact = [design.company.address, design.company.phone, design.company.email, design.company.website].filter(Boolean).join('  ·  ');
    pdf.fillColor('#94a3b8').fontSize(8).text(t(contact), m + 70, 70, { width: 300, lineBreak: false });
    pdf.fillColor(c.white).font(design.fonts.bold).fontSize(22).text(KIND_TITLE[doc.kind], right - 200, 30, { width: 200, align: 'right', lineBreak: false });
    pdf.fillColor(c.accent).font(design.fonts.mono).fontSize(10).text(doc.number, right - 200, 60, { width: 200, align: 'right', lineBreak: false });

    // ---- parties and details ----
    let y = 140;
    pdf.fillColor(c.muted).font(design.fonts.bold).fontSize(8).text(doc.kind === 'letter' ? 'TO' : 'PREPARED FOR', m, y, { lineBreak: false });
    pdf.fillColor(c.text).font(design.fonts.bold).fontSize(12).text(t(doc.client.name), m, y + 13, { width: 260 });
    pdf.font(design.fonts.regular).fontSize(9).fillColor(c.muted);
    for (const line of [doc.client.business, doc.client.address, doc.client.phone, doc.client.email].filter(Boolean) as string[]) pdf.text(t(line), m, pdf.y + 1, { width: 260 });
    const leftEnd = pdf.y;
    const rows: [string, string][] = [['Date', fmtDate(doc.issuedAt)]];
    if (doc.validUntil) rows.push(['Valid until', fmtDate(doc.validUntil)]);
    if (doc.reference) rows.push(['Reference', doc.reference]);
    if (design.company.tpin) rows.push(['TPIN', design.company.tpin]);
    let ry = y;
    for (const [k, v] of rows) {
      pdf.fillColor(c.muted).font(design.fonts.bold).fontSize(8).text(k.toUpperCase(), right - 200, ry, { width: 80, lineBreak: false });
      pdf.fillColor(c.text).font(design.fonts.regular).fontSize(9).text(t(v), right - 115, ry, { width: 115, align: 'right', lineBreak: false });
      ry += 16;
    }
    y = Math.max(leftEnd, ry) + 18;

    // ---- letter body ----
    if (doc.kind === 'letter') {
      if (doc.subject) { pdf.fillColor(c.text).font(design.fonts.bold).fontSize(12).text(t(doc.subject), m, y, { width: contentW }); y = pdf.y + 10; }
      pdf.fillColor(c.text).font(design.fonts.regular).fontSize(10).text(t(doc.body ?? ''), m, y, { width: contentW, lineGap: 3, align: 'left' });
      y = pdf.y + 16;
    } else {
      // ---- items table ----
      if (doc.subject) { pdf.fillColor(c.text).font(design.fonts.bold).fontSize(11).text(t(doc.subject), m, y, { width: contentW }); y = pdf.y + 8; }
      const col = { no: m + 8, desc: m + 34, qty: right - 230, unit: right - 168, amt: right - 84 };
      const header = (yy: number) => {
        pdf.rect(m, yy, contentW, 22).fill(c.navy);
        pdf.fillColor(c.white).font(design.fonts.bold).fontSize(8);
        pdf.text('#', col.no, yy + 7, { lineBreak: false });
        pdf.text('DESCRIPTION', col.desc, yy + 7, { lineBreak: false });
        pdf.text('QTY', col.qty, yy + 7, { width: 50, align: 'right', lineBreak: false });
        pdf.text('UNIT PRICE', col.unit, yy + 7, { width: 78, align: 'right', lineBreak: false });
        pdf.text('AMOUNT', col.amt, yy + 7, { width: 84 - 8, align: 'right', lineBreak: false });
        return yy + 22;
      };
      y = header(y);
      doc.items.forEach((item, i) => {
        const descH = pdf.font(design.fonts.regular).fontSize(9).heightOfString(t(item.description), { width: col.qty - col.desc - 10 });
        const rowH = Math.max(24, descH + 12);
        if (y + rowH > pdf.page.height - 190) { pdf.addPage(); y = header(m); }
        if (i % 2 === 0) pdf.rect(m, y, contentW, rowH).fill(c.stripe);
        pdf.font(design.fonts.regular).fontSize(9);
        pdf.fillColor(c.muted).text(String(i + 1), col.no, y + 7, { lineBreak: false });
        pdf.fillColor(c.text).text(t(item.description), col.desc, y + 7, { width: col.qty - col.desc - 10 });
        pdf.fillColor(c.text).text(String(item.quantity), col.qty, y + 7, { width: 50, align: 'right', lineBreak: false });
        pdf.text(formatMoney(item.unitPriceMinor, doc.currency).replace(`${doc.currency} `, ''), col.unit, y + 7, { width: 78, align: 'right', lineBreak: false });
        pdf.font(design.fonts.bold).text(formatMoney(item.amountMinor, doc.currency).replace(`${doc.currency} `, ''), col.amt, y + 7, { width: 76, align: 'right', lineBreak: false });
        y += rowH;
      });
      pdf.moveTo(m, y).lineTo(right, y).lineWidth(0.5).strokeColor(c.line).stroke();
      y += 14;

      // ---- totals ----
      if (y > pdf.page.height - 200) { pdf.addPage(); y = m; }
      const tx = right - 230;
      const line = (label: string, value: string, bold = false) => {
        pdf.fillColor(c.muted).font(design.fonts.regular).fontSize(9).text(label, tx, y, { width: 110, lineBreak: false });
        pdf.fillColor(c.text).font(bold ? design.fonts.bold : design.fonts.regular).text(value, tx + 100, y, { width: 130, align: 'right', lineBreak: false });
        y += 16;
      };
      line('Subtotal', formatMoney(doc.totals.subtotalMinor, doc.currency));
      if (doc.totals.vatPercent > 0) line(`VAT (${doc.totals.vatPercent}%)`, formatMoney(doc.totals.vatMinor, doc.currency));
      pdf.rect(tx - 8, y - 2, 238, 28).fill(c.primary);
      pdf.fillColor(c.white).font(design.fonts.bold).fontSize(10).text(doc.kind === 'receipt' ? 'AMOUNT RECEIVED' : 'TOTAL', tx, y + 8, { width: 110, lineBreak: false });
      pdf.fontSize(12).text(formatMoney(doc.totals.totalMinor, doc.currency), tx + 32, y + 7, { width: 190, align: 'right', lineBreak: false });
      y += 42;
      if (doc.kind === 'receipt') {
        pdf.fillColor(c.success).font(design.fonts.bold).fontSize(11).text(`PAID${doc.paidAt ? ` · ${fmtDate(doc.paidAt)}` : ''}${doc.paidVia ? ` · ${doc.paidVia}` : ''}`, m, y - 36, { lineBreak: false });
      }
    }

    // ---- notes, terms, payment ----
    const block = (title: string, body: string) => {
      if (y > pdf.page.height - 150) { pdf.addPage(); y = m; }
      pdf.fillColor(c.muted).font(design.fonts.bold).fontSize(8).text(title, m, y, { lineBreak: false });
      pdf.fillColor(c.text).font(design.fonts.regular).fontSize(9).text(t(body), m, y + 12, { width: contentW, lineGap: 2 });
      y = pdf.y + 12;
    };
    if (doc.notes) block('NOTES', doc.notes);
    if (doc.terms) block('TERMS', doc.terms);
    if (doc.paymentLink && doc.kind !== 'receipt') {
      if (y > pdf.page.height - 150) { pdf.addPage(); y = m; }
      pdf.fillColor(c.muted).font(design.fonts.bold).fontSize(8).text('PAY ONLINE', m, y, { lineBreak: false });
      pdf.fillColor(c.primary).font(design.fonts.regular).fontSize(9).text(doc.paymentLink, m, y + 12, { width: contentW, link: doc.paymentLink, underline: true });
      y = pdf.y + 12;
    }
    if (design.paymentInstructions && doc.kind !== 'receipt' && doc.kind !== 'letter') block('PAYMENT DETAILS', design.paymentInstructions);

    // ---- signature block ----
    if (y > pdf.page.height - 130) { pdf.addPage(); y = m; }
    const sy = pdf.page.height - 118;
    pdf.moveTo(m, sy).lineTo(m + 230, sy).lineWidth(0.6).strokeColor(c.line).stroke();
    pdf.fillColor(c.text).font(design.fonts.bold).fontSize(9).text(`${signer.employeeNumber}  ${t(signer.title)}`, m, sy + 6, { width: 300, lineBreak: false });
    pdf.fillColor(c.muted).font(design.fonts.mono).fontSize(8).text(signer.fingerprint ? `Signature ${signer.fingerprint}` : 'UNSIGNED (signing is not configured)', m, sy + 20, { width: 330, lineBreak: false });
    pdf.fillColor(c.muted).font(design.fonts.regular).fontSize(7).text('Verify this signature in the Tambala Control Centre.', m, sy + 32, { width: 330, lineBreak: false });

    // ---- footer on every page ----
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      pdf.switchToPage(range.start + i);
      pdf.page.margins.bottom = 0; // otherwise writing in the footer area would spawn an extra blank page
      pdf.rect(0, pdf.page.height - 40, W, 40).fill(c.navy);
      pdf.fillColor('#94a3b8').font(design.fonts.regular).fontSize(8).text(t(design.footerNote), m, pdf.page.height - 26, { width: contentW - 80, lineBreak: false });
      pdf.fillColor(c.accent).text(`Page ${i + 1} of ${range.count}`, right - 80, pdf.page.height - 26, { width: 80, align: 'right', lineBreak: false });
    }
    pdf.end();
  });
}
