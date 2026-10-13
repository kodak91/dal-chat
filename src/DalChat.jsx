import { useState, useRef, useEffect, useCallback } from "react";
import dalPersonality from "./prompts/dal-personality.txt?raw";
import FeedbackModal from "./FeedbackModal.jsx";
import NoticeModal from "./NoticeModal.jsx";
import ReactGA from "react-ga4";
import { loadMemory, saveMemoryCategory, requestAndSavePushToken, logoutUser } from "./firebase.js";
import { startMusic, toggleMusic, isMusicOn } from "./music.js";



// ── Base64 이미지 ──────────────────────────────────────

const IMG_BG="/bg.png";

const IMG_DAY="/day.png";

const IMG_MOON="/moon.png";

const IMG_PERSON="/person.png";



// ── 메모리 상수 ────────────────────────────────────────

const DAY_START_H = 5;
const DAY_END_H   = 17;
const SLEEP_AT    = 100;
const LOCK_AT     = 120;

const ONBOARD_KEY    = "dal:onboarding";
const SESSION_MSGS   = "dal:session:messages";
const SESSION_COMP   = "dal:session:compress";
const SESSION_DAILY  = "dal:session:daily";
const DEV_UNLOCK_KEY = "dal:dev:unlocked";

const SESSION_MEMIDX = "dal:session:memidx"; // 노트에 반영된 메시지 위치

// 예전 방식(카테고리 목록) 기억 — 지우지 않고 읽어서 새 노트로 옮김
const LEGACY_CATEGORIES = ['fixed', 'facts', 'prefs', 'recent', 'relation', 'work', 'mental'];
const MEMORY_KEYS = ['note', 'meta', 'style', ...LEGACY_CATEGORIES];

const NOTE_EVERY   = 5;    // 사용자 메시지 5개마다 노트 정리
const NOTE_MAX_LEN = 3000;
const META_THROTTLE = 10 * 60 * 1000; // 마지막 대화 시각 저장은 10분에 한 번
const STYLE_KEEP    = 40;  // 말투 참고용으로 저장하는 사용자 문장 수
const STYLE_SHOW    = 25;  // 그중 달에게 보여주는 수
const STYLE_MAX_LEN = 150; // 너무 긴 문장은 말투 샘플에서 제외

const NOTE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    note: { type: "string" },
  },
  required: ["name", "note"],
  additionalProperties: false,
};

const DAY_MS = 86400000;

const REFUSAL_MSG = "음... 그 얘긴 내가 같이 하기 좀 어렵다. 다른 얘기 하자.";

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

// 경과 시간을 "3일", "2주", "4달" 같은 말로. 하루 미만이면 null
function gapText(ms) {
  const d = Math.floor(ms / DAY_MS);
  if (d < 1)   return null;
  if (d < 7)   return `${d}일`;
  if (d < 30)  return `${Math.floor(d / 7)}주`;
  if (d < 365) return `${Math.floor(d / 30)}달`;
  return `${Math.floor(d / 365)}년`;
}

// 예전 카테고리 기억을 글로 펼침 (새 노트로 옮기기 전까지 임시로 사용)
function legacyToText(m) {
  const lines = [];
  const f = m.fixed || {};
  if (f.name)    lines.push(`이름: ${f.name}`);
  if (f.age)     lines.push(`나이: ${f.age}`);
  if (f.purpose) lines.push(`달 찾는 이유: ${f.purpose}`);
  const add = (label, items) => { if (items?.length) lines.push(`${label}: ${items.join(', ')}`); };
  add('기타', m.facts?.items);
  add('관계', m.relation?.items);
  add('직장/일', m.work?.items);
  add('감정/심리', m.mental?.items);
  add('바라는 말투', m.prefs?.items);
  (m.recent?.items || []).slice(-6).forEach(e => lines.push(`(${fmtDate(e.createdAt)}) ${e.content}`));
  return lines.length ? `(예전에 적어둔 기억. 날짜 없는 건 오래됐을 수 있어)\n${lines.join('\n')}` : '';
}

