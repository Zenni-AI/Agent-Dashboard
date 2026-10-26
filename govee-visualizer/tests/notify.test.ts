import { describe, expect, it } from 'vitest';
import { Notifier, type DesignNotice } from '../src/notify.js';
import { testConfig } from './helpers.js';

const notice: DesignNotice = {
  name: '<b>Jane</b> Smith',
  email: 'jane@example.com',
  phone: '+15552345678',
  address: '1 Main St',
  designUrl: 'https://lights.example.com/d/abc',
  looks: [{ label: 'Warm White', imagePath: '/x.jpg', imageUrl: 'https://lights.example.com/img/x.jpg' }],
};
const twilio = { smsEnabled: true, publicBaseUrl: 'https://lights.example.com', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioMessagingServiceSid: 'MG1' };

describe('Notifier', () => {
  it('is off unless fully configured', () => {
    expect(new Notifier(testConfig()).smsEnabled).toBe(false);
    expect(new Notifier(testConfig({ ...twilio, publicBaseUrl: '' })).smsEnabled).toBe(false);
    expect(new Notifier(testConfig({ ...twilio, smsEnabled: false })).smsEnabled).toBe(false);
    expect(new Notifier(testConfig(twilio)).smsEnabled).toBe(true);
  });

  it('uses a messaging service when configured and escapes names in email', async () => {
    const calls: Array<{ url: string; body: URLSearchParams; auth: string }> = [];
    const mails: any[] = [];
    const n = new Notifier(testConfig({ ...twilio, emailFrom: 'a@b.c' }), {
      fetchFn: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: init.body as URLSearchParams, auth: (init.headers as Record<string, string>).authorization });
        return Response.json({}, { status: 201 });
      }) as unknown as typeof fetch,
      mail: { sendMail: async (m) => void mails.push(m) },
    });
    expect(await n.sendDesign(notice)).toEqual({ sms: 'sent', email: 'sent' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(calls[0]!.body.get('MessagingServiceSid')).toBe('MG1');
    expect(calls[0]!.body.get('From')).toBeNull();
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from('AC1:t').toString('base64')}`);
    expect(mails[0].html).toContain('&lt;b&gt;Jane&lt;/b&gt;');
    expect(mails[0].html).not.toContain('<b>Jane</b>');
  });

  it('does not retry numbers Twilio rejects', async () => {
    let tries = 0;
    const n = new Notifier(testConfig(twilio), {
      fetchFn: (async () => {
        tries++;
        return Response.json({ code: 21610, message: 'unsubscribed' }, { status: 400 });
      }) as unknown as typeof fetch,
    });
    const origWarn = console.warn;
    console.warn = () => {};
    expect((await n.sendDesign(notice)).sms).toBe('failed');
    console.warn = origWarn;
    expect(tries).toBe(1);
  });
});
