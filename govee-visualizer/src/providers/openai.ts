import { JobFailure } from '../queue.js';
import { providerErrorFromResponse, type ImageProvider, type RenderRequest } from './types.js';

/**
 * OpenAI image edits — the image model behind ChatGPT. Needs an API key from platform.openai.com
 * (a ChatGPT subscription does not include API access). Docs: https://platform.openai.com/docs/api-reference/images/createEdit
 */
export class OpenAIProvider implements ImageProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async render({ image, prompt, signal }: RenderRequest): Promise<Buffer> {
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', prompt);
    form.set('size', '1536x1024');
    form.set('quality', 'medium');
    // Keep the house itself faithful to the photo instead of redrawing it. gpt-image-1 / 1.5 need this
    // asked for explicitly; newer models do it by default, so it isn't sent to them.
    if (/^gpt-image-1(\.5)?(-\d|$)/.test(this.model)) form.set('input_fidelity', 'high');
    form.set('image', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'house.jpg');

    const res = await this.fetchFn('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && text.includes('moderation')) {
        throw new JobFailure('render_blocked', "We couldn't light up this photo. Try a clearer daytime photo of the front of your house.");
      }
      throw providerErrorFromResponse(this.name, res, text);
    }
    const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image');
    return Buffer.from(b64, 'base64');
  }
}
