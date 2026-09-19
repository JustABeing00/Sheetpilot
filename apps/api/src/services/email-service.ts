import type { EmailMessage, EmailSender, Logger } from '@sheetpilot/core';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Injectable for tests, matching the classification provider's pattern. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResendEmailSenderOptions {
  apiKey: string;
  /** The verified sender, e.g. `SheetPilot <no-reply@sheetpilot.com>`. */
  from: string;
  logger: Logger;
  fetchImpl?: FetchLike;
}

/** Sends email through Resend's HTTP API (no SDK dependency). */
export class ResendEmailSender implements EmailSender {
  readonly driver = 'resend';

  constructor(private readonly options: ResendEmailSenderOptions) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await (this.options.fetchImpl ?? fetch)(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.options.logger.warn(
        { status: response.status, detail: detail.slice(0, 500) },
        'Resend rejected an email',
      );
      throw new Error(`Resend returned ${response.status}.`);
    }
  }
}

/** Fallback used when no email provider is configured: logs the message so nothing is lost silently. */
export class LogEmailSender implements EmailSender {
  readonly driver = 'log';

  constructor(private readonly logger: Logger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { to: message.to, subject: message.subject },
      'email not sent (no provider configured); message logged',
    );
    return Promise.resolve();
  }
}
