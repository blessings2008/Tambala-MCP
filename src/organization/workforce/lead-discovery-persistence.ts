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

export function parseProspectBlock(body: string): { prospects: Row[]; cleanBody: string; parseIssue?: string } {
  const wrapped = body.match(/DISCOVERED_PROSPECTS:\s*\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60\s*END_DISCOVERED_PROSPECTS/i);
  const fenced = wrapped ? null : body.match(/\x60\x60\x60json\s*([\s\S]*?)\x60\x60\x60/i);
  const source = wrapped?.[1] ?? fenced?.[1] ?? '';
  const arrayStart = source.indexOf('[');
  if (arrayStart < 0) {
    return {
      prospects: [],
      cleanBody: wrapped ? body.replace(wrapped[0], '').trim() : fenced ? body.replace(fenced[0], '').trim() : body.trim(),
      parseIssue: 'No DISCOVERED_PROSPECTS JSON array was present; no prospects were saved.',
    };
  }

  const jsonText = source.slice(arrayStart).trim();
  let prospects: Row[] = [];
  let parseIssue: string | undefined;
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (Array.isArray(parsed)) prospects = parsed.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    else parseIssue = 'DISCOVERED_PROSPECTS must contain a JSON array.';
  } catch {
    // Recover every complete top-level object before a truncated final object.
    let objectDepth = 0;
    let objectStart = -1;
    let inString = false;
    let escaped = false;
    for (let i = arrayStart + 1; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') {
        if (objectDepth === 0) objectStart = i;
        objectDepth += 1;
      } else if (ch === '}') {
        objectDepth -= 1;
        if (objectDepth === 0 && objectStart >= 0) {
          try {
            const item: unknown = JSON.parse(source.slice(objectStart, i + 1));
            if (item && typeof item === 'object' && !Array.isArray(item)) prospects.push(item as Row);
          } catch { /* Ignore this malformed object and continue salvaging later complete objects. */ }
          objectStart = -1;
        }
      } else if (ch === ']' && objectDepth === 0) break;
    }
    parseIssue = prospects.length
      ? \`Research output was truncated or malformed; recovered \${prospects.length} complete prospect record(s).\`
      : 'DISCOVERED_PROSPECTS JSON was malformed or truncated; no complete prospect records could be recovered.';
  }

  const removed = wrapped?.[0] ?? fenced?.[0] ?? source.slice(arrayStart);
  return {
    prospects,
    cleanBody: removed ? body.replace(removed, '').trim() : body.trim(),
    parseIssue,
  };
}

export async function persistDiscoveredProspects(body: string): Promise<{ cleanBody: string; saved: number; duplicates: number; rejected: number; details: string[] }> {
  const { prospects, cleanBody, parseIssue } = parseProspectBlock(body);
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

  let saved = 0, duplicates = 0, rejected = parseIssue ? 1 : 0;
  const details: string[] = parseIssue ? [parseIssue] : [];
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
        rejected++;
        details.push(`${name}: could not be saved (${message.slice(0, 160)}). Other complete prospects will continue processing.`);
      }
    }
  }
  return { cleanBody, saved, duplicates, rejected, details };
}
