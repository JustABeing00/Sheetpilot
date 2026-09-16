import { Link, useRouteError } from 'react-router-dom';

/**
 * Route-level error boundary. A lazy chunk that fails to load or a render-time throw previously
 * produced a blank screen; this gives the user a message and a way back.
 */
export function RouteError() {
  const error = useRouteError();
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Something went wrong while loading this page.';

  return (
    <div className="page">
      <div className="error-state" role="alert">
        <strong>This page could not be loaded</strong>
        <p>{message}</p>
        <p>
          <Link className="button" to="/dashboard">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
