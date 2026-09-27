/**
 * @fileoverview Notification module: renders a template in the recipient's
 * language and hands it to the (routed) sender. Every e-mail of the system —
 * codes, reminders, archive links, admin notices — goes through here and is
 * counted.
 */

import type {Locale} from '@ontodecide/shared-kernel';
import {
  isCodeTemplate,
  renderEmail,
  type TemplateData,
  type TemplateId,
} from '../../domain';
import type {EmailSender, SendResult} from '../ports';

/** Sends templated e-mails. */
export class NotificationService {
  constructor(private readonly sender: EmailSender) {}

  /** Renders and sends; the idempotency key deduplicates provider retries. */
  send<T extends TemplateId>(
    template: T,
    to: string,
    locale: Locale,
    data: TemplateData[T],
    idempotencyKey: string,
  ): Promise<SendResult> {
    const body = renderEmail(template, locale, data);
    return this.sender.send(
      {
        to,
        ...body,
        template,
        priority: isCodeTemplate(template) ? 'otp' : 'normal',
      },
      idempotencyKey,
    );
  }
}
