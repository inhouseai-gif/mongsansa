// net.js — 함께 있기(room)·연등 공유(db)·내 id(user)·카드 저장(downloads). 계약: INTERFACES §3.5
// 기능이 없으면(로그아웃·공개 링크·로컬 실행) 조용히 혼자 모드. 남이 보낸 값은 전부 믿지 않고 검사한다.

const VEST_COLORS = ['#e59a52', '#e8c95a', '#5a7fb0', '#9cc06a', '#e79aa6', '#9a86c0'];
const BOUNDS = { minX: -44, maxX: 36, minZ: -42, maxZ: 62 };
const MOVES = new Set('idle walk sit lie sweep prayWalk bow gassho zen tea fire'.split(' '));
const PLACES = new Set('start fork ilju musang-gate lantern yard fire pagoda hall bell tea yosa ginkgo gotgam pond bamboo river mujang haetal'.split(' '));
const TERMINAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
const NO_RETRY = new Set([...TERMINAL, 'invalid_argument', 'resource_exhausted', 'quota_exceeded']); // db.d.ts: 다시 구독해도 같은 답
const SAVE_ERRORS = new Set(['too_large', 'rate_limited', 'bad_request', 'request_unknown', 'rejected_extension', 'transform_error']);
const SLOTS = 108;
const LOCAL_KEY = 'mongsansa.lantern.v1';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SKEW = 10 * 60e3; // 남의 시계는 10분까지만 믿는다(먼 미래 시각으로 연등을 맨 앞에 박아 두는 것 막기)
const sane = (t) => Number.isInteger(t) && t > 1.6e12 && t < Date.now() + SKEW;
// 제어·양방향·폭 없는 문자를 빼고 글자(코드 포인트) 수로 자른다. 화면에는 G가 textContent로만 쓴다.
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f­؜​‎‏‪-‮⁠-⁤⁦-⁯﻿]/g;
const LONE_SURROGATE = /[\ud800-\udfff]/gu; // 잘린 이모지 반쪽: 서버 JSON이 통째로 거절한다
export const cleanText = (s, max) => (typeof s === 'string' ? Array.from(s.replace(BAD_CHARS, '').replace(LONE_SURROGATE, '').trim()).slice(0, max).join('') : '');
// 함께 보는 연등이 광고판이 되지 않게: 주소·SNS 아이디·전화번호. 수파베이스 hang_lantern(schema.sql)도 같은 식으로 막는다 — 둘을 같이 고칠 것
// 숫자만 이어진 줄은 0(또는 +82)으로 시작할 때만 번호로 본다: 100000000원 같은 금액은 통과
// shortcut: 전각 숫자·띄어 쓴 주소·한글 주소·한글로 읽은 번호·1588 번호는 못 막는다, 실제로 악용되면 운영자가 지우고 서버에 금칙어 표를 둔다
const CONTACT = /(https?:|www\.|youtu\.be|[a-z0-9-]\.(com|net|org|kr|io|me|ly|gg|xyz|co|info|link|site|shop|dev|app|ai|tv|cc|gl|biz|page|blog|store|online|club|live|top|pro)([^a-z]|$)|@[a-z0-9_]{2,}|(^|[^0-9])[0-9]{2,4}[-. )]+[0-9]{3,4}[-. ]*[0-9]{4}([^0-9]|$)|(^|[^0-9])[0-9]{2,4}[-. )]*[0-9]{3,4}[-. ]+[0-9]{4}([^0-9]|$)|(^|[^0-9])(0|\+ ?82 ?)[0-9]{8,10})/i;
export const hasContact = (s) => CONTACT.test(String(s || ''));
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const safe = (cb, v) => { try { cb(v); } catch (e) { console.error('[net] listener', e); } };

// 다른 사람 presence → 검증된 값. 좌표가 없거나 범위 밖이면 그리지 않는다(null).
export function cleanPeer(p) {
  const s = (p && p.presence) || {};
  if (!fin(s.x) || !fin(s.z) || s.x < BOUNDS.minX || s.x > BOUNDS.maxX || s.z < BOUNDS.minZ || s.z > BOUNDS.maxZ) return null;
  const g = s.g;
  return {
    peer: p.peer,
    n: cleanText(s.n, 16),
    c: VEST_COLORS.includes(s.c) ? s.c : VEST_COLORS[0],
    x: s.x, z: s.z,
    r: fin(s.r) ? wrap(s.r) : 0,
    m: MOVES.has(s.m) ? s.m : 'idle',
    p: PLACES.has(s.p) ? s.p : '',
    s: s.s === 'shroud' ? 'shroud' : '',
    e: typeof s.e === 'string' && /^[bg]\d{1,6}$/.test(s.e) ? s.e : '',
    g: g && typeof g === 'object' && typeof g.to === 'string' && g.to.length <= 64 && g.k === 'tea' && Number.isInteger(g.t) && Math.abs(g.t - Date.now()) < SKEW ? { to: g.to, k: 'tea', t: g.t } : null,
    updatedAt: p.updatedAt,
  };
}

const freeSlot = (id, used) => { let i = hash(id) % SLOTS; while (used.has(i)) i = (i + 1) % SLOTS; return i; };

// 오래된 순(ts·id)으로 칸을 정한다: 선호 칸 = id 해시 % 108, 차 있으면 다음 빈칸(PROMPT §10). 넘치면 최근 108개만, 결과도 오래된 순.
export function assignSlots(list) {
  const used = new Set(), out = [];
  const sorted = list.slice().sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of sorted.slice(-SLOTS)) { const slot = freeSlot(l.id, used); used.add(slot); out.push({ ...l, slot }); }
  return out;
}

