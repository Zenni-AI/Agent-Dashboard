import { describe, expect, it } from 'vitest';
import { leadsToCsv, type Lead } from '../src/leads.js';
import { leadSchema, normalizePhone } from '../src/validation.js';

describe('normalizePhone', () => {
  it.each([
    ['(555) 234-5678', '+15552345678'],
    ['555.234.5678', '+15552345678'],
    ['1-555-234-5678', '+15552345678'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (raw, e164) => expect(normalizePhone(raw)).toBe(e164));

  it.each(['123', '555-1234', '(055) 234-5678', 'call me'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeUndefined());
});

describe('leadSchema', () => {
  const ok = { name: 'Jane Smith', email: ' Jane@Example.com ', phone: '(555) 234-5678', address: '1 Main St, Town', consent: 'true' };

  it('accepts and normalises a good lead', () => {
    const r = leadSchema.parse(ok);
    expect(r.email).toBe('jane@example.com');
    expect(r.phone).toBe('+15552345678');
  });

  it('requires consent', () => expect(leadSchema.safeParse({ ...ok, consent: undefined }).success).toBe(false));
  it('rejects bots that fill the honeypot', () => expect(leadSchema.safeParse({ ...ok, website: 'http://spam' }).success).toBe(false));
  it('rejects junk place ids', () => expect(leadSchema.safeParse({ ...ok, placeId: 'abc&key=x' }).success).toBe(false));
});

describe('leadsToCsv', () => {
  it('neutralises spreadsheet formulas and escapes quotes', () => {
    const lead = { id: 'x', createdAt: 't', name: '=HYPERLINK("http://evil")', email: 'a@b.c', phone: '+1', address: 'A "B"', consent: true, renderCount: 0 } as Lead;
    const csv = leadsToCsv([lead], 'https://x');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"A ""B"""');
  });

  it('keeps E.164 phone numbers readable but still guards other leading "+"', () => {
    const lead = { id: 'x', createdAt: 't', name: '+1+cmd|calc', email: 'a@b.c', phone: '+15552345678', address: 'A', consent: true, renderCount: 0 } as Lead;
    const csv = leadsToCsv([lead], '');
    expect(csv).toContain('"+15552345678"');
    expect(csv).toContain(`"'+1+cmd|calc"`);
  });
});
