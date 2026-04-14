import { useState, useEffect, useRef } from 'react';

const SENTENCES = [
  { text: '수억 년을 살았습니다.',               gold: false },
  { text: '달은 사람들의 고민을 묵묵히 들어줬지요.', gold: false },
  { text: '오늘밤엔 무슨 일이 있었나요?',          gold: false },
  { text: '대화로 쓰는 일기 앱',                 gold: true  },
];

const STARTS    = [1000, 3600, 6600, 9800];
const CHAR_MS   = 85;
const HOLD_MS   = 1800;
const LOGO_TIME = 11500;
const FADE_TIME = 13000;
const DONE_TIME = 14000;

export default function SplashScreen({ onDone }) {
  const [imgOpacity,      setImgOpacity]     = useState(0);
  const [sentenceIdx,     setSentenceIdx]    = useState(-1);
  const [sentenceText,    setSentenceText]   = useState('');
  const [sentenceOpacity, setSentenceOpacity]= useState(1);
  const [logoOpacity,     setLogoOpacity]    = useState(0);
  const [splashOpacity,   setSplashOpacity]  = useState(1);
  const activeIdxRef = useRef(-1);

  useEffect(() => {
    const timers = [];
    const at = (delay, fn) => timers.push(setTimeout(fn, delay));

    // 이미지 페이드인
    at(100, () => setImgOpacity(1));

    STARTS.forEach((start, idx) => {
      const { text } = SENTENCES[idx];

      // 문장 활성화
      at(start, () => {
        activeIdxRef.current = idx;
        setSentenceIdx(idx);
        setSentenceOpacity(1);
        setSentenceText('');
      });

      // 한 글자씩 타이핑
      for (let i = 1; i <= text.length; i++) {
        at(start + i * CHAR_MS, () => setSentenceText(text.slice(0, i)));
      }

      // 디졸브 아웃 (마지막 문장은 로고 등장 시점에 맞춤)
      const dissolveAt = idx < 3
        ? start + text.length * CHAR_MS + HOLD_MS
        : LOGO_TIME;

      at(dissolveAt, () => {
        if (activeIdxRef.current === idx) setSentenceOpacity(0);
      });
    });

    // 달챗 로고 페이드인
    at(LOGO_TIME, () => setLogoOpacity(1));

    // 전체 페이드아웃
    at(FADE_TIME, () => setSplashOpacity(0));

    // 메인 화면 전환
    at(DONE_TIME, onDone);

    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const gold = sentenceIdx >= 0 ? SENTENCES[sentenceIdx].gold : false;

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      background:     '#000000',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      opacity:        splashOpacity,
      transition:     'opacity 0.8s ease-out',
      zIndex:         9999,
    }}>
      {/* 달 이미지 */}
      <img
        src="/moon.png"
        alt=""
        style={{
          width:      '25vw',
          maxWidth:   200,
          opacity:    imgOpacity,
          transition: 'opacity 0.8s ease-in',
          filter: 'drop-shadow(0 0 24px rgba(200,184,96,0.5)) drop-shadow(0 0 60px rgba(200,184,96,0.2))',
        }}
      />

      {/* 문장 */}
      {sentenceText ? (
        <p
          key={sentenceIdx}
          style={{
            margin:     '32px 24px 0',
            color:      gold ? '#c8b860' : '#ffffff',
            fontSize:   16,
            lineHeight: 1.8,
            textAlign:  'center',
            letterSpacing: '0.03em',
            fontFamily: "'Noto Serif KR', serif",
            opacity:    sentenceOpacity,
            transition: 'opacity 0.6s ease-out',
            minHeight:  28,
          }}
        >
          {sentenceText}
        </p>
      ) : (
        <div style={{ marginTop: 32, minHeight: 28 }} />
      )}

      {/* 달챗 로고 */}
      <p style={{
        margin:        '20px 0 0',
        color:         '#e4e4f8',
        fontSize:      24,
        fontFamily:    "'Noto Serif KR', serif",
        letterSpacing: '0.15em',
        opacity:       logoOpacity,
        transition:    'opacity 0.6s ease-in',
      }}>
        달챗
      </p>
    </div>
  );
}
