import { firebaseConfig, vapidKey } from './firebase';

export const environment = {
  production: false,
  // Calls use relative /api/... paths; proxy.conf.json forwards them to the backend.
  apiBaseUrl: '',
  firebase: firebaseConfig,
  vapidKey,
};
