import type { Config } from '../config.js';
import { JobFailure } from '../queue.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import { ProviderError, type ImageProvider, type RenderRequest } from './types.js';

export * from './types.js';

export function createProvider(config: Config): ImageProvider {
  switch (config.imageProvider) {
    case 'gemini':
      return new GeminiProvider(config.geminiApiKey, config.geminiImageModel);
    case 'openai':
      return new OpenAIProvider(config.openaiApiKey, config.openaiImageModel);
    case 'mock':
      return new MockProvider(config.mockDelayMs);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the provider with a timeout and retries rate limits / transient failures with exponential
 * backoff plus jitter, so a burst of visitors degrades into "a few seconds slower" rather than errors.
 */
export async function renderWithRetry(
  provider: ImageProvider,
  req: Omit<RenderRequest, 'signal'>,
  { timeoutMs, attempts = 4 }: { timeoutMs: number; attempts?: number },
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await provider.render({ ...req, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastError = err;
      if (err instanceof JobFailure) throw err;
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      const network = err instanceof TypeError; // fetch() network failure
      const retryable = (err instanceof ProviderError && err.retryable) || timedOut || network;
      if (!retryable || attempt === attempts) break;
      const backoff = 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
      const wait = err instanceof ProviderError && err.retryAfterMs ? Math.max(err.retryAfterMs, backoff) : backoff;
      console.warn(`[${provider.name}] attempt ${attempt} failed (${(err as Error).message}); retrying in ${Math.round(wait)}ms`);
      await sleep(Math.min(wait, 30_000));
    }
  }
  console.error(`[${provider.name}] render failed`, lastError);
  throw new JobFailure('render_failed', "Our lighting designer AI is busy right now. Please try again in a moment.");
}
