import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    client = new OpenAI({ apiKey });
  }
  return client;
}

export async function askTambalaAI(input: string, context?: unknown): Promise<string> {
  const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-mini';
  const contextText = context === undefined ? '' : `\n\nTambala business context:\n${JSON.stringify(context)}`;
  const response = await getClient().responses.create({
    model,
    instructions:
      'You are Tambala AI, a business operations assistant for Tambala Technologies. Use the supplied business context as facts. Do not invent clients, projects, conversations, financial figures, or actions. Be practical and concise. When information is missing, say so. Never send messages or make external changes unless an explicit tool is later provided for that action.',
    input: `${input}${contextText}`,
  });
  return response.output_text;
}
