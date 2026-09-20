import LegacyPage from './LegacyPage';
import html from './markup/reports.html?raw';
import { requireAuth } from '../lib/auth';
import { initReports } from '../lib/reports';

export default function ReportsPage() {
  return (
    <LegacyPage
      html={html}
      title="Statistics \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initReports();
        
      }}
    />
  );
}