// 칸은 모두가 똑같이 받는 서버 창(최근 108개)으로만 정하고, 내 등은 그 위에 얹는다 → 같은 등은 누구에게나 같은 칸.
// 내 등이 창에 있으면 그 칸에 최신 내용, 없고 자리가 남으면 빈칸, 꽉 찼으면 가장 오래된 등의 칸을 빌린다.
export function layoutLanterns(shared, mine) {
  const out = assignSlots(shared).map((l) => ({ ...l, mine: false }));
  if (!mine) return out;
  let i = out.findIndex((l) => l.id === mine.id);
  if (i < 0 && out.length >= SLOTS) i = 0; // assignSlots 결과는 오래된 순 → 0번이 가장 오래된 등
  if (i >= 0) out[i] = { ...mine, slot: out[i].slot, mine: true };
  else out.push({ ...mine, slot: freeSlot(mine.id, new Set(out.map((l) => l.slot))), mine: true });
  return out;
}

function cleanLantern(d) {
  const v = d && typeof d.data === 'function' ? d.data() : null;
  if (!v || !Number.isInteger(v.color) || v.color < 0 || v.color > 4 || !sane(v.ts)) return null;
  return { id: d.id, color: v.color, text: cleanText(v.text, 40), ts: v.ts };
}

// synced: 서버 저장이 확인된 사본(그 뒤로는 서버가 정답). 아니면 아직 못 올린 초안.
function loadLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    return v && Number.isInteger(v.color) && v.color >= 0 && v.color <= 4 && fin(v.ts) ? { color: v.color, text: cleanText(v.text, 40), ts: v.ts, synced: v.synced === true } : null;
  } catch { return null; }
}
function saveLocal(rec) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}
function clearLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch { /* 저장소 막힘: 메모리에서만 지움 */ } }

// ── 공개 홈페이지(claude.ai 밖) 연등 공유: 수파베이스 REST를 아래 createNet이 쓰는 db·user 부분만큼 흉내 낸다 ──
// 실시간 연결 대신 목록 30초·내 등 2분마다 다시 읽는다(숨은 탭은 쉼). 끊김·점검·무료 프로젝트 일시정지는 간격을 늘려 조용히
// 다시 읽고(풀리면 저절로 복구), 키·권한·주소가 틀린 400/401/403/404만 구독을 끝낸다. 쓰기는 hang_lantern 함수 하나뿐이다.
const VISITOR_KEY = 'mongsansa.visitor.v1';
const FRESH = Object.freeze({ fromCache: false, hasPendingWrites: false });
const failure = (code) => Object.assign(new Error(code), { code });
const httpCode = (s) => (s === 429 ? 'resource_exhausted' : s === 400 ? 'invalid_argument' : s === 401 || s === 403 || s === 404 ? 'not_granted' : 'unavailable');

// 방문객 = 무작위 id + 비밀값(이 브라우저에만). 서버는 비밀값의 해시만 지녀서 같은 비밀값만 그 등을 고칠 수 있다
function visitor() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VISITOR_KEY) || 'null'); } catch { /* 저장소 막힘 */ }
  if (v && /^[0-9a-f-]{36}$/.test(v.id) && /^[\w-]{43}$/.test(v.secret)) return v;
  const b = crypto.getRandomValues(new Uint8Array(32));
  v = { id: crypto.randomUUID(), secret: btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
  try { localStorage.setItem(VISITOR_KEY, JSON.stringify(v)); } catch { /* 이번 방문 동안만 같은 사람 */ }
  return v;
}

export function publicDb(cfg) {
  if (!cfg || !/^https?:\/\//.test(cfg.url) || typeof cfg.key !== 'string' || !cfg.key) return null;
  const base = cfg.url.replace(/\/+$/, '') + '/rest/v1', me = visitor(), kicks = new Set();
  const headers = { apikey: cfg.key, ...(cfg.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + cfg.key } : {}) }; // 옛 JWT 키만 Bearer로도 보낸다
  const call = async (path, body) => {
    let res;
    try {
      res = await fetch(base + path, {
        method: body ? 'POST' : 'GET', cache: 'no-store', body: body && JSON.stringify(body),
        headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
        signal: AbortSignal.timeout ? AbortSignal.timeout(10e3) : undefined, // 옛 iOS 사파리엔 없다
      });
    } catch { throw failure('unavailable'); }
    if (!res.ok) throw failure(httpCode(res.status));
    try { return await res.json(); } catch { throw failure('unavailable'); }
  };
  const asDoc = (r) => ({ id: r.id, exists: true, metadata: FRESH, data: () => ({ color: r.color, text: r.text, ts: Number(r.ts) }) });
  const poll = (path, every, deliver, onErr) => {
    let stopped = false, busy = false, again = false, timer = 0, wait = every;
    const stop = () => { stopped = true; clearTimeout(timer); kicks.delete(run); document.removeEventListener('visibilitychange', run); };
    async function run() {
      clearTimeout(timer);
      if (stopped || document.hidden) return; // 다시 보이면 visibilitychange가 깨운다
      if (busy) { again = true; return; }
      busy = true;
      let rows = null;
      try {
        const got = await call(path);
        // 이상한 응답(예: [null])을 '내 등 없음'으로 읽으면 이 기기에 남은 등까지 지운다 → 끊긴 것으로 치고 다시 기다린다
        if (!Array.isArray(got) || !got.every((r) => r && typeof r === 'object' && typeof r.id === 'string')) throw failure('unavailable');
        rows = got; wait = every;
      }
      catch (e) {
        if (e.code === 'not_granted' || e.code === 'invalid_argument') { stop(); if (onErr) safe(onErr, e); }
        else wait = Math.min(wait * 2, 300e3); // 30초 → 최대 5분
      } finally { busy = false; }
      if (stopped) return;
      if (rows) safe(deliver, rows);
      if (again) { again = false; run(); } else timer = setTimeout(run, wait);
    }
    kicks.add(run);
    document.addEventListener('visibilitychange', run);
    run();
    return stop;
  };
  const cols = '/lanterns?select=id,color,text,ts';
  return {
    user: { id: async () => me.id },
    db: {
      collection: () => ({
        orderBy: () => ({ limit: (n) => ({ onSnapshot: (cb, err) => poll(`${cols}&order=ts.desc,id.desc&limit=${n}`, 30e3, (rows) => cb({ docs: rows.map(asDoc), metadata: FRESH }), err) }) }),
        doc: (id) => ({
          onSnapshot: (cb, err) => poll(`${cols}&id=eq.${encodeURIComponent(id)}`, 120e3, (rows) => cb(rows[0] ? asDoc(rows[0]) : { id, exists: false, metadata: FRESH, data: () => undefined }), err),
          async set(rec) {
            if (id !== me.id) throw failure('not_granted');
            await call('/rpc/hang_lantern', { p_id: me.id, p_secret: me.secret, p_color: rec.color, p_text: rec.text, p_ts: rec.ts });
            for (const k of kicks) k(); // 방금 단 등을 다음 주기까지 기다리지 않고 바로 다시 읽는다
          },
        }),
      }),
    },
  };
}

