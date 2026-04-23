// 싱글톤 오디오 — 컴포넌트 언마운트와 무관하게 음악 유지
const SRC = '/music/MA_EchoVerse_Little One.wav';
const PREF_KEY = 'dal:music:enabled';

let _audio = null;
let _enabled = (() => {
  try { return localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
})();
let _pendingPlay = false;
let _interactionBound = false;

function getAudio() {
  if (!_audio) {
    _audio = new Audio(SRC);
    _audio.loop = true;
    _audio.volume = 0.35;
  }
  return _audio;
}

function onInteraction() {
  if (_pendingPlay && _enabled) {
    getAudio().play().catch(() => {});
    _pendingPlay = false;
  }
}

function bindInteraction() {
  if (_interactionBound) return;
  _interactionBound = true;
  const opts = { once: true, passive: true };
  document.addEventListener('click',      onInteraction, opts);
  document.addEventListener('touchstart', onInteraction, opts);
  document.addEventListener('keydown',    onInteraction, opts);
}

// 스플래시/메인 마운트 시 호출 — 이미 재생 중이면 no-op
export function startMusic() {
  if (!_enabled) return;
  bindInteraction();
  getAudio().play().catch(() => { _pendingPlay = true; });
}

// 음악 켜기/끄기 토글, 새 상태값 반환
export function toggleMusic() {
  _enabled = !_enabled;
  try { localStorage.setItem(PREF_KEY, _enabled ? '1' : '0'); } catch {}
  if (_enabled) {
    _pendingPlay = false;
    bindInteraction();
    getAudio().play().catch(() => { _pendingPlay = true; });
  } else {
    _pendingPlay = false;
    getAudio().pause();
  }
  return _enabled;
}

export function isMusicOn() { return _enabled; }
