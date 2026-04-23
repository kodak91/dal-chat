import { useState, useEffect } from 'react';
import SplashScreen from './SplashScreen.jsx';
import LoginScreen from './LoginScreen.jsx';
import DalChat from './DalChat.jsx';
import { getCurrentUser, logoutUser } from './firebase.js';

function patchFetch(uid) {
  const orig = window.fetch;
  window.fetch = function (url, opts = {}) {
    if (typeof url === 'string' && url.includes('/api/chat')) {
      opts = { ...opts, headers: { ...opts.headers, 'X-User-ID': uid } };
    }
    return orig.call(this, url, opts);
  };
}

export default function App() {
  const [showSplash, setShowSplash] = useState(
    () => localStorage.getItem('splashShown') !== '1'
  );
  const [uid, setUid] = useState(null);
  const [userNick, setUserNick] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (user && !user.isAnonymous) {
        patchFetch(user.uid);
        setUid(user.uid);
        const nick = user.displayName || user.email?.replace('@dalchat.app', '') || '';
        setUserNick(nick);
      } else if (user && user.isAnonymous) {
        // 이전 익명 유저 → 로그아웃 처리해서 로그인 화면으로 보냄
        try { await logoutUser(); } catch {}
      }
      setAuthChecked(true);
    });
  }, []);

  const handleSplashDone = () => {
    localStorage.setItem('splashShown', '1');
    setShowSplash(false);
  };

  const handleLoginSuccess = (newUid, nick) => {
    patchFetch(newUid);
    setUid(newUid);
    setUserNick(nick || '');
  };

  const handleLogout = () => {
    setUid(null);
    setUserNick('');
  };

  // 인증 확인 전: 로그인된 유저는 스플래시, 아니면 빈 화면
  if (!authChecked) return null;
  // 비로그인 → 스플래시 없이 바로 로그인 화면
  if (!uid) return <LoginScreen onSuccess={handleLoginSuccess} />;
  // 로그인 완료 → 첫 방문이면 스플래시 후 채팅
  if (showSplash) return <SplashScreen onDone={handleSplashDone} />;
  return <DalChat uid={uid} userNick={userNick} onLogout={handleLogout} />;
}
