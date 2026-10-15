export interface RenderRequest {
  /** JPEG of the house. */
  image: Buffer;
  prompt: string;
  themeId: string;
  signal: AbortSignal;
}

export interface ImageProvider {
  readonly name: string;
  /** Returns the edited image (any format sharp can read). */
  render(req: RenderRequest): Promise<Buffer>;
}

/** An HTTP error from a provider; `retryable` marks rate limits and transient server faults. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export function providerErrorFromResponse(provider: string, res: Response, detail: string): ProviderError {
  const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
  const retryAfter = Number(res.headers.get('retry-after'));
  return new ProviderError(
    `${provider} HTTP ${res.status}: ${detail.slice(0, 500)}`,
    retryable,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
  );
}
