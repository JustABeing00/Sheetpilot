import { describe, expect, it, vi } from 'vitest';
import {
  CapturingLogger,
  systemClock,
  type EmailMessage,
  type EmailSender,
} from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import { LogEmailSender, ResendEmailSender, type FetchLike } from './services/email-service.js';
import { WorkspaceService } from './services/workspace-service.js';

class CapturingEmailSender implements EmailSender {
  readonly driver = 'capture';
  readonly sent: EmailMessage[] = [];
  failNext = false;

  send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('provider unavailable'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe('ResendEmailSender', () => {
  it('posts the message to the Resend API with the configured sender', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}', { status: 200 })));
    const sender = new ResendEmailSender({
      apiKey: 're_test',
      from: 'SheetPilot <no-reply@example.com>',
      logger: CapturingLogger.create(),
      fetchImpl,
    });

    await sender.send({ to: 'a@example.com', subject: 'Hi', text: 'Body', html: '<p>Body</p>' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      from?: string;
      to?: string[];
      subject?: string;
      text?: string;
      html?: string;
    };
    expect(body.from).toBe('SheetPilot <no-reply@example.com>');
    expect(body.to).toEqual(['a@example.com']);
    expect(body.subject).toBe('Hi');
    expect(body.text).toBe('Body');
    expect(body.html).toBe('<p>Body</p>');
  });

  it('throws when the provider rejects the message', async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response('nope', { status: 422 })),
    );
    const sender = new ResendEmailSender({
      apiKey: 're_test',
      from: 'SheetPilot <no-reply@example.com>',
      logger: CapturingLogger.create(),
      fetchImpl,
    });

    await expect(sender.send({ to: 'a@example.com', subject: 'Hi', text: 'Body' })).rejects.toThrow(
      '422',
    );
  });
});

describe('LogEmailSender', () => {
  it('logs the message instead of sending it', async () => {
    const logger = CapturingLogger.create();
    await new LogEmailSender(logger).send({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]?.message).toMatch(/email not sent/i);
  });
});

describe('WorkspaceService invitation emails', () => {
  function makeService(emails: EmailSender) {
    const repositories = createInMemoryRepositories();
    const service = new WorkspaceService({
      repositories,
      clock: systemClock,
      logger: CapturingLogger.create(),
      emails,
      loginUrl: 'https://app.sheetpilot.test/login',
    });
    return { repositories, service };
  }

  it('emails the invited address with the workspace and sign-in link', async () => {
    const emails = new CapturingEmailSender();
    const { service } = makeService(emails);
    const workspace = await service.create('owner-1', 'Acme Ops');

    await service.invite(
      'owner-1',
      workspace.id,
      { email: 'Teammate@Example.com', role: 'member' },
      'owner@example.com',
    );

    expect(emails.sent).toHaveLength(1);
    const message = emails.sent[0]!;
    expect(message.to).toBe('teammate@example.com');
    expect(message.subject).toContain('Acme Ops');
    expect(message.text).toContain('https://app.sheetpilot.test/login');
    expect(message.text).toContain('teammate@example.com');
    expect(message.html).toContain('Acme Ops');
  });

  it('keeps the invitation when delivery fails', async () => {
    const emails = new CapturingEmailSender();
    emails.failNext = true;
    const { repositories, service } = makeService(emails);
    const workspace = await service.create('owner-1', 'Acme');

    const invitation = await service.invite(
      'owner-1',
      workspace.id,
      { email: 'teammate@example.com', role: 'member' },
      'owner@example.com',
    );

    expect(emails.sent).toHaveLength(0);
    expect(await repositories.invitations.listByTenant(workspace.id)).toEqual([invitation]);
  });
});
