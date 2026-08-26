import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ReferenceCreator } from "../types.js";
import { log } from "../util/logger.js";

const ReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  niche: z.string(),
  mechanic: z.string(),
  monetization: z.array(z.string()).default([]),
});

const RegistrySchema = z.object({
  creators: z.array(ReferenceSchema),
});

/**
 * The reference registry is data, not code, so an operator can point LITIX at
 * the accounts they actually compete with. The bundled list is a seed — the
 * useful version of this file is the one the user edits.
 */
export async function loadReferences(customPath?: string): Promise<ReferenceCreator[]> {
  const file = customPath ?? defaultRegistryPath();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = RegistrySchema.parse(JSON.parse(raw));
    return parsed.creators;
  } catch (error) {
    log.warn(`Could not load reference registry at ${file}: ${(error as Error).message}`);
    return [];
  }
}

export function referencesForNiche(
  references: ReferenceCreator[],
  niche: string,
): ReferenceCreator[] {
  const exact = references.filter((r) => r.niche === niche);
  return exact.length > 0 ? exact : [];
}

function defaultRegistryPath(): string {
  // ESM has no __dirname; derive the package root from this module's URL.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data/references.json");
}
