import { useEffect } from 'react';
import '../styles/pages/maintenance.css';
import { APP_CONFIG } from '../lib/app-config';

export default function MaintenancePage() {
  useEffect(() => {
    document.title = 'Under Maintenance — San Roque Elementary School';
  }, []);

  const animationUrl = APP_CONFIG.maintenanceAnimationUrl;

  return (
    <main className="maintenance-page">
      <div className="maintenance-orb maintenance-orb-one" aria-hidden="true" />
      <div className="maintenance-orb maintenance-orb-two" aria-hidden="true" />
      <div className="maintenance-grid" aria-hidden="true" />

      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-card-topline">
          <span className="maintenance-status-dot" aria-hidden="true" />
          <span>System update in progress</span>
        </div>

        <div className={`maintenance-art${animationUrl ? ' has-external-art' : ''}`}>
          {animationUrl ? (
            <img
              src={animationUrl}
              alt="A playful maintenance animation"
              className="maintenance-external-art"
            />
          ) : (
            <div className="maintenance-rocket" aria-hidden="true">
              <span className="maintenance-rocket-window" />
              <span className="maintenance-rocket-flame" />
            </div>
          )}
        </div>

        <p className="maintenance-eyebrow">San Roque Elementary School</p>
        <h1 id="maintenance-title">
          We’re making things
          <span> even better.</span>
        </h1>
        <p className="maintenance-copy">
          The dashboard is taking a quick little nap while we polish the
          experience. Please check back soon — your school data will be waiting
          right where you left it.
        </p>

        <div className="maintenance-progress" aria-label="Maintenance in progress">
          <span />
        </div>
        <div className="maintenance-footer">
          <span>Thanks for your patience</span>
          <span className="maintenance-sparkle" aria-hidden="true">✦</span>
        </div>
      </section>
    </main>
  );
}
