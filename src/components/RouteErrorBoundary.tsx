import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wraps the router's <Suspense> so a thrown error while loading or
 * rendering a lazy page (a failed chunk fetch after a redeploy, a bad
 * Firestore response, etc.) shows a retry screen instead of one of two
 * silent failure modes: a blank page, or — if the error happens to keep
 * the lazy import's promise pending instead of rejecting it — a
 * Suspense fallback that spins forever with no way out for the user
 * other than guessing to hit refresh.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('Route failed to load:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            minHeight: '100vh',
            padding: 24,
            textAlign: 'center',
            fontFamily:
              '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          }}
        >
          <h1 style={{ fontSize: 18, margin: 0 }}>This page couldn't load</h1>
          <p style={{ margin: 0, color: '#6b7690', maxWidth: 420 }}>
            Something went wrong while loading this page. This is usually
            temporary — reloading the tab fixes it.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#2f6fed',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
