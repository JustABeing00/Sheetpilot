import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { AuthConfig } from '@auth/core';
import type { Provider } from '@auth/core/providers';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import Resend from '@auth/core/providers/resend';
import { accounts, sessions, users, verificationTokens, type Database } from '@sheetpilot/db';
import type { AppConfig } from '@sheetpilot/config';

export interface AuthEvents {
  /** Called once per newly-created user so the app can provision their personal workspace. */
  onUserCreated?: (user: {
    id?: string;
    name?: string | null;
    email?: string | null;
  }) => Promise<void>;
}

/**
 * Builds the Auth.js configuration used both by the `/api/auth/*` handler and (indirectly) by the
 * session verifier. Only providers with complete credentials are registered, so a deployment can start
 * with email magic link only and add OAuth later without code changes.
 */
export function buildAuthConfig(
  config: AppConfig,
  db: Database,
  events: AuthEvents = {},
): AuthConfig {
  const providers: Provider[] = [];
  const { google, github, email } = config.auth.providers;

  if (google) {
    providers.push(
      Google({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (github) {
    providers.push(
      GitHub({
        clientId: github.clientId,
        clientSecret: github.clientSecret,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (email) {
    providers.push(Resend({ apiKey: email.apiKey, from: email.from }));
  }

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers,
    session: { strategy: 'jwt' },
    secret: config.auth.secret ?? undefined,
    trustHost: config.auth.trustHost,
    basePath: '/api/auth',
    callbacks: {
      jwt({ token, user }) {
        if (user?.id) {
          token.sub = user.id;
        }
        return token;
      },
      session({ session, token }) {
        if (session.user && token.sub) {
          session.user.id = token.sub;
        }
        return session;
      },
    },
    events: {
      async createUser(message) {
        await events.onUserCreated?.({
          id: message.user.id,
          name: message.user.name ?? null,
          email: message.user.email ?? null,
        });
      },
    },
  };
}
