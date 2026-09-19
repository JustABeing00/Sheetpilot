import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenError,
  planIdSchema,
  ValidationError,
  type Clock,
  type Logger,
  type PlanId,
  type Repositories,
  type Tenant,
} from '@sheetpilot/core';

/** How far a webhook timestamp may drift from now before it is rejected (replay protection). */
const DEFAULT_TOLERANCE_SECONDS = 300;

const UPGRADE_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
]);

const DOWNGRADE_EVENT = 'customer.subscription.deleted';

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

export interface BillingServiceDeps {
  repositories: Repositories;
  clock: Clock;
  logger: Logger;
  /** The endpoint's signing secret (`whsec_...`) from the Stripe dashboard. */
  webhookSecret: string;
  /** Plan applied when a subscription is cancelled; defaults to the free plan. */
  fallbackPlan?: PlanId;
}

export interface BillingEventResult {
  handled: boolean;
  tenantId?: string;
  plan?: PlanId;
}

/**
 * Verifies the `stripe-signature` header: Stripe signs `"{timestamp}.{payload}"` with the endpoint
 * secret and sends the HMAC-SHA256 hex digest alongside the timestamp. Multiple `v1` signatures are
 * accepted so a secret can be rotated without dropping events.
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value !== undefined) {
      timestamp = Number.parseInt(value, 10);
    } else if (key === 'v1' && value !== undefined) {
      signatures.push(value);
    }
  }
  if (timestamp === null || Number.isNaN(timestamp) || signatures.length === 0) {
    return false;
  }
  if (Math.abs(now - timestamp) > tolerance) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((signature) => {
    const provided = Buffer.from(signature, 'hex');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

function readMetadata(object: Record<string, unknown>): Record<string, string> {
  const metadata = object['metadata'];
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Applies Stripe subscription events to tenant plans. The contract is metadata-driven: a Checkout
 * Session (or Subscription) must carry `metadata.tenantId` and `metadata.plan`; cancellation events
 * only need `tenantId`. No Stripe SDK is required and no payment data is stored — the API only keeps
 * the resulting plan on the tenant row.
 */
export class BillingService {
  readonly driver = 'stripe';

  constructor(private readonly deps: BillingServiceDeps) {}

  async handle(rawBody: string, signatureHeader: string | undefined): Promise<BillingEventResult> {
    if (!verifyStripeSignature(rawBody, signatureHeader ?? '', this.deps.webhookSecret)) {
      this.deps.logger.warn({}, 'rejected a Stripe webhook with an invalid signature');
      throw new ForbiddenError('Invalid Stripe signature.');
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      throw new ValidationError('The Stripe webhook payload is not valid JSON.');
    }

    const type = event.type ?? '';
    const isDowngrade = type === DOWNGRADE_EVENT;
    if (!UPGRADE_EVENTS.has(type) && !isDowngrade) {
      this.deps.logger.info({ type }, 'ignored an unrelated Stripe event');
      return { handled: false };
    }

    const metadata = readMetadata(event.data?.object ?? {});
    const tenantId = metadata['tenantId'];
    if (!tenantId) {
      this.deps.logger.info({ type }, 'ignored a Stripe event without tenant metadata');
      return { handled: false };
    }

    const plan = isDowngrade
      ? (this.deps.fallbackPlan ?? 'free')
      : planIdSchema.safeParse(metadata['plan']).data;
    if (!plan) {
      this.deps.logger.info({ type, tenantId }, 'ignored a Stripe event without a valid plan');
      return { handled: false };
    }

    const tenant = await this.deps.repositories.tenants.getById(tenantId);
    if (!tenant) {
      this.deps.logger.warn({ tenantId, type }, 'Stripe event referenced an unknown tenant');
      return { handled: false };
    }
    if (tenant.plan === plan) {
      return { handled: true, tenantId, plan };
    }

    const updated: Tenant = { ...tenant, plan, updatedAt: this.deps.clock.now() };
    await this.deps.repositories.tenants.update(updated);
    this.deps.logger.info({ tenantId, plan, type }, 'tenant plan updated from Stripe');
    return { handled: true, tenantId, plan };
  }
}
