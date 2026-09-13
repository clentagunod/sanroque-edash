import LegacyPage from './LegacyPage';
import html from './markup/audit-log.html?raw';
import { requireAuth } from '../lib/auth';
import { initAuditLog } from '../lib/audit-log';

export default function AuditLogPage() {
  return (
    <LegacyPage
      html={html}
      title="Audit Log \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initAuditLog();
        
      }}
    />
  );
}
