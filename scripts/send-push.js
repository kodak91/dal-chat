/**
 * 달챗 전체 푸시 발송 스크립트
 *
 * 사전 준비:
 *   1. Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
 *      → serviceAccountKey.json 으로 저장 (이 파일과 같은 위치)
 *   2. npm install firebase-admin --save-dev
 *
 * 실행:
 *   node scripts/send-push.js "제목" "내용"
 *   node scripts/send-push.js "달이 생각났어" "오늘 밤 어때?"
 */

import admin from 'firebase-admin';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || serviceAccount.databaseURL,
});

const [, , title = '달챗', body = '달이 생각났어.'] = process.argv;

async function sendToAll() {
  const db = admin.database();
  const snapshot = await db.ref('users').once('value');
  const users = snapshot.val();

  if (!users) { console.log('유저 없음'); process.exit(0); }

  const tokens = Object.values(users)
    .map(u => u.pushToken)
    .filter(Boolean);

  if (!tokens.length) { console.log('등록된 토큰 없음'); process.exit(0); }

  console.log(`토큰 ${tokens.length}개에 발송 중...`);

  // FCM은 한 번에 최대 500개
  const CHUNK = 500;
  let success = 0, fail = 0;

  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      webpush: {
        notification: { icon: '/icon-192.png', badge: '/icon-48.png' },
      },
    });
    success += res.successCount;
    fail    += res.failureCount;
  }

  console.log(`완료 — 성공: ${success}, 실패: ${fail}`);
  process.exit(0);
}

sendToAll().catch(e => { console.error(e); process.exit(1); });
