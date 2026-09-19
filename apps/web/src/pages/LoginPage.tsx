import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { signInWithEmail, signInWithProvider } from '../api/auth.js';
import { useMeta, useSession } from '../api/hooks.js';
import { Alert, Field, LoadingState } from '../components/ui.js';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function LoginPage() {
  const meta = useMeta();
  const session = useSession();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  if (meta.isPending || session.isPending) {
    return (
      <div className="login">
        <LoadingState label="Loading…" />
      </div>
    );
  }

  if (meta.data && !meta.data.capabilities.authEnabled) {
    return <Navigate to="/dashboard" replace />;
  }

  if (session.data) {
    return <Navigate to={from} replace />;
  }

  const providers = meta.data?.capabilities.authProviders ?? [];
  const callbackUrl = `${window.location.origin}${from}`;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('sending');
    setMessage('');
    try {
      await signInWithEmail(email.trim(), callbackUrl);
      setStatus('sent');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <Link className="landing-brand login-brand" to="/">
          <span className="brand-mark" aria-hidden="true">
            SP
          </span>
          <strong>SheetPilot</strong>
        </Link>

        <h1>Sign in</h1>
        <p className="login-lead">
          Sign in to run your spreadsheets through SheetPilot and review the exceptions.
        </p>

        {status === 'sent' ? (
          <Alert tone="success" title="Check your inbox">
            We sent a sign-in link to <strong>{email}</strong>. Open it on this device to continue.
          </Alert>
        ) : (
          <>
            {status === 'error' ? <Alert tone="danger">{message}</Alert> : null}

            {providers.includes('email') ? (
              <form
                className="login-form"
                onSubmit={(event) => {
                  void onSubmit(event);
                }}
              >
                <Field label="Work email">
                  <input
                    className="input"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <button
                  className="button button-primary button-pill login-submit"
                  type="submit"
                  disabled={status === 'sending' || email.trim().length === 0}
                >
                  {status === 'sending' ? 'Sending link…' : 'Continue with email'}
                </button>
              </form>
            ) : null}

            {providers.some((provider) => provider === 'google' || provider === 'github') ? (
              <>
                {providers.includes('email') ? (
                  <div className="login-divider">
                    <span>or</span>
                  </div>
                ) : null}
                <div className="login-providers">
                  {providers.includes('google') ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => signInWithProvider('google', callbackUrl)}
                    >
                      Continue with Google
                    </button>
                  ) : null}
                  {providers.includes('github') ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => signInWithProvider('github', callbackUrl)}
                    >
                      Continue with GitHub
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        )}

        <p className="login-note">
          By continuing you agree to the terms of service. We never send your files to a third party
          unless an AI provider is explicitly enabled.
        </p>
      </div>

      <Link className="login-back" to="/">
        ← Back to home
      </Link>
    </div>
  );
}
