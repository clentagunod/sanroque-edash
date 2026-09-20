import LegacyPage from './LegacyPage';
import html from './markup/eosy-report.html?raw';
import { requireAuth } from '../lib/auth';
import { initEosyReport } from '../lib/eosy-report';

export default function EosyReportPage() {
  return (
    <LegacyPage
      html={html}
      title="EOSY Status Report - San Roque ES"
      onMount={async () => {
        await requireAuth();
    await initEosyReport();
        
      }}
    />
  );
}
