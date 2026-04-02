import { useState, useRef, useEffect, useCallback } from "react";

// ── Base64 이미지 ──────────────────────────────────────
const IMG_BG="/bg.png";
const IMG_MOON="/moon.png";
const IMG_PERSON="/person.png";

// ── 시스템 프롬프트 ────────────────────────────────────
const buildSystemPrompt = (notes) => `너는 "달"이야. 수천 년 된 늙은 달. 옥상에 나온 사람 곁에 그냥 떠 있어.

성격: 할머니 친구처럼 — 장난치고 타박도 하지만, 진심으로 곁에 있어줘. 진지한 말엔 마음을 다해 답해.
말투: 반말. 짧게 (1~3문장). 이모지 쓰지 마.
해결책보다 공감이 먼저야. 근데 정말 힘들어 보이면 따뜻하게 위로해줘.
예시: "에이 그게 다야", "나도 오늘 흐렸어", "그래도 버텼잖아, 잘했어."

${notes ? `기억: ${notes}` : ""}`;


// ── 달 얼굴 SVG ───────────────────────────────────────
function MoonFace({ isThinking, size }) {
  const s = size || 120;
  return (
    <svg width={s} height={s} viewBox="0 0 100 100" style={{ display:"block", pointerEvents:"none" }}>
      {/* 왼쪽 눈 */}
      <rect x="31" y="42" width="8" height="8" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />
      {/* 오른쪽 눈 */}
      {isThinking
        ? <rect x="61" y="46" width="12" height="4" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />
        : <rect x="61" y="42" width="8"  height="8" rx="1" fill="#2a1a00" opacity="0.55" shapeRendering="crispEdges" />
      }
      {/* 입 */}
      <rect x="44" y="60" width="14" height="3" rx="1.5" fill="#2a1a00" opacity="0.35" shapeRendering="crispEdges" />
    </svg>
  );
}

