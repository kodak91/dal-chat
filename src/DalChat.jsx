import { useState, useRef, useEffect, useCallback } from "react";
import dalPersonality from "./prompts/dal-personality.txt?raw";
import FeedbackModal from "./FeedbackModal.jsx";
import ReactGA from "react-ga4";
import { loadMemory, saveMemoryCategory } from "./firebase.js";



// ── Base64 이미지 ──────────────────────────────────────

const IMG_BG="/bg.png";

const IMG_DAY="/day.png";

const IMG_MOON="/moon.png";

const IMG_PERSON="/person.png";



// ── 메모리 상수 ────────────────────────────────────────

const SHORT_TTL = 14 * 24 * 60 * 60 * 1000; // 14일

const DAY_START_H = 5;
const DAY_END_H   = 17;
const SLEEP_AT    = 50;
const LOCK_AT     = 60;

const ONBOARD_KEY    = "dal:onboarding";
const SESSION_MSGS   = "dal:session:messages";
const SESSION_COMP   = "dal:session:compress";
const SESSION_DAILY  = "dal:session:daily";
const DEV_UNLOCK_KEY = "dal:dev:unlocked";

const BASE_CATEGORIES = ['fixed', 'facts', 'prefs', 'recent'];

const CATEGORY_KEYWORDS = {
  relation: ['여자친구', '남자친구', '연인', '결혼', '데이트',
             '가족', '엄마', '아빠', '형', '언니', '동생', '친구'],
  work:     ['직장', '회사', '팀장', '상사', '업무', '출근',
             '퇴근', '동료', '취업', '이직', '면접'],
  mental:   ['우울', '불안', '힘들', '외로', '스트레스',
             '무기력', '화나', '슬프', '지쳐'],
};

function detectCategories(messages) {
  const text = messages.map(m => m.content || '').join(' ');
  const extra = Object.entries(CATEGORY_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => text.includes(kw)))
    .map(([cat]) => cat);
  return [...new Set([...BASE_CATEGORIES, ...extra])];
}

// 현재 유효한 세션의 시작 timestamp 반환. 낮(오전5시~오후5시)이면 null.
function getSessionStart() {
  const now = new Date();
  const h = now.getHours();
  if (h >= DAY_END_H) {
    const s = new Date(now); s.setHours(DAY_END_H, 0, 0, 0); return s.getTime();
  } else if (h < DAY_START_H) {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(DAY_END_H, 0, 0, 0); return s.getTime();
  }
  return null; // 낮 시간
}

const defaultMemory = () => ({
  fixed:    { name: null, age: null, purpose: null },
  facts:    { items: [] },
  prefs:    { items: [] },
  relation: { items: [] },
  work:     { items: [] },
  mental:   { items: [] },
  recent:   { items: [] },
});
const defaultOnboard = () => ({ totalMessages: 0 });

function pruneShort(arr) {
  const now = Date.now();
  return (arr || []).filter(e => e.expiresAt > now).slice(-20);
}



// ── 시스템 프롬프트 ────────────────────────────────────

const buildSystemPrompt = (memoryData, onboarding, dailyMem = [], initTime = null) => {
  const now = Date.now();
  const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  let memSection = `\n\n[현재 시각: ${timeStr}]`;

  if (initTime) memSection += `\n\n[대화 시작 시간]: ${initTime}`;

  // fixed + facts → [이 사람에 대해 알고 있는 것]
  const fixed = memoryData.fixed || {};
  const longParts = [];
  if (fixed.name)    longParts.push(`이름: ${fixed.name}`);
  if (fixed.age)     longParts.push(`나이: ${fixed.age}`);
  if (fixed.purpose) longParts.push(`달 찾는 이유: ${fixed.purpose}`);
  const facts = memoryData.facts?.items || [];
  if (facts.length)  longParts.push(`기타: ${facts.join(', ')}`);
  if (longParts.length) {
    memSection += `\n\n[이 사람에 대해 알고 있는 것]\n${longParts.join('\n')}`;
  }

  // recent → [최근에 있었던 일]
  const recentItems = pruneShort(memoryData.recent?.items || []).slice(-6);
  if (recentItems.length) {
    const lines = recentItems.map(e => {
      const daysAgo = Math.floor((now - e.createdAt) / 86400000);
      const when = daysAgo === 0 ? '오늘' : daysAgo === 1 ? '어제' : `${daysAgo}일 전`;
      return `- ${when}: ${e.content}`;
    }).join('\n');
    memSection += `\n\n[최근에 있었던 일]\n${lines}`;
  }

  // 오늘 이전 대화 요약
  if (dailyMem.length) {
    memSection += `\n\n[오늘 이전 대화 요약]\n${dailyMem.map(d => d.summary).join('\n---\n')}`;
  }

  // prefs
  const prefs = memoryData.prefs?.items || [];
  if (prefs.length) {
    memSection += `\n\n[사용자 말투/성격 요청 — 참고만, 기본 성격 침해 금지]: ${prefs.join(', ')}`;
  }

  // 동적 카테고리 — 로드된 것만 추가
  const relation = memoryData.relation?.items || [];
  const work     = memoryData.work?.items || [];
  const mental   = memoryData.mental?.items || [];
  if (relation.length) memSection += `\n\n[관계]: ${relation.join(', ')}`;
  if (work.length)     memSection += `\n\n[직장/일]: ${work.join(', ')}`;
  if (mental.length)   memSection += `\n\n[감정/심리 패턴]: ${mental.join(', ')}`;

  // 온보딩
  const total = onboarding?.totalMessages || 0;
  const missing = [];
  if (!fixed.name)    missing.push('이름');
  if (!fixed.purpose) missing.push('달한테 주로 뭘 털어놓으러 오는지(하소연인지, 심심해서인지, 화풀이인지 등)');
  if (missing.length && total <= 30) {
    memSection += `\n\n[참고]: 아직 모르는 것이 있어 — "${missing[0]}". 대화 흐름상 자연스러울 때 슬쩍 한 번만 물어봐. 억지로 물어볼 필요는 없어.`;
  }

  if (total >= SLEEP_AT) memSection += `\n\n[참고]: 오늘 대화 많이 했어. 슬슬 졸려와. 자연스럽게 피곤함 드러내도 돼.`;

  return `${dalPersonality.trim()}${memSection}`;
};



// ── 달 얼굴 SVG ───────────────────────────────────────

