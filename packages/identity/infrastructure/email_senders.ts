/**
 * @fileoverview EmailSender adapters: Resend (primary, REST with
 * Idempotency-Key), Brevo (fallback, REST with an idempotency header) and
 * the local `EMAIL_MODE=log` sender. Open and click tracking are disabled in
 * both provider accounts (links must not be rewritten); nothing here adds
 * tracking.
 */

import {sha256Hex, type Logger} from '@ontodecide/shared-kernel';
import {isCodeTemplate, maskEmail} from '../domain';
import type {EmailMessage, EmailSender, SendResult} from '../application';

/** Parsed `MAIL_FROM` (`noreply@…` or `Name <noreply@…>`). */
export function parseMailFrom(from: string): {name: string; email: string} {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (m) return {name: m[1] || 'OntoDecide', email: m[2]};
  return {name: 'OntoDecide', email: from.trim()};
}

/** Resend REST adapter. */
export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage, idempotencyKey: string): Promise<SendResult> {
    const f = parseMailFrom(this.from);
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from: `${f.name} <${f.email}>`,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    return {ok: res.ok, status: res.status};
  }
}

/** Brevo transactional REST adapter. */
export class BrevoSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage, idempotencyKey: string): Promise<SendResult> {
    const f = parseMailFrom(this.from);
    const res = await this.fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {name: f.name, email: f.email},
        to: [{email: msg.to}],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        headers: {idempotencyKey},
      }),
    });
    return {ok: res.ok, status: res.status};
  }
}

/**
 * Local sender: logs one redacted line (template, masked recipient, key
 * hash). Outside production the one-time code is included so that local
 * sign-in works without a mail provider.
 */
export class LogEmailSender implements EmailSender {
  constructor(
    private readonly logger: Logger,
    private readonly includeCodes: boolean,
  ) {}

  async send(msg: EmailMessage, idempotencyKey: string): Promise<SendResult> {
    const fields: Record<string, unknown> = {
      template: msg.template,
      to: maskEmail(msg.to),
      key: (await sha256Hex(idempotencyKey)).slice(0, 12),
    };
    if (this.includeCodes && isCodeTemplate(msg.template)) {
      fields['code'] = /\b(\d{6})\b/.exec(msg.subject)?.[1];
    }
    this.logger.info('mail.logged', fields);
    return {ok: true, status: 200, channel: 'log'};
  }
}
