import LegacyPage from './LegacyPage';
import html from './markup/program-muslim.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function ProgramMuslimPage() {
  return (
    <LegacyPage
      html={html}
      title="Muslim Learners \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "Muslim", activeNavKey: "muslim", title: "Muslim Learners" });
        
      }}
    />
  );
}