// ── 공개 홈페이지 함께 걷기: 수파베이스 실시간(Phoenix 웹소켓) presence·broadcast로 아래 createNet이 쓰는 room 부분만큼 흉내 낸다 ──
// 무료 한도(공식 문서): 동시 접속 200, 초당 메시지 100(보낸 것+받은 것 합산), presence 초당 20, 한 사람 presence 호출 30초에 5회, 월 200만 건.
// 그래서 n명일 때 한 사람의 broadcast(움직임·차·받음 확인)를 평균 50·n·(n+1)ms(최소 2초)에 하나로 묶어 방 전체 수신이 초당 20건 안팎이 되게 하고,
// 한꺼번에 몰리지 않게 넷까지는 3번까지 몰아 보내고, 다섯부터는 1번, 여덟부터는 방 사람들이 이름순으로 돌아가며 제 칸(간격÷인원)에만 보낸다(입장 직후 첫 기록을 뺀 presence 기록도 같은 칸·토큰을 쓴다).
// presence 기록(track)은 100·n·(n+1)ms(최소 12초)마다, 35초에 4번까지만, 여럿 있던 방에 다시 붙을 때는 조금씩 흩어 보낸다. 몸짓(절·합장)은 번호(e)를 달아 1초 뒤부터, 움직임은 한 시간 400번까지.
// 로그인 없는 공개 채널이라 남의 이름·위치 흉내는 막을 수 없다(화면 표시만 바뀌고 저장되는 것은 없다). 순번 범위·필드·속도·유효 시간을 검사해 위조가 오래 남지 않게만 한다.
const PEER_KEY = /^[0-9a-f-]{36}$/;
const DENIED = /unauthori|jwt|api ?key|forbidden|not allowed|private|tenant ?not ?found|disabled/i; // 다시 붙어도 같은 답
const LIMITED = /rate limit|too many/i; // 'Client presence rate limit exceeded', 'Too many (presence) messages per second'
const FIELDS = ['n', 'c', 'x', 'z', 'r', 'm', 'p', 's', 'e'];
const qOf = (m) => (m && Number.isInteger(m.q) && m.q >= 0 && m.q < 2 ** 31 ? m.q : -1);
// 모습은 b(JSON 문자열) 하나로 싣는다(presence 키 수 제한). 옛 평평한 모양도 읽고, 정해진 필드의 짧은 값만 꺼낸다.
function unpack(o) {
  let src = o;
  if (o && typeof o.b === 'string') { if (o.b.length > 2048) return null; try { src = JSON.parse(o.b); } catch { return null; } }
  if (!src || typeof src !== 'object') return null;
  const f = {};
  for (const k of FIELDS) { const v = src[k]; if ((typeof v === 'string' && v.length <= 64) || fin(v)) f[k] = v; }
  return f;
}

