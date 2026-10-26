import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Config } from '../src/config.js';

export function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'govee-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    publicBaseUrl: 'https://lights.example.com',
    trustProxy: 0,
    dataDir: '',
    googleMapsServerKey: '',
    googleMapsBrowserKey: '',
    addressRegions: ['us'],
    imageProvider: 'mock',
    geminiApiKey: '',
    geminiImageModel: 'gemini-2.5-flash-image',
    openaiApiKey: '',
    openaiImageModel: 'gpt-image-1',
    mockDelayMs: 20,
    maxConcurrentGenerations: 4,
    maxQueueLength: 1000,
    generationTimeoutMs: 10_000,
    maxDesignsPerLead: 2,
    lightSpacingInches: 12,
    smsEnabled: false,
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFrom: '',
    twilioMessagingServiceSid: '',
    smtpUrl: '',
    emailFrom: '',
    adminPassword: 'hunter2',
    leadWebhookUrl: '',
    businessName: 'Test Lighting',
    businessPhone: '',
    ctaUrl: '',
    privacyUrl: '',
    ...overrides,
  };
}

/** A small synthetic "house" photo. */
export function houseJpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#88aacc' } })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${width * 0.2},${height * 0.5} ${width * 0.5},${height * 0.2} ${width * 0.8},${height * 0.5}" fill="#664433"/><rect x="${width * 0.25}" y="${height * 0.5}" width="${width * 0.5}" height="${height * 0.35}" fill="#ddccaa"/></svg>`,
        ),
      },
    ])
    .jpeg()
    .toBuffer();
}
