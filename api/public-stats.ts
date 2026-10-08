import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { publicStatsPayload } from '../src/lib/public-stats';

interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  'Vercel-CDN-Cache-Control': 'max-age=60, stale-while-revalidate=300',
  'Content-Type': 'application/json; charset=utf-8',
};

function firestoreDatabase() {
  const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!credentialJson) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');

  const serviceAccount = JSON.parse(credentialJson);
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId || serviceAccount.project_id !== projectId) {
    throw new Error('The service account project does not match VITE_FIREBASE_PROJECT_ID.');
  }

  const appName = 'public-stats-api';
  const app = getApps().find((candidate) => candidate.name === appName)
    || initializeApp({ credential: cert(serviceAccount), projectId }, appName);
  return getFirestore(app);
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.setHeader('Cache-Control', 'no-store');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const snapshot = await firestoreDatabase().collection('publicStats').doc('summary').get();
    Object.entries(CACHE_HEADERS).forEach(([name, value]) => response.setHeader(name, value));
    response.status(200).json(snapshot.exists ? publicStatsPayload(snapshot.data()) : null);
  } catch (error) {
    console.error('Unable to serve cached public statistics.', error);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.status(503).json({ error: 'Public statistics are temporarily unavailable.' });
  }
}
