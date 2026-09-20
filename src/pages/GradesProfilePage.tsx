import LegacyPage from './LegacyPage';
import html from './markup/grades-profile.html?raw';
import { requireAuth } from '../lib/auth';
import { initGradesProfile } from '../lib/grades-profile';

export default function GradesProfilePage() {
  return (
    <LegacyPage
      html={html}
      title="Grades Profile \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initGradesProfile();
        
      }}
    />
  );
}
