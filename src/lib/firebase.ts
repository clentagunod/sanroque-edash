// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
declare const firebase: any;

import { APP_CONFIG } from './app-config';
import { LPSCache } from './cache';

/**
 * ============================================================================
 * FIREBASE CONFIGURATION
 * ============================================================================
 * Firebase and Apps Script public runtime values are maintained in
 * `app-config.js`. This file initializes Firebase and exposes the shared
 * `auth` and Firebase runtime values to the rest of the site.
 *
 * WHERE TO GET THESE VALUES (see SETUP_GUIDE.md, Section 2):
 *   Firebase Console → Project settings (gear icon) → General tab →
 *   "Your apps" card → the </> (Web app) → firebaseConfig object.
 *
 * SECURITY NOTE: unlike a database password, this config is *meant* to be
 * public — it ships inside every browser that loads your site. Real access
 * control happens with Firebase Authentication (who can sign in) and, later,
 * with checks in your Google Apps Script backend (Part 2 of the guide). Do
 * NOT paste a "service account" JSON file here — that is a different,
 * secret credential and must never appear in frontend code.
 * ============================================================================
 */

// Configuration values are maintained in app-config.js.
export const firebaseConfig = APP_CONFIG.firebase;

// Initialize Firebase (compat SDK — chosen so this project runs from plain
// <script> tags with no build step, which keeps setup simple for a school).
firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export let userCreationAuth = null;

export function getUserCreationAuth() {
	if (!userCreationAuth) {
		const app = firebase.apps.find((item) => item.name === "user-creation") || firebase.initializeApp(firebaseConfig, "user-creation");
		userCreationAuth = app.auth();
	}
	return userCreationAuth;
}
// Keep the sign-in available while moving between the separate HTML pages,
// but do not block the UI on browser storage initialization. Some browsers
// reject local persistence and the rest of the app should still render quickly.
export const authPersistenceReady = Promise.resolve();
void auth
	.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
	.catch(() => auth.setPersistence(firebase.auth.Auth.Persistence.SESSION))
	.catch(() => undefined);

/**
 * Google Apps Script Web App URL.
 * You get this in SETUP_GUIDE.md, Part 2, Step 6, after you deploy the
 * Apps Script project as a Web App. It looks like:
 *   https://script.google.com/macros/s/AKfycb.../exec
 */
// Application records are stored in Firestore. Google Apps Script is used
// only by the separately deployed Feedback and AuditLog services.
export const SHEETS_API_URL = "";

/**
 * Firestore (live database).
 * Same Firebase project as Auth above — no extra config needed. Firestore
 * must be created once in the Firebase Console (Build → Firestore Database
 * → Create database → Production mode) before this works. See
 * SETUP_GUIDE.md, Section 3.
 *
 * Enabling offline persistence lets pages that use `db` keep working (read
 * cached data) for a few seconds of flaky connectivity, and queues writes
 * until the connection returns — this is what makes the UI feel "live"
 * instead of static.
 */
export const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
  // "failed-precondition" = more than one tab open; "unimplemented" = old
  // browser. Neither is fatal — Firestore just falls back to network-only.
  console.warn("Firestore offline persistence not enabled:", error.code);
});

// NOTE: mirrors fsGetPublicStats() in firestore-api.ts (kept here too since
// auth.ts's login-page widget imports it before firestore-api.ts loads).
// A missing doc is a normal "zero learners" empty state, not an error — it
// resolves to `null` instead of throwing, so callers can render zero values.
export function getPublicStats() {
	const load = async () => {
		const snapshot = await db.collection("publicStats").doc("summary").get();
		return snapshot.exists ? snapshot.data() : null;
	};
	return LPSCache.getOrLoad("firestore_public_stats", load, 300000, 3600000);
}
