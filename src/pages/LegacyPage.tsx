import { useEffect, useRef } from 'react';

/**
 * Renders one page's original static markup (extracted verbatim from the
 * legacy site's pages/*.html) and then runs that page's original
 * initialization logic (ported to src/lib/*.ts) against it — exactly the
 * same "render shell + query the DOM by id" flow the legacy site used,
 * just driven by a React component + router instead of a full page load.
 *
 * See README.md for why this "island" approach was chosen
 * over a full field-by-field rewrite.
 */
export interface LegacyPageProps {
  html: string;
  title: string;
  /** Runs after the markup is in the DOM. May return a cleanup function
   *  (e.g. to unsubscribe Firestore listeners) that runs on unmount. */
  onMount: () => void | (() => void) | Promise<void | (() => void)>;
}

export function sectionTitle(title: string) {
  return String(title || "")
    .split(/(?:\\u2014|—|\s+[–-]\s+)/, 1)[0]
    .trim();
}

export default function LegacyPage({ html, title, onMount }: LegacyPageProps) {
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    document.title = sectionTitle(title);
    let cancelled = false;
    let cleanup: void | (() => void);
    Promise.resolve(onMountRef.current()).then((c) => {
      if (cancelled && typeof c === 'function') {
        c();
        return;
      }
      cleanup = c;
    });
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, title]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