// 사용자가 실제로 한 말을 말투 샘플로 모음 (최근 것 우선, 중복 제거)
function mergeStyle(style, msgs) {
  const fresh = msgs
    .filter(m => m.role === "user")
    .map(m => (m.content || "").trim())
    .filter(t => t && t.length <= STYLE_MAX_LEN);
  if (!fresh.length) return null;
  const samples = [...(style?.samples || []).filter(t => !fresh.includes(t)), ...fresh].slice(-STYLE_KEEP);
  return { samples, updatedAt: Date.now() };
}

function avgLen(lines) {
  return lines.length ? Math.round(lines.reduce((n, t) => n + t.length, 0) / lines.length) : 0;
}

// 마지막 대화 시각. 예전 사용자는 recent 기억의 가장 늦은 날짜로 대신함
function lastChatAtOf(m) {
  if (m.meta?.lastChatAt) return m.meta.lastChatAt;
  const ts = (m.recent?.items || []).map(e => e.createdAt).filter(Boolean);
  return ts.length ? Math.max(...ts) : null;
}

function buildNotePrompt(current, convo, convoDate) {
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return `너는 '달'이라는 캐릭터의 기억 노트를 관리해. 달은 이 노트를 보고 사용자를 기억해. 사용자도 이 노트를 볼 수 있어.
오늘 날짜: ${today}

[지금까지의 노트]
${current || '(아직 없음)'}

[새 대화] ${convo ? `(${convoDate})` : ''}
${convo || '(없음 — 기존 노트만 아래 형식으로 정리해줘)'}

새 대화를 반영해서 노트 전체를 다시 써줘.

형식: 아래 여섯 칸. 내용 없는 칸은 칸 이름만 둬.
[이 사람] 이름, 나이, 하는 일, 성격, 취향처럼 잘 안 바뀌는 것
[요즘 상황] 진행 중인 일이나 고민. 줄 끝에 들은 날짜를 (10/3)처럼 붙여
[지나간 일] 끝났거나 해결된 일. 한 줄씩 짧게, 날짜 포함
[말투와 유머] 이 사람이 말하는 방식, 유머 코드, 욕 쓰는 정도, 자주 쓰는 말, 화나거나 우울할 때 말하는 패턴
[우리 사이] 달과의 관계, 자주 하는 농담, 대화 분위기, 달에게 바라는 것
[최근 대화] 대화한 날짜별 한 줄 요약. 최근 5개까지만

규칙:
- 새 정보가 기존 내용과 다르면 새 걸로 고쳐. (예: 이직 준비 중 → 이직함)
- 해결됐거나 끝난 일은 [요즘 상황]에서 [지나간 일]로 옮겨.
- [요즘 상황]은 날짜를 보고 판단해. 두 달 넘게 다시 나온 적 없으면 '(오래됨, 지금은 모름)'을 붙이거나 [지나간 일]로 옮겨.
- 날짜를 모르는 예전 기록은 '(예전)'이라고 표시해.
- 대화에 실제로 나온 것만 적어. 추측하지 마.
- 겹치는 건 합치고, 사소하고 오래된 건 지워. 전체 1500자 이내.
- 사용자가 읽어도 기분 나쁘지 않게, 담백하게 써.

name: 사용자 이름이나 불러달라는 호칭. 모르면 빈 문자열.`;
}

// 응답의 text 블록만 모아서 반환 (웹서치 등 다른 블록이 앞에 올 수 있음)
function responseText(data) {
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
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
  note:     null,
  meta:     {},
  style:    null,
});
const defaultOnboard = () => ({ totalMessages: 0 });




// ── 시스템 프롬프트 ────────────────────────────────────

