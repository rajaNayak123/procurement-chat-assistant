import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY || '';
const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export const groqClient = apiKey ? new Groq({ apiKey }) : null;

export async function callGroqChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  jsonMode: boolean = false
): Promise<string | null> {
  if (!groqClient) {
    return null;
  }

  try {
    const response = await groqClient.chat.completions.create({
      model,
      messages,
      temperature: 0,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });

    return response.choices[0]?.message?.content || null;
  } catch (err: any) {
    console.warn('Groq API call failed or rate-limited, falling back to deterministic parser:', err.message);
    return null;
  }
}
