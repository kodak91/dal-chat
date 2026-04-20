import { useState, useEffect } from "react";

// 새 공지 올릴 때 이 값만 바꾸면 다시 노출됨
const NOTICE_VERSION = "2026-04";
const STORAGE_KEY    = "dal:notice:dismissed";

export default function NoticeModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== NOTICE_VERSION) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const close = () => setVisible(false);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, NOTICE_VERSION);
    setVisible(false);
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{
        width: "min(480px, 100vw)",
        height: "78vh",
        background: "#020810",
        border: "1px solid #1a2040",
        borderBottom: "none",
        display: "flex", flexDirection: "column",
        animation: "slideUp .3s cubic-bezier(.34,1.3,.64,1) forwards",
      }}>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid #0e1628", flexShrink: 0,
        }}>
          <span style={{ color: "#3a4a68", fontSize: 12, letterSpacing: "0.1em" }}>공지</span>
          <button
            onClick={close}
            style={{ background: "none", border: "none", color: "#3a4a68", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}
          >✕</button>
        </div>

        {/* 내용 — iframe */}
        <iframe
          src="/update.html"
          style={{ flex: 1, border: "none", background: "#020810" }}
          title="공지사항"
        />

        {/* 하단 버튼 */}
        <div style={{
          display: "flex", gap: 8, padding: "12px 18px 28px", flexShrink: 0,
          borderTop: "1px solid #0e1628",
        }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: "11px",
              background: "none", border: "1px solid #1a2040",
              color: "#3a4a68", fontSize: 12,
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            앞으로 보지 않기
          </button>
          <button
            onClick={close}
            style={{
              flex: 1, padding: "11px",
              background: "rgba(40,20,80,.9)", border: "1px solid #5a3a90",
              color: "#c8a8f0", fontSize: 13, fontWeight: 600,
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
