import LegacyPage from './LegacyPage';
import html from './markup/dashboard.html?raw';
import { requireAuth } from '../lib/auth';
import { initDashboard, dashboardLearnerUnsubscribe, dashboardPublicStatsUnsubscribe, dashboardRecentLearnersUnsubscribe } from '../lib/dashboard';

export default function DashboardPage() {
  return (
    <LegacyPage
      html={html}
      title="Dashboard \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initDashboard();
        return () => {
      if (typeof dashboardLearnerUnsubscribe === 'function') dashboardLearnerUnsubscribe();
      if (typeof dashboardPublicStatsUnsubscribe === 'function') dashboardPublicStatsUnsubscribe();
      if (typeof dashboardRecentLearnersUnsubscribe === 'function') dashboardRecentLearnersUnsubscribe();
    };
      }}
    />
  );
}
