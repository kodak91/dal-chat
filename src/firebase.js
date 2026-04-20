import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const app = initializeApp({
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
const db = getDatabase(app);

// ── Auth ──────────────────────────────────────────────

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user.uid;
}

export async function loginWithNickname(nickname, password) {
  const email = `${nickname.trim().toLowerCase()}@dalchat.app`;
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return { uid: result.user.uid, isNew: false };
  } catch (e) {
    // Firebase 12: email enumeration protection으로 user-not-found → invalid-credential
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return { uid: result.user.uid, isNew: true };
      } catch (createErr) {
        if (createErr.code === 'auth/email-already-in-use') throw new Error('비밀번호가 틀렸어.');
        throw new Error('다시 시도해줘.');
      }
    }
    if (e.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸어.');
    throw new Error('다시 시도해줘.');
  }
}

export async function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function logoutUser() {
  await signOut(auth);
}

// ── Push 알림 ─────────────────────────────────────────

export async function requestAndSavePushToken(uid) {
  if (!('Notification' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js'),
    });
    if (!token) return;

    await set(ref(db, `users/${uid}/pushToken`), token);

    // 포그라운드 메시지 핸들러 (앱이 열려있을 때)
    onMessage(messaging, (payload) => {
      new Notification(payload.notification?.title ?? '달챗', {
        body: payload.notification?.body ?? '',
        icon: '/icon-192.png',
      });
    });
  } catch {
    // 권한 거부 또는 실패 시 조용히 무시
  }
}

// ── DB 헬퍼 ───────────────────────────────────────────

function defaultCategoryData(cat) {
  if (cat === 'fixed') return { name: null, age: null, purpose: null };
  return { items: [] };
}

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

export async function saveMemoryCategory(uid, category, data) {
  await set(ref(db, `users/${uid}/memory/${category}`), data);
}
