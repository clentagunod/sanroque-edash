import { useEffect, useRef } from 'react';
import '../styles/pages/login.css';
import html from './markup/login.html?raw';
import { forceLoginPageLightTheme, initLoginPage } from '../lib/auth';
import { auth } from '../lib/firebase';
import { clearVisitorSession, ensureVisitorSession } from '../lib/app-config';

export default function LoginPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'San Roque Elementary School — Realtime Enrollment Dashboard';

    // The login page is always light — even with a saved dark preference —
    // so strip any theme classes that survived a page load. Without this a
    // client-side navigation to "/" (e.g. the router catch-all) would keep
    // the dark theme applied to the login screen.
    forceLoginPageLightTheme();

    // Same wiring as the original index.html inline <script>: initLoginPage()
    // handles the sign-in form itself; the two listeners below are ported
    // verbatim from that inline script.
    const cleanupLogin = initLoginPage();

    const visitorBtn = document.getElementById('visitorLoginBtn');
    const onVisitorClick = () => {
      clearVisitorSession();
      ensureVisitorSession(true);
      window.location.href = 'pages/dashboard.html?visitor=1';
    };
    visitorBtn?.addEventListener('click', onVisitorClick);

    const forgotLink = document.getElementById('forgotPasswordLink');
    const onForgotClick = async (e: Event) => {
      e.preventDefault();
      const emailInput = document.getElementById('email') as HTMLInputElement | null;
      const email = emailInput?.value.trim() ?? '';
      const alertBox = document.getElementById('loginAlert') as HTMLElement | null;
      if (!email) {
        if (alertBox) {
          alertBox.textContent = 'Enter your email above first, then click "Forgot password?" again.';
          alertBox.classList.add('is-visible');
        }
        return;
      }
      try {
        await auth.sendPasswordResetEmail(email);
        if (alertBox) {
          alertBox.style.background = 'var(--success-100)';
          alertBox.style.color = 'var(--success-600)';
          alertBox.textContent = 'Password reset link sent. Please check your email inbox.';
          alertBox.classList.add('is-visible');
        }
      } catch (err) {
        if (alertBox) {
          alertBox.style.background = 'var(--danger-100)';
          alertBox.style.color = 'var(--danger-600)';
          alertBox.textContent = "We couldn't send a reset link for that email.";
          alertBox.classList.add('is-visible');
        }
      }
    };
    forgotLink?.addEventListener('click', onForgotClick);

    return () => {
      cleanupLogin?.();
      visitorBtn?.removeEventListener('click', onVisitorClick);
      forgotLink?.removeEventListener('click', onForgotClick);
    };
  }, []);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
