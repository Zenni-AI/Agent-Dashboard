import sharp from 'sharp';
import { getTheme } from '../themes.js';
import type { ImageProvider, RenderRequest } from './types.js';

const THEME_COLORS: Record<string, string[]> = {
  warm_white: ['#ffd9a0'],
  christmas: ['#ff3b30', '#34c759', '#fff4d6'],
  halloween: ['#ff8f00', '#a020f0'],
  patriotic: ['#ff3b30', '#ffffff', '#2f7bff'],
  rainbow: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#2f7bff', '#af52de'],
  ice_blue: ['#8fd8ff', '#ffffff'],
};

/**
 * Offline stand-in for the AI so the whole site can be run and load-tested without API keys:
 * turns the photo to dusk and draws a string of glowing dots across it. Not a real render.
 */
export class MockProvider implements ImageProvider {
  readonly name = 'mock';

  constructor(private readonly delayMs: number) {}

  async render({ image, themeId, signal }: RenderRequest): Promise<Buffer> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.delayMs);
      signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
    });
    const { width = 640, height = 480 } = await sharp(image).metadata();
    const colors = THEME_COLORS[getTheme(themeId).id] ?? ['#ffd9a0'];
    const y = Math.round(height * 0.32);
    const step = Math.max(14, Math.round(width / 40));
    let dots = '';
    for (let x = step, i = 0; x < width; x += step, i++) {
      const c = colors[i % colors.length];
      dots += `<circle cx="${x}" cy="${y}" r="${step * 0.9}" fill="${c}" opacity="0.18"/><circle cx="${x}" cy="${y}" r="${step * 0.22}" fill="${c}"/>`;
    }
    const overlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${dots}` +
        `<text x="12" y="${height - 14}" font-family="sans-serif" font-size="${Math.round(height / 22)}" fill="#fff" opacity="0.8">DEMO MODE — add an AI key for real renders</text></svg>`,
    );
    return sharp(image)
      .modulate({ brightness: 0.45, saturation: 0.8 })
      .tint('#3a4a7a')
      .composite([{ input: overlay }])
      .jpeg({ quality: 85 })
      .toBuffer();
  }
}
