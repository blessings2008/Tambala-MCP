import { supabaseSelect } from '../lib/supabase.js';

type DbRow = Record<string, unknown>;

export async function getCompanyProfile(topic?: string): Promise<DbRow | null> {
  const rows = await supabaseSelect<DbRow>('company_profile', 'select=*&id=eq.default&limit=1');
  if (rows.length === 0) return null;

  const profile = rows[0];
  if (!topic || topic === 'general' || topic === 'company') return profile;

  const key = topic.toLowerCase();
  const aliases: Record<string, string> = {
    location: 'base_location',
    base: 'base_location',
    focus: 'description',
    description: 'description',
    name: 'company_name',
    contact: 'contact_name',
  };
  const field = aliases[key] ?? key;
  return { topic, value: profile[field] ?? null, profile };
}
