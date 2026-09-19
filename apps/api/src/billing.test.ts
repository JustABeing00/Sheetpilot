import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  CapturingLogger,
  isAppError,
  systemClock,
  tenantSchema,
  toPublicErrorBody,
} from '@sheetpilot/core';
import { createInMemoryRepositories } from '@sheetpilot/db';
import type { AppContainer } from './container.js';
import { registerBillingRoutes } from './http/routes/billing.js';
import { BillingService, verifyStripeSignature } from './services/billing-service.js';

const SECRET = 'whsec_test_secret';

function sign(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function stripeEvent(type: string, metadata: Record<string, string>): string {
  return JSON.stringify({ id: 'evt_test', type, data: { object: { metadata } } });
}

async function makeBilling() {
  const repositories = createInMemoryRepositories();
  const logger = CapturingLogger.create();
  const billing = new BillingService({
    repositories,
    clock: systemClock,
    logger,
    webhookSecret: SECRET,
  });
  const now = systemClock.now();
  await repositories.tenants.create(
    tenantSchema.parse({
      id: 'tenant-1',
      name: 'Acme',
      slug: 'acme',
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    }),
  );
  return { repositories, billing };
}

describe('Stripe webhook signatures', () => {
  it('accepts a valid signature and rejects tampering, wrong secrets and stale timestamps', () => {
    const payload = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'pro',
    });
    const header = sign(payload);

    expect(verifyStripeSignature(payload, header, SECRET)).toBe(true);
    expect(verifyStripeSignature(`${payload} `, header, SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, header, 'whsec_other')).toBe(false);
    expect(verifyStripeSignature(payload, 'nonsense', SECRET)).toBe(false);

    const stale = sign(payload, SECRET, Math.floor(Date.now() / 1000) - 10_000);
    expect(verifyStripeSignature(payload, stale, SECRET)).toBe(false);
  });
});

describe('BillingService', () => {
  it('upgrades a tenant plan from checkout metadata', async () => {
    const { repositories, billing } = await makeBilling();
    const payload = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'pro',
    });

    const result = await billing.handle(payload, sign(payload));
    expect(result).toEqual({ handled: true, tenantId: 'tenant-1', plan: 'pro' });
    expect((await repositories.tenants.getById('tenant-1'))?.plan).toBe('pro');
  });

  it('downgrades a tenant to the fallback plan when the subscription is deleted', async () => {
    const { repositories, billing } = await makeBilling();
    const upgrade = stripeEvent('customer.subscription.updated', {
      tenantId: 'tenant-1',
      plan: 'enterprise',
    });
    await billing.handle(upgrade, sign(upgrade));

    const payload = stripeEvent('customer.subscription.deleted', { tenantId: 'tenant-1' });
    const result = await billing.handle(payload, sign(payload));
    expect(result).toEqual({ handled: true, tenantId: 'tenant-1', plan: 'free' });
    expect((await repositories.tenants.getById('tenant-1'))?.plan).toBe('free');
  });

  it('rejects an invalid signature', async () => {
    const { billing } = await makeBilling();
    const payload = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'pro',
    });
    await expect(billing.handle(payload, 't=1,v1=deadbeef')).rejects.toThrow(/signature/i);
  });

  it('ignores unrelated events, missing metadata and unknown tenants', async () => {
    const { billing } = await makeBilling();

    const unrelated = stripeEvent('invoice.paid', { tenantId: 'tenant-1', plan: 'pro' });
    expect((await billing.handle(unrelated, sign(unrelated))).handled).toBe(false);

    const noTenant = stripeEvent('checkout.session.completed', { plan: 'pro' });
    expect((await billing.handle(noTenant, sign(noTenant))).handled).toBe(false);

    const badPlan = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'gold',
    });
    expect((await billing.handle(badPlan, sign(badPlan))).handled).toBe(false);

    const unknown = stripeEvent('checkout.session.completed', { tenantId: 'nope', plan: 'pro' });
    expect((await billing.handle(unknown, sign(unknown))).handled).toBe(false);
  });
});

describe('billing webhook route', () => {
  async function buildApp(billing: BillingService) {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (isAppError(error)) {
        reply.status(error.statusCode).send(toPublicErrorBody(error));
        return;
      }
      reply.status(500).send({ error: { code: 'internal_error', message: 'unexpected' } });
    });
    registerBillingRoutes(app, { billing } as unknown as AppContainer);
    await app.ready();
    return app;
  }

  it('accepts a signed event and applies the plan change', async () => {
    const { repositories, billing } = await makeBilling();
    const app = await buildApp(billing);
    const payload = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'enterprise',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhook',
      payload,
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(payload) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, handled: true });
    expect((await repositories.tenants.getById('tenant-1'))?.plan).toBe('enterprise');
  });

  it('rejects an unsigned request without touching the tenant', async () => {
    const { repositories, billing } = await makeBilling();
    const app = await buildApp(billing);
    const payload = stripeEvent('checkout.session.completed', {
      tenantId: 'tenant-1',
      plan: 'pro',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhook',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(403);
    expect((await repositories.tenants.getById('tenant-1'))?.plan).toBe('free');
  });
});
