import { supabaseSelect } from '../lib/supabase.js';

type LeadRow = {
  name: string | null;
  business_name: string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
};

type ClientRow = {
  name: string | null;
  business_name: string | null;
  status: string | null;
  location: string | null;
  created_at: string | null;
};

type ServiceRow = {
  name: string;
  description: string | null;
  active: boolean;
};

export interface SalesResearchContext {
  crmAvailable: boolean;
  crmAvailabilityNote: string;
  existingLeads: Array<{ businessName: string; status: string; source: string }>;
  existingClients: Array<{ businessName: string; status: string; location: string }>;
  verifiedServices: Array<{ name: string; description: string }>;
}

/**
 * Supplies a minimal, privacy-conscious CRM snapshot to Sales & Business
 * Development. Contact details and private notes are intentionally excluded:
 * this context is for duplicate detection and service-claim grounding.
 */
export async function getSalesResearchContext(): Promise<SalesResearchContext> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      crmAvailable: false,
      crmAvailabilityNote: 'CRM context unavailable because the server has no Supabase service-role configuration. Do not claim to have checked existing leads or clients.',
      existingLeads: [],
      existingClients: [],
      verifiedServices: [],
    };
  }

  const [leads, clients, services] = await Promise.all([
    supabaseSelect<LeadRow>(
      'leads',
      'select=name,business_name,status,source,created_at&order=created_at.desc&limit=100',
    ),
    supabaseSelect<ClientRow>(
      'clients',
      'select=name,business_name,status,location,created_at&order=created_at.desc&limit=100',
    ),
    supabaseSelect<ServiceRow>(
      'services',
      'select=name,description,active&active=eq.true&order=name.asc',
    ),
  ]);

  return {
    crmAvailable: true,
    crmAvailabilityNote: 'CRM snapshot loaded from the existing Supabase database. Treat it as the source of truth for known leads, clients, and active services.',
    existingLeads: leads.map((row) => ({
      businessName: (row.business_name || row.name || '').trim(),
      status: row.status || 'unknown',
      source: row.source || 'unknown',
    })).filter((row) => row.businessName),
    existingClients: clients.map((row) => ({
      businessName: (row.business_name || row.name || '').trim(),
      status: row.status || 'unknown',
      location: row.location || 'unknown',
    })).filter((row) => row.businessName),
    verifiedServices: services.filter((row) => row.active).map((row) => ({
      name: row.name,
      description: row.description || '',
    })),
  };
}
