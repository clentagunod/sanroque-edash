import LegacyPage from './LegacyPage';
import '../styles/pages/feedback.css';
import html from './markup/feedback.html?raw';
import { requireAuth } from '../lib/auth';
import { initFeedback } from '../lib/feedback';

export default function FeedbackPage() {
  return (
    <LegacyPage
      html={html}
      title="Feedback \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    initFeedback();
        
      }}
    />
  );
}
