import { useState } from 'react';
import { loginWithNickname, loginWithGoogle, auth } from './firebase.js';

export default function LoginScreen({ onSuccess }) {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleNickname = async () => {
    const nick = nickname.trim();
    if (!nick || !password) { setError('이름이랑 비밀번호 둘 다 필요해.'); return; }
    if (password.length < 6) { setError('비밀번호는 6자 이상이어야 해.'); return; }
    setError(''); setLoading(true);
    try {
      const { uid } = await loginWithNickname(nick, password);
      onSuccess(uid, nick);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(''); setLoading(true);
    try {
      const uid = await loginWithGoogle();
      const nick = auth.currentUser?.displayName || auth.currentUser?.email?.replace('@dalchat.app', '') || '';
      onSuccess(uid, nick);
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        // 사용자가 팝업 닫은 경우 — 에러 표시 안 함
      } else if (e.code === 'auth/unauthorized-domain') {
        setError('이 도메인이 Firebase에 등록되지 않았어. 콘솔 확인 필요.');
      } else {
        setError(e.message || '다시 시도해줘.');
      }
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') handleNickname(); };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'radial-gradient(ellipse at 50% 30%, #0a0820 0%, #04070f 70%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Noto Sans KR', sans-serif",
      padding: '0 24px',
    }}>
      {/* 달 아이콘 */}
      <img src="/moon.png" alt="" style={{
        width: '18vw', maxWidth: 80, marginBottom: 20,
        filter: 'drop-shadow(0 0 18px rgba(200,184,96,0.45))',
      }} />

      {/* 문구 */}
      <p style={{
        color: '#8898b4', fontSize: 13, textAlign: 'center',
        marginBottom: 28, lineHeight: 1.7,
      }}>
        달이 널 기억하려면 이름이 필요해
      </p>

      {/* 입력 영역 */}
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={onKey}
          placeholder="뭐라고 불러줄까"
          disabled={loading}
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={onKey}
          placeholder="비밀번호"
          disabled={loading}
          style={inputStyle}
        />

        <button onClick={handleNickname} disabled={loading} style={primaryBtnStyle(loading)}>
          {loading ? '...' : '시작하기'}
        </button>

        {/* 구분선 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
          <div style={{ flex: 1, height: 1, background: '#141e30' }} />
          <span style={{ color: '#2a3a50', fontSize: 11 }}>또는</span>
          <div style={{ flex: 1, height: 1, background: '#141e30' }} />
        </div>

        <button onClick={handleGoogle} disabled={loading} style={googleBtnStyle(loading)}>
          <svg width="16" height="16" viewBox="0 0 48 48" style={{ marginRight: 8, flexShrink: 0 }}>
            <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.1-6.1C34.36 3.07 29.45 1 24 1 14.82 1 7.07 6.48 3.56 14.18l7.1 5.52C12.4 13.16 17.73 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.44 24.5c0-1.64-.15-3.22-.42-4.74H24v8.98h12.6c-.54 2.92-2.18 5.4-4.64 7.06l7.1 5.52C43.36 37.5 46.44 31.44 46.44 24.5z"/>
            <path fill="#FBBC05" d="M10.66 28.3A14.5 14.5 0 0 1 9.5 24c0-1.5.26-2.96.7-4.3l-7.1-5.52A23.97 23.97 0 0 0 0 24c0 3.88.92 7.55 2.56 10.8l7.1-6.5z" transform="translate(.5)"/>
            <path fill="#34A853" d="M24 47c5.45 0 10.02-1.8 13.36-4.88l-7.1-5.52C28.44 38.3 26.35 39 24 39c-6.27 0-11.6-3.66-13.34-9.7l-7.1 6.5C7.07 43.52 14.82 47 24 47z" transform="translate(.5 1)"/>
          </svg>
          Google로 계속하기
        </button>

        {/* 에러 */}
        {error && (
          <p style={{ color: '#c05050', fontSize: 12, textAlign: 'center', margin: '4px 0 0' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  background: 'rgba(255,255,255,.04)',
  border: '1px solid #1e2c3c',
  color: '#8898b4',
  fontSize: 14,
  padding: '12px 14px',
  fontFamily: "'Noto Sans KR', sans-serif",
  outline: 'none',
  caretColor: '#4878b8',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtnStyle = (loading) => ({
  background: loading ? 'rgba(8,13,26,.8)' : 'rgba(40,20,80,.9)',
  border: `1px solid ${loading ? '#1e2c3c' : '#5a3a90'}`,
  color: loading ? '#2a3a50' : '#c8a8f0',
  fontSize: 14, fontWeight: 600,
  padding: '12px',
  fontFamily: "'Noto Sans KR', sans-serif",
  cursor: loading ? 'default' : 'pointer',
  width: '100%',
  transition: 'color .2s, border-color .2s',
});

const googleBtnStyle = (loading) => ({
  background: 'rgba(255,255,255,.04)',
  border: '1px solid #1e2c3c',
  color: '#5a6a80',
  fontSize: 13,
  padding: '11px',
  fontFamily: "'Noto Sans KR', sans-serif",
  cursor: loading ? 'default' : 'pointer',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});
