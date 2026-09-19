/** A plain transactional email. `html` is optional; `text` must always be present as the fallback. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbound transactional email (workspace invitations, and future notifications). Implementations
 * must be safe to call when the surrounding action should still succeed if delivery fails — callers
 * decide whether a failure is fatal.
 */
export interface EmailSender {
  readonly driver: string;
  send(message: EmailMessage): Promise<void>;
}