// isThinking: 스트리밍 중 눈 찡그림 / isSpeaking: 타이핑 중 입 뻐끔
function MoonFace({ isThinking, isSpeaking, size }) {

  const s = size || 120;

  const [mouthState, setMouthState] = useState(0);

  useEffect(() => {

    if (!isSpeaking) { setMouthState(0); return; }

    const cycle = [0, 1, 2, 1];

    let i = 0;

    const id = setInterval(() => { i = (i + 1) % cycle.length; setMouthState(cycle[i]); }, 190);

    return () => clearInterval(id);

  }, [isSpeaking]);

  // 눈: y=49 (SVG 중앙 50 기준 5% 아래=55가 face 중심), 눈 사이 x=37/58, 입: y=59
  const mouth = [

    // 0: 닫힘
    <rect key="m" x="45" y="59" width="11" height="2" rx="1"   fill="#2a1a00" opacity="0.32" shapeRendering="crispEdges" />,

    // 1: 살짝 열림
    <rect key="m" x="45" y="58" width="11" height="4" rx="2"   fill="#2a1a00" opacity="0.40" shapeRendering="crispEdges" />,

    // 2: 더 열림
    <rect key="m" x="44" y="57" width="13" height="6" rx="3"   fill="#2a1a00" opacity="0.46" shapeRendering="crispEdges" />,

  ];

  return (

    <svg width={s} height={s} viewBox="0 0 100 100" style={{ display:"block", pointerEvents:"none" }}>

      {/* 왼쪽 눈 */}

      <rect x="37" y="49" width="5" height="5" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />

      {/* 오른쪽 눈 */}

      {isThinking

        ? <rect x="57" y="51" width="7" height="3" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />

        : <rect x="58" y="49" width="5" height="5" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />

      }

      {/* 입 */}

      {mouth[mouthState]}

    </svg>

  );

}



// ── 히스토리 패널 ──────────────────────────────────────

