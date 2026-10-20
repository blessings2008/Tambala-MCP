export interface SendEmailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Email provider failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  if (!payload?.id) throw new Error('Email provider returned no message id');
  return { id: String(payload.id) };
}
