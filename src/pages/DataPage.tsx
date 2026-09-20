import LegacyPage from './LegacyPage';
import html from './markup/data.html?raw';
import { requireAuth } from '../lib/auth';
import { initDataPage } from '../lib/data';

export default function DataPage() {
  return (
    <LegacyPage
      html={html}
      title="Data \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initDataPage();
        
      }}
    />
  );
}
