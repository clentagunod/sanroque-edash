import LegacyPage from './LegacyPage';
import html from './markup/program-sned.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function ProgramSnedPage() {
  return (
    <LegacyPage
      html={html}
      title="SNED Learners \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "SNED", activeNavKey: "sned", title: "SNED Learners" });
        
      }}
    />
  );
}
