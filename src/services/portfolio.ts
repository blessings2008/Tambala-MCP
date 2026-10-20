import { supabaseSelect } from '../lib/database.js';

export type PortfolioItem = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  url: string | null;
  approved_for_outreach: boolean;
  client_visible: boolean;
};

export async function getApprovedPortfolio(category?: string): Promise<PortfolioItem[]> {
  const rows = await supabaseSelect('portfolio');
  return (rows as PortfolioItem[]).filter((item) =>
    item.status === 'live' && item.approved_for_outreach && item.client_visible &&
    (!category || String(item.category ?? '').toLowerCase() === category.toLowerCase())
  );
}

export async function getPortfolioContext(category?: string): Promise<string> {
  const items = await getApprovedPortfolio(category);
  if (!items.length) return 'No portfolio item is currently approved for prospect-facing use.';
  return items.map((item) => `${item.name}: ${item.description ?? ''}${item.url ? ` | ${item.url}` : ''}`).join('\n');
}
