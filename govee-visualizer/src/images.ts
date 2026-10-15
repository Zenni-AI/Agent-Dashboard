import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { JobFailure } from './queue.js';

/** Image ids are 128 random bits: unguessable, so a link to someone's house can't be enumerated. */
export const IMAGE_ID = /^[a-f0-9]{32}\.jpg$/;

export class ImageStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'images');
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  async save(jpeg: Buffer): Promise<string> {
    const file = `${randomBytes(16).toString('hex')}.jpg`;
    await writeFile(path.join(this.dir, file), jpeg);
    return file;
  }

  pathFor(file: string): string | undefined {
    return IMAGE_ID.test(file) ? path.join(this.dir, file) : undefined;
  }
}

/**
 * Re-encodes any image to a clean, upright JPEG of bounded size. Decoding with sharp is also the real
 * file-type check: the browser-supplied MIME type is not trusted. EXIF (including GPS) is dropped.
 */
export async function normalizePhoto(input: Buffer, maxEdge = 1536): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new JobFailure('bad_image', "We couldn't read that image. Please upload a JPG or PNG photo of your house.");
  }
}
