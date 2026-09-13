import { useEffect, useState } from 'react';

const SLOW_LOAD_WARNING_MS = 8000;

/**
 * Suspense fallback for route-level (lazy-loaded page) transitions. Shown
 * only for the brief moment a page's JS chunk is being fetched — but if
 * that takes unusually long (slow connection, stalled request), it swaps
 * to a message with a manual reload button instead of leaving the person
 * staring at a spinner with no explanation or way out.
 */
export default function RouteLoadingFallback() {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsSlow(true), SLOW_LOAD_WARNING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="app-loading"
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: '100vh',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <span>Loading…</span>
      {isSlow && (
        <>
          <p style={{ margin: 0, color: '#6b7690', maxWidth: 380, fontSize: 14 }}>
            This is taking longer than expected. Your connection may be slow.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e4e8f0',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </>
      )}
    </div>
  );
}
