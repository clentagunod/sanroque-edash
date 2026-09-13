import LegacyPage from './LegacyPage';
import html from './markup/masterlist.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function MasterlistPage() {
  return (
    <LegacyPage
      html={html}
      title="Learner Masterlist \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "", activeNavKey: "masterlist", title: "Learner Masterlist" });
        
      }}
    />
  );
}
