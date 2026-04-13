import { useState } from "react";
import emailjs from "@emailjs/browser";
import ReactGA from "react-ga4";

const SERVICE_ID  = "service_dal_chat";
const TEMPLATE_ID = "template_9cz1xj5";

export default function FeedbackModal({ onClose }) {
  const [text, setText]     = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | done | failed

  const submit = async () => {
    if (!text.trim() || status === "sending" || status === "done") return;
    setStatus("sending");
    try {
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        message: text.trim(),
        time: new Date().toLocaleString("ko-KR"),
      });
      ReactGA.event({ category: "Feedback", action: "submitted" });
      setStatus("done");
      setTimeout(onClose, 1500);
    } catch {
      setStatus("failed");
    }
  };

  const btnLabel = { sending: "...", done: "비둘기 서신으로 보냈음", failed: "다시 시도" }[status] ?? "보내기";
  const isFailed = status === "failed";

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position:"fixed", inset:0, zIndex:600,
        background:"rgba(0,0,0,.6)", backdropFilter:"blur(3px)",
        display:"flex", alignItems:"flex-end", justifyContent:"center",
        fontFamily:"'Noto Sans KR',sans-serif",
      }}
    >
      <div style={{
        width:"min(420px,100vw)",
        background:"rgba(6,4,16,.98)",
        border:"1px solid #2a1f4a",
        borderBottom:"none",
        padding:"24px 20px 36px",
        animation:"slideUp .28s cubic-bezier(.34,1.56,.64,1) forwards",
      }}>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        {/* 헤더 */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <span style={{ color:"#a890d8", fontSize:14, fontWeight:600 }}>무슨 일이야? 전할 말 있어?</span>
          <button
            onClick={onClose}
            style={{ background:"none", border:"none", color:"#3d2f5a", fontSize:20, cursor:"pointer", lineHeight:1, padding:0 }}
          >✕</button>
        </div>

        {/* textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={status === "sending" || status === "done"}
          placeholder="아무 말이나 해도 돼"
          style={{
            width:"100%", height:110, resize:"none",
            background:"rgba(255,255,255,.04)",
            border:`1px solid ${isFailed ? "#6a2020" : "#2a1f4a"}`,
            color:"#c8b8e8", fontSize:14, lineHeight:1.7,
            fontFamily:"inherit", padding:"10px 12px",
            boxSizing:"border-box",
            outline:"none", caretColor:"#8060c0",
          }}
        />

        {/* 전송 버튼 */}
        <button
          onClick={isFailed ? () => setStatus("idle") : submit}
          disabled={status === "sending" || status === "done" || (!isFailed && !text.trim())}
          style={{
            marginTop:12, width:"100%", padding:"11px",
            background: status === "done" ? "rgba(30,15,50,.9)" : isFailed ? "rgba(50,10,10,.9)" : "rgba(40,20,70,.9)",
            border:`1px solid ${status === "done" ? "#4a2f7a" : isFailed ? "#7a2020" : "#5a3a90"}`,
            color: status === "done" ? "#7a60a8" : isFailed ? "#c05050" : (text.trim() ? "#c8a8f0" : "#4a3a60"),
            fontSize:14, fontWeight:600, fontFamily:"inherit",
            cursor: (status === "idle" && text.trim()) || isFailed ? "pointer" : "default",
            transition:"color .2s, border-color .2s",
          }}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}