export function publicRoom(cfg) {
  if (!cfg || !/^https?:\/\//.test(cfg.url) || typeof cfg.key !== 'string' || !cfg.key || typeof WebSocket !== 'function') return null;
  const url = cfg.url.replace(/\/+$/, '').replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0';
  const TOPIC = 'realtime:mongsansa', me = crypto.randomUUID();
  const connCbs = new Set(), peerCbs = new Set(), errCbs = new Set();
  // metas: 사람별 presence 기록(phx_ref별), moves: 기록 위에 덧씌운 최근 움직임, gifts: 나에게 온 차, early: presence보다 먼저 닿은 broadcast
  const metas = new Map(), moves = new Map(), gifts = new Map(), gotTea = new Set(), buckets = new Map(), early = new Map(), acks = new Map();
  const outbox = [], trackLog = [], castLog = [];
  let cache = new Map(), ws = null, ref = 0, joinRef = '', joined = false, dead = false, started = false, synced = false, pendingDiffs = [];
  let want = null, q = 0, sentKey = '', sentE = '', sentAt = 0, trackedKey = '', trackedAt = 0, lastGiftT = null, tokens = 3, tokAt = 0, pushTimer = 0, pushAt = 0, slotUsed = 0, joinAt = 0;
  let beatTimer = 0, pendingBeat = null, retryTimer = 0, clearTimer = 0, hideTimer = 0, stableTimer = 0, hiddenAt = 0, backoff = 1000, coolUntil = 0;
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const out = (event, payload) => send({ topic: TOPIC, event, payload, ref: String(++ref), join_ref: joinRef });
  const cast = (event, payload) => out('broadcast', { type: 'broadcast', event, payload });
  const setJoined = (v) => { if (v !== joined) { joined = v; for (const cb of connCbs) safe(cb, v); } };
  const members = () => metas.size + (metas.has(me) ? 0 : 1);
  const gap = () => { const n = members(); return n <= 1 ? Infinity : Math.max(2000, 50 * n * (n + 1)); };
  const trackGap = () => { const n = members(); return Math.max(12e3, 100 * n * (n + 1)); };
  // 한 사람의 여러 기록 중 순번(q)이 가장 큰 것, 같으면 나중에 온 것
  const latest = (key) => { let m = null; for (const v of metas.get(key)?.values() || []) if (!m || qOf(v) >= qOf(m)) m = v; return m; };
  const body = () => { const b = {}; for (const k of FIELDS) if (want[k] !== undefined) b[k] = want[k]; return b; };
  const forget = () => { metas.clear(); moves.clear(); gifts.clear(); early.clear(); buckets.clear(); acks.clear(); };
  const cool = (why) => { if (LIMITED.test(JSON.stringify(why ?? ''))) coolUntil = Date.now() + 30e3 + Math.random() * 30e3; };
  // 보내는 쪽 예산: 움직임·차·받음 확인이 함께 쓰는 토큰이 gap()마다 1개씩 찬다. 한꺼번에 몰리지 않게 넷까지는 3개까지 모이고, 다섯부터는 1개,
  // 여덟부터는 방 사람들이 이름순으로 돌아가며 제 칸(gap÷인원, 인원마다 한 번 돌아옴)에만 한 번 보낸다(시계가 조금 달라도 평균은 고르게 퍼진다).
  const cap = () => (members() <= 4 ? 3 : 1);
  function refill(now) { const g = gap(); tokens = Math.min(cap(), tokens + (now - tokAt) / (g === Infinity ? 2000 : g)); tokAt = now; }
  function slotAt(t) {
    const n = members(); if (n < 8) return t;
    const S = Math.round(gap() / n), mine = [...metas.keys(), ...(metas.has(me) ? [] : [me])].sort().indexOf(me), from = Math.max(t, slotUsed);
    const k = Math.floor(from / S), mk = k + ((((mine - k) % n) + n) % n);
    return mk === k ? from : mk * S;
  }
  // tokenAt(now) === now 이면 take(now)가 꼭 성공한다(plan이 헛돌지 않게)
  const tokenAt = (now) => { refill(now); return slotAt(tokens >= 1 - 1e-6 ? now : now + Math.ceil((1 - tokens) * gap())); };
  function take(now) {
    refill(now); if (tokens < 1 - 1e-6 || slotAt(now) > now) return false;
    tokens = Math.max(0, tokens - 1);
    if (members() >= 8) { const S = Math.round(gap() / members()); slotUsed = (Math.floor(now / S) + 1) * S; }
    return true;
  }
  // 받는 쪽: 한 사람에게서 받아들이는 움직임·차도 같은 속도(조금 넉넉하게)로 제한
  function allow(id, now) {
    const per = 0.8 * Math.min(gap(), 1e9);
    let bk = buckets.get(id);
    if (!bk) buckets.set(id, (bk = { tok: 3, at: now }));
    bk.tok = Math.min(3, bk.tok + (now - bk.at) / per); bk.at = now;
    if (bk.tok < 1) return false;
    bk.tok -= 1; return true;
  }

  function emitPeers() {
    const next = new Map(), peers = [];
    for (const key of metas.keys()) {
      const meta = latest(key), mv = moves.get(key), gift = gifts.get(key);
      let c = cache.get(key);
      if (!c || c.meta !== meta || c.mv !== mv || c.gift !== gift) {
        const presence = unpack(meta) || {};
        if (mv) Object.assign(presence, mv.f);
        if (gift) presence.g = gift.g;
        c = { meta, mv, gift, peer: Object.freeze({ peer: key, presence: Object.freeze(presence), updatedAt: Date.now(), sameTab: key === me, kind: 'viewer' }) };
      }
      next.set(key, c); peers.push(c.peer);
    }
    cache = next;
    for (const cb of peerCbs) safe(cb, { peers });
  }
  function merge(joins, leaves, hello) {
    const alone = members() <= 1, added = [];
    for (const [key, v] of Object.entries(joins || {})) {
      if (!PEER_KEY.test(key) || !v || !Array.isArray(v.metas)) continue;
      for (const meta of v.metas) {
        if (!meta || typeof meta !== 'object' || typeof meta.phx_ref !== 'string') continue;
        let refs = metas.get(key);
        if (!refs) { metas.set(key, (refs = new Map())); if (key !== me) added.push(key); }
        refs.delete(meta.phx_ref); refs.set(meta.phx_ref, meta);
      }
      // 새 기록보다 옛 덧씌움, 기록보다 너무 앞선(위조 의심) 덧씌움은 버린다. 움직임보다 늦게 닿은 옛 기록에는 되돌아가지 않는다(가짜 덧씌움은 +16 안쪽만 남고 expire()가 치운다)
      const mv = moves.get(key), top = qOf(latest(key));
      if (mv && (mv.q <= top || mv.q > top + 16)) moves.delete(key);
    }
    for (const [key, v] of Object.entries(leaves || {})) {
      const refs = metas.get(key);
      if (!refs || !v || !Array.isArray(v.metas)) continue;
      for (const meta of v.metas) if (meta) refs.delete(meta.phx_ref);
      if (!refs.size) { metas.delete(key); moves.delete(key); gifts.delete(key); buckets.delete(key); } // 나간 사람에게 줄 답은 pump가 지운다
    }
    for (const key of added) { const l = early.get(key); early.delete(key); if (l) for (const e of l) if (Date.now() - e.at <= 5e3) hear(e.p, true); } // presence보다 먼저 닿은 broadcast
    emitPeers();
    // 혼자 있다가 누가 오면 지금 모습을 곧 한 번(기록이 막 지났으면 broadcast로) 알린다
    if (hello && added.length && alone && joined && want && JSON.stringify(body()) !== trackedKey) { sentKey = ''; sentAt = 0; schedule(Date.now() + 300 + Math.random() * 1200); }
    else if (added.length) pump();
  }
  // 받았다는 답 [[받는 사람, 차 t], …]: 그 사람에게 건넨 차를 대기열에서 뺀다(검사를 통과한 메시지에서만 부른다)
  function ackIn(d) {
    if (Array.isArray(d.a)) for (const x of d.a.slice(0, 32)) if (Array.isArray(x) && x[0] === me && fin(x[1])) for (let i = outbox.length; i--;) if (outbox[i].to === d.id && outbox[i].t === x[1]) outbox.splice(i, 1);
  }
  function hear(p, replay) {
    const d = p && p.payload, now = Date.now();
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || d.id === me) return false;
    if (p.event === 'ack') { if (metas.has(d.id) && allow(d.id, now)) ackIn(d); return false; } // 받았다는 답: 지금 보이는 사람이 보낸 것만
    if (p.event !== 'move' && p.event !== 'gift') return false;
    if (!metas.has(d.id)) { // 아직 presence로 안 보이는 사람: 5초 동안 사람당 4건까지 모았다가 보이면 다시 듣는다
      if (replay || !PEER_KEY.test(d.id)) return false;
      for (const [k, l] of early) if (now - l[0].at > 5e3) early.delete(k);
      let l = early.get(d.id);
      if (!l) { if (early.size >= 64) return false; early.set(d.id, (l = [])); }
      if (l.length < 4) l.push({ p, at: now });
      return false;
    }
    if (p.event === 'move') { // 순번은 그 사람 최신 기록보다 크고 64 안쪽, 지난 움직임보다 커야 한다. 얹힌 답도 검사를 통과한 움직임에서만 읽는다
      const top = qOf(latest(d.id)), mv = moves.get(d.id);
      if (!Number.isInteger(d.q) || d.q <= top || d.q > top + 64 || (mv && d.q <= mv.q)) return false;
      const f = unpack(d);
      if (!f || !allow(d.id, now)) return false;
      moves.set(d.id, { q: d.q, f, at: now }); ackIn(d);
      return true;
    }
    if (d.to !== me || d.k !== 'tea' || !Number.isInteger(d.t) || Math.abs(d.t - now) >= SKEW) return false;
    const key = d.id + ' ' + d.t, seen = gotTea.has(key); // 이미 받은 차(다시 온 것)면 답만 다시. 늦게 닿은 앞선 차도 처음이면 받는다
    if (!seen && !allow(d.id, now)) return false; // 답을 안 보내면 보낸 쪽이 다시 보낸다
    acks.set(key, [d.id, d.t]); if (acks.size > 64) acks.delete(acks.keys().next().value);
    if (!seen) {
      gotTea.add(key); if (gotTea.size > 256) gotTea.delete(gotTea.values().next().value);
      gifts.set(d.id, { g: { to: me, k: 'tea', t: d.t } });
    }
    pump();
    return !seen;
  }

  function schedule(at) { if (pushTimer && pushAt <= at) return; clearTimeout(pushTimer); pushAt = at; pushTimer = setTimeout(pump, Math.max(0, at - Date.now())); }
  function trackFree() { const now = Date.now(); while (trackLog.length && now - trackLog[0] >= 35e3) trackLog.shift(); return trackLog.length < 4 ? now : trackLog[0] + 35e3; }
  const snapAt = () => (!trackedKey ? joinAt : members() > 1 ? trackedAt + trackGap() : Infinity);
  function moveAt(b, now) {
    if (members() <= 1) return Infinity;
    while (castLog.length && now - castLog[0] >= 3600e3) castLog.shift();
    const base = castLog.length >= 400 ? castLog[0] + 3600e3 : (b.e || '') !== sentE ? sentAt + 1000 : sentAt + gap();
    return Math.max(base, tokenAt(now));
  }
  // 다음에 보낼 것이 생기는 가장 이른 때에 pump를 다시 부른다(pump의 조건과 같아야 헛돌지 않는다)
  function plan() {
    if (!joined || !want) return;
    const now = Date.now(), b = body(), key = JSON.stringify(b);
    let at = Infinity;
    if (key !== trackedKey) at = Math.max(snapAt(), trackFree(), trackedKey && members() >= 8 ? tokenAt(now) : 0); // 여덟 명부터는 첫 기록 뒤의 기록도 토큰·칸을 쓴다
    if (trackedKey) {
      if (key !== sentKey) at = Math.min(at, moveAt(b, now)); // 받았다는 답은 이 움직임에 얹힌다
      else if (acks.size) at = Math.min(at, tokenAt(now));
      if (outbox.length) { const tok = tokenAt(now); for (const x of outbox) if (metas.has(x.to)) at = Math.min(at, Math.max(x.nextAt, tok)); }
    }
    if (at !== Infinity) schedule(at);
  }
  // 차의 기한. 보낸 차는 첫 전송 뒤 30초(until). 안 보낸 차는 건넨 뒤 60초, 큰 방은 내 차례가 gap()마다 오고 그 칸을 기록이 먼저 쓸 수 있으니 두 차례+5초.
  // 다만 받는 쪽은 t가 SKEW(10분) 넘은 차를 버리니 t 뒤 450초를 넘기지 않는다(다시 보내기 30초까지 480초, 시계 차이 120초 여유). 지나면 canGive가 다시 열린다
  function deadAt(x) { return x.left === 3 ? Math.min(x.at + (Number.isFinite(gap()) ? Math.max(60e3, 2 * gap() + 5e3) : 60e3), x.t + SKEW - 150e3) : x.until; }
  function pump() {
    clearTimeout(pushTimer); pushTimer = 0;
    if (!joined || !want) return;
    const now = Date.now(), b = body(), key = JSON.stringify(b);
    if (key !== trackedKey && now >= snapAt() && trackFree() <= now && (!trackedKey || members() < 8 || take(now))) {
      out('presence', { type: 'presence', event: 'track', payload: { b: key, q: ++q } });
      trackLog.push(now); trackedKey = sentKey = key; trackedAt = sentAt = now; sentE = b.e || '';
    }
    if (trackedKey) { // 이번 연결에서 내 presence를 올린 뒤에만 broadcast(상대가 나를 모르면 버리니까)
      for (const [k, v] of acks) if (!metas.has(v[0])) acks.delete(k);
      // 아직 한 번도 안 보낸 차가 다시 보내기보다 먼저. 기한(deadAt)이 지나면 버린다
      for (const x of [...outbox].sort((u, v) => (v.left === 3) - (u.left === 3))) {
        if (deadAt(x) <= now) { outbox.splice(outbox.indexOf(x), 1); continue; }
        if (x.nextAt > now || !metas.has(x.to)) continue;
        if (!take(now)) break;
        cast('gift', { id: me, to: x.to, k: 'tea', t: x.t });
        if (x.left === 3) x.until = now + 30e3;
        x.nextAt = now + Math.max(3000, gap());
        if (!--x.left) outbox.splice(outbox.indexOf(x), 1);
      }
      // 받았다는 답은 한 메시지에 묶어 움직임에 얹고, 가만히 있을 때만 따로 보낸다(답 때문에 움직임이 밀리지 않게)
      const a = [...acks.values()].slice(0, 32);
      let acked = false;
      if (key !== sentKey) {
        if (now >= moveAt(b, now) && take(now)) {
          cast('move', a.length ? { id: me, q: ++q, b: key, a } : { id: me, q: ++q, b: key });
          castLog.push(now); sentKey = key; sentAt = now; sentE = b.e || ''; acked = true;
        }
      } else if (a.length && take(now)) { cast('ack', { id: me, a }); acked = true; }
      if (acked) for (const [to, t] of a) acks.delete(to + ' ' + t);
    }
    plan();
  }

  function onJoined() {
    clearTimeout(clearTimer); clearTimer = 0;
    clearTimeout(stableTimer); stableTimer = setTimeout(() => { backoff = 1000; }, 30e3); // 30초 버티면 다시 붙기 간격을 처음으로
    trackedKey = sentKey = sentE = '';
    // 여럿 있던 방에 다시 붙을 때(서버가 잠깐 끊겨 다 같이 다시 붙는 때)는 첫 기록을 인원에 맞춰 조금씩 흩어 보낸다
    joinAt = Date.now() + (metas.size >= 5 ? Math.round(Math.random() * Math.min(10e3, 400 * metas.size)) : 0);
    setJoined(true); pump();
  }
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.topic === 'phoenix') { if (m.ref === pendingBeat) pendingBeat = null; return; }
    if (m.topic !== TOPIC) return;
    const p = (m.payload && typeof m.payload === 'object') ? m.payload : {};
    if (m.event === 'phx_reply') {
      if (m.ref !== joinRef) { if (p.status === 'error') cool(p.response); }
      else if (p.status === 'ok') onJoined();
      else if (DENIED.test(JSON.stringify(p.response || ''))) die();
      else { cool(p.response); lost(); }
    } else if (m.event === 'broadcast') { if (hear(p)) emitPeers(); }
    else if (m.event === 'presence_state') { // 첫 state 전에 온 diff는 모아 뒀다가 state 뒤에 적용(공식 클라이언트와 같다)
      metas.clear(); merge(p, null, false); synced = true;
      const pend = pendingDiffs; pendingDiffs = [];
      for (const d of pend) merge(d.joins, d.leaves, true);
      for (const k of [...moves.keys(), ...gifts.keys()]) if (!metas.has(k)) { moves.delete(k); gifts.delete(k); }
    } else if (m.event === 'presence_diff') { if (synced) merge(p.joins, p.leaves, true); else if (pendingDiffs.length < 100) pendingDiffs.push(p); }
    else if (m.event === 'system') { if (p.status === 'error') cool(p.message); } // 한도 알림 뒤엔 서버가 채널을 닫는다(phx_close)
    else if (m.event === 'phx_error' || m.event === 'phx_close') lost();
  }
  function connect() {
    if (dead || ws || document.hidden) return;
    clearTimeout(retryTimer); retryTimer = 0;
    if (Date.now() < coolUntil) { retryLater(); return; }
    try { ws = new WebSocket(url); } catch { ws = null; retryLater(); return; }
    joinRef = String(++ref); synced = false; pendingDiffs = [];
    ws.onopen = () => send({ topic: TOPIC, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: me, enabled: true }, postgres_changes: [], private: false } }, ref: joinRef, join_ref: joinRef });
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
    ws.onclose = ws.onerror = () => lost();
    beatTimer = setInterval(beat, 25e3);
  }
  // 25초 안에 못 붙었거나 지난 심장 박동에 답이 없으면 끊긴 것(모바일은 열린 척하는 죽은 소켓이 흔하다)
  function beat() {
    if (!joined || pendingBeat) { lost(); return; }
    pendingBeat = String(++ref);
    send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: pendingBeat });
    expire();
  }
  // 덧씌운 움직임은 그 사람의 다음 기록(track)이 늦어도 trackGap+40초 안에는 온다 → 그보다 오래된 것(위조 포함)은 버린다
  function expire() {
    const now = Date.now(), ttl = trackGap() + 40e3; let gone = false;
    for (const [k, v] of moves) if (now - v.at > ttl) { moves.delete(k); gone = true; }
    if (gone) emitPeers();
  }
  function close() {
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch { /* 이미 닫힘 */ } ws = null; }
    clearInterval(beatTimer); clearTimeout(pushTimer); clearTimeout(stableTimer); pushTimer = 0; pendingBeat = null;
    setJoined(false);
    // 잠깐 끊겼다 붙는 동안은 사람들을 그대로 두고, 처음 끊긴 때부터 5초 넘게 못 붙으면 비운다(다시 붙기가 실패해도 늦추지 않는다)
    if (!clearTimer) clearTimer = setTimeout(() => { clearTimer = 0; if (!joined && metas.size) { forget(); emitPeers(); } }, 5000);
  }
  function retryLater() {
    if (dead || document.hidden || retryTimer) return; // 숨은 탭은 다시 보일 때 붙는다
    retryTimer = setTimeout(() => { retryTimer = 0; connect(); }, Math.max(backoff * (0.5 + Math.random()), coolUntil - Date.now()));
    backoff = Math.min(backoff * 2, 60e3);
  }
  function lost() { close(); retryLater(); }
  function die() {
    dead = true; close(); clearTimeout(clearTimer); forget(); emitPeers();
    for (const cb of errCbs) safe(cb, failure('not_granted'));
  }

  document.addEventListener('visibilitychange', () => {
    clearTimeout(hideTimer);
    if (document.hidden) { hiddenAt = Date.now(); hideTimer = setTimeout(close, 60e3); return; }
    if (ws && Date.now() - hiddenAt > 60e3) close(); // 오래 숨어 있던 소켓은 죽었을 수 있다 → 새로
    if (started && !ws && !dead) { backoff = 1000; connect(); } // 한도로 쉬는 중이면 connect가 기다린다
  });

  return {
    presence(msg) {
      if (dead) return Promise.reject(failure('not_granted'));
      want = msg;
      // 새 차(t가 바뀜)만 대기열에: 끊긴 동안 건넨 것도 60초(큰 방은 두 차례+5초) 안에 다시 붙으면 보내고, 첫 전송 뒤 30초 동안 받았다는 답이 올 때까지 3번까지
      const g = msg && msg.g;
      if (g && typeof g.to === 'string' && fin(g.t) && g.t !== lastGiftT) {
        lastGiftT = g.t;
        outbox.push({ to: g.to.slice(0, 64), t: g.t, at: Date.now(), until: 0, nextAt: 0, left: 3 });
        if (outbox.length > 4) outbox.shift();
      }
      if (!started) { started = true; connect(); } else pump();
      return Promise.resolve();
    },
    connected: () => joined,
    canGive: () => !outbox.some((x) => x.left === 3 && metas.has(x.to) && deadAt(x) > Date.now()), // 앞서 건넨 차가 아직 한 번도 못 나갔으면 새로 건네지 않게(game.js가 묻는다)
    onConnection(cb, onErr) {
      connCbs.add(cb); if (onErr) errCbs.add(onErr);
      queueMicrotask(() => connCbs.has(cb) && safe(cb, joined));
    },
    onPeers(cb, onErr) { peerCbs.add(cb); if (onErr) errCbs.add(onErr); },
  };
}

