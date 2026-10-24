/**
 * Build short, task-specific search terms from the actual objective.
 * Never forward the full Founder/CEO prompt to the search provider.
 */
const LOCATIONS: Array<[RegExp, string]> = [
  [/\bblantyre\b/i, 'Blantyre Malawi'],
  [/\blilongwe\b/i, 'Lilongwe Malawi'],
  [/\bmzuzu\b/i, 'Mzuzu Malawi'],
  [/\bzomba\b/i, 'Zomba Malawi'],
  [/\bntcheu\b/i, 'Ntcheu Malawi'],
  [/\bmalawi|malawian\b/i, 'Malawi'],
  [/\bkenya|kenyan\b/i, 'Kenya'],
  [/\bzambia|zambian\b/i, 'Zambia'],
  [/\btanzania|tanzanian\b/i, 'Tanzania'],
  [/\bsouth africa\b/i, 'South Africa'],
  [/\bghana|ghanaian\b/i, 'Ghana'],
  [/\bnigeria|nigerian\b/i, 'Nigeria'],
  [/\brwanda|rwandan\b/i, 'Rwanda'],
  [/\buganda|ugandan\b/i, 'Uganda'],
  [/\bunited states|\busa\b|\bu\.s\.\b|\bamerica\b/i, 'United States'],
  [/\bcanada|canadian\b/i, 'Canada'],
  [/\bnorth america\b/i, 'North America'],
  [/\buk|united kingdom|england|scotland|wales\b/i, 'United Kingdom'],
  [/\beurope\b/i, 'Europe'],
  [/\bfrance|french\b/i, 'France'],
  [/\bgermany|german\b/i, 'Germany'],
  [/\bspain|spanish\b/i, 'Spain'],
  [/\bitaly|italian\b/i, 'Italy'],
  [/\bsoutheast asia|south east asia\b/i, 'Southeast Asia'],
  [/\bthailand|thai\b/i, 'Thailand'],
  [/\bindonesia|indonesian\b/i, 'Indonesia'],
  [/\bvietnam|vietnamese\b/i, 'Vietnam'],
  [/\bphilippines|philippine\b/i, 'Philippines'],
];

const INDUSTRIES: Array<[RegExp, string]> = [
  [/\blodg(?:e|es)\b/i, 'lodges'],
  [/\bhotels?\b/i, 'hotels'],
  [/\brestaurants?|caf[eé]s?|coffee shops?\b/i, 'restaurants cafes'],
  [/\bguest ?houses?\b/i, 'guest houses'],
  [/\bsalons?|barbers?\b/i, 'salons barbers'],
  [/\bschools?|colleges?|universit(?:y|ies)\b/i, 'schools colleges'],
  [/\bclinics?|medical practices?\b/i, 'clinics'],
  [/\btour(?:ism| operators?)\b/i, 'tourism operators'],
  [/\bretail|retailer|e-commerce|ecommerce\b/i, 'retail ecommerce'],
  [/\bmusic|record labels?|artist management|music publishing\b/i, 'music industry'],
];

const STOP_WORDS = new Set([
  'find', 'our', 'next', 'client', 'clients', 'prospect', 'prospects', 'identify', 'research',
  'please', 'help', 'need', 'want', 'give', 'make', 'create', 'prepare', 'provide', 'return',
  'complete', 'task', 'objective', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'who',
  'could', 'would', 'should', 'their', 'them', 'business', 'businesses', 'potential', 'suitable',
  'qualified', 'new', 'website', 'websites', 'web', 'development', 'design', 'digital',
]);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Returns a compact query suited to a single web search. Generic client-finding
 * tasks default to Tambala's known Malawi market only when no explicit geography
 * is present. Explicit geography must always win over the default.
 */
export function buildResearchQuery(objective: string, delegatedTask = '', suggestedQuery = ''): string {
  const combined = [objective, delegatedTask].filter(Boolean).join(' ').replace(/https?:\/\/\S+/gi, ' ');
  const lower = combined.toLowerCase();
  const isProspecting = /\b(find|identify|source|discover|prospect|client acquisition|new clients?|potential clients?)\b/i.test(combined);

  const location = LOCATIONS.find(([pattern]) => pattern.test(combined))?.[1]
    ?? (isProspecting ? 'Malawi' : '');
  const industry = unique(INDUSTRIES.filter(([pattern]) => pattern.test(combined)).map(([, label]) => label));
  const serviceTerms = /\b(website|websites|web design|web development|digital presence|online presence)\b/i.test(combined)
    || isProspecting
    ? ['website', 'web design', 'contact']
    : [];

  // Generic prospecting uses Tambala's established core sectors rather than
  // weak fragments such as "our next client" or the full model instruction.
  if (isProspecting && industry.length === 0) {
    return unique([location || 'Malawi', 'lodges hotels restaurants', ...serviceTerms, 'official website']).join(' ').slice(0, 220);
  }

  const explicitEntities = [...combined.matchAll(/\b[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){0,2}\b/g)]
    .map((match) => match[0])
    .filter((value) => !/^(Find|Identify|Research|Please|The|Our|Next|Client|Potential|Current|Return|Provide|Complete|Five|Ten|Top|Best|New)\b/i.test(value))
    .filter((value) => !STOP_WORDS.has(value.toLowerCase()));

  const suggestedTerms = suggestedQuery
    .replace(/https?:\/\/\S+/gi, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 8);

  const query = unique([
    location,
    ...industry,
    ...serviceTerms,
    ...explicitEntities.slice(0, 3),
    ...suggestedTerms,
    /\bcontact|email|phone\b/i.test(lower) ? 'contact' : '',
    /\bofficial|verified|source\b/i.test(lower) ? 'official' : '',
  ]).join(' ').replace(/\s+/g, ' ').trim();

  return (query || 'Malawi businesses official website contact').slice(0, 220);
}
