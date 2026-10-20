export const runtimeConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'https://tambala-mcp.onrender.com',
  senderName: process.env.TAMBALA_SENDER_NAME ?? '[SENDER NAME]',
  senderPhone: process.env.TAMBALA_SENDER_PHONE ?? '[SENDER PHONE]',
} as const;
