import { JobFailure } from '../queue.js';
import { providerErrorFromResponse, type ImageProvider, type RenderRequest } from './types.js';

/**
 * Google Gemini image editing ("Nano Banana"), called over REST so there is no SDK version to track.
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */
export class GeminiProvider implements ImageProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async render({ image, prompt, signal }: RenderRequest): Promise<Buffer> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } }, { text: prompt }],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) throw providerErrorFromResponse(this.name, res, await res.text());

    const body = (await res.json()) as GeminiResponse;
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (data) return Buffer.from(data, 'base64');
    }
    const reason = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? 'no image returned';
    console.warn(`[gemini] no image in response: ${reason}`);
    throw new JobFailure('render_blocked', "We couldn't light up this photo. Try a clearer daytime photo of the front of your house.");
  }
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; inlineData?: { data?: string }; inline_data?: { data?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
}