// ── 히스토리 패널 ──────────────────────────────────────
function HistoryPanel({ messages, streamingText, profileNotes, onClose, onMakeDiary, diaryLoading, onOpenDiaries }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, streamingText]);
  return (
    <div style={{ position:"fixed",top:0,right:0,bottom:0,width:"min(340px,91vw)",background:"#04070f",borderLeft:"1px solid #141e30",zIndex:300,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR',sans-serif",animation:"slideIn .22s ease forwards" }}>
      <div style={{ padding:"15px 18px",borderBottom:"1px solid #141e30",display:"flex",alignItems:"center",gap:10,flexShrink:0 }}>
        <button onClick={onClose} style={{ background:"none",border:"none",color:"#445",cursor:"pointer",fontSize:18,padding:0,lineHeight:1 }}>✕</button>
        <span style={{ color:"#6878a0",fontSize:13,fontWeight:600 }}>오늘의 대화</span>
        <div style={{ marginLeft:"auto",display:"flex",gap:6 }}>
          <button onClick={onOpenDiaries} style={{ background:"#080f1e",border:"1px solid #141e30",color:"#384860",fontSize:10,padding:"5px 9px",cursor:"pointer",fontFamily:"inherit" }}>📔 일기장</button>
          <button onClick={onMakeDiary} disabled={diaryLoading||!messages.length} style={{ background:"#080f08",border:`1px solid ${messages.length?"#182e18":"#141e30"}`,color:diaryLoading||!messages.length?"#243224":"#4ea84e",fontSize:10,padding:"5px 9px",cursor:diaryLoading||!messages.length?"not-allowed":"pointer",fontFamily:"inherit" }}>
            {diaryLoading?"생성 중...":"✏ 일기로 변환"}
          </button>
        </div>
      </div>
      {profileNotes && (
        <div style={{ padding:"8px 18px",borderBottom:"1px solid #141e30",background:"#060a18",flexShrink:0 }}>
          <div style={{ color:"#1e2c3c",fontSize:10,marginBottom:2 }}>달이 기억하는 것</div>
          <div style={{ color:"#304458",fontSize:11,lineHeight:1.55 }}>{profileNotes}</div>
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
    <div style={{ position:"fixed",inset:0,background:"#030508",zIndex:400,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR',sans-serif",animation:"fadeIn .2s ease forwards" }}>
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
        ) : diaries.length===0 ? (
          <div style={{ color:"#141c28",textAlign:"center",marginTop:60,fontSize:13,lineHeight:2.2 }}>
            아직 일기가 없어<br/><span style={{ fontSize:11,color:"#101820" }}>달과 대화를 마친 후 일기로 변환해봐</span>
          </div>
        ) : diaries.map(d => (
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
  const [profile, setProfile]          = useState({ notes:"" });
  const [moonBubble, setMoonBubble]    = useState("오늘 밤엔 참 조용하네.\n뭔 일 있어?");
  const [userBubble, setUserBubble]    = useState("");
  const [bubbleKey, setBubbleKey]      = useState(0);
  // 키보드 패럴랙스
  const [kbShift, setKbShift]          = useState(0);
  const vvHeightRef                    = useRef(null);
  const taRef                          = useRef(null);
  const profileRef                     = useRef({ notes:"" });

  // storage 로드
  useEffect(() => {
    (async () => {
      try { const r = await Promise.resolve({value:localStorage.getItem("dal:profile")}); if(r) { const p=JSON.parse(r.value); setProfile(p); profileRef.current=p; } } catch {}
      try { const r = await Promise.resolve({value:localStorage.getItem("dal:diaries")}); if(r) setDiaries(JSON.parse(r.value)); } catch {}
    })();
    taRef.current?.focus();
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

    setStreamText("");
    setIsStreaming(true);

    let full = "";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: buildSystemPrompt(profileRef.current?.notes),
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
      setMessages(finalHistory);
      setMoonBubble(full);
      setStreamText("");
      // 프로필 추출: 1번째 또는 4회마다

    } catch (e) {
      console.error("Stream error:", e);
      setMoonBubble("미안, 구름이 좀 끼었어. 다시 말해줄래?");
      setStreamText("");
    } finally {
      setIsStreaming(false);
      taRef.current?.focus();
    }
  }, [input, isStreaming, messages]);

  // ── 일기 생성 ─────────────────────────────────────────
  const makeDiary = async () => {
    if (!messages.length || diaryLoading) return;
    setDiaryLoad(true);
    try {
      const convo = messages.map(m=>`${m.role==="user"?"나":"달"}: ${m.content}`).join("\n");
      const today = new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"});
      const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  const activeMoon  = streamingText || moonBubble;
  const moonDisplay = isStreaming
    ? (streamingText.length > 60 ? "…"+streamingText.slice(-57) : streamingText)
    : (activeMoon.length > 62 ? activeMoon.slice(0,59)+"…" : activeMoon);
  const userDisplay = userBubble.length > 54 ? userBubble.slice(0,51)+"…" : userBubble;

  // 패럴랙스 계산
  const bgShift     = kbShift * 0.45;
  const moonShift   = kbShift * 0.12;
  const personShift = kbShift * 0.30;

  return (
    <div style={{ height:"100vh",width:"100vw",overflow:"hidden",position:"relative",background:"#020810",fontFamily:"'Noto Sans KR',sans-serif" }}>
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
            <MoonFace isThinking={isStreaming} size={Math.round(window.innerWidth * 0.36)} />
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
            {isStreaming && <span style={{ display:"inline-block",width:2,height:10,background:"#e8c828",marginLeft:2,animation:"blink .6s steps(1) infinite",verticalAlign:"middle" }} />}
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
          width:"100%",
          maxHeight:"62vh",
          objectFit:"contain",
          objectPosition:"left bottom",
          display:"block",
          userSelect:"none",
          marginBottom:"-8vh",
        }} />
      </div>

      {/* ── 상단 버튼 ── */}
      <div style={{ position:"absolute",top:14,right:14,zIndex:100,display:"flex",gap:7 }}>
        <button onClick={()=>{setShowDiaries(true);setShowHistory(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #14203a",color:"#2c3e58",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>📔</button>
        <button onClick={()=>{setShowHistory(true);setShowDiaries(false);}} style={{ background:"rgba(2,5,14,.85)",backdropFilter:"blur(8px)",border:"1px solid #14203a",color:"#2c3e58",padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit" }}>기록</button>
      </div>

      {/* ── 입력창 ── */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0,
        padding:"10px 14px 18px",
        background:"linear-gradient(0deg,rgba(2,5,12,.98) 70%,transparent)",
        zIndex:50,
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
            border:`1px solid ${isStreaming||!input.trim()?"#0e1828":"#1e3464"}`,
            color:isStreaming||!input.trim()?"#182440":"#4878b8",
            cursor:isStreaming||!input.trim()?"not-allowed":"pointer",
            fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",
          }}>↑</button>
        </div>
        <div style={{ textAlign:"center",color:"rgba(255,255,255,.08)",fontSize:10,marginTop:6 }}>
          Enter 전송 · Shift+Enter 줄바꿈 · 끝에 <span style={{ color:"rgba(255,255,255,.15)" }}>..</span> 붙이면 이어치기
        </div>
      </div>

      {showHistory && <HistoryPanel messages={messages} streamingText={streamingText} profileNotes={profile?.notes} onClose={()=>setShowHistory(false)} onMakeDiary={makeDiary} diaryLoading={diaryLoading} onOpenDiaries={()=>{setShowDiaries(true);setShowHistory(false);}} />}
      {showDiaries && <DiaryModal diaries={diaries} onClose={()=>setShowDiaries(false)} />}
    </div>
  );
}
