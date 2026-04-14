import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const app = initializeApp({
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

export const auth = getAuth(app);

/** 익명 로그인 보장. 이미 로그인 상태면 기존 uid 반환. 실패해도 null 반환(앱 동작 유지). */
export async function ensureAnonymousAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        resolve(user.uid);
      } else {
        try {
          const { user: newUser } = await signInAnonymously(auth);
          resolve(newUser.uid);
        } catch (e) {
          console.error('Anonymous auth failed:', e);
          resolve(null);
        }
      }
    });
  });
}
