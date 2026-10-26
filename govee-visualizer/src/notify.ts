import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { Config } from './config.js';

export interface DesignNotice {
  name: string;
  email: string;
  phone: string;
  address?: string;
  /** Public page showing all the looks. */
  designUrl: string;
  looks: Array<{ label: string; imagePath: string; imageUrl: string }>;
}

type FetchFn = typeof fetch;
interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
}

export type SendStatus = 'sent' | 'failed' | 'disabled';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends the finished design to the visitor by SMS/MMS (Twilio) and email (any SMTP provider), so they get
 * it whether or not they waited on the page.
 */
export class Notifier {
  private readonly fetchFn: FetchFn;
  private readonly mail?: MailTransport;

  constructor(
    private readonly config: Config,
    opts: { fetchFn?: FetchFn; mail?: MailTransport } = {},
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.mail = opts.mail ?? (config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : undefined);
  }

  get smsEnabled(): boolean {
    const c = this.config;
    return Boolean(c.smsEnabled && c.twilioAccountSid && c.twilioAuthToken && (c.twilioFrom || c.twilioMessagingServiceSid) && c.publicBaseUrl);
  }

  get emailEnabled(): boolean {
    return Boolean(this.mail && this.config.emailFrom && this.config.publicBaseUrl);
  }

  async sendDesign(notice: DesignNotice): Promise<{ sms: SendStatus; email: SendStatus }> {
    const [sms, email] = await Promise.all([
      this.smsEnabled ? this.sendSms(notice).then(ok) : ('disabled' as const),
      this.emailEnabled ? this.sendEmail(notice).then(ok) : ('disabled' as const),
    ]);
    return { sms, email };
  }

  private async sendSms(n: DesignNotice): Promise<boolean> {
    const c = this.config;
    const first = firstName(n.name);
    const body =
      `Hi ${first}! Here's your home lit up with Govee Permanent Outdoor Lights ✨ ` +
      `See all ${n.looks.length} looks: ${n.designUrl}\n` +
      `${c.businessPhone ? `Questions or a free quote? Call ${c.businessPhone}. ` : ''}— ${c.businessName}. Reply STOP to opt out.`;
    const form = new URLSearchParams({ To: n.phone, Body: body });
    if (c.twilioMessagingServiceSid) form.set('MessagingServiceSid', c.twilioMessagingServiceSid);
    else form.set('From', c.twilioFrom);
    // Picture message: carriers fetch the image from a public https URL.
    const picture = n.looks[0]?.imageUrl;
    if (picture?.startsWith('https://')) form.set('MediaUrl', picture);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.twilioAccountSid)}/Messages.json`;
    const auth = Buffer.from(`${c.twilioAccountSid}:${c.twilioAuthToken}`).toString('base64');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return true;
        const detail = await res.text();
        console.warn(`[sms] Twilio HTTP ${res.status}: ${detail.slice(0, 300)}`);
        // 4xx (bad number, opted out, unverified sender…) won't succeed on retry.
        if (res.status !== 429 && res.status < 500) return false;
      } catch (err) {
        console.warn(`[sms] ${(err as Error).message}`);
      }
      if (attempt < 3) await sleep(1000 * 2 ** attempt);
    }
    return false;
  }

  private async sendEmail(n: DesignNotice): Promise<boolean> {
    const c = this.config;
    const first = escapeHtml(firstName(n.name));
    const looks = n.looks
      .map(
        (look, i) => `
          <tr><td style="padding:18px 0 6px;font:600 16px/1.3 Arial,sans-serif;color:#1b1f33">${escapeHtml(look.label)}</td></tr>
          <tr><td><img src="cid:look${i}@design" alt="Your home with ${escapeHtml(look.label)} permanent lights" width="560"
                style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px"></td></tr>`,
      )
      .join('');
    const call = c.businessPhone
      ? `<p style="margin:16px 0 0;font:15px/1.5 Arial,sans-serif;color:#444">Questions? Call us at <a href="tel:${escapeHtml(c.businessPhone.replace(/[^\d+]/g, ''))}">${escapeHtml(c.businessPhone)}</a>.</p>`
      : '';
    const html = `<!doctype html><html><body style="margin:0;background:#f3f1ea">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ea"><tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px">
          <tr><td style="padding:28px 20px 0">
            <h1 style="margin:0;font:700 24px/1.25 Arial,sans-serif;color:#1b1f33">${first}, here's your home lit up ✨</h1>
            <p style="margin:10px 0 0;font:15px/1.5 Arial,sans-serif;color:#444">These are your previews of Govee Permanent Outdoor Lights Pro${n.address ? ` at ${escapeHtml(n.address)}` : ''}. Slide between before and after on your design page:</p>
            <p style="margin:18px 0 0"><a href="${escapeHtml(n.designUrl)}" style="display:inline-block;background:#ff9a3d;color:#1b1205;font:700 16px Arial,sans-serif;text-decoration:none;padding:13px 22px;border-radius:10px">See my design</a></p>
          </td></tr>
          <tr><td style="padding:4px 20px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${looks}</table></td></tr>
          <tr><td style="padding:8px 20px 28px">
            <p style="margin:16px 0 0;font:15px/1.5 Arial,sans-serif;color:#444">We'll be in touch with a free installation quote.</p>${call}
            <p style="margin:24px 0 0;font:12px/1.5 Arial,sans-serif;color:#888">${escapeHtml(c.businessName)} · Previews are AI-generated illustrations; actual results vary. You're receiving this because you requested a lighting preview.</p>
          </td></tr>
        </table>
      </td></tr></table></body></html>`;
    const text = `${firstName(n.name)}, here's your home lit up with Govee Permanent Outdoor Lights Pro.\n\nSee your design: ${n.designUrl}\n\n${
      c.businessPhone ? `Questions? Call ${c.businessPhone}.\n\n` : ''
    }— ${c.businessName}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.mail!.sendMail({
          from: c.emailFrom,
          to: n.email,
          subject: `${firstName(n.name)}, your home with permanent lights ✨`,
          html,
          text,
          attachments: n.looks.map((look, i) => ({
            filename: `${look.label.toLowerCase().replace(/\W+/g, '-')}.jpg`,
            path: look.imagePath,
            cid: `look${i}@design`,
          })),
        });
        return true;
      } catch (err) {
        console.warn(`[email] ${(err as Error).message} (attempt ${attempt})`);
        const code = (err as { responseCode?: number }).responseCode;
        if (code && code >= 500) return false; // permanent SMTP rejection
      }
      if (attempt < 3) await sleep(1000 * 2 ** attempt);
    }
    return false;
  }
}

const ok = (sent: boolean): SendStatus => (sent ? 'sent' : 'failed');

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