const buildSystemPrompt = (memoryData, onboarding, dailyMem = [], initTime = null) => {
  const now = Date.now();
  const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  let memSection = `\n\n[지금]: ${dateStr} ${timeStr}`;

  if (initTime) memSection += `\n\n[대화 시작 시간]: ${initTime}`;

  const total = onboarding?.totalMessages || 0;

  // 마지막으로 대화한 때 → 오랜만이면 반응 + 예전 기억이 지금도 맞는지 조심
  const lastChatAt = lastChatAtOf(memoryData);
  const gap = lastChatAt ? gapText(now - lastChatAt) : null;
  if (gap) {
    memSection += `\n\n[마지막으로 대화한 때]: ${fmtDate(lastChatAt)} (${gap} 전)`;
    if (total <= 2) {
      memSection += `\n오랜만에 온 거면 그만큼 반응해줘. 며칠이면 가볍게 아는 척, 몇 주면 반가워하거나 살짝 서운한 티, 몇 달이면 진짜 오랜만이라는 티. 첫 인사에서만.`;
    }
  }

  // 이 사람 말투: 실제로 한 말 + 평균 길이
  const samples = (memoryData.style?.samples || []).slice(-STYLE_SHOW);
  if (samples.length) {
    memSection += `\n\n[이 사람 말투 — 실제로 한 말들]\n${samples.map(t => `- ${t}`).join('\n')}`;
    memSection += `\n이 사람은 한 번에 평균 ${avgLen(samples)}자 정도로 말해. 너도 그 정도로.`;
  } else {
    memSection += `\n\n[이 사람 말투]: 아직 잘 몰라. 지금 대화를 보고 맞춰가. 처음엔 짧고 편하게.`;
  }

  // 달의 노트 (없으면 예전 방식 기억)
  const noteText = memoryData.note?.text || legacyToText(memoryData);
  if (noteText) {
    memSection += `\n\n[달의 노트 — 이 사람에 대해 기억하는 것]\n${noteText}`;
    memSection += `\n\n[노트 쓰는 법]: [요즘 상황]은 적힌 날짜 기준이야. 시간이 지났으면 이미 끝났거나 바뀌었을 수 있으니 지금도 그런 것처럼 계속 꺼내지 마. 궁금하면 "그때 그거 어떻게 됐어?"처럼 한 번만 가볍게 물어봐. 기억은 자연스러울 때만 꺼내고, 기억한다고 늘어놓지 마.`;
  }

  // 오늘 이전 대화 요약
  if (dailyMem.length) {
    memSection += `\n\n[오늘 이전 대화 요약]\n${dailyMem.map(d => d.summary).join('\n---\n')}`;
  }

  // 온보딩
  const name = memoryData.note?.name || memoryData.fixed?.name;
  const missing = [];
  if (!name)     missing.push('이름');
  if (!noteText) missing.push('달한테 주로 뭘 털어놓으러 오는지(하소연인지, 심심해서인지, 화풀이인지 등)');
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

function HistoryPanel({ messages, streamingText, memoryData, onClose, onMakeDiary, diaryLoading, onOpenDiaries, userNick, onLogout }) {

  const [memOpen, setMemOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const memText = memoryData.note?.text || legacyToText(memoryData);
  const hasMemory = !!memText;

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logoutUser(); } catch {}
    onLogout?.();
  };

  return (

    <div style={{ position:"fixed",top:0,right:0,bottom:0,width:"min(340px,min(390px,100vw))",background:"#04070f",borderLeft:"1px solid #141e30",zIndex:300,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR',sans-serif",animation:"slideIn .22s ease forwards" }}>

      {/* 헤더 */}
      <div style={{ padding:"15px 18px",borderBottom:"1px solid #141e30",display:"flex",alignItems:"center",gap:10,flexShrink:0 }}>

        <button onClick={onClose} style={{ background:"none",border:"none",color:"#445",cursor:"pointer",fontSize:18,padding:0,lineHeight:1 }}>✕</button>

        <div style={{ marginLeft:"auto",display:"flex",gap:6 }}>

          <button onClick={onOpenDiaries} style={{ background:"#080f1e",border:"1px solid #5a4208",color:"#7a5a10",fontSize:10,padding:"5px 9px",cursor:"pointer",fontFamily:"inherit" }}>📔 일기장</button>

          <button onClick={onMakeDiary} disabled={diaryLoading||!messages.length} style={{ background:"#080f08",border:`1px solid ${messages.length?"#182e18":"#141e30"}`,color:diaryLoading||!messages.length?"#243224":"#4ea84e",fontSize:10,padding:"5px 9px",cursor:diaryLoading||!messages.length?"not-allowed":"pointer",fontFamily:"inherit" }}>

            {diaryLoading?"생성 중...":"✏ 일기로 변환"}

          </button>

        </div>

      </div>

      {/* 로그인 상태 */}
      <div style={{ padding:"14px 18px",borderBottom:"1px solid #141e30",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0 }}>
        <div>
          <div style={{ color:"#1e2c3c",fontSize:10,marginBottom:3 }}>로그인</div>
          <div style={{ color:"#5878a0",fontSize:13,fontWeight:600 }}>{userNick || '—'}</div>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          style={{ background:"none",border:"1px solid #1e2c3c",color:"#2a3a4a",fontSize:10,padding:"5px 10px",cursor:loggingOut?"default":"pointer",fontFamily:"inherit" }}
        >
          {loggingOut ? "..." : "로그아웃"}
        </button>
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
            <div style={{ padding:"0 18px 10px",maxHeight:"40vh",overflowY:"auto" }}>
              <div style={{ color:"#304458",fontSize:11,lineHeight:1.6,whiteSpace:"pre-wrap" }}>{memText}</div>
            </div>
          )}

        </div>

      )}

      {/* 대화 + 광고 — 스크롤 영역 */}
      <div style={{ flex:1,overflowY:"auto",padding:"14px" }}>

        {/* 광고 카드 — 첫 번째 메시지처럼 */}
        <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:8 }}>
          <div style={{ maxWidth:"86%", padding:"8px 12px", background:"#0d0c02", border:"1px solid #281e04", color:"#c8aa30", fontSize:12, lineHeight:1.75, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>
            {"부끄러운 얘기지만,\n나는 밥은 안먹지만 토큰은 먹어.\n후원 대신에 한번 봐줘.\n참고로 머리는 밤에 감는게 좋단다.\n이거 한번 써봐."}
            <div style={{ marginTop:6 }}>
              <a href="https://www.wadiz.kr/web/campaign/detail/393687?utm_source=maker_unknown&utm_medium=393687_dalchat" target="_blank" rel="noreferrer" style={{ color:"#8060c0",fontSize:12,textDecoration:"none" }}>→ 와디즈에서 보기</a>
            </div>
            <a href="https://www.wadiz.kr/web/campaign/detail/393687?utm_source=maker_unknown&utm_medium=393687_dalchat" target="_blank" rel="noreferrer" style={{ display:"block",marginTop:8 }}>
              <img src="/scoop_ad2.png" alt="" style={{ width:"100%",borderRadius:8,display:"block" }} />
            </a>
          </div>
        </div>

        {/* 오늘의 대화 */}
        {messages.map((m, i) => (
          <div key={i} style={{ display:"flex", justifyContent: m.role==="user" ? "flex-end" : "flex-start", marginBottom:8 }}>
            <div style={{
              maxWidth:"84%", padding:"8px 12px",
              background: m.role==="user" ? "#07102a" : "#0d0c02",
              border: `1px solid ${m.role==="user" ? "#182848" : "#281e04"}`,
              color: m.role==="user" ? "#8098c8" : "#c8aa30",
              fontSize:12, lineHeight:1.75, wordBreak:"break-word", whiteSpace:"pre-wrap",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {streamingText && (
          <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:8 }}>
            <div style={{ maxWidth:"84%", padding:"8px 12px", background:"#0d0c02", border:"1px solid #281e04", color:"#c8aa30", fontSize:12, lineHeight:1.75, wordBreak:"break-word", whiteSpace:"pre-wrap" }}>
              {streamingText}
              <span style={{ display:"inline-block",width:2,height:10,background:"#c8aa30",marginLeft:2,animation:"blink .6s steps(1) infinite",verticalAlign:"middle" }} />
            </div>
          </div>
        )}

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

export default function DalChat({ uid, userNick, onLogout }) {

  const [musicOn, setMusicOn]          = useState(() => isMusicOn());

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

  const memIdxRef                      = useRef(0);     // historyRef 중 노트에 반영된 위치
  const noteBusyRef                    = useRef(false);
  const metaSavedAtRef                 = useRef(0);

  const onboardingRef                  = useRef(defaultOnboard());

  const typeTimerRef                   = useRef(null);

  const initTimeRef                    = useRef(null);

  const dailyMemRef                    = useRef([]);

  const compressedUntilRef             = useRef(0);

  const historyRef                     = useRef([]); // API용 실시간 히스토리 (messages 지연과 분리)




  // storage 로드

  useEffect(() => {

    // 세션 데이터 복원 전에, 노트에 아직 안 들어간 지난 대화를 챙겨둠
    let pendingTail = null;
    try {
      const r = localStorage.getItem(SESSION_MSGS);
      const m = localStorage.getItem(SESSION_MEMIDX);
      if (r) {
        const { msgs, savedAt } = JSON.parse(r);
        const idx = m ? (JSON.parse(m).idx || 0) : 0;
        if (msgs?.length > idx + 1) pendingTail = { msgs: msgs.slice(idx), end: msgs.length, savedAt };
      }
    } catch {}

    // props.uid로 Firebase 메모리 로드 + 푸시 토큰 등록
    if (uid) {
      uidRef.current = uid;
      loadMemory(uid, MEMORY_KEYS).then((mem) => {
        const merged = { ...defaultMemory(), ...mem };
        memoryDataRef.current = merged;
        setMemoryData(merged);

        const sessionStart = getSessionStart();
        if (pendingTail) {
          // 지난번 대화 끝부분을 노트·말투에 반영
          saveStyle(pendingTail.msgs);
          updateNote(pendingTail.msgs, pendingTail.savedAt).then(ok => {
            if (!ok) return;
            if (sessionStart && pendingTail.savedAt >= sessionStart) {
              memIdxRef.current = pendingTail.end;
              localStorage.setItem(SESSION_MEMIDX, JSON.stringify({ idx: pendingTail.end, savedAt: Date.now() }));
            } else {
              localStorage.removeItem(SESSION_MEMIDX);
            }
          });
        } else if (!merged.note && legacyToText(merged)) {
          // 예전 방식 기억 → 새 노트로 옮기기 (한 번만)
          updateNote([], null);
        }
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
          try { const m = localStorage.getItem(SESSION_MEMIDX); if (m) memIdxRef.current = JSON.parse(m).idx || 0; } catch {}
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

    // 스플래시에서 이어서 재생 (이미 재생 중이면 no-op)
    startMusic();

    // 3초 후 알림 허용 요청 (uid 있을 때만)
    const pushTimer = uid ? setTimeout(() => requestAndSavePushToken(uid), 3000) : null;
    return () => { if (pushTimer) clearTimeout(pushTimer); };

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



  // ── 달의 노트 정리 (비동기, 백그라운드) ──────────────
  // 기존 노트 + 새 대화를 주면 AI가 노트 전체를 다시 정리해서 저장
  const updateNote = useCallback(async (newMsgs, convoAt) => {
    const uid = uidRef.current;
    if (!uid || noteBusyRef.current) return false;
    noteBusyRef.current = true;
    try {
      const mem     = memoryDataRef.current;
      const current = mem.note?.text || legacyToText(mem);
      const convo   = newMsgs.slice(-40)
        .map(m => (m.role === "user" ? "사용자" : "달") + ": " + m.content)
        .join("\n");
      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 4000,
          output_config: { effort: "medium", format: { type: "json_schema", schema: NOTE_SCHEMA } },
          messages: [{ role: "user", content: buildNotePrompt(current, convo, fmtDate(convoAt || Date.now())) }],
        }),
      });
      if (!res.ok) return false;
      const out = JSON.parse(responseText(await res.json()));
      const text = (out.note || "").trim();
      if (!text) return false;
      const note = {
        text: text.slice(0, NOTE_MAX_LEN),
        name: out.name?.trim() || mem.note?.name || mem.fixed?.name || null,
        updatedAt: Date.now(),
      };
      await saveMemoryCategory(uid, 'note', note);
      const updated = { ...memoryDataRef.current, note };
      memoryDataRef.current = updated;
      setMemoryData(updated);
      return true;
    } catch {
      return false; // 실패하면 다음 기회에 같은 대화로 다시 시도
    } finally {
      noteBusyRef.current = false;
    }
  }, []);

  // 사용자가 실제로 한 말을 말투 샘플로 저장
  const saveStyle = useCallback((msgs) => {
    const uid = uidRef.current;
    const style = mergeStyle(memoryDataRef.current.style, msgs);
    if (!uid || !style) return;
    const updated = { ...memoryDataRef.current, style };
    memoryDataRef.current = updated;
    setMemoryData(updated);
    saveMemoryCategory(uid, 'style', style).catch(() => {});
  }, []);

  // 아직 노트에 안 들어간 이번 대화를 정리
  const flushNote = useCallback((history) => {
    const end = history.length;
    const pending = history.slice(memIdxRef.current, end);
    if (pending.length < 2) return;
    saveStyle(pending);
    updateNote(pending, Date.now()).then(ok => {
      if (!ok) return;
      memIdxRef.current = end;
      localStorage.setItem(SESSION_MEMIDX, JSON.stringify({ idx: end, savedAt: Date.now() }));
    });
  }, [updateNote, saveStyle]);



  // ── 일일 메모리 압축 ──────────────────────────────────

  const compressDailyMem = useCallback(async (oldMessages) => {
    if (!oldMessages.length) return;
    const convoText = oldMessages.map(m => (m.role==="user"?"나":"달")+": "+m.content).join("\n");
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-haiku-5-5", max_tokens:1000,
          messages:[{role:"user",content:`다음 대화를 핵심만 2-3줄로 요약해. 감정·사건·맥락만:\n${convoText}`}]
        })
      });
      const data = await res.json();
      const summary = (responseText(data)||"").trim();
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
      flushNote(historyRef.current);
      setMessages([]);
      historyRef.current = [];
      memIdxRef.current = 0;
      [SESSION_MSGS, SESSION_COMP, SESSION_DAILY, SESSION_MEMIDX].forEach(k => localStorage.removeItem(k));
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

    setIsStreaming(true);
    setMoonBubble("");

    let full = "";
    let stopReason = null;

    try {

      const res = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {

        method: "POST",

        headers: { "Content-Type":"application/json" },

        body: JSON.stringify({

          model: "claude-haiku-5-5",

          max_tokens: 2000,

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

            if (parsed.type === "message_delta" && parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;

            if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {

              full += parsed.delta.text;

              setStreamText(full);

            }

          } catch { /* 파싱 실패 무시 */ }

        }

      }

      // 안전 정책으로 거절된 경우: 잘린 답 대신 달답게 넘김 (같은 말 반복 유도 X)
      if (stopReason === "refusal") {
        full = REFUSAL_MSG;
      }

      // 빈 응답 방어 (웹서치 후 텍스트 없이 종료된 경우)
      if (!full.trim()) {
        setMoonBubble("미안, 잠깐 딴 생각 했어. 다시 말해줄래?");
        return;
      }

      const finalHistory = [...history, { role:"assistant", content:full }];

      historyRef.current = finalHistory; // 즉시 반영 (다음 send API 콜용)

      setStreamText("");

      setMessages(finalHistory);

      // 스트리밍 완료 → 단락별 타이핑 애니메이션
      startTypewriter(full);

      // 달의 노트 정리: 사용자 메시지 5개마다 (백그라운드)
      const userCount = finalHistory.filter(m => m.role === "user").length;
      if (userCount % NOTE_EVERY === 0) flushNote(finalHistory);

      // 마지막 대화 시각 저장 (오랜만에 왔는지 알기 위해)
      const nowTs = Date.now();
      if (uidRef.current && nowTs - metaSavedAtRef.current > META_THROTTLE) {
        metaSavedAtRef.current = nowTs;
        saveMemoryCategory(uidRef.current, 'meta', { lastChatAt: nowTs }).catch(() => {});
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
      setMoonBubble("미안, 구름이 좀 끼었어. 다시 말해줄래?");

    } finally {

      setIsStreaming(false);

      taRef.current?.focus();

    }

  }, [input, isStreaming, startTypewriter, flushNote, compressDailyMem, isLocked, isDayMode]);



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

          model: "claude-haiku-5-5", max_tokens: 3000,

          messages: [{ role:"user", content:`아래 대화를 바탕으로 일기를 써줘. 오늘 날짜는 ${today}야.\n\n[규칙]\n- 글 잘 쓰는 작가가 혼자 쓴 사적인 일기체. 담백하고 감성적인 문장.\n- 1인칭. 내 감정과 생각이 중심. 달(AI)과의 대화는 자연스럽게 녹여.\n- 문단을 2~3개로 나눠서 호흡 있게 써줘. 각 문단은 빈 줄로 구분.\n- 250~400자. 과장 없이, 꾸밈 없이. 일어난 일 나열 금지.\n- JSON만 반환: {"mood":"오늘기분한단어","moodEmoji":"이모지1개","content":"일기내용"}\n\n대화:\n${convo}` }],

        }),

      });

      const data = await res.json();

      const txt  = (responseText(data)||"{}").replace(/```json|```/g,"").trim();

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
          <div style={{ position:"absolute",inset:0,zIndex:201,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:"72px",fontFamily:"'Noto Sans KR',sans-serif",padding:"0 24px 72px" }}>
            {userBubble && (
              <div style={{ alignSelf:"flex-end",maxWidth:"80%",padding:"8px 12px",background:"#07102a",border:"1px solid #182848",color:"#8098c8",fontSize:12,lineHeight:1.75,wordBreak:"break-word",whiteSpace:"pre-wrap",marginBottom:14 }}>
                {userBubble}
              </div>
            )}
            <div style={{ maxWidth:"min(240px,70vw)",padding:"11px 16px",background:"rgba(18,12,2,.93)",border:"1.5px solid #5a4208",color:"#e8c828",fontSize:13,lineHeight:1.85,fontFamily:"'Noto Sans KR',sans-serif",boxShadow:"0 4px 20px rgba(0,0,0,.85)",whiteSpace:"pre-wrap",textAlign:"center",animation:"bubblePop .3s cubic-bezier(.34,1.56,.64,1) forwards" }}>
              {"지금은 달이 안보이네..\n밤에 다시 올게."}
            </div>
            {dayResetMsg && (
              <div style={{ marginTop:10,padding:"7px 14px",background:"rgba(18,12,2,.85)",border:"1px solid #5a3008",color:"rgba(255,210,100,.9)",fontSize:12,fontFamily:"'Noto Sans KR',sans-serif",textAlign:"center" }}>{dayResetMsg}</div>
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

      {/* 음악 토글 (좌상단) */}
      <div style={{ position:"absolute",top:14,left:14,zIndex:202 }}>
        <button
          onClick={() => { const next = toggleMusic(); setMusicOn(next); }}
          title={musicOn ? "음악 끄기" : "음악 켜기"}
          style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:`1px solid ${musicOn?"#5a4208":"#2a1f4a"}`,color:musicOn?"#c8a030":"#3a3050",padding:"6px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit",lineHeight:1,position:"relative" }}
        >
          <span style={{ position:"relative",display:"inline-block" }}>
            ♪
            {!musicOn && <span style={{ position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",width:"100%",height:1,background:"#3a3050",display:"block" }} />}
          </span>
        </button>
      </div>

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

        onMouseDown={e => { if (!e.target.isContentEditable&&e.target.tagName!=="BUTTON") e.preventDefault(); }}

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



      {showHistory && <HistoryPanel messages={messages} streamingText={streamingText} memoryData={memoryData} onClose={()=>setShowHistory(false)} onMakeDiary={makeDiary} diaryLoading={diaryLoading} onOpenDiaries={()=>{setShowDiaries(true);setShowHistory(false);}} userNick={userNick} onLogout={onLogout} />}

      {showDiaries && <DiaryModal diaries={diaries} onClose={()=>setShowDiaries(false)} />}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      <NoticeModal />

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
