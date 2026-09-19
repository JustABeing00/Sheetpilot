# Transactional email

SheetPilot sends two kinds of email:

| Email | Sent by | Template location |
| --- | --- | --- |
| Magic-link sign-in | Auth.js (built-in) via Resend | Auth.js — configured with `AUTH_RESEND_KEY` + `AUTH_EMAIL_FROM` |
| Workspace invitation | `WorkspaceService.sendInvitationEmail` | `apps/api/src/services/workspace-service.ts` |

## Provider configuration

With `AUTH_ENABLED=true`:

- If `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` are set, email is delivered through Resend's HTTP API
  (`ResendEmailSender`, no SDK dependency).
- Otherwise the message is logged instead of sent (`LogEmailSender`) so Google/GitHub-only
  deployments still work and nothing is silently dropped.

`AUTH_URL` is included in invitation emails as the sign-in link.

## Invitation email

Inviting someone creates the invitation row first, then sends a best-effort email:

- **Subject:** `You're invited to join <workspace> on SheetPilot`
- **Text and HTML bodies:** workspace name, invited role, sign-in link, invited address, expiry date,
  and a line explaining the invitation can be ignored.
- A delivery failure is logged and swallowed: the invitation is still valid, and the recipient joins
  automatically the next time they sign in with that address.

Invitations expire after 7 days (`INVITATION_TTL_MS` in `workspace-service.ts`) and are revoked
explicitly from the workspace settings page.

## Testing

- Unit coverage: `apps/api/src/email.test.ts` (Resend request shape, failure handling, service
  wiring) and `apps/api/src/workspace.test.ts` (invitation lifecycle).
- Local: run with a real `AUTH_RESEND_KEY`, or leave it unset and read the logged message instead.
