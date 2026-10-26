import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
import { JobFailure } from '../src/queue.js';

function capture(response: Response) {
  const sent: FormData[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push(init.body as FormData);
    return response.clone();
  }) as unknown as typeof fetch;
  return { sent, fetchFn };
}
const ok = () => Response.json({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] });
const req = { image: Buffer.from('jpeg'), prompt: 'add lights', themeId: 'warm_white', signal: AbortSignal.timeout(5000) };

describe('OpenAIProvider', () => {
  it('sends the house photo and prompt, and returns the edited image', async () => {
    const { sent, fetchFn } = capture(ok());
    const out = await new OpenAIProvider('sk-test', 'gpt-image-2', fetchFn).render(req);
    expect(out.toString()).toBe('png-bytes');
    expect(sent[0]!.get('model')).toBe('gpt-image-2');
    expect(sent[0]!.get('prompt')).toBe('add lights');
    expect(sent[0]!.get('image')).toBeInstanceOf(Blob);
    expect(sent[0]!.get('input_fidelity')).toBeNull();
  });

  it.each(['gpt-image-1', 'gpt-image-1.5'])('asks %s to keep the house faithful', async (model) => {
    const { sent, fetchFn } = capture(ok());
    await new OpenAIProvider('sk-test', model, fetchFn).render(req);
    expect(sent[0]!.get('input_fidelity')).toBe('high');
  });

  it('maps a moderation rejection to a friendly failure', async () => {
    const { fetchFn } = capture(new Response('{"error":{"code":"moderation_blocked"}}', { status: 400 }));
    await expect(new OpenAIProvider('sk-test', 'gpt-image-2', fetchFn).render(req)).rejects.toBeInstanceOf(JobFailure);
  });
});
