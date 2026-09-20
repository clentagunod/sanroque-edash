import { APP_CONFIG } from '../lib/app-config';

export default function TestModeStamp() {
  if (!APP_CONFIG.testMode) return null;
  return <div className="test-mode-stamp" aria-hidden="true">TEST MODE</div>;
}
