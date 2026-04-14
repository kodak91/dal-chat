import { useState, useEffect } from 'react';
import SplashScreen from './SplashScreen.jsx';
import DalChat from './DalChat.jsx';
import { ensureAnonymousAuth } from './firebase.js';

export default function App() {
  const [showSplash, setShowSplash] = useState(
    () => localStorage.getItem('splashShown') !== '1'
  );

  useEffect(() => {
    ensureAnonymousAuth().then((uid) => {
      if (!uid) return;
      // /api/chat 요청에 X-User-ID 헤더 자동 주입
      const orig = window.fetch;
      window.fetch = function (url, opts = {}) {
        if (typeof url === 'string' && url.includes('/api/chat')) {
          opts = { ...opts, headers: { ...opts.headers, 'X-User-ID': uid } };
        }
        return orig.call(this, url, opts);
      };
    });
  }, []);

  const handleDone = () => {
    localStorage.setItem('splashShown', '1');
    setShowSplash(false);
  };

  if (showSplash) return <SplashScreen onDone={handleDone} />;
  return <DalChat />;
}
