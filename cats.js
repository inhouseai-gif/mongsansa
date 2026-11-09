// 산사 고양이 24마리의 하루. 네트워크 없이 시계(Date.now)와 이름만으로 정해서,
// 같은 판을 연 방문객은 모두 같은 고양이를 같은 자리에서 같은 몸짓으로 본다.
// 자리·시간 계산은 + − × ÷ 와 sqrt만 쓴다(삼각함수·hypot은 엔진마다 끝자리가 달라 길이 갈릴 수 있다). 바라보는 방향(atan2)은 보기용이다.

// 이름, 털, 집 x, z, 새끼(1). 0번은 불멍 자리에서 자는 보리.
export const CATS = [
  ['보리', 'orange', -7, 15.3], ['치즈', 'cream', -1, 12], ['까망이', 'black', -4, -3.5], ['삼색이', 'calico', -19, 3.6],
  ['고등어', 'mackerel', -12, -14], ['콩이', 'tuxedo', 10, 12.5, 1], ['두부', 'white', 6, 4.5], ['호박', 'orange', 16, -3],
  ['먹물', 'tuxedo', -20, -30], ['누룽지', 'brown', 12, -9], ['단풍', 'red', -6, 27], ['솜이', 'white', -28.5, 16],
  ['깨비', 'mackerel', -14, -23], ['모카', 'brown', 5, 24], ['율무', 'point', -6, 43], ['앵두', 'calico', -10, 7, 1],
  ['나비', 'blue', 21, 30], ['달이', 'white', -28.5, -3], ['별이', 'black', 8, 9, 1], ['감자', 'point', 8, 44],
  ['밤톨', 'brown', 18, -9, 1], ['인절미', 'cream', 3, 51], ['호떡', 'orange', -21, 11], ['만두', 'mandu', -6, 10, 1],
].map(([name, coat, x, z, kitten], i) => ({ name, coat, x, z, kitten: !!kitten, fire: i === 0 }));

// FNV-1a 32비트
export function hash(...parts) { const s = parts.join('|'); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// 16방위: 22.5° 간격 값을 적어 두고 90°씩 돌린다((x,z)→(-z,x)는 정확한 계산).
const C = .9238795325112867, S = .3826834323650898, H = .7071067811865476;
export const DIRS16 = [];
for (let q = 0, b = [[1, 0], [C, S], [H, H], [S, C]]; q < 4; q++, b = b.map(([x, z]) => [-z, x])) DIRS16.push(...b);

// 받침: 보리가/호박이, 보리를/호박을, 보리는/호박은
export const josa = (s, a, b) => { const c = s.charCodeAt(s.length - 1) - 0xac00; return s + (c >= 0 && c < 11172 && c % 28 ? a : b); };

const IDLE = 1200, STRETCH = 2000, len = (x, z) => Math.sqrt(x * x + z * z);

function line(raw) {
  const pts = [raw[0]];
  for (const p of raw) { const q = pts[pts.length - 1]; if (len(p.x - q.x, p.z - q.z) > 1e-9) pts.push(p); }
  const cum = [0];
  for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + len(pts[j].x - pts[j - 1].x, pts[j].z - pts[j - 1].z));
  const a = pts[Math.max(0, pts.length - 2)], b = pts[pts.length - 1];
  return { pts, cum, len: cum[cum.length - 1], yaw: Math.atan2(b.x - a.x, b.z - a.z) };
}

