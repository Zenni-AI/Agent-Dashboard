import 'dotenv/config';
import path from 'node:path';

export type ProviderName = 'gemini' | 'openai' | 'mock';

export interface Config {
  port: number;
  /** Public origin, e.g. https://lights.example.com — used for absolute image links in webhooks. */
  publicBaseUrl: string;
  trustProxy: number;
  dataDir: string;

  googleMapsServerKey: string;
  googleMapsBrowserKey: string;
  /** ISO 3166 region codes the address autocomplete is restricted to. */
  addressRegions: string[];

  imageProvider: ProviderName;
  geminiApiKey: string;
  geminiImageModel: string;
  openaiApiKey: string;
  openaiImageModel: string;
  mockDelayMs: number;

  /** How many image generations may hit the AI provider at the same time. */
  maxConcurrentGenerations: number;
  /** Jobs waiting beyond this are rejected with 503 instead of queueing forever. */
  maxQueueLength: number;
  generationTimeoutMs: number;
  maxRendersPerLead: number;

  adminPassword: string;
  leadWebhookUrl: string;

  businessName: string;
  businessPhone: string;
  ctaUrl: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export function loadConfig(): Config {
  const geminiApiKey = str('GEMINI_API_KEY');
  const openaiApiKey = str('OPENAI_API_KEY');
  const requested = str('IMAGE_PROVIDER').toLowerCase();
  let imageProvider: ProviderName;
  if (requested === 'gemini' || requested === 'openai' || requested === 'mock') {
    imageProvider = requested;
  } else if (requested) {
    throw new Error(`IMAGE_PROVIDER must be gemini, openai or mock, got "${requested}"`);
  } else {
    imageProvider = geminiApiKey ? 'gemini' : openaiApiKey ? 'openai' : 'mock';
  }
  if (imageProvider === 'gemini' && !geminiApiKey) throw new Error('IMAGE_PROVIDER=gemini needs GEMINI_API_KEY');
  if (imageProvider === 'openai' && !openaiApiKey) throw new Error('IMAGE_PROVIDER=openai needs OPENAI_API_KEY');

  return {
    port: int('PORT', 3000),
    publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/+$/, ''),
    trustProxy: int('TRUST_PROXY', 0),
    dataDir: path.resolve(str('DATA_DIR', './var')),

    googleMapsServerKey: str('GOOGLE_MAPS_SERVER_KEY'),
    googleMapsBrowserKey: str('GOOGLE_MAPS_BROWSER_KEY'),
    addressRegions: str('ADDRESS_REGIONS', 'us')
      .split(',')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),

    imageProvider,
    geminiApiKey,
    geminiImageModel: str('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),
    openaiApiKey,
    openaiImageModel: str('OPENAI_IMAGE_MODEL', 'gpt-image-1'),
    mockDelayMs: int('MOCK_DELAY_MS', 1500),

    maxConcurrentGenerations: Math.max(1, int('MAX_CONCURRENT_GENERATIONS', 10)),
    maxQueueLength: int('MAX_QUEUE_LENGTH', 1000),
    generationTimeoutMs: int('GENERATION_TIMEOUT_MS', 120_000),
    maxRendersPerLead: Math.max(1, int('MAX_RENDERS_PER_LEAD', 5)),

    adminPassword: str('ADMIN_PASSWORD'),
    leadWebhookUrl: str('LEAD_WEBHOOK_URL'),

    businessName: str('BUSINESS_NAME', 'Bright Home Lighting'),
    businessPhone: str('BUSINESS_PHONE'),
    ctaUrl: str('CTA_URL'),
  };
}
