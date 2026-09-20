import LegacyPage from './LegacyPage';
import html from './markup/program-4ps.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function Program4psPage() {
  return (
    <LegacyPage
      html={html}
      title="4Ps Beneficiaries \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "4Ps", activeNavKey: "4ps", title: "4Ps Beneficiaries" });
        
      }}
    />
  );
}
