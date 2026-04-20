import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';

const app = initializeApp({
  apiKey:      import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:   import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
});

export const auth = getAuth(app);
const db = getDatabase(app);

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

function defaultCategoryData(cat) {
  if (cat === 'fixed') return { name: null, age: null, purpose: null };
  return { items: [] };
}

/** categories 배열로 받아서 해당 카테고리만 병렬로 읽어 객체로 반환 */
export async function loadMemory(uid, categories) {
  const results = {};
  await Promise.all(
    categories.map(async (cat) => {
      try {
        const snap = await get(ref(db, `users/${uid}/memory/${cat}`));
        results[cat] = snap.exists() ? snap.val() : defaultCategoryData(cat);
      } catch {
        results[cat] = defaultCategoryData(cat);
      }
    })
  );
  return results;
}

/** users/{uid}/memory/{category} 에 data 저장 */
export async function saveMemoryCategory(uid, category, data) {
  await set(ref(db, `users/${uid}/memory/${category}`), data);
}
