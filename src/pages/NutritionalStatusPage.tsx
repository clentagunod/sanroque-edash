import LegacyPage from './LegacyPage';
import html from './markup/nutritional-status.html?raw';
import { requireAuth } from '../lib/auth';
import { initNutritionPage } from '../lib/nutrition';

export default function NutritionalStatusPage() {
  return (
    <LegacyPage
      html={html}
      title="Nutritional Status - San Roque ES Realtime Enrollment Dashboard"
      onMount={async () => {
        await requireAuth();
    await initNutritionPage();
        
      }}
    />
  );
}
