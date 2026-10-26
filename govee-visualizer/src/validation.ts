import { z } from 'zod';

/** Normalises to E.164. Bare 10-digit numbers are treated as US/Canada. */
export function normalizePhone(raw: string): string | undefined {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  if (digits.length === 10) return /^[2-9]\d{2}[2-9]/.test(digits) ? `+1${digits}` : undefined;
  if (digits.length === 11 && digits.startsWith('1')) return normalizePhone(`+${digits}`);
  return undefined;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email').max(254)),
  phone: z
    .string()
    .max(30)
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) ctx.addIssue({ code: 'custom', message: 'Please enter a valid phone number' });
      return phone ?? '';
    }),
  address: z.string().trim().min(5, 'Please enter your home address').max(200),
  placeId: z
    .string()
    .trim()
    .max(300)
    .regex(/^[A-Za-z0-9_-]*$/)
    .optional()
    .transform((v) => v || undefined),
  consent: z.literal('true', { error: 'Please agree so we can contact you about your design' }),
  // Honeypot: invisible to humans, bots fill it in.
  website: z.string().max(0, 'Invalid submission').optional(),
  utmSource: optionalText(100),
  utmMedium: optionalText(100),
  utmCampaign: optionalText(100),
  referrer: optionalText(500),
});

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request';
}
