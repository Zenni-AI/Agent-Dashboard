import { JobFailure } from '../queue.js';
import { providerErrorFromResponse, type ImageProvider, type RenderRequest } from './types.js';

/** OpenAI image edits (gpt-image-1). Docs: https://platform.openai.com/docs/api-reference/images/createEdit */
export class OpenAIProvider implements ImageProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async render({ image, prompt, signal }: RenderRequest): Promise<Buffer> {
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', prompt);
    form.set('size', '1536x1024');
    form.set('quality', 'medium');
    form.set('image', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'house.jpg');

    const res = await fetch('https://api.openai.com/v1/images/edits', {
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
