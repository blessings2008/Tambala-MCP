import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { insertRow, supabaseSelect, updateRow } from '../lib/database.js';

type Row = Record<string, unknown>;
type QueueStatus = 'new' | 'reviewing' | 'qualified' | 'rejected' | 'duplicate';

const serviceFit = z.enum([
  'web_development',
  'software_development',
  'digital_product_development',
  'social_media_management',
]);

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function safeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function registerLeadDiscoveryTools(server: McpServer): void {
  server.registerTool('submit_prospect_for_review', {
    description: 'Save a researched Malawian organisation to the separate lead discovery queue. Requires evidence URLs. Checks existing CRM and discovery records for duplicates. Does not create CRM leads or contact anyone.',
    inputSchema: {
      organisation_name: z.string().trim().min(2).max(200),
      website: z.string().trim().url().optional(),
      sector: z.string().trim().max(120).optional(),
      service_fit: z.array(serviceFit).min(1).max(4),
      reason_for_fit: z.string().trim().min(20).max(1200),
      decision_maker_name: z.string().trim().max(160).optional(),
      decision_maker_title: z.string().trim().max(160).optional(),
      public_email: z.string().trim().email().optional(),
      public_phone: z.string().trim().max(80).optional(),
      source_urls: z.array(z.string().url()).min(1).max(12),
      verification_status: z.enum(['verified', 'partial', 'unverified']).default('partial'),
      research_notes: z.string().trim().max(1600).optional(),
    },
  }, async (input) => {
    const name = input.organisation_name.trim();
    const normalised = normaliseName(name);
    if (!normalised) throw new Error('Organisation name must contain letters or numbers.');
    const sourceUrls = input.source_urls.filter(isHttpUrl);
    if (sourceUrls.length !== input.source_urls.length) throw new Error('Every evidence source must use HTTP or HTTPS.');

    const [queueRows, crmRows] = await Promise.all([
      supabaseSelect<Row>('lead_discovery_queue', { select: 'id,organisation_name,processing_status', limit: '1000' }),
      supabaseSelect<Row>('leads', { select: 'id,name,business_name', limit: '2000' }),
    ]);
    const queueMatch = queueRows.find((row) => normaliseName(String(row.organisation_name ?? '')) === normalised);
    if (queueMatch) {
      return text({
        saved: false,
        duplicate: true,
        duplicate_location: 'lead_discovery_queue',
        existing_id: queueMatch.id,
        existing_status: queueMatch.processing_status,
        message: 'This organisation is already in the discovery queue. No second record was created.',
      });
    }
    const crmMatch = crmRows.find((row) =>
      [row.name, row.business_name].some((value) => typeof value === 'string' && normaliseName(value) === normalised)
    );
    if (crmMatch) {
      return text({
        saved: false,
        duplicate: true,
        duplicate_location: 'crm_leads',
        existing_id: crmMatch.id,
        message: 'This organisation already exists in the CRM. It was not added to the discovery queue.',
      });
    }

    const saved = await insertRow<Row>('lead_discovery_queue', {
      organisation_name: name,
      website: safeOptional(input.website),
      sector: safeOptional(input.sector),
      service_fit: input.service_fit,
      reason_for_fit: input.reason_for_fit.trim(),
      decision_maker_name: safeOptional(input.decision_maker_name),
      decision_maker_title: safeOptional(input.decision_maker_title),
      public_email: safeOptional(input.public_email),
      public_phone: safeOptional(input.public_phone),
      source_urls: sourceUrls,
      verification_status: input.verification_status,
      processing_status: 'new',
      research_notes: safeOptional(input.research_notes),
    });
    return text({
      saved: true,
      duplicate: false,
      prospect: saved,
      next_step: 'Sales must review and qualify this record. CRM promotion and outreach remain separate approval-gated actions.',
    });
  });

  server.registerTool('list_prospect_discovery_queue', {
    description: 'Read prospects awaiting Sales review from the separate discovery queue. Does not change status or create CRM leads.',
    inputSchema: {
      status: z.enum(['new', 'reviewing', 'qualified', 'rejected', 'duplicate']).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
  }, async ({ status, limit }) => {
    const params: Record<string, string> = {
      select: 'id,organisation_name,website,sector,service_fit,reason_for_fit,decision_maker_name,decision_maker_title,public_email,public_phone,source_urls,research_date,verification_status,processing_status,research_notes,created_at',
      order: 'research_date.desc,created_at.desc',
      limit: String(limit),
    };
    if (status) params.processing_status = `eq.${status}`;
    const rows = await supabaseSelect<Row>('lead_discovery_queue', params);
    return text({
      count: rows.length,
      status_filter: status ?? 'all',
      prospects: rows,
      note: 'Discovery records are not CRM leads. Sales review is required before any separate CRM promotion.',
    });
  });

  server.registerTool('update_prospect_review_status', {
    description: 'Update a discovery prospect review state. Allowed states are reviewing, qualified, rejected, or duplicate. This tool cannot promote records into the CRM.',
    inputSchema: {
      id: z.string().uuid(),
      status: z.enum(['reviewing', 'qualified', 'rejected', 'duplicate']),
      review_note: z.string().trim().max(1000).optional(),
    },
  }, async ({ id, status, review_note }) => {
    const current = await supabaseSelect<Row>('lead_discovery_queue', {
      select: 'id,organisation_name,processing_status',
      id: `eq.${id}`,
      limit: '1',
    });
    if (!current.length) throw new Error('Discovery prospect not found.');
    if (current[0].processing_status === 'promoted') {
      throw new Error('This prospect has already been promoted and cannot be changed through the discovery review tool.');
    }
    const notes = safeOptional(review_note);
    const updated = await updateRow<Row>('lead_discovery_queue', id, {
      processing_status: status,
      ...(notes ? { research_notes: notes } : {}),
    });
    return text({
      updated: true,
      prospect: updated,
      crm_created: false,
      message: status === 'qualified'
        ? 'Marked qualified for a separate human-approved CRM promotion step. No CRM record was created.'
        : 'Review status updated. No CRM record was created and no outreach was sent.',
    });
  });
}
