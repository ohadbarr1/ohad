/* Cross-device sync: one switch. Off until the owner enables Google sign-in and Firestore on fox-research-il
   (docs/ENABLE_SYNC.md); while off, nothing about sync is loaded and "שלי" says it is coming. */

/** Flip to true once the console steps in docs/ENABLE_SYNC.md are done and the CSP request is merged. */
export const SYNC_ENABLED = false;

/** The web app's Firebase config. null: read it from Hosting's reserved /__/firebase/init.json (works on the deployed site once a
 *  web app is registered in the project). Paste the object from the console here only to run sign-in from somewhere else. */
export const FIREBASE_CONFIG: null | { apiKey: string; authDomain: string; projectId: string; appId?: string } = null;

/** Hosts served by Firebase Hosting for this site: sign-in runs its helper page on the same host (no third-party storage). */
export const HOSTED = ['fox-research-il.web.app', 'fox-research-il.firebaseapp.com'];

/** Keys that describe this device, not the reader: never sent. */
export const LOCAL_ONLY = new Set(['density', 'fin.dense', 'reader']);
