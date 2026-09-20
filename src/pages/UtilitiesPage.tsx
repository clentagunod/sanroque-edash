import LegacyPage from './LegacyPage';
import html from './markup/utilities.html?raw';
import { requireAuth } from '../lib/auth';
import { initUtilities } from '../lib/utilities';

export default function UtilitiesPage() {
  return (
    <LegacyPage
      html={html}
      title="Utilities \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    initUtilities();
        
      }}
    />
  );
}
