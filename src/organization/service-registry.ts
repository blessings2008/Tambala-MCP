/**
 * Organization-level registry for capabilities provided by internal systems
 * and independently deployed services.
 *
 * The registry deliberately stores no credentials. URLs are resolved from
 * environment variables at runtime so the organization can route work without
 * coupling itself to a service's implementation details.
 */

export type ServiceKind = 'internal' | 'external_api';

export type OrganizationService = {
  id: string;
  name: string;
  kind: ServiceKind;
  ownerUnitId: string;
  capabilities: string[];
  baseUrlEnv?: string;
  enabled: boolean;
};

const services: OrganizationService[] = [
  {
    id: 'tambala-pay',
    name: 'Tambala Pay',
    kind: 'external_api',
    ownerUnitId: 'fintech-ventures',
    capabilities: [
      'invoices.create',
      'invoices.read',
      'payments.read',
      'payments.reconcile',
      'receipts.read',
      'financial-reports.read',
    ],
    baseUrlEnv: 'TAMBALA_PAY_BASE_URL',
    enabled: true,
  },
  {
    id: 'rendering-service',
    name: 'Tambala Rendering Service',
    kind: 'external_api',
    ownerUnitId: 'software-digital-services',
    capabilities: ['video.render', 'media.process', 'render.jobs.read'],
    baseUrlEnv: 'TAMBALA_RENDERING_BASE_URL',
    enabled: true,
  },
  {
    id: 'mcp-web-research',
    name: 'Web Research',
    kind: 'internal',
    ownerUnitId: 'research-intelligence',
    capabilities: ['research.web', 'evidence.collect'],
    enabled: true,
  },
  {
    id: 'mcp-email',
    name: 'Organization Email',
    kind: 'internal',
    ownerUnitId: 'corporate-services',
    capabilities: ['email.send', 'email.report'],
    enabled: true,
  },
];

export function listOrganizationServices(): OrganizationService[] {
  return services.map((service) => ({ ...service, capabilities: [...service.capabilities] }));
}

export function getOrganizationService(id: string): OrganizationService | null {
  const service = services.find((candidate) => candidate.id === id);
  return service ? { ...service, capabilities: [...service.capabilities] } : null;
}

export function findServicesForCapability(capability: string): OrganizationService[] {
  return services
    .filter((service) => service.enabled && service.capabilities.includes(capability))
    .map((service) => ({ ...service, capabilities: [...service.capabilities] }));
}

export function resolveServiceBaseUrl(service: OrganizationService): string | null {
  if (!service.baseUrlEnv) return null;
  const value = process.env[service.baseUrlEnv]?.trim();
  return value || null;
}
