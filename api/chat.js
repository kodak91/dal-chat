const crypto = require('crypto');

const MODEL      = 'claude-haiku-4-5-20251001';
const SLEEP_AT   = 40;
const LOCK_AT    = 50;
const SLEEP_NOTE = '\n\n[참고]: 오늘 대화 많이 했어. 슬슬 졸려와. 자연스럽게 피곤함 드러내도 돼.';
const LOCK_MSG   = '미안한데 이제 가봐야겠다. 나중에 다시 보자.';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function dateKey() {
  return new Date().toISOString().slice(0, 10); // "2026-04-14"
}

async function getCount(uid, date) {
  const url = `${process.env.FIREBASE_DB_URL}/users/${uid}/${date}.json?auth=${process.env.FIREBASE_DB_SECRET}`;
  const r = await fetch(url);
  const d = await r.json();
  return d?.count ?? 0;
}

async function setCount(uid, date, count) {
  const url = `${process.env.FIREBASE_DB_URL}/users/${uid}/${date}.json?auth=${process.env.FIREBASE_DB_SECRET}`;
  await fetch(url, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ count }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, CORS);
    return res.end('Method Not Allowed');
  }

  // uid: 클라이언트 익명 인증, 없으면 IP 해시로 폴백
  const uid = req.headers['x-user-id'] || hashIP(
    ((req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) ||
    req.socket?.remoteAddress ||
    'unknown'
  );
  const date = dateKey();

  let count = 0;
  try { count = await getCount(uid, date); } catch (e) { console.error('Firebase read error:', e); }

  // 50회 초과 — 종료
  if (count >= LOCK_AT) {
    if (req.body?.stream) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: LOCK_MSG } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    } else {
      res.writeHead(429, { ...CORS, 'Content-Type': 'application/json' });
      res.write(JSON.stringify({ error: 'rate_limit', message: LOCK_MSG }));
    }
    return res.end();
  }

  try { await setCount(uid, date, count + 1); } catch (e) { console.error('Firebase write error:', e); }

  // 모델 고정 + 40회 이상 졸림 노트 추가
  const body = { ...req.body, model: MODEL };
  if (count >= SLEEP_AT && body.system) body.system += SLEEP_NOTE;
  body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]; // 웹서치 툴 추가

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      console.error('Anthropic API error:', upstream.status, errBody);
      res.writeHead(upstream.status, { ...CORS, 'Content-Type': 'application/json' });
      res.write(errBody);
      return res.end();
    }

    if (body.stream) {
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } else {
      const data = await upstream.json();
      res.writeHead(upstream.status, { ...CORS, 'Content-Type': 'application/json' });
      res.write(JSON.stringify(data));
    }
  } catch (err) {
    console.error('Anthropic API error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'internal_server_error' }));
  }

  res.end();
};
