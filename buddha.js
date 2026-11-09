import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 몽산사 · 단위 1 = 게임의 로컬 단위. 정면 +z, 대좌 바닥 y=0.
// 조형 참고: 석굴암 본존불의 편단우견·항마촉지인과 통일신라 금동불의 연화좌.
// https://www.heritage.go.kr/html/heritage/heritage_play01.html
// 외부 자산/비동기 작업 없음. 광원은 호출자가 배치한다.
const environments = new WeakMap();
let interiorTexture;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

function warmInterior() {
  if (interiorTexture) return interiorTexture;
  // 방위 u=.75가 +z: 삼문에서 들어오는 넓은 빛, 양옆 창과 촛불.
  const w = 256, h = 128;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let texture;
  if (canvas) {
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    c.scale(.5, .5);
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#37291d'); g.addColorStop(.30, '#8b7960');
    g.addColorStop(.49, '#c9b48e'); g.addColorStop(.64, '#8f7350');
    g.addColorStop(.78, '#342016'); g.addColorStop(1, '#1b100b');
    c.fillStyle = g; c.fillRect(0, 0, 512, 256);
    const glow = (x, y, rx, ry, color) => {
      c.save(); c.translate(x, y); c.scale(rx, ry);
      const r = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      r.addColorStop(0, color); r.addColorStop(.18, color); r.addColorStop(1, '#ffe9bb00');
      c.fillStyle = r; c.fillRect(-1, -1, 2, 2); c.restore();
    };
    glow(384, 96, 105, 88, '#fff4de'); // 정면 문
    glow(266, 100, 34, 50, '#e7cca1'); glow(485, 100, 32, 52, '#eed0a2');
    glow(155, 117, 38, 34, '#bd8e54');
    glow(320, 151, 12, 23, '#ffd183'); glow(447, 151, 12, 23, '#ffd183');
    texture = new THREE.CanvasTexture(canvas);
  } else {
    // DOM 없는 도구에서도 형상/Box3를 검사할 수 있다.
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const band = Math.exp(-(((y / h - .46) / .27) ** 2));
      const door = Math.exp(-(((x / w - .75) / .15) ** 2) - ((y / h - .44) / .27) ** 2);
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, 28 + 116 * band + 160 * door);
      data[i + 1] = Math.min(255, 17 + 83 * band + 150 * door);
      data[i + 2] = Math.min(255, 10 + 48 * band + 130 * door); data[i + 3] = 255;
    }
    texture = new THREE.DataTexture(data, w, h); texture.needsUpdate = true;
  }
  texture.name = '몽산사 · 따뜻한 법당 반사';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  interiorTexture = texture;
  return texture;
}

function environment(opts) {
  if (opts.envMap) return opts.envMap;
  const raw = warmInterior();
  if (!opts.renderer) return raw;
  if (!environments.has(opts.renderer)) {
    const generator = new THREE.PMREMGenerator(opts.renderer);
    const target = generator.fromEquirectangular(raw);
    generator.dispose();
    // RenderTarget도 보관: 조각 하나의 dispose는 공유 광환경을 해제하지 않는다.
    environments.set(opts.renderer, target);
  }
  return environments.get(opts.renderer).texture;
}

/**
 * @param {{variant?:'buddha'|'bodhisattva', side?:1|-1,
 * quality?:'high'|'low', renderer?:THREE.WebGLRenderer, envMap?:THREE.Texture}} opts
 * @returns {THREE.Group} geometry/material ownership belongs to this group.
 */