export function createNet() {
  const statusCbs = new Set(), peerCbs = new Set(), lanternCbs = new Set();
  let status = 'connecting';
  let room = null, db = null, downloads = null, roomDead = false;
  let peersCache = [];
  const memo = new WeakMap(); // 안 바뀐 Peer는 같은 얼린 객체로 온다 → 다시 검사하지 않는다
  let shared = [], mineShared = null, local = loadLocal(), lanterns = [], lanternsReady = false;
  let want = null, lastSent = '', lastAt = 0, timer = 0;
  let writing = Promise.resolve();

  const setStatus = (s) => { if (s !== status) { status = s; for (const cb of statusCbs) safe(cb, s); } };
  const notifyPeers = () => { for (const cb of peerCbs) safe(cb, peersCache); };

  const net = {
    get status() { return status; },
    get sharing() { return !!db; }, // 단 연등이 다른 방문객에게도 보이는가
    meId: null,
    mePeer: null,
    onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    peers: () => peersCache,
    canGive: () => !room || typeof room.canGive !== 'function' || room.canGive(),
    onPeers(cb) { peerCbs.add(cb); return () => peerCbs.delete(cb); },
    onLanterns(cb) {
      lanternCbs.add(cb);
      if (lanternsReady) queueMicrotask(() => lanternCbs.has(cb) && safe(cb, lanterns));
      return () => lanternCbs.delete(cb);
    },
    setPresence(o) {
      want = o;
      if (!timer) timer = setTimeout(flush, Math.max(0, lastAt + 100 - Date.now()));
    },
    putLantern({ color, text } = {}) {
      const run = () => writeLantern(color, text);
      return (writing = writing.then(run, run));
    },
    async saveFile(filename, blob) {
      await ready;
      if (!downloads) return 'unavailable';
      try { await downloads.save({ filename, data: blob }); return 'saved'; }
      catch (e) {
        const code = e && e.code;
        if (code === 'declined') return 'declined';
        // downloads.d.ts: 모르는 코드는 unavailable로. 그 경우 G가 그림을 띄워 길게 눌러 저장하게 한다
        return SAVE_ERRORS.has(code) ? 'error' : 'unavailable';
      }
    },
  };

  function flush() {
    timer = 0;
    if (!room || roomDead || !want) return;
    const o = want;
    const msg = {
      v: 1,
      n: cleanText(o.n, 16),
      c: VEST_COLORS.includes(o.c) ? o.c : VEST_COLORS[0],
      x: r2(fin(o.x) ? o.x : 0), z: r2(fin(o.z) ? o.z : 0),
      r: r2(fin(o.r) ? wrap(o.r) : 0),
      m: MOVES.has(o.m) ? o.m : 'idle',
      p: PLACES.has(o.p) ? o.p : '',
      s: o.s === 'shroud' ? 'shroud' : '',
      e: typeof o.e === 'string' && /^[bg]\d{1,6}$/.test(o.e) ? o.e : '',
      g: o.g && typeof o.g.to === 'string' ? { to: o.g.to.slice(0, 64), k: 'tea', t: fin(o.g.t) ? o.g.t : Date.now() } : null,
    };
    const key = JSON.stringify(msg);
    if (key === lastSent) return;
    lastSent = key; lastAt = Date.now();
    room.presence(msg).catch((e) => {
      lastSent = '';
      if (TERMINAL.has(e && e.code)) killRoom(); else console.warn('[net] presence', e && e.code, e && e.message);
    });
  }

  function killRoom() {
    roomDead = true;
    peersCache = [];
    notifyPeers();
    setStatus('solo');
  }

  function startRoom() {
    let offTimer = 0;
    const onErr = (e) => { if (TERMINAL.has(e && e.code)) { clearTimeout(offTimer); killRoom(); } };
    room.onConnection((c) => {
      if (roomDead) return;
      clearTimeout(offTimer);
      if (c) setStatus('live');
      // 처음 붙는 데 1초쯤, 잠깐 끊김은 흔하다 → 계속 끊겨 있을 때만 혼자 모드
      else offTimer = setTimeout(() => { if (!roomDead && !room.connected()) setStatus('solo'); }, status === 'connecting' ? 6000 : 2000);
    }, onErr);
    room.onPeers(({ peers }) => {
      if (roomDead) return;
      const out = [];
      for (const p of peers) {
        if (p.sameTab) net.mePeer = p.peer;
        if (p.sameTab || p.kind !== 'viewer') continue;
        let c = memo.get(p);
        if (c === undefined) { c = cleanPeer(p); if (c && p.isMe) c.me = true; memo.set(p, c); }
        if (c) out.push(c);
      }
      peersCache = out;
      notifyPeers();
    }, onErr);
    if (want) flush();
  }

  function emitLanterns() {
    let mine = mineShared;
    // 이 기기 사본은 서버 것보다 새것일 때만 덧씌운다(못 올린 초안·막 단 등). 서버 삭제가 확정되면 아래 구독이 사본을 지운다
    if (local && (!mine || local.ts > mine.ts)) mine = { id: net.meId ?? 'local', color: local.color, text: local.text, ts: local.ts };
    lanterns = layoutLanterns(shared, mine);
    lanternsReady = true;
    for (const cb of lanternCbs) safe(cb, lanterns);
  }

  async function writeLantern(color, text) {
    const rec = { color: Number.isInteger(color) && color >= 0 && color <= 4 ? color : 0, text: cleanText(text, 40), ts: Date.now() };
    const savedHere = saveLocal(rec);
    local = rec;
    await ready;
    emitLanterns();
    if (!db || !net.meId) return { ok: true, shared: false, saved: savedHere };
    for (let attempt = 0; ; attempt++) {
      try {
        await db.collection('lanterns').doc(net.meId).set(rec);
        if (local === rec) { local = { ...rec, synced: true }; saveLocal(local); } // 그사이 새로 단 등이 있으면 그것을 지킨다
        return { ok: true, shared: true };
      } catch (e) {
        const code = (e && e.code) || 'error';
        // db 문서: 잠깐 막힌 unavailable만 짧게 쉬고 한 번 더
        if (code === 'unavailable' && attempt === 0) { await new Promise((r) => setTimeout(r, 300 + Math.random() * 500)); continue; }
        console.warn('[net] lantern write', code, e && e.message);
        return { ok: true, shared: false, saved: savedHere, error: code }; // 등은 이미 그려졌다: 실패 대신 저장 여부만 알린다
      }
    }
  }

  // db.d.ts: 구독은 오류 한 번으로 끝난다. unavailable(호스트 응답 끊김)과 모르는 코드(queue_overflow 등)는 새 구독만이 복구 →
  // 간격을 늘리며 5번까지. 횟수는 서버가 확정한 응답(fromCache 아님)이 와야 되돌린다(캐시 응답만 오가면 끝없이 다시 열린다).
  // revoked는 이 페이지 동안 끝 → 공유를 끄고 내 기기 등만 보인다. 나머지 아는 코드는 다시 해도 같은 답이라 멈춘다.
  function keep(label, open) {
    let tries = 0;
    const start = () => {
      if (!db) return;
      try {
        open((meta) => { if (!(meta && meta.fromCache)) tries = 0; }, (e) => {
          const code = e && e.code;
          console.warn('[net]', label, code, e && e.message);
          if (code === 'revoked') { db = null; shared = []; mineShared = null; emitLanterns(); }
          else if (!NO_RETRY.has(code) && tries < 5) setTimeout(start, 1000 * 2 ** tries++ + Math.random() * 1000);
        });
      } catch (e) { console.warn('[net]', label, e); }
    };
    start();
  }

  function startLanterns() {
    emitLanterns();
    if (!db) return;
    // 최근 108개 + 내 등(오래돼서 창 밖이어도 늘 보이게)
    keep('lanterns', (ok, err) => db.collection('lanterns').orderBy('ts', 'desc').limit(SLOTS).onSnapshot((snap) => {
      ok(snap.metadata);
      shared = snap.docs.map(cleanLantern).filter(Boolean);
      emitLanterns();
    }, err));
    if (net.meId) keep('my lantern', (ok, err) => db.collection('lanterns').doc(net.meId).onSnapshot((d) => {
      ok(d.metadata);
      const m = d.metadata || {}, sure = !m.fromCache && !m.hasPendingWrites; // 서버가 확정한 모습
      mineShared = d.exists ? cleanLantern(d) : null;
      // 서버가 확정한 '없음'인데 이미 올렸던 사본이면 → 지워진 것. 다시 나타나지 않게 이 기기 사본도 지운다
      if (sure && !d.exists && local && local.synced) { local = null; clearLocal(); }
      // 저장 응답을 못 받았어도(창을 닫는 등) 서버에 같은 등이 있으면 올라간 것 → 그 뒤 서버 삭제도 위에서 반영된다
      else if (sure && mineShared && local && !local.synced && mineShared.ts === local.ts) { local = { ...local, synced: true }; saveLocal(local); }
      emitLanterns();
    }, err));
  }

  const use = (name) => {
    try { return Promise.resolve(globalThis.claude && globalThis.claude.use ? globalThis.claude.use(name) : null).catch(() => null); }
    catch { return Promise.resolve(null); }
  };
  const ready = (async () => {
    let user, pub = null;
    // claude.ai 밖(공개 홈페이지)에선 빌드가 넣은 수파베이스로 연등을 함께 보고, 수파베이스 실시간으로 서로 만난다
    if (!(globalThis.claude && globalThis.claude.use) && globalThis.MONGSANSA_DB) {
      try { pub = publicDb(globalThis.MONGSANSA_DB); } catch (e) { console.warn('[net] public db', e); }
    }
    if (pub) {
      ({ db, user } = pub);
      try { room = publicRoom(globalThis.MONGSANSA_DB); } catch (e) { console.warn('[net] public room', e); }
    } else [room, db, user, downloads] = await Promise.all(['room', 'db', 'user', 'downloads'].map(use));
    if (user) { try { net.meId = (await user.id()) || null; } catch { net.meId = null; } }
    if (room) { try { startRoom(); } catch (e) { console.warn('[net] room', e); killRoom(); } }
    else setStatus('solo');
    startLanterns();
  })();

  return net;
}
