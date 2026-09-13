import LegacyPage from './LegacyPage';
import '../styles/pages/manage-users.css';
import html from './markup/manage-users.html?raw';
import { requireAuth } from '../lib/auth';
import { initManageUsers } from '../lib/manage-users';
import { initAdminOptions } from '../lib/admin-options';
import '../lib/firestore-backup';

export default function ManageUsersPage() {
  return (
    <LegacyPage
      html={html}
      title="Admin Console \u2014 San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await Promise.all([initManageUsers(), initAdminOptions()]);
        
      }}
    />
  );
}
