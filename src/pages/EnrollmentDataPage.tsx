import LegacyPage from './LegacyPage';
import html from './markup/enrollment-data.html?raw';
import { requireAuth } from '../lib/auth';
import { initEnrollmentData, visitorEnrollmentUnsubscribe } from '../lib/enrollment-data';

export default function EnrollmentDataPage() {
  return (
    <LegacyPage
      html={html}
      title="Enrollment Data \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initEnrollmentData();
        return () => {
      if (typeof visitorEnrollmentUnsubscribe === 'function') visitorEnrollmentUnsubscribe();
    };
      }}
    />
  );
}