export function createBuddha(opts = {}) {
  const now = () => globalThis.performance?.now() ?? Date.now();
  const started = now();
  const bodhi = opts.variant === 'bodhisattva';
  const high = opts.quality !== 'low';
  const side = opts.side === -1 ? -1 : 1;
  const envMap = environment(opts);
  const environmentMs = now() - started;
  const group = new THREE.Group();
  group.name = bodhi ? '몽산사 · 연화보살' : '몽산사 · 항마촉지인 여래';
  const materials = {
    gold: new THREE.MeshStandardMaterial({ color: '#d9ab52', metalness: 1, roughness: .40, envMap, envMapIntensity: .9, flatShading: false, side: THREE.DoubleSide }),
    robe: new THREE.MeshStandardMaterial({ color: '#bd8c3e', metalness: 1, roughness: .43, envMap, envMapIntensity: .9, flatShading: false, side: THREE.DoubleSide }),
    hair: new THREE.MeshStandardMaterial({ color: '#2b3546', metalness: .22, roughness: .7, envMap, envMapIntensity: .65, flatShading: false }),
    recess: new THREE.MeshStandardMaterial({ color: '#78522a', metalness: .9, roughness: .53, envMap, envMapIntensity: .7, flatShading: false }),
  };
  if (bodhi) materials.jewel = new THREE.MeshStandardMaterial({ color: '#477c79', metalness: .65, roughness: .27, envMap, envMapIntensity: .9 });
  const batches = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const templates = new Map();
  const transform = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  function add(g, mat = 'gold', p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) {
    g.deleteAttribute('uv');
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    quat.setFromEuler(euler.set(...r)); transform.compose(V(...p), quat, V(...s));
    g.applyMatrix4(transform); batches[mat].push(g); return g;
  }
  function ell(p, s, mat = 'gold', r = [0, 0, 0], seg, rows) {
    const size = Math.max(...s);
    seg ??= high ? (size < .08 ? 12 : size < .16 ? (bodhi ? 14 : 16) : (bodhi ? 20 : 28)) : (size < .16 ? 10 : 16);
    rows ??= high ? (size < .08 ? 8 : size < .16 ? (bodhi ? 9 : 10) : (bodhi ? 12 : 18)) : (size < .16 ? 7 : 10);
    const key = `${seg}/${rows}`;
    if (!templates.has(key)) templates.set(key, new THREE.SphereGeometry(1, seg, rows));
    return add(templates.get(key).clone(), mat, p, s, r);
  }
  function tube(points, radius, mat = 'gold', segments = high ? 24 : 12, radial = high ? 6 : 4, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)), closed, 'centripetal');
    return add(new THREE.TubeGeometry(curve, segments, radius, radial, closed), mat);
  }
  function limb(points, radii, mat = 'gold', squash = 1) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)));
    const small = Math.max(...radii) < .025;
    const n = high ? (small ? 10 : mat === 'hair' ? 18 : 24) : 10, m = high ? (small ? 6 : mat === 'hair' ? 10 : 14) : 6;
    const g = new THREE.TubeGeometry(curve, n, 1, m, false);
    const p = g.attributes.position;
    for (let i = 0; i <= n; i++) {
      const t = i / n, q = t * (radii.length - 1), a = Math.min(radii.length - 2, Math.floor(q));
      const f = q - a, rad = THREE.MathUtils.lerp(radii[a], radii[a + 1], f);
      const center = curve.getPointAt(t);
      for (let j = 0; j <= m; j++) {
        const k = i * (m + 1) + j;
        p.setXYZ(k, center.x + (p.getX(k) - center.x) * rad, center.y + (p.getY(k) - center.y) * rad, center.z + (p.getZ(k) - center.z) * rad * squash);
      }
    }
    g.computeVertexNormals(); add(g, mat);
    const capSegments = r => high && r > .04 ? [16, 10] : [8, 5];
    ell(points[0], [radii[0], radii[0], radii[0] * squash], mat, [0, 0, 0], ...capSegments(radii[0]));
    const r = radii.at(-1); ell(points.at(-1), [r, r, r * squash], mat, [0, 0, 0], ...capSegments(r));
  }
  function lathe(profile, mat, sz = 1, z = 0) {
    const spline = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.LatheGeometry(spline.getPoints(high ? Math.ceil(profile.length * 1.5) : profile.length), high ? (bodhi ? 32 : 40) : 24);
    const p=g.attributes.position; for(let i=0;i<p.count;i++) p.setY(i,Math.max(0,p.getY(i))); g.computeVertexNormals();
    return add(g, mat, [0, 0, z], [1, 1, sz]);
  }
  function ring(rx, ry, y, z, radius, mat = 'gold', count = high ? (bodhi ? 40 : 56) : 28) {
    const points = Array.from({ length: count }, (_, i) => { const a = i * TAU / count; return [rx * Math.cos(a), y + ry * Math.sin(a), z]; });
    return tube(points, radius, mat, count, high ? 5 : 4, true);
  }

  // 연화대좌: 원형 주물의 윤곽을 앞뒤로 살짝 압축해 법당 벽과 거리를 확보한다.
  lathe([[0, 0], [.60, 0], [.655, .016], [.67, .045], [.65, .078], [.56, .09], [.48, .135], [.48, .185], [.50, .205], [.515, .235], [.49, .27], [0, .27]], 'recess', .75, -.03);
  lathe([[0, .212], [.45, .212], [.475, .24], [.48, .31], [.50, .395], [.54, .434], [0, .434]], 'gold', .76, -.03);
  for (const y of [.055, .105, .205, .44]) {
    const r = y > .3 ? .548 : y < .08 ? .66 : y < .15 ? .54 : .508;
    const ps = Array.from({ length: 48 }, (_, i) => [r * Math.cos(i * TAU / 48), y, -.03 + r * .75 * Math.sin(i * TAU / 48)]);
    tube(ps, y > .3 ? .012 : .008, 'gold', high ? 48 : 28, high ? 5 : 4, true);
  }
  function cup(x, y) { return .088 * Math.sin(Math.PI * y / .228) - .035 * (x / .1) ** 2 + .042 * (y / .228) ** 6; }
  const petalPos = [], petalIndex = [], pn = high ? 8 : 6, pm = high && !bodhi ? 6 : 4;
  for (let iy = 0; iy <= pn; iy++) {
    const t = iy / pn, y = .228 * t, width = .096 * Math.sin(Math.PI * t) ** .80;
    for (let ix = 0; ix <= pm; ix++) {
      const x = (ix / pm * 2 - 1) * width;
      petalPos.push(x, y, cup(x, y) + .002);
      if (iy < pn && ix < pm) {
        const k = iy * (pm + 1) + ix;
        petalIndex.push(k,k+1,k+pm+1,k+1,k+pm+2,k+pm+1);
      }
    }
  }
  const pShape = new THREE.BufferGeometry();
  pShape.setAttribute('position',new THREE.Float32BufferAttribute(petalPos,3));
  pShape.setIndex(petalIndex);pShape.computeVertexNormals();
  const np = high ? (bodhi ? 12 : 16) : 10;
  for (let row = 0; row < 2; row++) for (let i = 0; i < np; i++) {
    const a = (i + row * .5) * TAU / np, baseR = row ? .49 : .51, baseY = row ? .215 : .155;
    const g = pShape.clone();
    const p = g.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const x = p.getX(j), y = p.getY(j) * (row ? 1 : .95), radial = baseR + p.getZ(j);
      p.setXYZ(j, x * Math.cos(a) + radial * Math.sin(a), baseY + y, -.03 + .75 * (radial * Math.cos(a) - x * Math.sin(a)));
    }
    g.computeVertexNormals(); add(g, row ? 'gold' : 'robe');
    // 꽃잎 가장자리마다 가늘게 이어지는 주물 테두리.
    if (high || row) {
      const rim = [];
      for (let j=0;j<=24;j++) {
        const t=j<=12?j/12:(24-j)/12, y=.228*t;
        const x=(j<=12?-1:1)*.096*Math.sin(Math.PI*t)**.80;
        const rr=baseR+cup(x,y)+.006;
        rim.push([x*Math.cos(a)+rr*Math.sin(a),baseY+y*(row?1:.95),-.03+.75*(rr*Math.cos(a)-x*Math.sin(a))]);
      }
      tube(rim,.0028,'gold',high?16:12,3);
    }
  }
  pShape.dispose();

  // 다리: 납작한 무릎, 교차하는 정강이, 반대편 허벅지 위의 위를 향한 발바닥.
  ell([0, .54, -.025], [.545, .12, .285], 'robe');
  for (const s of [-1, 1]) ell([s * .335, .582, .015], [.25, .116, .24], 'robe', [0, 0, -s * .11]);
  limb([[-.48, .58, .04], [-.31, .59, .27], [-.08, .64, .29], [.19, .702, .18]], [.084, .088, .074, .052], 'robe', .8);
  limb([[.47, .59, .06], [.31, .54, .29], [.06, .535, .33], [-.24, .655, .25]], [.088, .085, .075, .052], 'robe', .8);
  function foot(s, y, z) {
    ell([s * .195, y, z], [.132, .046, .061], 'gold', [0, s * -.18, s * .11]);
    ell([s * .263, y + .018, z], [.057, .031, .065], 'gold');
    if (high) for (let i = 0; i < 5; i++) ell([s * (.302 - i * .005), y + .014, z + (i - 2) * .021], [.027 - i * .002, .018, .012], 'gold', [0, 0, 0], 10, 7);
    tube([[s * .11, y + .037, z], [s * .17, y + .044, z - .017], [s * .235, y + .046, z]], .0025, 'recess', 12, 4);
  }
  foot(1, .714, .19); foot(-1, .653, .294);
  const fanPos=[],fanIndices=[],fanN=high?10:6;
  for(let i=0;i<=fanN;i++) for(let j=0;j<=fanN;j++) {
    const t=i/fanN,u=j/fanN*2-1;
    fanPos.push(u*(.033+.19*t),.637-.198*t,.288+.042*t+.006*Math.cos(u*Math.PI*3)*t);
    if(i<fanN&&j<fanN){const k=i*(fanN+1)+j;fanIndices.push(k,k+1,k+fanN+1,k+1,k+fanN+2,k+fanN+1);}
  }
  const fan=new THREE.BufferGeometry();fan.setAttribute('position',new THREE.Float32BufferAttribute(fanPos,3));fan.setIndex(fanIndices);fan.computeVertexNormals();add(fan,'robe');
  for(const u of [-1,-.5,0,.5,1]) {
    const pts=Array.from({length:12},(_,i)=>{const t=i/11;return[u*(.033+.19*t),.637-.198*t,.294+.042*t+.006*Math.cos(u*Math.PI*3)*t];});
    tube(pts,.004,'gold',high?16:10,4);
  }
  for (const side of [-1,1]) for(let i=0;i<(high?3:2);i++) {
    const y=.52+i*.028;
    const pts=[];
    for(let j=0;j<=18;j++){
      const t=j/18, x=side*(.52-.29*t), yy=y+.067*Math.pow(2*t-1,2);
      const front=.015+.24*Math.sqrt(Math.max(.03,1-Math.pow((x-side*.335)/.25,2)-Math.pow((yy-.582)/.116,2)));
      pts.push([x,yy,front+.006]);
    }
    tube(pts,.0045,'gold',high?20:12,4);
  }

  // 연속된 몸통 단면으로 어깨와 배를 부드럽게 연결한다.
  const profile = [[0, .71], [.182, .72], [.236, .80], [.253, .94], [.292, 1.095], [.308, 1.19], [.265, 1.246], [.138, 1.292], [.095, 1.325], [0, 1.325]];
  lathe(profile, 'gold', .61, -.018);
  const bodyCurve = new THREE.SplineCurve(profile.slice(1, -1).map(([r, y]) => new THREE.Vector2(r, y)));
  const bodySamples = bodyCurve.getPoints(120).sort((a, b) => a.y - b.y);
  function bodyR(y) {
    for (let i = 1; i < bodySamples.length; i++) if (bodySamples[i].y >= y) {
      const a = bodySamples[i - 1], b = bodySamples[i];
      return THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / (b.y - a.y || 1));
    }
    return .1;
  }
  const hemAngle = y => -.95 + (y - .76) / .51 * 1.61;
  const chest = (y, a, lift = .004) => { const r = bodyR(y) + lift; return [r * Math.sin(a), y, -.018 + r * .61 * Math.cos(a)]; };
  if (!bodhi) {
    const pos = [], idx = [], ny = high ? 22 : 14, nx = high ? 24 : 14;
    for (let iy = 0; iy <= ny; iy++) {
      const y = .755 + iy / ny * .526, start = hemAngle(y);
      for (let ix = 0; ix <= nx; ix++) {
        const a = start + ix / nx * (Math.PI * 1.2 - start);
        const drape = .003 * Math.sin(iy / ny * Math.PI * 6 + ix / nx * 2) * Math.sin(ix / nx * Math.PI);
        pos.push(...chest(y, a, .005 + drape));
        if (iy < ny && ix < nx) { const k = iy * (nx + 1) + ix; idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
      }
    }
    const cloth = new THREE.BufferGeometry(); cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cloth.setIndex(idx); cloth.computeVertexNormals(); add(cloth, 'robe');
    const hem = Array.from({ length: 22 }, (_, i) => { const y = .77 + i / 21 * .511; return chest(y, hemAngle(y), .01); });
    tube(hem, .009, 'gold', high ? 32 : 18);
    for (let i = 0; i < 3; i++) {
      const ps = Array.from({ length: 18 }, (_, j) => { const y = .80 + j / 17 * (.4 - i * .031); return chest(y, hemAngle(y) + .20 + i * .25 + .13 * Math.sin((y - .8) / .4 * Math.PI), .009); });
      tube(ps, .0045, 'gold', high ? 22 : 14, 5);
    }
  }
  // 목의 삼도는 목 표면에 반쯤 잠긴 가는 능선이다.
  ell([0, 1.322, -.012], [.098, .114, .082]);
  for (let i = 0; i < 3; i++) {
    const y = 1.309 + i * .023;
    tube([[-.067, y + .006, .047], [-.038, y, .067], [0, y - .003, .075], [.038, y, .067], [.067, y + .006, .047]], .0020, 'robe', 16, 4);
  }

  function lapHand(s = 1) {
    limb([[s * .28, 1.20, -.004], [s * .375, 1.03, .025], [s * .34, .862, .14], [s * .19, .79, .25], [s * .07, .791, .272]], [.078, .085, .068, .045, .036], bodhi ? 'gold' : 'robe', .86);
    ell([s * .025, .791, .28], [.083, .026, .056], 'gold', [0, 0, s * -.04]);
    if (high) {
      for (let i = 0; i < 4; i++) limb([[s * -.018, .796, .245 + i * .023], [s * -.062, .802, .245 + i * .023], [s * -.091, .814, .245 + i * .022]], [.012, .011, .008], 'gold', .9);
      limb([[s * .066, .805, .321], [s * .015, .82, .337], [s * -.012, .819, .325]], [.016, .013, .009], 'gold');
    }
  }
  if (!bodhi) {
    lapHand(1);
    limb([[-.285, 1.202, -.013], [-.357, 1.07, .014], [-.387, .88, .129], [-.467, .699, .265], [-.478, .626, .298]], [.078, .082, .065, .046, .034], 'gold', .91);
    ell([-.48, .594, .313], [.052, .064, .026], 'gold', [0, 0, .07]);
    if (high) {
      for (let i = 0; i < 4; i++) {
        const x = -.516 + i * .023, y = .446 + Math.abs(i - 1.2) * .011;
        limb([[x, .577, .32], [x - .002, .527, .331], [x + .002, y, .314]], [.012, .011, .008], 'gold', .85);
      }
      limb([[-.441, .621, .319], [-.414, .588, .326], [-.422, .552, .33]], [.017, .014, .009], 'gold');
    } else ell([-.482, .529, .32], [.043, .088, .018]);
  } else {
    lapHand(-side);
    limb([[side * .282, 1.205, -.01], [side * .367, 1.022, .039], [side * .398, .899, .126], [side * .412, 1.042, .208]], [.075, .078, .059, .034], 'gold', .86);
    ell([side * .419, 1.07, .216], [.039, .057, .031]);
    if (high) for (let i = 0; i < 4; i++) limb([[side * .405, 1.045 + i * .018, .237], [side * .448, 1.052 + i * .018, .245], [side * .46, 1.06 + i * .017, .222]], [.011, .01, .008]);
    limb([[side * .395, 1.103, .227], [side * .424, 1.12, .246], [side * .444, 1.105, .233]], [.014, .012, .008]);
    tube([[side * .46, .82, .216], [side * .445, 1.07, .225], [side * .49, 1.31, .146], [side * .464, 1.485, .098]], .009, 'recess', 28, 6);
    // 보살의 연봉오리는 조각에 붙은 작은 앙련이다.
    ell([side * .463, 1.526, .098], [.047, .084, .043], 'gold');
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      tube([[side * .464 + .022 * Math.cos(a), 1.451, .098 + .022 * Math.sin(a)], [side * .464 + .046 * Math.cos(a), 1.52, .098 + .046 * Math.sin(a)], [side * .464, 1.606, .098]], .0045, 'robe', 14, 4);
    }
    tube([[side * .477, 1.20, .18], [side * .567, 1.26, .17], [side * .561, 1.335, .15]], .01, 'gold', 16, 5);
  }


  // 얼굴: 눈두덩·콧등·볼·턱을 동일한 표면에서 변위시킨다.
  const fy = 1.522, fz = .007, rx = .161, ry = .199, rz = .128;
  const gaussian = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
  function facial(x, y) {
    let d = .0;
    for (const s of [-1, 1]) {
      d += .016 * gaussian(x, y, s * .082, -.037, .048, .055); // 볼
      d -= .009 * gaussian(x, y, s * .064, .035, .037, .021); // 눈확
      d += .010 * gaussian(x, y, s * .063, .067, .048, .017); // 눈썹뼈
    }
    d += .032 * gaussian(x, y, 0, .028, .017, .065); // 반듯한 콧등
    d += .032 * gaussian(x, y, 0, -.016, .027, .025);
    d += .012 * gaussian(x, y, -.022, -.024, .014, .014) + .012 * gaussian(x, y, .022, -.024, .014, .014); // 코끝
    d += .010 * gaussian(x, y, 0, -.084, .048, .035);
    d += .005 * gaussian(x, y, 0, -.073, .03, .006) + .006 * gaussian(x, y, 0, -.084, .028, .007); // 입 주위
    d += .012 * gaussian(x, y, 0, -.143, .05, .03); // 둥근 턱
    return d;
  }
  function faceZ(x, y) {
    const width = rx * (y < -.035 ? 1 - .08 * (-y - .035) / .164 : 1);
    return fz + rz * Math.sqrt(Math.max(0, 1 - (x / width) ** 2 - (y / ry) ** 2)) + facial(x, y);
  }
  const face = new THREE.SphereGeometry(1, high ? (bodhi ? 40 : 48) : 28, high ? (bodhi ? 28 : 36) : 18);
  const fp = face.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const y = fp.getY(i) * ry;
    const x = fp.getX(i) * rx * (y < -.035 ? 1 - .08 * (-y - .035) / .164 : 1);
    const front = THREE.MathUtils.smoothstep(fp.getZ(i), .1, .8);
    fp.setXYZ(i, x, fy + y, fz + fp.getZ(i) * rz + facial(x, y) * front);
  }
  face.computeVertexNormals(); add(face);
  for (const s of [-1, 1]) {
    ell([s * .164, fy - .009, -.002], [.033, .088, .032], 'gold', [0, 0, s * -.08]);
    ell([s * .171, fy - .077, .001], [.023, .042, .022], 'gold');
    tube([[s * .173, fy + .048, .026], [s * .184, fy + .021, .028], [s * .179, fy - .026, .03], [s * .17, fy - .057, .024]], .007, 'robe', 16, 5);
    tube([[s * .163, fy + .033, .027], [s * .169, fy + .008, .036], [s * .163, fy - .02, .03]], .0055, 'gold', 12, 5);
    // 눈동자 없는 반개안: 위 눈꺼풀의 그림자와 그 위의 얇은 능선.
    const lid = [];
    const ridge = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = s * (.029 + .078 * t);
      const y = .032 + .003 * t - .005 * Math.sin(t * Math.PI);
      lid.push([x, fy + y, faceZ(x, y) + .0015]);
      ridge.push([x, fy + y + .006, faceZ(x, y + .006) + .002]);
    }
    tube(lid, .0012, 'recess', high ? 22 : 12, 4);
    tube(ridge, .0024, 'gold', high ? 22 : 12, 5);
    // 눈썹은 얼굴의 변위된 눈썹뼈로만 표현한다.
    
    ell([s * .017, fy - .030, faceZ(s * .017, -.030) - .001], [.004, .0015, .002], 'recess', [0, 0, 0], 10, 6);
  }
  // 입꼬리를 조금만 올린 작고 도톰한 입술.
  const mouth = [];
  for (let i = 0; i <= 16; i++) {
    const x = -.031 + i / 16 * .062, t = x / .031;
    const y = -.078 + .003 * t * t;
    const z = faceZ(x, y);
    mouth.push([x, fy + y, z + .003]);
  }
  tube(mouth, .0010, 'recess', 18, 4);
  ell([0, fy + .085, faceZ(0, .085) + .003], [.0067, .0077, .005], 'gold', [0, 0, 0], 12, 8);


  // 나발을 머리의 법선에 붙여 깨끗한 곡선의 헤어라인을 만든다.
  const scalp = (t, a, lift = 0) => {
    const th = t * (1.40 - .39 * Math.sin(a));
    return [-(.164 + lift) * Math.cos(a) * Math.sin(th), fy + (.217 + lift) * Math.cos(th), fz + (.138 + lift) * Math.sin(a) * Math.sin(th)];
  };
  const cap = new THREE.SphereGeometry(1, high ? (bodhi ? 24 : 32) : 20, high ? (bodhi ? 12 : 14) : 9, 0, TAU, 0, Math.PI / 2);
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const t = Math.acos(THREE.MathUtils.clamp(cp.getY(i), -1, 1)) / (Math.PI / 2);
    const a = Math.atan2(cp.getZ(i), -cp.getX(i)); cp.setXYZ(i, ...scalp(t, a));
  }
  cap.computeVertexNormals(); add(cap, 'hair');
  if (!bodhi) {
    const rows = high ? 8 : 4;
    for (let row = 1; row <= rows; row++) {
      const t = row / rows, n = Math.round((high ? 8 : 4) + (high ? 25 : 22) * t);
      for (let i = 0; i < n; i++) {
        const a = (i + (row % 2) * .5) * TAU / n, p = scalp(t, a, .003);
        ell(p, [high ? .011 : .013, high ? .009 : .011, high ? .011 : .013], 'hair', [0, 0, 0], high ? 6 : 5, high ? 4 : 3);
      }
    }
    ell([0, 1.748, -.003], [.078, .064, .071], 'hair');
    for (let row = 0; row < (high ? 4 : 3); row++) {
      const a = .2 + row * .40, n = high ? 6 + row * 5 : 4 + row * 3;
      for (let i = 0; i < n; i++) { const b = (i + row * .5) * TAU / n; ell([.075 * Math.sin(a) * Math.cos(b), 1.748 + .063 * Math.cos(a), -.003 + .068 * Math.sin(a) * Math.sin(b)], [.011, .009, .011], 'hair', [0, 0, 0], high ? 6 : 5, high ? 4 : 3); }
    }
    ell([0, 1.817, -.003], [.013, .014, .013], 'gold', [0, 0, 0], 12, 8);
  } else {
    ell([0, 1.755, -.027], [.075, .098, .065], 'hair');
    for (const s of [-1, 1]) {
      limb([[s * .14, 1.63, -.055], [s * .173, 1.475, -.063], [s * .19, 1.32, -.045], [s * .266, 1.232, .028]], [.026, .023, .022, .013], 'hair');
      tube([[s * .153, 1.596, -.032], [s * .182, 1.43, -.026], [s * .212, 1.294, .01]], .0045, 'gold', 22, 5);
      ell([s * .169, 1.406, .013], [.017, .028, .012], 'gold', [0, 0, 0], 12, 8);
    }
    for (const y of [1.655, 1.69]) {
      const ps = Array.from({ length: 40 }, (_, i) => [Math.cos(i * TAU / 40) * .151, y, Math.sin(i * TAU / 40) * .132]);
      tube(ps, .012, 'gold', high ? 32 : 16, high ? 5 : 4, true);
    }
    for (let i = -2; i <= 2; i++) {
      const a = i * .48, x = Math.sin(a) * .149, z = Math.cos(a) * .133;
      ell([x, 1.716 + (2 - Math.abs(i)) * .015, z], [.035, .055 + (2 - Math.abs(i)) * .013, .012], 'gold', [0, a, -i * .16], 12, 8);
      ell([x, 1.723 + (2 - Math.abs(i)) * .014, z + .013], [.014, .023, .009], 'jewel', [0, a, 0], 10, 6);
    }
    const necklace = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, x = -.188 + t * .376; necklace.push([x, 1.208 - .138 * Math.sin(t * Math.PI), .116 + .05 * Math.sin(t * Math.PI)]); }
    tube(necklace, .006, 'gold', 28, 5);
    const beadCount = high ? 13 : 9;
    for (let i = 0; i < beadCount; i++) { const p = necklace[Math.round(i * 24 / (beadCount - 1))]; ell(p, [.011, .014, .009], 'gold', [0, 0, 0], 6, 4); }
    ell([0, 1.047, .174], [.025, .033, .011], 'gold'); ell([0, 1.048, .185], [.014, .022, .007], 'jewel', [0, 0, 0], 12, 8);
    // 천의: 양 어깨에서 흘러 팔 바깥으로 휘감기는 폭 있는 띠.
    for (const s of [-1, 1]) {
      const path = [[s * .15, 1.277, -.043], [s * .29, 1.245, .03], [s * .345, 1.12, .061], [s * .394, .937, .10], [s * .503, .76, .083], [s * .51, .58, .03], [s * .36, .476, .166]];
      const curve = new THREE.CatmullRomCurve3(path.map(p => V(...p)));
      const n = high ? 20 : 10, pos = [], indices = [], edges = [[], []];
      for (let i = 0; i <= n; i++) {
        const p = curve.getPoint(i / n), width = .025 + .013 * Math.sin(i / n * Math.PI);
        for (let j = 0; j <= 4; j++) {
          const v = (j / 4 * 2 - 1), q = [p.x + v * width, p.y, p.z + .008 * (1 - v * v)];
          pos.push(...q); if (j === 0 || j === 4) edges[j === 0 ? 0 : 1].push(q);
          if (i < n && j < 4) { const k = i * 5 + j; indices.push(k, k + 5, k + 1, k + 1, k + 5, k + 6); }
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(indices); g.computeVertexNormals(); add(g, 'robe');
      for (const edge of edges) tube(edge, .003, 'gold', n, 3);
    }
  }


  // 광배: 뚫린 주형 테두리 + 머리 원광. 모든 장식은 0.06 깊이 안의 부조다.
  const outline = new THREE.Shape();
  outline.moveTo(0, 1.965);
  outline.bezierCurveTo(.14, 1.77, .57, 1.54, .647, 1.14);
  outline.bezierCurveTo(.727, .76, .425, .419, 0, .379);
  outline.bezierCurveTo(-.425, .419, -.727, .76, -.647, 1.14);
  outline.bezierCurveTo(-.57, 1.54, -.14, 1.77, 0, 1.965);
  const outer = outline.getPoints(high ? 28 : 16);
  const inner = new THREE.Path();
  outer.slice().reverse().forEach((p, i) => { const x = p.x * .902, y = 1.15 + (p.y - 1.15) * .91; if (i) inner.lineTo(x, y); else inner.moveTo(x, y); }); inner.closePath(); outline.holes.push(inner);
  const plate = new THREE.ExtrudeGeometry(outline, { depth: .018, bevelEnabled: true, bevelThickness: .003, bevelSize: .003, bevelSegments: 1, curveSegments: high ? 10 : 6 });
  add(plate, 'robe', [0, 0, -.343]);
  for (const scale of [1, .905]) tube(outer.map(p => [p.x * scale, 1.15 + (p.y - 1.15) * (scale === 1 ? 1 : .914), -.315]), .0055, 'gold', high ? (bodhi ? 64 : 96) : 48, high && !bodhi ? 5 : 4, true);
  // 광배의 화염은 얇은 잎 모양 부조이며, 지붕 높이를 넘지 않게 옆면에만 배치한다.
  const flame = new THREE.Shape();
  flame.moveTo(0, 0); flame.bezierCurveTo(-.022, .023, -.021, .05, .015, .076);
  flame.bezierCurveTo(.003, .046, .032, .028, 0, 0);
  const fg = new THREE.ExtrudeGeometry(flame, { depth: .009, bevelEnabled: false, steps: 1, curveSegments: high ? 4 : 3 });
  const samples = outline.getSpacedPoints(high ? (bodhi ? 28 : 44) : (bodhi ? 20 : 28));
  for (let i = 2; i < samples.length - 2; i += bodhi ? 2 : 1) {
    const p = samples[i]; if (p.y > 1.86 || p.y < .48) continue;
    const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    add(fg.clone(), 'gold', [p.x, p.y, -.326], [1, bodhi ? .7 : 1, 1], [0, 0, angle]);
  }
  fg.dispose();
  const haloY = 1.50, haloZ = -.306;
  // 원광의 낮은 돔은 조각 얼굴의 여백을 만들며 테두리만 밝게 빛난다.
  const disc = new THREE.CircleGeometry(.306, high ? 64 : 40);
  add(disc, 'recess', [0, haloY, -.324]);
  ring(.311, .311, haloY, haloZ, .009);
  ring(.274, .274, haloY, haloZ, .0045);
  if (!bodhi) ring(.245, .245, haloY, haloZ, .0032, 'gold');
  const nr = high ? (bodhi ? 12 : 16) : (bodhi ? 8 : 12);
  for (let i = 0; i < nr; i++) {
    const a = i * TAU / nr;
    const ps = [[0, .189], [-.026, .234], [0, .268], [.026, .234], [0, .189]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), haloY + x * Math.sin(a) + y * Math.cos(a), haloZ + .001]);
    tube(ps, .0032, 'gold', high ? (bodhi ? 12 : 16) : 10, 3);
  }
  if (!bodhi && high) for (const s of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const cy = .70 + j * .2, cx = s * (.39 + .07 * Math.sin(j));
      const ps = Array.from({ length: 30 }, (_, i) => { const t = i / 29, a = t * Math.PI * 2.1, r = .064 * (1 - .8 * t); return [cx + s * Math.cos(a) * r, cy + Math.sin(a) * r, -.312]; });
      tube(ps, .0042, 'gold', high ? 28 : 16, 5);
    }
  }


  for (const [name, geometries] of Object.entries(batches)) {
    if (!geometries.length) { materials[name].dispose(); continue; }
    const g = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!g) throw new Error(`Buddha geometry merge failed: ${name}`);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[name]);
    mesh.name = `${group.name} / ${name}`;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  for (const t of templates.values()) t.dispose();
  let disposed = false;
  group.userData.buildTime = { environmentMs, geometryMs: now() - started - environmentMs };
  group.userData.variant = bodhi ? 'bodhisattva' : 'buddha';
  group.userData.quality = high ? 'high' : 'low';
  group.userData.setEnvIntensity = v => {
    if (!Number.isFinite(v) || v < 0) return;
    for (const mesh of group.children) mesh.material.envMapIntensity = v;
  };
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const mesh of group.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
    group.clear();
  };
  return group;
}
