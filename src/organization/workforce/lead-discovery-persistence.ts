import { insertRow, supabaseSelect } from '../../lib/database.js';

type Row = Record<string, unknown>;
const SERVICE_FIT = new Set([
  'web_development',
  'software_development',
  'digital_product_development',
  'social_media_management',
]);

function normaliseName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isHttpUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}

function optionalString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function parseProspectBlock(body: string): { prospects: Row[]; cleanBody: string } {
  const match = body.match(/DISCOVERED_PROSPECTS:\s*\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60\s*END_DISCOVERED_PROSPECTS/i);
  if (!match) throw new Error('Research output is missing the required DISCOVERED_PROSPECTS JSON block; no prospects were saved.');
  let parsed: unknown;
  try { parsed = JSON.parse(match[1].trim()); }
  catch { throw new Error('The DISCOVERED_PROSPECTS block contains invalid JSON; no prospects were saved.'); }
  if (!Array.isArray(parsed)) throw new Error('DISCOVERED_PROSPECTS must be a JSON array.');
  return {
    prospects: parsed as Row[],
    cleanBody: body.replace(match[0], '').trim(),
  };
}

export async function persistDiscoveredProspects(body: string): Promise<{ cleanBody: string; saved: number; duplicates: number; rejected: number; details: string[] }> {
  const { prospects, cleanBody } = parseProspectBlock(body);
  const [queueRows, leads, clients] = await Promise.all([
    supabaseSelect<Row>('lead_discovery_queue', { select: 'id,organisation_name', limit: '5000' }),
    supabaseSelect<Row>('leads', { select: 'id,name,business_name', limit: '5000' }),
    supabaseSelect<Row>('clients', { select: 'id,name,business_name', limit: '5000' }),
  ]);
  const known = new Set<string>();
  for (const row of [...queueRows, ...leads, ...clients]) {
    for (const value of [row.organisation_name, row.name, row.business_name]) {
      if (typeof value === 'string' && normaliseName(value)) known.add(normaliseName(value));
    }
  }

  let saved = 0, duplicates = 0, rejected = 0;
  const details: string[] = [];
  for (const [index, row] of prospects.entries()) {
    const name = optionalString(row.organisation_name, 200);
    if (!name || !normaliseName(name)) { rejected++; details.push(`Item ${index + 1}: missing organisation_name.`); continue; }
    const normalized = normaliseName(name);
    if (known.has(normalized)) { duplicates++; details.push(`${name}: duplicate of an existing CRM or discovery record.`); continue; }
    const fit = Array.isArray(row.service_fit)
      ? [...new Set(row.service_fit.filter((v): v is string => typeof v === 'string' && SERVICE_FIT.has(v)))]
      : [];
    const sources = Array.isArray(row.source_urls)
      ? [...new Set(row.source_urls.filter((v): v is string => typeof v === 'string' && isHttpUrl(v)))].slice(0, 12)
      : [];
    const reason = optionalString(row.reason_for_fit, 1200);
    if (!fit.length || !reason || reason.length < 20 || !sources.length) {
      rejected++; details.push(`${name}: rejected because service_fit, a substantive reason, or evidence URLs are missing/invalid.`); continue;
    }
    const verification = row.verification_status === 'verified' || row.verification_status === 'unverified'
      ? row.verification_status : 'partial';
    try {
      await insertRow<Row>('lead_discovery_queue', {
        organisation_name: name,
        website: optionalString(row.website, 500) && isHttpUrl(String(row.website)) ? String(row.website).trim() : null,
        sector: optionalString(row.sector, 120),
        service_fit: fit,
        reason_for_fit: reason,
        decision_maker_name: optionalString(row.decision_maker_name, 160),
        decision_maker_title: optionalString(row.decision_maker_title, 160),
        public_email: optionalString(row.public_email, 254),
        public_phone: optionalString(row.public_phone, 80),
        source_urls: sources,
        verification_status: verification,
        processing_status: 'new',
        research_notes: optionalString(row.research_notes, 1600),
        first_contact_message: optionalString(row.first_contact_message, 1800),
      });
      known.add(normalized);
      saved++;
      details.push(`${name}: saved for Sales review.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error.';
      if (/23505|duplicate key|unique constraint/i.test(message)) {
        duplicates++; details.push(`${name}: duplicate blocked by database constraint.`);
      } else {
        throw new Error(`Could not save ${name}: ${message.slice(0, 180)}`);
      }
    }
  }
  return { cleanBody, saved, duplicates, rejected, details };
}