// free·treeFree: 그래픽 품질과 상관없는 판정(world.blockedFixed·treeFree), nav: 그 판정으로 만든 길찾기
export function createCatSchedule({ free, treeFree, nav }) {
  const ok = (x, z) => free(x, z) && treeFree(x, z);
  function snap(x, z, n = 8) { for (let s = 0; s <= n; s++) for (const [a, b] of s ? DIRS16 : [[0, 0]]) { const p = { x: x + a * s * .35, z: z + b * s * .35 }; if (ok(p.x, p.z)) return p; } return null; }
  const cats = CATS.map(c => {
    const P = (50 + hash(c.name, 'P') % 61) * 1000, O = hash(c.name, 'O') % P;
    const home = snap(c.x, c.z, 24); if (!home) return null; // 8.4m 안에 빈 곳이 없으면 그 고양이는 뺀다(모든 기기가 같은 판정이라 같은 고양이들)
    const spots = [home], routes = new Map();
    for (let j = 0; j < (c.fire ? 2 : 3); j++) {
      const h = hash(c.name, 'n', j), [a, b] = DIRS16[h % 16], r = 3 + (h >>> 4) % 5, q = snap(home.x + a * r, home.z + b * r);
      const pts = q && !spots.some(s => len(s.x - q.x, s.z - q.z) < 1) ? nav.path(home, q) : [];
      if (!pts.length) continue;
      const l = line([home, ...pts, q]);
      if (l.len > 20) continue;
      routes.set('0:' + spots.length, l); spots.push(q);
    }
    const nooks = spots.map((_, j) => j).slice(1);
    return { ...c, P, O, home, spots, routes, pick: c.fire ? [0, 0, 0, ...nooks] : [0, 0, ...nooks],
      yaws: spots.map((_, j) => c.fire && j === 0 ? .7 : hash(c.name, 'y', j) % 6283 / 1000), speed: c.kitten ? .7 : .6 };
  }).filter(Boolean);
  const spotAt = (c, k) => c.pick[hash(c.name, 's', k) % c.pick.length];
  function route(c, a, b) {
    const key = a + ':' + b; let r = c.routes.get(key);
    if (!r) { const A = c.spots[a], B = c.spots[b]; r = line([A, ...nav.path(A, B), B]); c.routes.set(key, r); }
    return r;
  }
  function restPose(c, k, spot) {
    if (c.fire && spot === 0) return 'sleep';
    const r = hash(c.name, 'p', k) % 100, h = (Math.floor((k * c.P - c.O) / 36e5) + 9) % 24; // 한국 시각
    return h >= 21 || h < 6 ? (r < 60 ? 'sleep' : r < 85 ? 'loaf' : 'sit') : (r < 35 ? 'sit' : r < 70 ? 'loaf' : 'sleep');
  }
  // ms: Date.now() 정수. 한 주기(50~110초)마다 자리를 옮기거나 머문다.
  function state(i, ms) {
    const c = cats[i], k = Math.floor((ms + c.O) / c.P), tau = ms + c.O - k * c.P, to = spotAt(c, k), from = spotAt(c, k - 1), at = c.spots[to];
    const out = { x: at.x, z: at.z, yaw: c.yaws[to], pose: restPose(c, k, to), moving: false, speed: 0, action: 'rest', k, spot: to };
    let since = tau, turn = null;
    if (to !== from) {
      const r = route(c, from, to), walk = Math.min(r.len / c.speed * 1000, .6 * c.P);
      if (tau < walk) {
        const v = r.len / (walk / 1000), d = v * tau / 1000;
        let j = 1; while (j < r.pts.length - 1 && r.cum[j] < d) j++;
        const a = r.pts[j - 1], b = r.pts[j], sl = r.cum[j] - r.cum[j - 1], f = sl > 0 ? Math.min(1, (d - r.cum[j - 1]) / sl) : 1;
        return { ...out, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z), pose: 'walk', moving: true, speed: v, action: 'walk' };
      }
      since = tau - walk; turn = r.yaw;
    } else if (out.pose === restPose(c, k - 1, from)) return out;
    const stretch = hash(c.name, 'st', k) % 3 === 0;
    if (since < IDLE || stretch && since < IDLE + STRETCH) { out.pose = 'idle'; out.action = since < IDLE ? 'idle' : 'stretch'; if (turn !== null) out.yaw = turn; }
    return out;
  }
  // 다음에 자리를 뜰 때까지 남은 ms(걷는 중이면 0). 6주기 안에 안 뜨면 6주기.
  function restLeft(i, ms) {
    const c = cats[i], k = Math.floor((ms + c.O) / c.P);
    if (state(i, ms).moving) return 0;
    for (let j = k + 1; j <= k + 6; j++) if (spotAt(c, j) !== spotAt(c, j - 1)) return j * c.P - c.O - ms;
    return 6 * c.P;
  }
  return { cats, state, restLeft };
}
