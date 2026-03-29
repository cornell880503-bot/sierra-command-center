// AI client — Google Gemini
// Uses VITE_GEMINI_API_KEY env var directly (browser-safe for dev/internal tools)

export const GEMINI_MODEL = 'gemini-2.5-flash';

export interface GeminiCallMeta {
  model: string;
  inputChars: number;
  outputChars: number;
  tookMs: number;
}

export interface GeminiResult {
  text: string;
  meta: GeminiCallMeta;
}

export async function callClaude(
  systemPrompt: string,
  userContent: string,
  _maxTokens = 1024,
): Promise<string> {
  const { text } = await callGemini(systemPrompt, userContent, _maxTokens);
  return text;
}

// Full call that also returns metadata — used by AI agent functions
export async function callGemini(
  systemPrompt: string,
  userContent: string,
  maxTokens = 1024,
): Promise<GeminiResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY not set — cannot call Gemini API');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const inputChars = systemPrompt.length + userContent.length;

  console.log(`[Sierra AI] → Gemini ${GEMINI_MODEL} (${inputChars} chars)`);

  const t0 = performance.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  });

  const tookMs = Math.round(performance.now() - t0);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Sierra AI] ✗ Gemini error ${res.status}:`, errText);
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();

  // Extract text — skip any "thought" parts (thinking models emit role=model parts
  // where some parts have no text or have a "thought" flag)
  const parts: Array<{ text?: string; thought?: boolean }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find(p => p.text && !p.thought);
  const text = textPart?.text;

  if (typeof text !== 'string' || !text.trim()) {
    console.error('[Sierra AI] ✗ No text in response:', JSON.stringify(data).slice(0, 300));
    throw new Error('Unexpected response format from Gemini — no text part found');
  }

  const meta: GeminiCallMeta = {
    model: GEMINI_MODEL,
    inputChars,
    outputChars: text.length,
    tookMs,
  };

  console.log(`[Sierra AI] ✓ ${GEMINI_MODEL} (${text.length} chars, ${tookMs}ms):`, text.slice(0, 100));
  return { text, meta };
}

/** Strip markdown code fences if the model wraps the JSON.
 *  With responseMimeType:'application/json' this is usually a no-op,
 *  but kept as a safety net for any stray fence characters. */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Happy path: already valid JSON object or array
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  // Strip ```json ... ``` or ``` ... ``` fences (with or without closing fence)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (fenced) return fenced[1].trim();
  // Last resort: extract first JSON object or array found anywhere in the string
  const obj = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (obj) return obj[1].trim();
  console.warn('[Sierra extractJson] Could not extract JSON from response:', trimmed.slice(0, 200));
  return trimmed;
}
