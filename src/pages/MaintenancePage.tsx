import { useEffect, useRef } from 'react';
import '../styles/pages/maintenance.css';
import { APP_CONFIG } from '../lib/app-config';

export default function MaintenancePage() {
  const lottieContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = 'Under Maintenance — San Roque Elementary School';
  }, []);

  const animationUrl = APP_CONFIG.maintenanceAnimationUrl;
  const isLottieEmbed =
    /lottie\.host\/embed\//i.test(animationUrl) ||
    /lottiefiles\.com\/.*embed|player\.lottiefiles\.com/i.test(animationUrl);
  const isLottieJson = !isLottieEmbed && /\.json(?:[?#].*)?$/i.test(animationUrl);

  useEffect(() => {
    if (!animationUrl || !isLottieJson || !lottieContainerRef.current) return;
    const container = lottieContainerRef.current;
    let cancelled = false;
    const renderPlayer = () => {
      if (cancelled || !container) return;
      const player = document.createElement('lottie-player');
      player.setAttribute('src', animationUrl);
      player.setAttribute('background', 'transparent');
      player.setAttribute('speed', '1');
      player.setAttribute('loop', '');
      player.setAttribute('autoplay', '');
      player.setAttribute('aria-label', 'Maintenance animation');
      player.style.width = '100%';
      player.style.height = '100%';
      container.replaceChildren(player);
    };
    if (customElements.get('lottie-player')) {
      renderPlayer();
    } else {
      const existingScript = document.querySelector('script[data-maintenance-lottie]');
      if (existingScript) existingScript.addEventListener('load', renderPlayer, { once: true });
      else {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js';
        script.async = true;
        script.dataset.maintenanceLottie = 'true';
        script.addEventListener('load', renderPlayer, { once: true });
        script.addEventListener('error', () => container.replaceChildren(), { once: true });
        document.head.appendChild(script);
      }
    }
    return () => { cancelled = true; container.replaceChildren(); };
  }, [animationUrl, isLottieJson]);

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
            isLottieEmbed ? <iframe src={animationUrl} title="Maintenance animation" className="maintenance-external-art maintenance-animation-frame" allow="autoplay" /> :
            isLottieJson ? <div ref={lottieContainerRef} className="maintenance-lottie-art" aria-label="Maintenance animation" /> :
            <img src={animationUrl} alt="A playful maintenance animation" className="maintenance-external-art" />
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
          <span>Thanks for your patience from <a href="https://github.com/clentagunod">ClentIndustries</a></span>
          <span className="maintenance-sparkle" aria-hidden="true">✦</span>
        </div>
      </section>
    </main>
  );
}
