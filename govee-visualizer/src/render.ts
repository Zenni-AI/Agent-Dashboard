import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Config } from './config.js';
import type { ImageStore } from './images.js';
import { sendWebhook, type LeadStore } from './leads.js';
import { renderWithRetry, type ImageProvider } from './providers/index.js';
import { JobFailure, type Worker } from './queue.js';
import type { StreetView } from './streetview.js';
import { buildPrompt, getTheme } from './themes.js';

export interface RenderInput {
  leadId: string;
  themeId: string;
  /** Already-normalised house photo (uploaded or from an earlier render). Absent = use Street View. */
  beforeImage?: string;
  /** Where `beforeImage` originally came from. */
  beforeSource?: 'streetview' | 'upload';
  address: string;
  placeId?: string;
}

export interface RenderResult {
  beforeUrl: string;
  afterUrl: string;
  source: 'streetview' | 'upload';
  formattedAddress?: string;
  themeId: string;
}

export interface RenderDeps {
  config: Config;
  leads: LeadStore;
  images: ImageStore;
  streetView: StreetView;
  provider: ImageProvider;
}

export function createRenderWorker({ config, leads, images, streetView, provider }: RenderDeps): Worker<RenderInput, RenderResult> {
  return async (input, setStage) => {
    try {
      let beforeFile = input.beforeImage;
      let beforeJpeg: Buffer;
      let formattedAddress: string | undefined;
      let source: RenderResult['source'] = 'upload';

      if (beforeFile) {
        const file = images.pathFor(beforeFile);
        if (!file) throw new Error(`bad image id ${beforeFile}`);
        beforeJpeg = await readFile(file);
        source = input.beforeSource ?? 'upload';
      } else {
        if (!streetView.enabled) {
          throw new JobFailure('no_street_view', 'Upload a photo of the front of your house and we’ll light it up.');
        }
        setStage('locating');
        const house = await streetView.fetchHouseImage(input.address, input.placeId);
        formattedAddress = house.geocode.formattedAddress;
        leads.setLocation(input.leadId, { formattedAddress, lat: house.geocode.lat, lng: house.geocode.lng });
        beforeJpeg = house.jpeg;
        beforeFile = await images.save(beforeJpeg);
        source = 'streetview';
      }

      setStage('rendering');
      const theme = getTheme(input.themeId);
      const raw = await renderWithRetry(
        provider,
        { image: beforeJpeg, prompt: buildPrompt(theme), themeId: theme.id },
        { timeoutMs: config.generationTimeoutMs },
      );
      setStage('finishing');
      const afterJpeg = await sharp(raw).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const afterFile = await images.save(afterJpeg);
      leads.setImages(input.leadId, beforeFile, afterFile, source);

      const result: RenderResult = {
        beforeUrl: `/img/${beforeFile}`,
        afterUrl: `/img/${afterFile}`,
        source,
        themeId: theme.id,
        ...(formattedAddress ? { formattedAddress } : {}),
      };
      const lead = leads.get(input.leadId);
      void sendWebhook(config.leadWebhookUrl, {
        event: 'render.completed',
        leadId: input.leadId,
        name: lead?.name,
        email: lead?.email,
        phone: lead?.phone,
        address: lead?.formattedAddress ?? lead?.address,
        theme: theme.label,
        beforeUrl: `${config.publicBaseUrl}${result.beforeUrl}`,
        afterUrl: `${config.publicBaseUrl}${result.afterUrl}`,
      });
      return result;
    } catch (err) {
      // A failed attempt shouldn't use up one of the visitor's renders.
      leads.releaseRender(input.leadId);
      throw err;
    }
  };
}
