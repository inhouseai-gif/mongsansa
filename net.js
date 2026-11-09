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
export const cleanText = (s, max) => (typeof s === 'string' ? Array.from(s.replace(BAD_CHARS, '').trim()).slice(0, max).join('') : '');
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
    meId: null,
    mePeer: null,
    onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    peers: () => peersCache,
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
    if (!db || !net.meId) return savedHere ? { ok: true, shared: false } : { ok: false, shared: false, error: 'storage' };
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
        return { ok: savedHere, shared: false, error: code };
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
    let user;
    [room, db, user, downloads] = await Promise.all(['room', 'db', 'user', 'downloads'].map(use));
    if (user) { try { net.meId = (await user.id()) || null; } catch { net.meId = null; } }
    if (room) { try { startRoom(); } catch (e) { console.warn('[net] room', e); killRoom(); } }
    else setStatus('solo');
    startLanterns();
  })();

  return net;
}
