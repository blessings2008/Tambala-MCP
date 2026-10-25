#!/usr/bin/env node

import { createHmac } from 'node:crypto';

const baseUrl = process.env.TAMBALA_WEBHOOK_URL ?? 'https://tambala-mcp.onrender.com/webhooks/zapclaw/whatsapp';
const secret = process.env.ZAPCLAW_WEBHOOK_SECRET;
const sender = process.env.TEST_WHATSAPP_FROM ?? '265000000000';

if (!secret) {
  console.error('Missing ZAPCLAW_WEBHOOK_SECRET. Set it locally; never commit the secret.');
  process.exit(1);
}

const payload = {
  event: 'message.received',
  sequence: Date.now(),
  timestamp: new Date().toISOString(),
  data: {
    from: sender,
    user_id: 'test-user',
    contact_name: 'Tambala WhatsApp Test',
    message_id: `test-${Date.now()}`,
    type: 'text',
    timestamp: new Date().toISOString(),
    text: { body: 'Hello Tambala — this is a ZapClaw webhook smoke test.' },
  },
  account: {
    phone_number_id: 'test-phone-number-id',
    display_name: 'Tambala Test',
    display_phone_number: sender,
  },
};

const body = JSON.stringify(payload);
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const response = await fetch(baseUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-zapclaw-signature': signature,
  },
  body,
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text);

if (!response.ok) process.exit(1);
