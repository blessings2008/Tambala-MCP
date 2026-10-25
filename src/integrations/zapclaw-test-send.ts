const ZAPCLAW_BASE_URL = process.env.ZAPCLAW_BASE_URL ?? 'https://api.zapclaw.app';

function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export async function sendZapClawTestText(to: string, text: string): Promise<unknown> {
  const key = process.env.ZAPCLAW_API_KEY;
  const from = process.env.ZAPCLAW_FROM;
  if (!key) throw new Error('ZAPCLAW_API_KEY is not configured');
  if (!from) throw new Error('ZAPCLAW_FROM is not configured');

  const normalizedTo = phoneDigits(to);
  if (!/^265\d{9}$/.test(normalizedTo)) {
    throw new Error('Test recipient must be a Malawi WhatsApp number in E.164 form, e.g. 265XXXXXXXXX');
  }
  if (!text.trim()) throw new Error('Test message cannot be empty');
  if (text.length > 4096) throw new Error('Test message is too long (maximum 4096 characters).');

  const response = await fetch(`${ZAPCLAW_BASE_URL}/api/v1/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      'Idempotency-Key': `tambala-wa-test-${Date.now()}`,
    },
    body: JSON.stringify({ from: phoneDigits(from), to: normalizedTo, text: text.trim() }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ZapClaw send failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}
