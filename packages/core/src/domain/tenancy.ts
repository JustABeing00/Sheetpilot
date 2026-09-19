import { z } from 'zod';
import { planIdSchema } from './plans.js';

/**
 * A tenant is the isolation boundary: an organization (or a solo user's personal workspace) whose
 * data is invisible to every other tenant. Every tenant-scoped row carries a `tenantId`.
 */
export const membershipRoleSchema = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  /** The commercial plan governing quotas. Billing (or an operator) may change it. */
  plan: planIdSchema.default('free'),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const membershipSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: membershipRoleSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const invitationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  email: z.string().email(),
  role: membershipRoleSchema,
  invitedBy: z.string().nullable().default(null),
  acceptedAt: z.date().nullable().default(null),
  expiresAt: z.date(),
  createdAt: z.date(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** Roles that may administer a tenant (invite, remove, rename, delete). */
export function canManageTenant(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Turns a display name into a URL-safe slug. Uniqueness is enforced by the caller/repository
 * (a short suffix is appended on collision); this only produces the base candidate.
 */
export function tenantSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'workspace';
}

/** The default personal workspace name for a user who has no organization yet. */
export function personalTenantName(userLabel: string | null | undefined): string {
  const label = (userLabel ?? '').trim();
  return label.length > 0 ? `${label}'s workspace` : 'My workspace';
}