function HistoryPanel({ messages, streamingText, memoryData, onClose, onMakeDiary, diaryLoading, onOpenDiaries }) {

  const endRef = useRef(null);

  const [memOpen, setMemOpen] = useState(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, streamingText]);

  const fixed = memoryData.fixed || {};
  const longLines = [
    fixed.name    ? `이름: ${fixed.name}` : null,
    fixed.age     ? `나이: ${fixed.age}` : null,
    fixed.purpose ? `목적: ${fixed.purpose}` : null,
    ...(memoryData.facts?.items || []).map(f => `• ${f}`),
  ].filter(Boolean);

  const now = Date.now();
  const recentLines = pruneShort(memoryData.recent?.items || []).slice(-4).map(e => {
    const daysAgo = Math.floor((now - e.createdAt) / 86400000);
    const when = daysAgo === 0 ? '오늘' : daysAgo === 1 ? '어제' : `${daysAgo}일 전`;
    return `${when}: ${e.content}`;
  });

  const hasMemory = longLines.length > 0 || recentLines.length > 0;

  return (

    <div style={{ position:"fixed",top:0,right:0,bottom:0,width:"min(340px,min(390px,100vw))",background:"#04070f",borderLeft:"1px solid #141e30",zIndex:300,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR',sans-serif",animation:"slideIn .22s ease forwards" }}>

      <div style={{ padding:"15px 18px",borderBottom:"1px solid #141e30",display:"flex",alignItems:"center",gap:10,flexShrink:0 }}>

        <button onClick={onClose} style={{ background:"none",border:"none",color:"#445",cursor:"pointer",fontSize:18,padding:0,lineHeight:1 }}>✕</button>

        <span style={{ color:"#6878a0",fontSize:13,fontWeight:600 }}>오늘의 대화</span>

        <div style={{ marginLeft:"auto",display:"flex",gap:6 }}>

          <button onClick={onOpenDiaries} style={{ background:"#080f1e",border:"1px solid #5a4208",color:"#7a5a10",fontSize:10,padding:"5px 9px",cursor:"pointer",fontFamily:"inherit" }}>📔 일기장</button>

          <button onClick={onMakeDiary} disabled={diaryLoading||!messages.length} style={{ background:"#080f08",border:`1px solid ${messages.length?"#182e18":"#141e30"}`,color:diaryLoading||!messages.length?"#243224":"#4ea84e",fontSize:10,padding:"5px 9px",cursor:diaryLoading||!messages.length?"not-allowed":"pointer",fontFamily:"inherit" }}>

            {diaryLoading?"생성 중...":"✏ 일기로 변환"}

          </button>

        </div>

      </div>

      {hasMemory && (

        <div style={{ borderBottom:"1px solid #141e30",background:"#060a18",flexShrink:0 }}>

          <button
            onClick={() => setMemOpen(o => !o)}
            style={{ width:"100%",padding:"7px 18px",background:"none",border:"none",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",fontFamily:"inherit" }}
          >
            <span style={{ color:"#1e2c3c",fontSize:10 }}>달이 기억하는 것</span>
            <span style={{ color:"#1e2c3c",fontSize:10,transition:"transform .2s",display:"inline-block",transform:memOpen?"rotate(90deg)":"rotate(0deg)" }}>›</span>
          </button>

          {memOpen && (
            <div style={{ padding:"0 18px 10px" }}>
              {longLines.length > 0 && (
                <div style={{ color:"#304458",fontSize:11,lineHeight:1.6,whiteSpace:"pre-wrap" }}>{longLines.join('\n')}</div>
              )}
              {recentLines.length > 0 && (
                <div style={{ marginTop: longLines.length > 0 ? 6 : 0 }}>
                  <div style={{ color:"#1a2530",fontSize:10,marginBottom:2 }}>최근 (시간이 지나면 사라져)</div>
                  <div style={{ color:"#253040",fontSize:11,lineHeight:1.6,whiteSpace:"pre-wrap" }}>{recentLines.join('\n')}</div>
                </div>
              )}
            </div>
          )}

        </div>

      )}

      <div style={{ flex:1,overflowY:"auto",padding:"14px" }}>

        {/* ── 광고 카드 (달 말풍선 스타일) ── */}
        <div style={{ marginBottom:10,display:"flex",flexDirection:"column",alignItems:"flex-start" }}>
          <div style={{ fontSize:10,color:"#243448",marginBottom:3 }}>🌙 달</div>
          <div style={{ maxWidth:"86%",padding:"8px 12px",background:"#0d0c02",border:"1px solid #281e04",color:"#c8aa30",fontSize:12,lineHeight:1.75,wordBreak:"break-word",whiteSpace:"pre-wrap" }}>
            {"부끄러운 얘기지만,\n나는 밥은 안먹지만 토큰은 먹어.\n후원 대신에 한번 봐줘.\n참고로 머리는 밤에 감는게 좋단다.\n이거 한번 써봐."}
            <div style={{ marginTop:6 }}>
              <a href="https://www.wadiz.kr/web/wcomingsoon/rwd/393687" target="_blank" rel="noreferrer" style={{ color:"#8060c0",fontSize:12,textDecoration:"none" }}>→ 와디즈에서 보기</a>
            </div>
            <a href="https://www.wadiz.kr/web/wcomingsoon/rwd/393687" target="_blank" rel="noreferrer" style={{ display:"block",marginTop:8 }}>
              <img src="/scoop_ad2.png" alt="" style={{ width:"100%",borderRadius:8,display:"block" }} />
            </a>
          </div>
        </div>

        {!messages.length && <div style={{ color:"#182030",textAlign:"center",marginTop:40,fontSize:12 }}>아직 대화가 없어</div>}

        {messages.map((m,i) => {

          const isUser = m.role==="user";

          return (

            <div key={i} style={{ marginBottom:10,display:"flex",flexDirection:"column",alignItems:isUser?"flex-end":"flex-start" }}>

              <div style={{ fontSize:10,color:"#243448",marginBottom:3 }}>{isUser?"나":"🌙 달"}</div>

              <div style={{ maxWidth:"86%",padding:"8px 12px",background:isUser?"#07102a":"#0d0c02",border:`1px solid ${isUser?"#182848":"#281e04"}`,color:isUser?"#8098c8":"#c8aa30",fontSize:12,lineHeight:1.75,wordBreak:"break-word",whiteSpace:"pre-wrap" }}>{m.content}</div>

            </div>

          );

        })}

        {streamingText && (

          <div style={{ marginBottom:10,display:"flex",flexDirection:"column",alignItems:"flex-start" }}>

            <div style={{ fontSize:10,color:"#243448",marginBottom:3 }}>🌙 달</div>

            <div style={{ maxWidth:"86%",padding:"8px 12px",background:"#0d0c02",border:"1px solid #281e04",color:"#c8aa30",fontSize:12,lineHeight:1.75,wordBreak:"break-word",whiteSpace:"pre-wrap" }}>

              {streamingText}<span style={{ display:"inline-block",width:2,height:10,background:"#c8aa30",marginLeft:2,animation:"blink .6s steps(1) infinite",verticalAlign:"middle" }} />

            </div>

          </div>

        )}

        <div ref={endRef} />

      </div>

    </div>

  );

}



// ── 일기 모달 ──────────────────────────────────────────

function DiaryModal({ diaries, onClose }) {

  const [view, setView] = useState(null);

  return (

    <div style={{ position:"fixed",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:"min(390px,100vw)",background:"#030508",zIndex:400,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR',sans-serif",animation:"fadeIn .2s ease forwards" }}>

      <div style={{ padding:"17px 22px",borderBottom:"1px solid #141e30",display:"flex",alignItems:"center",gap:12,flexShrink:0 }}>

        {view ? <button onClick={()=>setView(null)} style={{ background:"none",border:"none",color:"#384860",cursor:"pointer",fontSize:18,padding:0 }}>←</button>

               : <button onClick={onClose}           style={{ background:"none",border:"none",color:"#384860",cursor:"pointer",fontSize:18,padding:0 }}>✕</button>}

        <span style={{ color:"#6878a0",fontSize:14,fontWeight:600 }}>{view?view.dateShort:"📔 나의 일기장"}</span>

        {view && <span style={{ fontSize:22,marginLeft:2 }}>{view.moodEmoji}</span>}

      </div>

      <div style={{ flex:1,overflowY:"auto",padding:"20px 22px" }}>

        {view ? (

          <div>

            <div style={{ color:"#2e3e50",fontSize:11,marginBottom:14 }}>{view.moodEmoji} {view.mood} · {view.date}</div>

            <div style={{ color:"#90a8c0",fontSize:14,lineHeight:2.1,whiteSpace:"pre-wrap",background:"#060c1c",padding:"22px",border:"1px solid #141e30" }}>{view.content}</div>

          </div>

        ) : (diaries||[]).length===0 ? (

          <div style={{ color:"#141c28",textAlign:"center",marginTop:60,fontSize:13,lineHeight:2.2 }}>

            아직 일기가 없어<br/><span style={{ fontSize:11,color:"#101820" }}>달과 대화를 마친 후 일기로 변환해봐</span>

          </div>

        ) : (diaries||[]).map(d => (

          <div key={d.id} onClick={()=>setView(d)} style={{ padding:"15px 18px",marginBottom:9,background:"#060c1c",border:"1px solid #141e30",cursor:"pointer",display:"flex",alignItems:"center",gap:14 }}>

            <span style={{ fontSize:28,flexShrink:0 }}>{d.moodEmoji}</span>

            <div style={{ overflow:"hidden",flex:1 }}>

              <div style={{ color:"#8098b0",fontSize:13,fontWeight:600 }}>{d.dateShort}</div>

              <div style={{ color:"#384860",fontSize:11,marginTop:2 }}>{d.mood}</div>

              <div style={{ color:"#243040",fontSize:11,marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.content.slice(0,55)}…</div>

            </div>

            <span style={{ color:"#243040",fontSize:18,flexShrink:0 }}>›</span>

          </div>

        ))}

      </div>

    </div>

  );

}



// ── 메인 앱 ────────────────────────────────────────────

export default function DalChat({ uid }) {

  const [messages, setMessages]        = useState([]);

  const [input, setInput]              = useState("");

  const [isStreaming, setIsStreaming]  = useState(false);

  const [streamingText, setStreamText] = useState("");

  const [showHistory, setShowHistory]  = useState(false);

  const [showDiaries, setShowDiaries]  = useState(false);

  const [diaryLoading, setDiaryLoad]   = useState(false);

  const [diaries, setDiaries]          = useState([]);

  const [memoryData, setMemoryData]    = useState(defaultMemory());

  const [onboarding, setOnboarding]    = useState(defaultOnboard());

  const [moonBubble, setMoonBubble]    = useState("오늘 밤엔 참 조용하네.\n뭔 일 있어?");

  const [userBubble, setUserBubble]    = useState("");

  const [bubbleKey, setBubbleKey]      = useState(0);

  const [isDayMode, setIsDayMode]      = useState(() => { const h = new Date().getHours(); return h >= DAY_START_H && h < DAY_END_H; });

  const [dayResetMsg, setDayResetMsg]  = useState(null);

  const [isLocked, setIsLocked]        = useState(false);
  const [isDevUnlocked, setIsDevUnlocked] = useState(() => localStorage.getItem(DEV_UNLOCK_KEY) === "1");

  const [dailyMem, setDailyMem]        = useState([]);

  const [isTyping, setIsTyping]        = useState(false);

  // PWA 설치
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall]     = useState(false);
  const installDismissed = useRef(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const taRef                          = useRef(null);

  const memoryDataRef                  = useRef(defaultMemory());

  const uidRef                         = useRef(null);

  const loadedCatsRef                  = useRef(new Set(BASE_CATEGORIES));

  const onboardingRef                  = useRef(defaultOnboard());

  const typeTimerRef                   = useRef(null);

  const initTimeRef                    = useRef(null);

  const dailyMemRef                    = useRef([]);

  const compressedUntilRef             = useRef(0);

  const historyRef                     = useRef([]); // API용 실시간 히스토리 (messages 지연과 분리)




  // storage 로드

  useEffect(() => {

    // props.uid로 Firebase 메모리 로드
    if (uid) {
      uidRef.current = uid;
      loadMemory(uid, BASE_CATEGORIES).then((mem) => {
        const merged = { ...defaultMemory(), ...mem };
        memoryDataRef.current = merged;
        setMemoryData(merged);
      }).catch(() => {});
    }

    // 세션 데이터 복원 (오후5시~오전5시 범위 내면 유지)
    const sessionStart = getSessionStart();

    try {
      const r = localStorage.getItem(ONBOARD_KEY);
      if (r) {
        const o = JSON.parse(r);
        // 새 세션이 시작됐는데 totalMessages가 이전 세션 것이면 리셋
        if (sessionStart && (!o.sessionResetAt || o.sessionResetAt < sessionStart)) {
          o.totalMessages = 0;
          o.sessionResetAt = sessionStart;
          localStorage.setItem(ONBOARD_KEY, JSON.stringify(o));
        }
        setOnboarding(o); onboardingRef.current = o;
      }
    } catch {}

    try { const r = localStorage.getItem("dal:diaries"); if(r) setDiaries(JSON.parse(r) || []); } catch {}
    try {
      const r = localStorage.getItem(SESSION_MSGS);
      if (r) {
        const { msgs, savedAt } = JSON.parse(r);
        if (sessionStart && savedAt >= sessionStart && msgs?.length) {
          setMessages(msgs); historyRef.current = msgs;
          const lastDal  = [...msgs].reverse().find(m => m.role === "assistant");
          const lastUser = [...msgs].reverse().find(m => m.role === "user");
          if (lastDal)  setMoonBubble(lastDal.content.length > 62 ? lastDal.content.slice(0,59)+"…" : lastDal.content);
          if (lastUser) setUserBubble(lastUser.content.length > 54 ? lastUser.content.slice(0,51)+"…" : lastUser.content);
        } else { localStorage.removeItem(SESSION_MSGS); }
      }
    } catch {}
    try {
      const r = localStorage.getItem(SESSION_COMP);
      if (r) { const { idx, savedAt } = JSON.parse(r); if (sessionStart && savedAt >= sessionStart) compressedUntilRef.current = idx; }
    } catch {}
    try {
      const r = localStorage.getItem(SESSION_DAILY);
      if (r) { const { data, savedAt } = JSON.parse(r); if (sessionStart && savedAt >= sessionStart) { setDailyMem(data); dailyMemRef.current = data; } }
    } catch {}

    initTimeRef.current = new Date().toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', hour12:false});

    taRef.current?.focus();

  }, []);



  // PWA 설치 프롬프트
  useEffect(() => {
    if (localStorage.getItem("dal:installed")) return;

    // index.html에서 React 마운트 전에 미리 캡처한 이벤트 우선 처리
    if (window.__pwaPrompt) {
      setInstallPrompt(window.__pwaPrompt);
      setShowInstall(true);
      return;
    }

    // Android/Chrome: beforeinstallprompt 이벤트 캡처 (아직 발생 안 한 경우)
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari: standalone 모드가 아니면 안내 표시
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    if (isIos && !isStandalone) {
      setShowInstall(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        localStorage.setItem("dal:installed", "1");
      }
      setInstallPrompt(null);
    }
    setShowInstall(false);
    installDismissed.current = true;
  };

  const dismissInstall = () => {
    setShowInstall(false);
    installDismissed.current = true;
    localStorage.setItem("dal:installed", "1");
  };

  // 메시지 변경 시 세션 localStorage에 저장
  useEffect(() => {
    if (!messages.length) return;
    const sessionStart = getSessionStart();
    if (!sessionStart) return; // 낮 시간엔 저장 안 함
    localStorage.setItem(SESSION_MSGS, JSON.stringify({ msgs: messages, savedAt: Date.now() }));
  }, [messages]);

  // dailyMem 변경 시 저장
  useEffect(() => {
    if (!dailyMem.length) return;
    const sessionStart = getSessionStart();
    if (!sessionStart) return;
    localStorage.setItem(SESSION_DAILY, JSON.stringify({ data: dailyMem, savedAt: Date.now() }));
  }, [dailyMem]);


  // 스크롤 차단 (height는 건드리지 않음 — 안드로이드 뷰포트 리사이즈 방해 금지)
  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);




  // 키보드 감지: visualViewport 기준 translateY — iOS/Android 통일 처리
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const el = document.getElementById('chat-input-area');
      if (el) el.style.transform = keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : 'translateY(0)';
      window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => { vv.removeEventListener('resize', handler); vv.removeEventListener('scroll', handler); };
  }, []);



  // typewriter 타이머 정리

  useEffect(() => () => { if (typeTimerRef.current) clearTimeout(typeTimerRef.current); }, []);



  // ── 타이핑 애니메이션 ─────────────────────────────────

  const startTypewriter = useCallback((fullText, onComplete) => {

    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);

    const paragraphs = fullText.split(String.fromCharCode(10)+String.fromCharCode(10)).map(p => p.trim()).filter(Boolean);

    if (!paragraphs.length) return;



    let pIdx = 0;

    const typeParagraph = (para) => {

      setIsTyping(true);

      setBubbleKey(k => k + 1);

      let charIdx = 0;

      setMoonBubble("");

      const typeNext = () => {

        charIdx++;

        setMoonBubble(para.slice(0, charIdx));

        if (charIdx < para.length) {

          typeTimerRef.current = setTimeout(typeNext, 38);

        } else {

          pIdx++;

          if (pIdx < paragraphs.length) {

            typeTimerRef.current = setTimeout(() => typeParagraph(paragraphs[pIdx]), 1000);

          } else {

            setIsTyping(false);

            onComplete?.();

          }

        }

      };

      typeNext();

    };

    typeParagraph(paragraphs[0]);

  }, []);



  // ── 메모리 추출 (비동기, 백그라운드) ─────────────────

  const extractAndSaveMemories = useCallback(async (finalHistory) => {

    const uid = uidRef.current;
    if (!uid) return;

    const convoText = finalHistory.slice(-12)
      .map(m => (m.role === "user" ? "사용자" : "달") + ": " + m.content)
      .join("\n");

    const prompt = `다음 대화를 분석해서 JSON만 반환해. 다른 말은 하지 마.

{
  "fixed": { "name": "이름(확실할 때만, 아니면 null)", "age": "나이(확실할 때만, 아니면 null)", "purpose": "달 찾는 주 목적(하소연/장난/화풀이/대화 중 하나, 불명확하면 null)" },
  "facts": ["일반 영구 사실(직업·취미 등, 없으면 빈 배열)"],
  "relation": ["관계 관련 내용(없으면 빈 배열)"],
  "work": ["직장 관련 내용(없으면 빈 배열)"],
  "mental": ["감정/심리 패턴(없으면 빈 배열)"],
  "recent": ["최근 사건/감정/상황(최대 3개, 없으면 빈 배열)"],
  "prefs": ["달에게 원하는 말투/성격 변화(없으면 빈 배열)"]
}

대화:
${convoText}`;

    try {

      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await res.json();
      const txt  = (data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim();
      const ext  = JSON.parse(txt);
      const now  = Date.now();

      const current = memoryDataRef.current;
      const updated = { ...current };

      // fixed: 기존 값 우선 (덮어쓰지 않음)
      if (ext.fixed) {
        const f = ext.fixed;
        const cf = current.fixed || {};
        updated.fixed = { ...cf };
        if (f.name    && !cf.name)    updated.fixed.name    = f.name;
        if (f.age     && !cf.age)     updated.fixed.age     = f.age;
        if (f.purpose && !cf.purpose) updated.fixed.purpose = f.purpose;
        await saveMemoryCategory(uid, 'fixed', updated.fixed);
      }

      // 카테고리별 누적 저장 헬퍼
      const mergeItems = async (cat, newItems, limit) => {
        if (!newItems?.length) return;
        const existing = new Set(current[cat]?.items || []);
        newItems.filter(v => v && v.trim && !existing.has(v)).forEach(v => existing.add(v));
        updated[cat] = { items: [...existing].slice(-limit) };
        await saveMemoryCategory(uid, cat, updated[cat]);
      };

      await mergeItems('facts',    ext.facts,    15);
      await mergeItems('relation', ext.relation, 20);
      await mergeItems('work',     ext.work,     20);
      await mergeItems('mental',   ext.mental,   20);
      await mergeItems('prefs',    ext.prefs,    10);

      // recent: 만료 처리 포함
      if (ext.recent?.length) {
        const newItems = ext.recent
          .filter(e => e && e.trim())
          .map(content => ({ content: content.trim(), createdAt: now, expiresAt: now + SHORT_TTL }));
        updated.recent = { items: pruneShort([...(current.recent?.items || []), ...newItems]) };
        await saveMemoryCategory(uid, 'recent', updated.recent);
      }

      memoryDataRef.current = updated;
      setMemoryData(updated);

    } catch { /* 실패 시 조용히 무시 */ }

  }, []);



  // ── 일일 메모리 압축 ──────────────────────────────────

  const compressDailyMem = useCallback(async (oldMessages) => {
    if (!oldMessages.length) return;
    const convoText = oldMessages.map(m => (m.role==="user"?"나":"달")+": "+m.content).join("\n");
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-haiku-4-5-20251001", max_tokens:120,
          messages:[{role:"user",content:`다음 대화를 핵심만 2-3줄로 요약해. 감정·사건·맥락만:\n${convoText}`}]
        })
      });
      const data = await res.json();
      const summary = (data.content?.[0]?.text||"").trim();
      if (!summary) return;
      const updated = [...dailyMemRef.current, {summary, ts:Date.now()}];
      dailyMemRef.current = updated;
      setDailyMem(updated);
      sessionStorage.setItem("dal:memory:daily", JSON.stringify(updated));
    } catch {}
  }, []);



  // ── 낮 모드 리셋 ─────────────────────────────────────

  const handleDayReset = () => {
    const h = new Date().getHours();
    if (h < DAY_START_H || h >= DAY_END_H) {
      setIsDayMode(false);
      setDayResetMsg(null);
      setMessages([]);
      historyRef.current = [];
      [SESSION_MSGS, SESSION_COMP, SESSION_DAILY].forEach(k => localStorage.removeItem(k));
      setMoonBubble("오늘 밤엔 참 조용하네.\n뭔 일 있어?");
      setUserBubble("");
      setIsLocked(false);
    } else {
      setDayResetMsg("오후 5시 이후에 와줘 🌙");
    }
  };



  // ── SEND ─────────────────────────────────────────────

  const send = useCallback(async () => {

    if ((isLocked && !isDevUnlocked) || isDayMode) return;

    const text = input.trim();

    if (!text || isStreaming) return;

    // 개발자 잠금 해제 코드
    if (text === "일어나이새끼야") {
      localStorage.setItem(DEV_UNLOCK_KEY, "1");
      setIsDevUnlocked(true);
      setIsLocked(false);
      setInput(""); if (taRef.current) taRef.current.innerText = "";
      startTypewriter("...알았어, 일어날게.");
      return;
    }

    const isContinuing = text.endsWith("..");

    const displayText  = isContinuing ? text.slice(0,-2).trimEnd() || text : text;

    const newMsg  = { role:"user", content:displayText };

    const history = [...historyRef.current, newMsg];

    historyRef.current = history;

    setMessages(history);

    setInput(""); if (taRef.current) { taRef.current.innerText = ""; }

    ReactGA.event({ category: "Chat", action: "send_message" });

    setUserBubble(displayText);

    setBubbleKey(k => k+1);

    if (taRef.current) { taRef.current.focus(); }

    if (isContinuing) return;

    // 온보딩 카운터 증가
    const newOnboard = { ...onboardingRef.current, totalMessages: (onboardingRef.current.totalMessages || 0) + 1 };
    onboardingRef.current = newOnboard;
    setOnboarding(newOnboard);
    localStorage.setItem(ONBOARD_KEY, JSON.stringify(newOnboard));

    setStreamText("");

    if (newOnboard.totalMessages >= LOCK_AT && !isDevUnlocked) {
      startTypewriter("미안한데 이제 가봐야겠다. 나중에 다시 보자.");
      setIsLocked(true);
      return;
    }

    // 키워드 감지 → 새 카테고리 있으면 추가 로드
    const detectedCats = detectCategories(history);
    const newCats = detectedCats.filter(c => !loadedCatsRef.current.has(c));
    if (newCats.length && uidRef.current) {
      try {
        const extra = await loadMemory(uidRef.current, newCats);
        newCats.forEach(c => loadedCatsRef.current.add(c));
        const merged = { ...memoryDataRef.current };
        newCats.forEach(c => { if (extra[c]) merged[c] = extra[c]; });
        memoryDataRef.current = merged;
        setMemoryData(merged);
      } catch {}
    }

    setIsStreaming(true);

    let full = "";

    try {

      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {

        method: "POST",

        headers: { "Content-Type":"application/json" },

        body: JSON.stringify({

          model: "claude-sonnet-4-20250514",

          max_tokens: 300,

          system: buildSystemPrompt(memoryDataRef.current, onboardingRef.current, dailyMemRef.current, initTimeRef.current),

          stream: true,

          messages: history.slice(-20),

        }),

      });

      if (!res.ok) {

        const errText = await res.text();

        throw new Error(`HTTP ${res.status}: ${errText}`);

      }

      const reader = res.body.getReader();

      const dec    = new TextDecoder();

      let buf = "";

      outer: while (true) {

        const { done, value } = await reader.read();

        if (done) break;

        buf += dec.decode(value, { stream:true });

        const lines = buf.split("\n");

        buf = lines.pop() ?? "";

        for (const line of lines) {

          if (!line.startsWith("data: ")) continue;

          const raw = line.slice(6).trim();

          if (!raw || raw === "[DONE]") continue;

          try {

            const parsed = JSON.parse(raw);

            if (parsed.type === "message_stop") break outer;

            if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {

              full += parsed.delta.text;

              setStreamText(full);

            }

          } catch { /* 파싱 실패 무시 */ }

        }

      }

      const finalHistory = [...history, { role:"assistant", content:full }];

      historyRef.current = finalHistory; // 즉시 반영 (다음 send API 콜용)

      setStreamText("");

      setMessages(finalHistory);

      // 메모리 추출: 1번째 또는 4회마다 (백그라운드)
      const userCount = finalHistory.filter(m => m.role === "user").length;
      if (userCount === 1 || userCount % 4 === 0) {
        extractAndSaveMemories(finalHistory);
      }

      // 일일 대화 압축: 10회마다
      const compressEnd = finalHistory.length - 20;
      if (userCount % 10 === 0 && compressEnd > compressedUntilRef.current && compressEnd > 0) {
        const toCompress = finalHistory.slice(compressedUntilRef.current, compressEnd);
        if (toCompress.length) {
          compressedUntilRef.current = compressEnd;
          localStorage.setItem(SESSION_COMP, JSON.stringify({ idx: compressEnd, savedAt: Date.now() }));
          compressDailyMem(toCompress);
        }
      }


    } catch (e) {

      console.error("Stream error:", e);

      setStreamText("");

      startTypewriter("미안, 구름이 좀 끼었어. 다시 말해줄래?");

    } finally {

      setIsStreaming(false);

      taRef.current?.focus();

    }

  }, [input, isStreaming, startTypewriter, extractAndSaveMemories, compressDailyMem, isLocked, isDayMode]);



  // ── 일기 생성 ─────────────────────────────────────────

  const makeDiary = async () => {

    if (!messages.length || diaryLoading) return;

    setDiaryLoad(true);

    try {

      const convo = messages.map(m=>`${m.role==="user"?"나":"달"}: ${m.content}`).join("\n");

      const today = new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"});

      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {

        method: "POST",

        headers: { "Content-Type":"application/json" },

        body: JSON.stringify({

          model: "claude-sonnet-4-20250514", max_tokens: 700,

          messages: [{ role:"user", content:`아래 대화를 바탕으로 일기를 써줘. 오늘 날짜는 ${today}야.\n\n[규칙]\n- 글 잘 쓰는 작가가 혼자 쓴 사적인 일기체. 담백하고 감성적인 문장.\n- 1인칭. 내 감정과 생각이 중심. 달(AI)과의 대화는 자연스럽게 녹여.\n- 문단을 2~3개로 나눠서 호흡 있게 써줘. 각 문단은 빈 줄로 구분.\n- 250~400자. 과장 없이, 꾸밈 없이. 일어난 일 나열 금지.\n- JSON만 반환: {"mood":"오늘기분한단어","moodEmoji":"이모지1개","content":"일기내용"}\n\n대화:\n${convo}` }],

        }),

      });

      const data = await res.json();

      const txt  = (data.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim();

      const p    = JSON.parse(txt);

      const entry = { id:Date.now(), date:today, dateShort:new Date().toLocaleDateString("ko-KR"), mood:p.mood, moodEmoji:p.moodEmoji, content:p.content };

      const updated = [entry, ...diaries];

      setDiaries(updated);

      localStorage.setItem("dal:diaries", JSON.stringify(updated));

      setShowHistory(false); setShowDiaries(true);

    } catch {} finally { setDiaryLoad(false); }

  };



  const onKey   = (e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const onInput = (e) => {
    setInput(e.currentTarget.innerText);
  };

  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    sel.deleteFromDocument();
    sel.getRangeAt(0).insertNode(document.createTextNode(text));
    sel.collapseToEnd();
    setInput(taRef.current.innerText);
  };



  // 말풍선 텍스트

  const moonDisplay = (isStreaming || isTyping)

    ? moonBubble

    : (moonBubble.length > 62 ? moonBubble.slice(0,59)+"…" : moonBubble);

  const userDisplay = userBubble.length > 54 ? userBubble.slice(0,51)+"…" : userBubble;



  // iOS 여부 (설치 배너용)
  const isIosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent) && window.navigator.standalone !== true;

  // 키보드 올라올 때 전체 씬을 한 덩어리로 올리기 위해 컨테이너 transform 사용



  return (

    <div style={{ width:"100vw",height:"100dvh",background:"#000",display:"flex",justifyContent:"center",overflow:"hidden" }}>

    <div style={{ width:"min(390px,100vw)",height:"100dvh",overflow:"hidden",position:"relative",background:"#020810",fontFamily:"'Noto Sans KR',sans-serif",flexShrink:0 }}>

      <style>{`

        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600&display=swap');

        @keyframes moonFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}

        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

        @keyframes bubblePop{from{opacity:0;transform:scale(.87) translateY(7px)}to{opacity:1;transform:scale(1) translateY(0)}}

        @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}

        @keyframes fadeIn{from{opacity:0}to{opacity:1}}

        [contenteditable]{outline:none;}
        [contenteditable][data-placeholder]:empty::before{content:attr(data-placeholder);color:rgba(136,152,180,.45);pointer-events:none;}

        ::-webkit-scrollbar{width:3px}

        ::-webkit-scrollbar-thumb{background:#14203a}

      `}</style>



      {/* ── 낮 모드 오버레이 ── */}

      {isDayMode && (
        <>
          <img src={IMG_DAY} alt="" style={{ position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top",zIndex:200,userSelect:"none",pointerEvents:"none" }} />
          <div style={{ position:"absolute",inset:0,zIndex:201,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:"72px",fontFamily:"'Noto Sans KR',sans-serif" }}>
            <p style={{ margin:"0 0 16px",textAlign:"center",color:"rgba(255,255,255,.72)",fontSize:13,lineHeight:1.85,textShadow:"0 1px 6px rgba(0,0,0,.5)" }}>
              지금은 달이 안보이네..<br />밤에 다시 올게.
            </p>
            <button
              onClick={handleDayReset}
              style={{ background:"rgba(0,0,0,.28)",border:"1px solid rgba(255,255,255,.22)",color:"rgba(255,255,255,.65)",fontSize:12,padding:"8px 22px",cursor:"pointer",fontFamily:"inherit",backdropFilter:"blur(4px)" }}
            >
              나중에 다시 올게 🌙
            </button>
            {dayResetMsg && (
              <p style={{ margin:"12px 0 0",color:"rgba(255,210,100,.85)",fontSize:12,textShadow:"0 1px 4px rgba(0,0,0,.6)" }}>{dayResetMsg}</p>
            )}
          </div>
        </>
      )}



      {/* ── 배경 ── */}

      <img src={IMG_BG} alt="" style={{

        position:"absolute", inset:0, width:"100%", height:"100%",

        objectFit:"cover", objectPosition:"center top",

        transition:"none",

        zIndex:1, userSelect:"none", pointerEvents:"none",

      }} />



      {/* ── 달 레이어 ── */}

      <div style={{

        position:"absolute",

        left:"58%", top:"27%",

        transform:"translate(-50%, -50%)",

        zIndex:5,

        display:"flex", flexDirection:"column", alignItems:"center",

      }}>

        {/* 달 이미지 */}

        <div style={{ animation:"moonFloat 6s ease-in-out infinite", position:"relative" }}>

          <img src={IMG_MOON} alt="" style={{

            width:"clamp(140px,44vw,220px)",

            display:"block",

            userSelect:"none", pointerEvents:"none",

          }} />

          {/* 달 얼굴 SVG 오버레이 */}

          <div style={{

            position:"absolute", inset:0,

            display:"flex", alignItems:"center", justifyContent:"center",

          }}>

            <MoonFace isThinking={isStreaming} isSpeaking={isTyping} size={Math.round(window.innerWidth * 0.36)} />

          </div>

        </div>



        {/* 달 말풍선 */}

        {moonDisplay && (

          <div key={`m${bubbleKey}`} style={{

            marginTop:6, position:"relative",

            maxWidth:"min(240px,62vw)",

            padding:"9px 13px",

            background:"rgba(18,12,2,.93)",

            border:"1.5px solid #5a4208",

            color:"#e8c828",

            fontSize:"clamp(10px,3vw,12px)",

            lineHeight:1.72, wordBreak:"break-word",

            fontFamily:"'Noto Sans KR',sans-serif",

            boxShadow:"0 3px 16px rgba(0,0,0,.8)",

            animation:"bubblePop .3s cubic-bezier(.34,1.56,.64,1) forwards",

            whiteSpace:"pre-wrap",

          }}>

            {moonDisplay}

            {(isStreaming || isTyping) && <span style={{ display:"inline-block",width:2,height:10,background:"#e8c828",marginLeft:2,animation:"blink .6s steps(1) infinite",verticalAlign:"middle" }} />}

            <div style={{ position:"absolute",top:-6,left:"50%",transform:"translateX(-50%)",borderLeft:"5px solid transparent",borderRight:"5px solid transparent",borderBottom:"6px solid #5a4208" }} />

          </div>

        )}

      </div>



      {/* ── 인물 레이어 ── */}

      <div style={{

        position:"absolute",

        bottom:0,

        left:0, right:0,

        zIndex:8,

        pointerEvents:"none",

      }}>

        {/* 유저 말풍선 */}

        {userDisplay && (

          <div key={`u${bubbleKey}`} style={{

            position:"absolute",

            bottom:"100%",

            left:"clamp(12px, 18%, 120px)",

            marginBottom:8,

            maxWidth:"min(190px,50vw)",

            padding:"8px 12px",

            background:"rgba(3,8,22,.93)",

            border:"1.5px solid #162248",

            color:"#7898cc",

            fontSize:"clamp(10px,3vw,12px)",

            lineHeight:1.68, wordBreak:"break-word",

            fontFamily:"'Noto Sans KR',sans-serif",

            boxShadow:"0 3px 16px rgba(0,0,0,.8)",

            animation:"bubblePop .26s cubic-bezier(.34,1.56,.64,1) forwards",

            whiteSpace:"pre-wrap",

            pointerEvents:"none",

          }}>

            {userDisplay}

            <div style={{ position:"absolute",bottom:-6,left:14,borderLeft:"5px solid transparent",borderRight:"5px solid transparent",borderTop:"6px solid #162248" }} />

          </div>

        )}



        <img src={IMG_PERSON} alt="" style={{

          width:"86.25%",

          height:"auto",

          maxHeight:"70vh",

          display:"block",

          marginLeft:0,

          userSelect:"none",

          verticalAlign:"bottom",

        }} />

      </div>



      {/* ── 상단 버튼 ── */}

      <div style={{ position:"absolute",top:14,right:14,zIndex:202,display:"flex",gap:7 }}>

        <button onClick={() => setShowFeedback(true)} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #2a1f4a",color:"#5a4880",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>✉</button>

        <button onClick={handleDayReset} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #5a4208",color:"#7a5a10",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>↺</button>

        <button onClick={()=>{setShowDiaries(true);setShowHistory(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #5a4208",color:"#7a5a10",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>📔</button>

        <button onClick={()=>{setShowHistory(true);setShowDiaries(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #5a4208",color:"#7a5a10",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>기록</button>

      </div>



      {/* ── 입력창 ── */}
      {/* 래퍼: 가운데 고정 (transform 충돌 방지) */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100, display:"flex", justifyContent:"center", pointerEvents:"none" }}>

      <div id="chat-input-area" style={{

        width:"min(390px,100vw)",

        padding:"10px 14px 18px",

        background:"linear-gradient(0deg,rgba(2,5,12,.98) 70%,transparent)",

        transition:"none",

        pointerEvents:"all",

      }}

        onMouseDown={e => { if (e.target.tagName!=="TEXTAREA"&&e.target.tagName!=="BUTTON") e.preventDefault(); }}

      >

        <div style={{ display:"flex",alignItems:"center",gap:9,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",padding:"8px 12px",backdropFilter:"blur(4px)" }}>

          <div ref={taRef} contentEditable={!isStreaming&&!isDayMode&&!(isLocked&&!isDevUnlocked)} suppressContentEditableWarning={true}
            onInput={onInput} onKeyDown={onKey} onPaste={onPaste}
            onFocus={() => setTimeout(() => window.scrollTo(0,0), 50)}
            data-placeholder="달에게 말 걸어봐..."
            style={{ flex:1,background:"transparent",border:"none",color:"#8898b4",fontSize:14,fontFamily:"'Noto Sans KR',sans-serif",lineHeight:1.55,minHeight:44,maxHeight:100,overflowY:"auto",caretColor:"#4878b8",wordBreak:"break-word",whiteSpace:"pre-wrap",paddingTop:11 }} />

          <button onClick={send} disabled={isStreaming||!input.trim()||isDayMode||(isLocked&&!isDevUnlocked)} style={{

            width:36,height:36,flexShrink:0,

            background:isStreaming||!input.trim()||isDayMode||(isLocked&&!isDevUnlocked)?"rgba(8,13,26,.8)":"rgba(14,28,56,.9)",

            border:`1px solid ${isStreaming||!input.trim()||isDayMode||(isLocked&&!isDevUnlocked)?"#2a1a00":"#5a4208"}`,

            color:isStreaming||!input.trim()||isDayMode||(isLocked&&!isDevUnlocked)?"#2a1a00":"#c8a020",

            cursor:isStreaming||!input.trim()||isDayMode||(isLocked&&!isDevUnlocked)?"not-allowed":"pointer",

            fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",

          }}>↑</button>

        </div>

        <div style={{ textAlign:"center",color:"rgba(255,255,255,.08)",fontSize:10,marginTop:6 }}>

          Enter 전송 · Shift+Enter 줄바꿈 · 끝에 <span style={{ color:"rgba(255,255,255,.15)" }}>..</span> 붙이면 이어치기

        </div>

      </div>
      </div>{/* 래퍼 닫기 */}



      {showHistory && <HistoryPanel messages={messages} streamingText={streamingText} memoryData={memoryData} onClose={()=>setShowHistory(false)} onMakeDiary={makeDiary} diaryLoading={diaryLoading} onOpenDiaries={()=>{setShowDiaries(true);setShowHistory(false);}} />}

      {showDiaries && <DiaryModal diaries={diaries} onClose={()=>setShowDiaries(false)} />}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {/* ── PWA 설치 배너 ── */}
      {showInstall && (
        <div style={{
          position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
          width:"min(390px,100vw)", zIndex:500,
          background:"rgba(4,8,20,.97)", borderTop:"1px solid #1a2a4a",
          padding:"16px 20px 28px", fontFamily:"'Noto Sans KR',sans-serif",
          animation:"slideUp .28s cubic-bezier(.34,1.56,.64,1) forwards",
        }}>
          <style>{`@keyframes slideUp{from{transform:translateX(-50%) translateY(100%)}to{transform:translateX(-50%) translateY(0)}}`}</style>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14 }}>
            <div>
              <div style={{ color:"#c8a820", fontSize:15, fontWeight:600, marginBottom:4 }}>🌙 달챗 홈 화면에 추가</div>
              <div style={{ color:"#4a6080", fontSize:12, lineHeight:1.6 }}>
                {isIosBrowser
                  ? <>Safari 하단 공유 버튼(<span style={{fontSize:13}}>⎙</span>)을 누른 뒤<br/>「홈 화면에 추가」를 선택해줘</>
                  : "홈 화면에 추가하면 앱처럼 바로 열 수 있어"
                }
              </div>
            </div>
            <button onClick={dismissInstall} style={{ background:"none", border:"none", color:"#2a3a50", fontSize:20, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0 }}>✕</button>
          </div>
          {!isIosBrowser && (
            <button onClick={handleInstall} style={{
              width:"100%", padding:"12px", background:"rgba(14,28,56,.9)",
              border:"1px solid #5a4208", color:"#c8a020", fontSize:14,
              fontFamily:"inherit", cursor:"pointer", fontWeight:600,
            }}>
              홈 화면에 추가
            </button>
          )}
        </div>
      )}

    </div>

    </div>

  );

}
