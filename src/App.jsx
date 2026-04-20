import { useState, useEffect } from 'react';
import SplashScreen from './SplashScreen.jsx';
import LoginScreen from './LoginScreen.jsx';
import DalChat from './DalChat.jsx';
import { getCurrentUser } from './firebase.js';

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
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        patchFetch(user.uid);
        setUid(user.uid);
      }
      setAuthChecked(true);
    });
  }, []);

  const handleSplashDone = () => {
    localStorage.setItem('splashShown', '1');
    setShowSplash(false);
  };

  const handleLoginSuccess = (newUid) => {
    patchFetch(newUid);
    setUid(newUid);
  };

  // 인증 확인 전엔 스플래시 중이거나 빈 화면
  if (showSplash) return <SplashScreen onDone={handleSplashDone} />;
  if (!authChecked) return null;
  if (!uid) return <LoginScreen onSuccess={handleLoginSuccess} />;
  return <DalChat uid={uid} />;
}
