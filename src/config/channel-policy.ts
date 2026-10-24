export type OrganizationChannel = 'chat' | 'email' | 'whatsapp';

/**
 * Organization-wide operating policy for external outreach and customer work.
 * WhatsApp is deliberately disabled until the provider credentials are configured.
 */
export const organizationChannelPolicy = {
  operatingMarket: 'Malawi',
  defaultExternalChannel: 'whatsapp' as OrganizationChannel,
  enabledChannels: ['chat', 'email'] as OrganizationChannel[],
  pendingChannels: ['whatsapp'] as OrganizationChannel[],
  whatsapp: {
    enabled: Boolean(process.env.TAMBALA_WHATSAPP_ENABLED === 'true'),
    providerBaseUrl: process.env.TAMBALA_WHATSAPP_BASE_URL ?? '',
    accessTokenConfigured: Boolean(process.env.TAMBALA_WHATSAPP_ACCESS_TOKEN),
    phoneNumberIdConfigured: Boolean(process.env.TAMBALA_WHATSAPP_PHONE_NUMBER_ID),
    webhookVerifyTokenConfigured: Boolean(process.env.TAMBALA_WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    inboundRoutingRoleId: 'director-customer-relations',
    outboundApprovalRoleId: 'founder',
  },
} as const;

export function isAllowedOperatingMarket(country: string): boolean {
  return country.trim().toLowerCase() === 'malawi';
}
