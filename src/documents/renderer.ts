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


function renderQuotation(doc: StoredDocument, design: DocDesign, signer: Signer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `QUOTATION ${doc.reference ?? doc.number}`, Author: design.company.name, Creator: 'Tambala MCP' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (d: Buffer) => chunks.push(d));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const W = pdf.page.width; const H = pdf.page.height; const m = 48; const right = W - m; const cw = W - 2 * m;
    const c = design.colors; const safe = (s: string) => pdfSafe(s);
    const line = (x1: number, y1: number, x2: number, y2: number) => pdf.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.55).strokeColor(c.line).stroke();
    const header = (page: number) => {
      pdf.rect(0, 0, W, 31).fill(c.navy);
      pdf.fillColor(c.white).font('Helvetica-Bold').fontSize(8).text('TAMBALA TECHNOLOGIES | SOFTWARE DEVELOPMENT & DIGITAL SOLUTIONS', m, 11, { lineBreak: false });
      pdf.fillColor(c.white).font('Helvetica').fontSize(8).text(`Page ${page}`, right - 55, 11, { width: 55, align: 'right', lineBreak: false });
    };
    const sectionTitle = (n: number, title: string, y: number) => {
      pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(10).text(`${n}. ${safe(title)}`, m, y, { width: cw });
      return pdf.y + 5;
    };
    const overview = doc.sections?.find(s => /project overview/i.test(s.title))?.body ?? doc.notes ?? 'Tambala Technologies is pleased to submit this quotation for the project described below.';
    const scopeIntro = doc.sections?.find(s => /scope/i.test(s.title))?.body;
    const supportIntro = doc.sections?.find(s => /management|support/i.test(s.title))?.body;
    const terms = doc.termsBullets?.length ? doc.termsBullets : (doc.terms ?? '').split(/\n+/).map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
    const milestones = doc.milestones ?? [{ label: 'Upon acceptance and commencement', percentage: 50 }, { label: 'Upon presentation of the working system for review', percentage: 30 }, { label: 'Upon final acceptance and handover', percentage: 20 }];
    const money = (v: number) => formatMoney(v, doc.currency);
    const date = (v: string) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Blantyre' });
    const drawTableHeader = (y: number, widths: number[], labels: string[]) => {
      pdf.rect(m, y, cw, 20).fill('#eef2f7');
      let x = m + 7;
      labels.forEach((label, i) => { pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(7.5).text(label, x, y + 6, { width: widths[i] - 10, lineBreak: false, align: i === labels.length - 1 ? 'right' : 'left' }); x += widths[i]; });
      return y + 20;
    };
    // PAGE 1 — project, scope, support and payment heading.
    header(1);
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(20).text('QUOTATION', m, 53, { lineBreak: false });
    pdf.fillColor(c.muted).font('Helvetica').fontSize(8.5).text(`Ref: ${safe(doc.reference ?? doc.number)}\nDate: ${date(doc.issuedAt)}`, right - 190, 54, { width: 190, align: 'right', lineGap: 4 });
    let y = 112;
    const partyW = (cw - 28) / 2;
    pdf.fillColor(c.muted).font('Helvetica-Bold').fontSize(7.5).text('PREPARED FOR', m, y, { lineBreak: false });
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(10).text(safe(doc.client.name), m, y + 13, { width: partyW });
    pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(safe([doc.client.business, doc.client.address].filter(Boolean).join(' · ')), m, y + 27, { width: partyW });
    pdf.fillColor(c.muted).font('Helvetica-Bold').fontSize(7.5).text('PREPARED BY', m + partyW + 28, y, { lineBreak: false });
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(10).text(safe(design.company.name), m + partyW + 28, y + 13, { width: partyW });
    pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(safe(design.company.tagline), m + partyW + 28, y + 27, { width: partyW });
    y += 57;
    pdf.fillColor(c.muted).font('Helvetica-Bold').fontSize(7.5).text('PROJECT', m, y, { lineBreak: false });
    pdf.fillColor(c.navy).font('Helvetica').fontSize(9).text(safe(doc.project ?? doc.subject ?? 'Software development and implementation'), m, y + 12, { width: partyW });
    pdf.fillColor(c.muted).font('Helvetica-Bold').fontSize(7.5).text('VALIDITY', m + partyW + 28, y, { lineBreak: false });
    pdf.fillColor(c.navy).font('Helvetica').fontSize(9).text('30 days from date of issue', m + partyW + 28, y + 12, { width: partyW });
    y += 49;
    y = sectionTitle(1, 'Project Overview', y);
    pdf.fillColor(c.text).font('Helvetica').fontSize(8.4).text(safe(overview), m, y, { width: cw, lineGap: 2, height: 58 });
    y = pdf.y + 10;
    y = sectionTitle(2, 'Scope of Work and Development Costs', y);
    if (scopeIntro) { pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(safe(scopeIntro), m, y, { width: cw }); y = pdf.y + 5; }
    const widths = [145, cw - 145 - 94, 94];
    y = drawTableHeader(y, widths, ['Work component', 'Description', 'Amount (MWK)']);
    doc.items.forEach((item, i) => {
      pdf.font('Helvetica').fontSize(7.6);
      const descH = pdf.heightOfString(safe(item.description), { width: widths[1] - 12, lineGap: 1 });
      const rowH = Math.max(22, descH + 9);
      if (i % 2 === 0) pdf.rect(m, y, cw, rowH).fill('#f8fafc');
      pdf.fillColor(c.text).font('Helvetica-Bold').fontSize(7.6).text(safe(item.description), m + 7, y + 6, { width: widths[0] - 12 });
      pdf.font('Helvetica').fontSize(7.6).text(safe(item.description), m + widths[0] + 6, y + 6, { width: widths[1] - 12 });
      pdf.font('Helvetica').fontSize(7.6).text(money(item.amountMinor), m + widths[0] + widths[1], y + 6, { width: widths[2] - 7, align: 'right', lineBreak: false });
      y += rowH; line(m, y, right, y);
    });
    pdf.rect(m, y, cw, 23).fill('#e8eef6');
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(8.5).text('TOTAL', m + 7, y + 7, { lineBreak: false });
    pdf.text(money(doc.totals.totalMinor), right - 145, y + 7, { width: 138, align: 'right', lineBreak: false });
    y += 32;
    y = sectionTitle(3, 'Ongoing System Management and Support', y);
    if (supportIntro) { pdf.fillColor(c.text).font('Helvetica').fontSize(7.8).text(safe(supportIntro), m, y, { width: cw }); y = pdf.y + 4; }
    const fees = doc.recurringFees ?? [];
    const feeWidths = [cw - 125, 125];
    y = drawTableHeader(y, feeWidths, ['Management service', 'Monthly fee']);
    fees.forEach((fee, i) => {
      const value = fee.included ? 'Included' : money(fee.amountMinor ?? 0);
      pdf.fillColor(c.text).font('Helvetica').fontSize(7.5).text(safe(fee.description), m + 7, y + 5, { width: feeWidths[0] - 12 });
      pdf.text(value, m + feeWidths[0], y + 5, { width: feeWidths[1] - 8, align: 'right', lineBreak: false });
      y += 17; line(m, y, right, y);
    });
    const monthly = fees.filter(f => !f.included).reduce((sum, f) => sum + (f.amountMinor ?? 0), 0);
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(8).text('MONTHLY MANAGEMENT FEE', m + 7, y + 6, { lineBreak: false });
    pdf.text(monthly ? money(monthly) : 'As agreed separately', right - 180, y + 6, { width: 173, align: 'right', lineBreak: false });
    y += 25;
    sectionTitle(4, 'Payment Terms', y);
    // PAGE 2 — milestones, conditions and acceptance.
    pdf.addPage({ size: 'A4', margin: 0 });
    header(2);
    y = 61;
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(10).text('4. Payment Terms', m, y, { lineBreak: false });
    y += 23;
    const intro = `The one-time development fee of ${money(doc.totals.totalMinor)} is proposed to be paid as follows:`;
    pdf.fillColor(c.text).font('Helvetica').fontSize(8.5).text(safe(intro), m, y, { width: cw });
    y = pdf.y + 10;
    const mw = [cw - 180, 72, 108];
    y = drawTableHeader(y, mw, ['Milestone', 'Share', 'Amount (MWK)']);
    let allocated = 0;
    milestones.forEach((milestone, i) => {
      const amount = i === milestones.length - 1 ? doc.totals.totalMinor - allocated : Math.round(doc.totals.totalMinor * milestone.percentage / 100);
      allocated += amount;
      pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(safe(milestone.label), m + 7, y + 6, { width: mw[0] - 12 });
      pdf.text(`${milestone.percentage}%`, m + mw[0], y + 6, { width: mw[1] - 8, align: 'right', lineBreak: false });
      pdf.text(money(amount), m + mw[0] + mw[1], y + 6, { width: mw[2] - 8, align: 'right', lineBreak: false });
      y += 23; line(m, y, right, y);
    });
    y += 12;
    y = sectionTitle(5, 'Terms and Conditions', y);
    terms.forEach((bullet) => {
      pdf.font('Helvetica').fontSize(8);
      const h = pdf.heightOfString(safe(bullet), { width: cw - 16, lineGap: 1 });
      pdf.fillColor(c.primary).font('Helvetica-Bold').fontSize(8).text('•', m + 2, y + 1, { lineBreak: false });
      pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(safe(bullet), m + 16, y, { width: cw - 16, lineGap: 1 });
      y += Math.max(15, h + 5);
    });
    y += 7;
    y = sectionTitle(6, 'Acceptance', y);
    pdf.fillColor(c.text).font('Helvetica').fontSize(8).text('Acceptance of this quotation confirms agreement to the stated development scope, fees and payment terms. Ongoing management services require separate written confirmation.', m, y, { width: cw, lineGap: 2 });
    y = pdf.y + 18;
    const half = (cw - 28) / 2;
    const signCol = (x: number, title: string, name: string) => {
      pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(8).text(title, x, y, { width: half });
      pdf.fillColor(c.text).font('Helvetica').fontSize(8).text(`Name: ${name}\n\nTitle: __________________________\n\nSignature: ______________________\n\nDate: __________________________`, x, y + 17, { width: half, lineGap: 1 });
    };
    signCol(m, 'FOR THE CLIENT', '____________________________');
    signCol(m + half + 28, 'FOR TAMBALA TECHNOLOGIES', signer.employeeNumber);
    pdf.fillColor(c.muted).font('Helvetica').fontSize(6.5).text(signer.fingerprint ? `Employee signature fingerprint: ${signer.fingerprint}` : 'UNSIGNED — signing is not configured', m + half + 28, y + 111, { width: half });
    pdf.fillColor(c.navy).font('Helvetica-Bold').fontSize(9).text(safe(doc.closingLine ?? 'Thank you for considering Tambala Technologies as your technology partner.'), m, H - 78, { width: cw, align: 'center' });
    pdf.end();
  });
}

export function renderDocument(doc: StoredDocument, design: DocDesign, signer: Signer): Promise<Buffer> {
  if (doc.kind === 'quotation') return renderQuotation(doc, design, signer);
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
