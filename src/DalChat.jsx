import { useState, useRef, useEffect, useCallback } from "react";
import dalPersonality from "./prompts/dal-personality.txt?raw";



// ── Base64 이미지 ──────────────────────────────────────

const IMG_BG="/bg.png";

const IMG_MOON="/moon.png";

const IMG_PERSON="/person.png";



// ── 메모리 상수 ────────────────────────────────────────

const SHORT_TTL = 14 * 24 * 60 * 60 * 1000; // 14일

const LONG_KEY    = "dal:memory:long";
const SHORT_KEY   = "dal:memory:short";
const ONBOARD_KEY = "dal:onboarding";

const defaultLong = () => ({ name: null, age: null, purpose: null, facts: [], lastUpdated: null });
const defaultShort = () => [];
const defaultOnboard = () => ({ totalMessages: 0 });

function pruneShort(arr) {
  const now = Date.now();
  return (arr || []).filter(e => e.expiresAt > now).slice(-20);
}



// ── 시스템 프롬프트 ────────────────────────────────────

const buildSystemPrompt = (longMem, shortMem, onboarding) => {
  const now = Date.now();
  let memSection = "";

  // 장기 기억
  const longParts = [];
  if (longMem.name)    longParts.push(`이름: ${longMem.name}`);
  if (longMem.age)     longParts.push(`나이: ${longMem.age}`);
  if (longMem.purpose) longParts.push(`달 찾는 이유: ${longMem.purpose}`);
  if (longMem.facts?.length) longParts.push(`기타: ${longMem.facts.join(', ')}`);
  if (longParts.length) {
    memSection += `\n\n[이 사람에 대해 알고 있는 것]\n${longParts.join('\n')}`;
  }

  // 단기 기억 (최근 사건)
  const recent = pruneShort(shortMem).slice(-6);
  if (recent.length) {
    const lines = recent.map(e => {
      const daysAgo = Math.floor((now - e.createdAt) / 86400000);
      const when = daysAgo === 0 ? '오늘' : daysAgo === 1 ? '어제' : `${daysAgo}일 전`;
      return `- ${when}: ${e.content}`;
    }).join('\n');
    memSection += `\n\n[최근에 있었던 일]\n${lines}`;
  }

  // 온보딩: 모르는 것 자연스럽게 하나씩 질문
  const total = onboarding?.totalMessages || 0;
  const missing = [];
  if (!longMem.name)    missing.push('이름');
  if (!longMem.purpose) missing.push('달한테 주로 뭘 털어놓으러 오는지(하소연인지, 심심해서인지, 화풀이인지 등)');
  if (missing.length && total <= 30) {
    memSection += `\n\n[참고]: 아직 모르는 것이 있어 — "${missing[0]}". 대화 흐름상 자연스러울 때 슬쩍 한 번만 물어봐. 억지로 물어볼 필요는 없어.`;
  }

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

function HistoryPanel({ messages, streamingText, longMem, shortMem, onClose, onMakeDiary, diaryLoading, onOpenDiaries }) {

  const endRef = useRef(null);

  const [memOpen, setMemOpen] = useState(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, streamingText]);

  // 장기 기억 표시용 텍스트
  const longLines = [
    longMem.name    ? `이름: ${longMem.name}` : null,
    longMem.age     ? `나이: ${longMem.age}` : null,
    longMem.purpose ? `목적: ${longMem.purpose}` : null,
    ...(longMem.facts || []).map(f => `• ${f}`),
  ].filter(Boolean);

  // 단기 기억 표시용 텍스트
  const now = Date.now();
  const recentLines = pruneShort(shortMem).slice(-4).map(e => {
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

export default function DalChat() {

  const [messages, setMessages]        = useState([]);

  const [input, setInput]              = useState("");

  const [isStreaming, setIsStreaming]  = useState(false);

  const [streamingText, setStreamText] = useState("");

  const [showHistory, setShowHistory]  = useState(false);

  const [showDiaries, setShowDiaries]  = useState(false);

  const [diaryLoading, setDiaryLoad]   = useState(false);

  const [diaries, setDiaries]          = useState([]);

  const [longMem, setLongMem]          = useState(defaultLong());

  const [shortMem, setShortMem]        = useState(defaultShort());

  const [onboarding, setOnboarding]    = useState(defaultOnboard());

  const [moonBubble, setMoonBubble]    = useState("오늘 밤엔 참 조용하네.\n뭔 일 있어?");

  const [userBubble, setUserBubble]    = useState("");

  const [bubbleKey, setBubbleKey]      = useState(0);

  // 키보드 패럴랙스

  const [kbShift, setKbShift]          = useState(0);

  const [isTyping, setIsTyping]        = useState(false);

  const vvHeightRef                    = useRef(null);

  const taRef                          = useRef(null);

  const longMemRef                     = useRef(defaultLong());

  const shortMemRef                    = useRef(defaultShort());

  const onboardingRef                  = useRef(defaultOnboard());

  const typeTimerRef                   = useRef(null);



  // storage 로드

  useEffect(() => {

    try {
      const r = localStorage.getItem(LONG_KEY);
      if (r) { const p = JSON.parse(r); setLongMem(p); longMemRef.current = p; }
    } catch {}

    try {
      const r = localStorage.getItem(SHORT_KEY);
      if (r) { const arr = pruneShort(JSON.parse(r)); setShortMem(arr); shortMemRef.current = arr; }
    } catch {}

    try {
      const r = localStorage.getItem(ONBOARD_KEY);
      if (r) { const o = JSON.parse(r); setOnboarding(o); onboardingRef.current = o; }
    } catch {}

    try { const r = localStorage.getItem("dal:diaries"); if(r) setDiaries(JSON.parse(r) || []); } catch {}

    taRef.current?.focus();

  }, []);



  // 전체화면 자동 요청 (첫 탭/클릭 시)

  useEffect(() => {

    const req = () => {

      const el = document.documentElement;

      if (!document.fullscreenElement) el.requestFullscreen?.().catch(()=>{});

    };

    document.addEventListener("touchstart", req, { once:true, passive:true });

    document.addEventListener("click",      req, { once:true });

    return () => { document.removeEventListener("touchstart", req); document.removeEventListener("click", req); };

  }, []);



  // 키보드 패럴랙스: visualViewport 감지

  useEffect(() => {

    const vv = window.visualViewport;

    if (!vv) return;

    vvHeightRef.current = vv.height;

    const handler = () => {

      const initial = vvHeightRef.current;

      const current = vv.height;

      const shrink  = Math.max(0, initial - current);

      setKbShift(shrink);

    };

    vv.addEventListener("resize", handler);

    return () => vv.removeEventListener("resize", handler);

  }, []);



  // typewriter 타이머 정리

  useEffect(() => () => { if (typeTimerRef.current) clearTimeout(typeTimerRef.current); }, []);



  // ── 타이핑 애니메이션 ─────────────────────────────────

  const startTypewriter = useCallback((fullText) => {

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

          }

        }

      };

      typeNext();

    };

    typeParagraph(paragraphs[0]);

  }, []);



  // ── 메모리 추출 (비동기, 백그라운드) ─────────────────

  const extractAndSaveMemories = useCallback(async (finalHistory) => {

    const convoText = finalHistory.slice(-12)
      .map(m => (m.role === "user" ? "사용자" : "달") + ": " + m.content)
      .join("\n");

    const prompt = `다음 대화를 분석해서 JSON만 반환해. 다른 말은 하지 마.

{
  "shortEvents": ["방금 대화에서 나온 사용자의 최근 사건/감정/상황 (최대 3개, 없으면 빈 배열)"],
  "longFacts": {
    "name": "사용자 이름 (확실할 때만, 아니면 null)",
    "age": "나이 숫자 (확실할 때만, 아니면 null)",
    "purpose": "달 찾는 주 목적 — 하소연/장난/화풀이/대화 중 하나로, 불명확하면 null",
    "newFacts": ["새롭게 알게 된 영구적 사실 (직업·가족·취미 등, 없으면 빈 배열)"]
  }
}

대화:
${convoText}`;

    try {

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await res.json();
      const txt  = (data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim();
      const ext  = JSON.parse(txt);
      const now  = Date.now();

      // 단기 기억 업데이트
      const newEvents = (ext.shortEvents || [])
        .filter(e => e && e.trim())
        .map(content => ({ content: content.trim(), createdAt: now, expiresAt: now + SHORT_TTL }));

      const updatedShort = pruneShort([...shortMemRef.current, ...newEvents]);
      shortMemRef.current = updatedShort;
      setShortMem(updatedShort);
      localStorage.setItem(SHORT_KEY, JSON.stringify(updatedShort));

      // 장기 기억 업데이트 (기존 값 우선, 새 값으로 덮어쓰지 않음)
      const lf = ext.longFacts || {};
      const updatedLong = { ...longMemRef.current };
      if (lf.name    && !updatedLong.name)    updatedLong.name    = lf.name;
      if (lf.age     && !updatedLong.age)     updatedLong.age     = lf.age;
      if (lf.purpose && !updatedLong.purpose) updatedLong.purpose = lf.purpose;
      if (lf.newFacts?.length) {
        const existing = new Set(updatedLong.facts || []);
        lf.newFacts.filter(f => f && !existing.has(f)).forEach(f => existing.add(f));
        updatedLong.facts = [...existing].slice(-15);
      }
      updatedLong.lastUpdated = now;
      longMemRef.current = updatedLong;
      setLongMem(updatedLong);
      localStorage.setItem(LONG_KEY, JSON.stringify(updatedLong));

    } catch { /* 실패 시 조용히 무시 */ }

  }, []);



  // ── SEND ─────────────────────────────────────────────

  const send = useCallback(async () => {

    const text = input.trim();

    if (!text || isStreaming) return;

    const isContinuing = text.endsWith("..");

    const displayText  = isContinuing ? text.slice(0,-2).trimEnd() || text : text;

    const newMsg  = { role:"user", content:displayText };

    const history = [...messages, newMsg];

    setMessages(history);

    setInput("");

    setUserBubble(displayText);

    setBubbleKey(k => k+1);

    if (taRef.current) { taRef.current.style.height="44px"; taRef.current.focus(); }

    if (isContinuing) return;

    // 온보딩 카운터 증가
    const newOnboard = { ...onboardingRef.current, totalMessages: (onboardingRef.current.totalMessages || 0) + 1 };
    onboardingRef.current = newOnboard;
    setOnboarding(newOnboard);
    localStorage.setItem(ONBOARD_KEY, JSON.stringify(newOnboard));

    setStreamText("");

    setIsStreaming(true);

    let full = "";

    try {

      const res = await fetch("/api/chat", {

        method: "POST",

        headers: { "Content-Type":"application/json" },

        body: JSON.stringify({

          model: "claude-sonnet-4-20250514",

          max_tokens: 300,

          system: buildSystemPrompt(longMemRef.current, shortMemRef.current, onboardingRef.current),

          stream: true,

          messages: history.slice(-10),

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

      // React 18 자동 배칭: 세 setState가 단일 렌더로 묶여 동시 반영
      setMessages(finalHistory);
      setStreamText("");
      startTypewriter(full);

      // 메모리 추출: 1번째 또는 4회마다 (백그라운드)
      const userCount = finalHistory.filter(m => m.role === "user").length;
      if (userCount === 1 || userCount % 4 === 0) {
        extractAndSaveMemories(finalHistory);
      }


    } catch (e) {

      console.error("Stream error:", e);

      setStreamText("");

      startTypewriter("미안, 구름이 좀 끼었어. 다시 말해줄래?");

    } finally {

      setIsStreaming(false);

      taRef.current?.focus();

    }

  }, [input, isStreaming, messages, startTypewriter, extractAndSaveMemories]);



  // ── 일기 생성 ─────────────────────────────────────────

  const makeDiary = async () => {

    if (!messages.length || diaryLoading) return;

    setDiaryLoad(true);

    try {

      const convo = messages.map(m=>`${m.role==="user"?"나":"달"}: ${m.content}`).join("\n");

      const today = new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"});

      const res = await fetch("/api/chat", {

        method: "POST",

        headers: { "Content-Type":"application/json" },

        body: JSON.stringify({

          model: "claude-sonnet-4-20250514", max_tokens: 700,

          messages: [{ role:"user", content:`오늘(${today}) 달과의 대화를 내가 직접 쓴 일기로 바꿔줘.\n- 1인칭. 내 감정/생각 중심. 달 얘기도 자연스럽게 녹여.\n- 진짜 일기처럼, 구어체로. 200~360자.\nJSON만: {"mood":"오늘기분한단어","moodEmoji":"이모지1개","content":"일기내용"}\n대화:\n${convo}` }],

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

    setInput(e.target.value);

    const t = e.target;

    t.style.height = "44px";

    t.style.height = Math.min(t.scrollHeight, 100)+"px";

  };



  // 말풍선 텍스트

  const moonDisplay = (isStreaming || isTyping)

    ? moonBubble

    : (moonBubble.length > 62 ? moonBubble.slice(0,59)+"…" : moonBubble);

  const userDisplay = userBubble.length > 54 ? userBubble.slice(0,51)+"…" : userBubble;



  // 패럴랙스 계산

  const bgShift     = kbShift * 0.45;

  const moonShift   = kbShift * 0.12;

  const personShift = kbShift * 0.30;



  return (

    <div style={{ width:"100vw",height:"100dvh",background:"#000",display:"flex",justifyContent:"center",overflow:"hidden" }}>

    <div style={{ width:"min(390px,100vw)",height:"100%",overflow:"hidden",position:"relative",background:"#020810",fontFamily:"'Noto Sans KR',sans-serif",flexShrink:0 }}>

      <style>{`

        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600&display=swap');

        @keyframes moonFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}

        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

        @keyframes bubblePop{from{opacity:0;transform:scale(.87) translateY(7px)}to{opacity:1;transform:scale(1) translateY(0)}}

        @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}

        @keyframes fadeIn{from{opacity:0}to{opacity:1}}

        textarea{outline:none;}

        ::-webkit-scrollbar{width:3px}

        ::-webkit-scrollbar-thumb{background:#14203a}

      `}</style>



      {/* ── 배경 ── */}

      <img src={IMG_BG} alt="" style={{

        position:"absolute", inset:0, width:"100%", height:"100%",

        objectFit:"cover", objectPosition:"center top",

        transform:`translateY(-${bgShift}px)`,

        transition:"transform .15s ease-out",

        zIndex:1, userSelect:"none", pointerEvents:"none",

      }} />



      {/* ── 달 레이어 ── */}

      <div style={{

        position:"absolute",

        left:"58%", top:`calc(27% - ${moonShift}px)`,

        transform:"translate(-50%, -50%)",

        transition:"top .15s ease-out",

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

        bottom:`calc(0px + ${personShift}px)`,

        left:0, right:0,

        transition:"bottom .15s ease-out",

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

      <div style={{ position:"absolute",top:14,right:14,zIndex:100,display:"flex",gap:7 }}>

        <button onClick={()=>{setShowDiaries(true);setShowHistory(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #5a4208",color:"#7a5a10",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>📔</button>

        <button onClick={()=>{setShowHistory(true);setShowDiaries(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #5a4208",color:"#7a5a10",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>기록</button>

      </div>



      {/* ── 입력창 ── */}

      <div style={{

        position:"absolute", bottom:kbShift, left:0, right:0,

        padding:"10px 14px 18px",

        background:"linear-gradient(0deg,rgba(2,5,12,.98) 70%,transparent)",

        zIndex:50,

        transition:"bottom .2s ease-out",

      }}

        onMouseDown={e => { if (e.target.tagName!=="TEXTAREA"&&e.target.tagName!=="BUTTON") e.preventDefault(); }}

      >

        <div style={{ display:"flex",alignItems:"flex-end",gap:9,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",padding:"8px 12px",backdropFilter:"blur(4px)" }}>

          <textarea ref={taRef} value={input} onChange={onInput} onKeyDown={onKey} disabled={isStreaming}

            placeholder="달에게 말 걸어봐..."

            style={{ flex:1,background:"transparent",border:"none",color:"#8898b4",fontSize:14,fontFamily:"'Noto Sans KR',sans-serif",resize:"none",lineHeight:1.55,height:44,maxHeight:100,overflow:"auto",caretColor:"#4878b8" }} />

          <button onClick={send} disabled={isStreaming||!input.trim()} style={{

            width:36,height:36,flexShrink:0,

            background:isStreaming||!input.trim()?"rgba(8,13,26,.8)":"rgba(14,28,56,.9)",

            border:`1px solid ${isStreaming||!input.trim()?"#2a1a00":"#5a4208"}`,

            color:isStreaming||!input.trim()?"#2a1a00":"#c8a020",

            cursor:isStreaming||!input.trim()?"not-allowed":"pointer",

            fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",

          }}>↑</button>

        </div>

        <div style={{ textAlign:"center",color:"rgba(255,255,255,.08)",fontSize:10,marginTop:6 }}>

          Enter 전송 · Shift+Enter 줄바꿈 · 끝에 <span style={{ color:"rgba(255,255,255,.15)" }}>..</span> 붙이면 이어치기

        </div>

      </div>



      {showHistory && <HistoryPanel messages={messages} streamingText={streamingText} longMem={longMem} shortMem={shortMem} onClose={()=>setShowHistory(false)} onMakeDiary={makeDiary} diaryLoading={diaryLoading} onOpenDiaries={()=>{setShowDiaries(true);setShowHistory(false);}} />}

      {showDiaries && <DiaryModal diaries={diaries} onClose={()=>setShowDiaries(false)} />}

    </div>

    </div>

  );

}
