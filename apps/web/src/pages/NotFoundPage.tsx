import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.js';

export function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Link className="button button-primary" to="/dashboard">
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
