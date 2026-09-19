import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.js';

/**
 * Stripe webhook endpoint. Registered only when `BILLING_PROVIDER=stripe` and a signing secret is
 * configured. The request is authenticated by its signature (not a session or API key from the
 * browser), so `/api/v1/billing/webhook` is exempt from the session guard; the Worker still injects
 * `x-api-key` for transport trust in production.
 */
export function registerBillingRoutes(app: FastifyInstance, container: AppContainer): void {
  const billing = container.billing;
  if (!billing) {
    return;
  }

  app.register((instance) => {
    // The signature covers the exact bytes Stripe sent, so this route must see the raw string body
    // rather than the parsed object. Fastify content-type parsers are scoped to this plugin.
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    instance.post('/api/v1/billing/webhook', async (request, reply) => {
      const header = request.headers['stripe-signature'];
      const signature = Array.isArray(header) ? header[0] : header;
      const rawBody = typeof request.body === 'string' ? request.body : '';
      const result = await billing.handle(rawBody, signature);
      reply.status(result.handled ? 200 : 202);
      return { received: true, handled: result.handled };
    });
  });
}
