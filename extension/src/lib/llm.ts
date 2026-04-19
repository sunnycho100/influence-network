import type { Profile, UserProfile } from '@alumni-graph/shared';
import { buildColdOutreachPrompt } from './prompts';

interface LlmConfig {
  apiKey: string;
  model?: string;
}

async function getStoredConfig(): Promise<LlmConfig | null> {
  const result = await chrome.storage.local.get(['geminiApiKey', 'llmModel']);
  const apiKey = result.geminiApiKey as string | undefined;
  if (!apiKey) return null;
  return {
    apiKey,
    model: (result.llmModel as string | undefined) ?? 'gemini-2.5-flash',
  };
}

export async function generateMessage(
  user: UserProfile,
  target: Profile,
): Promise<string> {
  const config = await getStoredConfig();
  if (!config) {
    throw new Error('No API key configured. Open the extension settings to add your Gemini API key.');
  }

  const prompt = buildColdOutreachPrompt(user, target);
  return callGemini(config, prompt);
}

async function callGemini(config: LlmConfig, prompt: string): Promise<string> {
  const model = config.model ?? 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 280,
        temperature: 0.85,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  return text;
}
