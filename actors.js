import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Every instance owns its rig, but shares all rigid-part geometry and face maps.
// Idle Mongi/monk: 8 draws; a held object + an emote still fit the 10/12 budget.
const PI = Math.PI, TAU = PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const C = { skin: '#f7dcc0', scalp: '#e9d6c3', robe: '#c3c0b6', shroud: '#ece6d6', shoe: '#f5f0e5', monk: '#9b988f', sash: '#8a4a32' };
const libraries = new Map();

function library(quality = 'high') {
  if (libraries.has(quality)) { const s = libraries.get(quality); s.refs++; return s; }
  const s = { refs: 1, geometries: new Set(), materials: new Set(), textures: new Set(), cache: new Map(), quality };
  libraries.set(quality, s);
  s.geom = g => (s.geometries.add(g), g);
  s.mat = m => (s.materials.add(m), m);
  s.tex = t => (s.textures.add(t), t);
  s.solid = s.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88 }));
  s.wood = s.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .58 }));
  const cloth = document.createElement('canvas'); cloth.width = cloth.height = 128;
  const cc = cloth.getContext('2d'); cc.fillStyle = '#fffdf4'; cc.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    cc.fillStyle = i % 8 ? '#ece6d9' : '#f2eddf'; cc.fillRect(i, 0, 1, 128); cc.fillRect(0, i, 128, 1);
  }
  const weave = s.tex(new THREE.CanvasTexture(cloth)); weave.colorSpace = THREE.SRGBColorSpace;
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(3, 3);
  s.cloth = s.mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: weave, roughness: 1 }));
  s.faces = {};
  for (const name of ['normal', 'happy', 'closed', 'sleepy', 'monk', 'cat', 'catClosed', 'catDark', 'catDarkClosed', 'catTux', 'catTuxClosed']) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 384;
    const c = cv.getContext('2d'); c.lineCap = 'round'; c.lineJoin = 'round';
    const cat = name.startsWith('cat'), dark = /^cat(Dark|Tux)/.test(name), tux = name.startsWith('catTux'), eyeY = cat ? 190 : 230;
    c.fillStyle = dark ? 'rgba(242,161,153,.3)' : 'rgba(242,161,153,.55)';
    for (const x of [114, 398]) { c.beginPath(); c.ellipse(x, 268, 38, 22, 0, 0, TAU); c.fill(); }
    c.strokeStyle = dark ? '#eadfd3' : '#3a2927'; c.lineWidth = 12; c.fillStyle = '#272321';
    for (const x of [165, 347]) {
      c.beginPath();
      if (name === 'normal' || name === 'cat' || name === 'catDark' || name === 'catTux') {
        if (dark) { c.fillStyle = '#e0c45c'; c.ellipse(x, eyeY, 22, 31, 0, 0, TAU); c.fill(); c.fillStyle = '#272321'; c.beginPath(); c.ellipse(x, eyeY + 2, 9, 25, 0, 0, TAU); c.fill(); }
        else { c.ellipse(x, eyeY, cat ? 20 : 27, cat ? 31 : 37, 0, 0, TAU); c.fill(); }
        c.fillStyle = '#fffdf6'; c.beginPath(); c.ellipse(x - 7, eyeY - 13, 9, 11, -.25, 0, TAU); c.fill();
        c.beginPath(); c.arc(x + 8, eyeY + 12, 4, 0, TAU); c.fill(); c.fillStyle = '#272321';
      } else if (name === 'happy' || name === 'monk') {
        c.moveTo(x - 25, eyeY + 6); c.quadraticCurveTo(x, eyeY - 29, x + 25, eyeY + 6); c.stroke();
      } else if (name === 'sleepy') {
        c.ellipse(x, eyeY + 9, 23, 11, 0, 0, PI); c.fill(); c.moveTo(x - 27, eyeY + 4); c.lineTo(x + 25, eyeY + 4); c.stroke();
      } else { c.moveTo(x - 25, eyeY); c.quadraticCurveTo(x, eyeY + 15, x + 25, eyeY); c.stroke(); }
    }
    c.strokeStyle = dark && !tux ? '#dccdbf' : '#9b5a4a'; c.lineWidth = 8; c.beginPath();
    if (cat) {
      c.fillStyle = '#be7973'; c.moveTo(245, 230); c.lineTo(267, 230); c.lineTo(256, 242); c.closePath(); c.fill();
      c.moveTo(256, 242); c.quadraticCurveTo(240, 265, 230, 247); c.moveTo(256, 242); c.quadraticCurveTo(272, 265, 282, 247);
      if (dark) { c.stroke(); c.beginPath(); c.strokeStyle = '#e8ded3'; }
      for (const side of [-1, 1]) for (let j = 0; j < 3; j++) { c.moveTo(256 + side * 70, 250 + j * 13); c.lineTo(256 + side * 130, 240 + j * 19); }
    } else { c.moveTo(240, 291); c.quadraticCurveTo(256, name === 'happy' ? 316 : 307, 272, 291); }
    c.stroke();
    const tex = s.tex(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace;
    s.faces[name] = s.mat(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: .12, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  s.emotes = {};
  for (const kind of ['heart', 'sparkle', 'note', 'zzz']) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
    c.fillStyle = kind === 'heart' ? '#f3a4ad' : '#fff0b6'; c.strokeStyle = c.fillStyle; c.lineWidth = 8; c.lineCap = 'round';
    if (kind === 'heart') { c.beginPath(); c.moveTo(64, 108); c.bezierCurveTo(2, 68, 8, 18, 40, 26); c.quadraticCurveTo(58, 28, 64, 44); c.bezierCurveTo(87, -5, 153, 38, 64, 108); c.fill(); }
    if (kind === 'sparkle') { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * PI / 4 - PI / 2, r = i % 2 ? 14 : 53; c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } c.closePath(); c.fill(); }
    if (kind === 'note') { c.beginPath(); c.ellipse(46, 96, 21, 15, -.3, 0, TAU); c.fill(); c.beginPath(); c.moveTo(65, 92); c.lineTo(65, 20); c.lineTo(102, 34); c.stroke(); }
    if (kind === 'zzz') { for (let i = 0; i < 3; i++) { const x = 14 + i * 29, y = 89 - i * 28, d = 17 + i * 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x + d, y + d); c.stroke(); } }
    const tex = s.tex(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; s.emotes[kind] = tex;
  }
  s.release = () => {
    if (--s.refs > 0) return;
    for (const g of s.geometries) g.dispose(); for (const m of s.materials) m.dispose(); for (const t of s.textures) t.dispose();
    s.cache.clear(); libraries.delete(quality);
  };
  return s;
}

const sphere = (r, s = 20) => new THREE.SphereGeometry(r, s, Math.max(10, s / 2));
const part = (g, color, p = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) => ({ g, color, p, scale, rot });
function join(s, parts, grain = false) {
  const list = parts.map(p => {
    let g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); p.g.dispose();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot)), new THREE.Vector3(...p.scale)));
    const a = g.getAttribute('position'), fn = typeof p.color === 'function', col = new THREE.Color(fn ? '#fff' : p.color), colors = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      if (fn) col.set(p.color(a.getX(i), a.getY(i), a.getZ(i)));
      const k = grain ? .82 + .18 * Math.sin(a.getY(i) * 110 + 4 * Math.sin(a.getX(i) * 19 + a.getZ(i) * 9)) : 1;
      colors.set([col.r * k, col.g * k, col.b * k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
  });
  const out = mergeGeometries(list, false); list.forEach(g => g.dispose()); return s.geom(out);
}
function cached(s, key, fn) { if (!s.cache.has(key)) s.cache.set(key, fn()); return s.cache.get(key); }
function mesh(g, m, parent) { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; parent?.add(o); return o; }
function faceGeometry(s, r, sy = .95) {
  return cached(s, `face${r}`, () => {
    const p = [], uv = [], indices = [], nx = 24, ny = 18;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const a = (i / nx - .5) * 1.65, b = (.5 - j / ny) * 1.17 - .12;
      p.push(Math.sin(a) * Math.cos(b) * (r + .002), Math.sin(b) * (r + .002) * sy, Math.cos(a) * Math.cos(b) * (r + .002)); uv.push(i / nx, 1 - j / ny);
      if (i < nx && j < ny) { const k = j * (nx + 1) + i; indices.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return s.geom(g);
  });
}
function humanParts(s, monk) {
  return cached(s, monk ? 'monkParts' : 'mongiParts', () => {
    const r = monk ? .215 : .33, seg = s.quality === 'low' ? 16 : 28;
    const head = join(s, [part(sphere(r, seg), C.skin, [0, 0, 0], [1, .95, 1]), part(sphere(monk ? .043 : .06, 12), C.skin, [-r * .96, -.025, 0], [.72, 1, .8]), part(sphere(monk ? .043 : .06, 12), C.skin, [r * .96, -.025, 0], [.72, 1, .8]), part(new THREE.SphereGeometry(r + .0008, seg, 12, 0, TAU, 0, .61), C.scalp, [0, 0, 0], [1, .95, 1])]);
    const bottom = monk ? -.34 : -.12, top = monk ? .59 : .36, radius = monk ? .25 : .27;
    const lathe = () => new THREE.LatheGeometry([new THREE.Vector2(0, bottom), new THREE.Vector2(radius * .82, bottom), new THREE.Vector2(radius, bottom + .05), new THREE.Vector2(radius * .91, bottom + .22), new THREE.Vector2(radius * .72, top - .06), new THREE.Vector2(radius * .48, top), new THREE.Vector2(0, top)], 24);
    const body = join(s, [part(lathe(), monk ? C.monk : C.robe)]), shroud = join(s, [part(lathe(), C.shroud)]);
    let vest;
    if (monk) {
      const sash = front => {
        const pos = [], uv = [], indices = [], profile = [[-.34,.205],[-.29,.25],[-.12,.2275],[.53,.18],[.59,.12]];
        for (let j = 0; j <= 16; j++) for (let i = 0; i <= 4; i++) {
          const y = -.30 + j / 16 * .86, x = .105 - j / 16 * .21 + (i / 4 - .5) * .145;
          let radius = .2; for (let k = 1; k < profile.length; k++) if (y <= profile[k][0]) { radius = THREE.MathUtils.lerp(profile[k - 1][1], profile[k][1], (y - profile[k - 1][0]) / (profile[k][0] - profile[k - 1][0])); break; }
          pos.push(x, y, front * (Math.sqrt(Math.max(.001, radius * radius - x * x)) + .012)); uv.push(i / 4, j / 16);
          if (j < 16 && i < 4) { const k = j * 5 + i; if (front > 0) indices.push(k,k+1,k+5,k+1,k+6,k+5); else indices.push(k,k+5,k+1,k+1,k+5,k+6); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2)); g.setIndex(indices); g.computeVertexNormals(); return g;
      };
      vest = join(s, [part(sash(1), C.sash), part(sash(-1), C.sash), part(new THREE.TorusGeometry(.212, .013, 6, 28), C.sash, [0, .13, 0], [1, 1, 1], [PI / 2, 0, 0])]);
    } else {
      // Match the robe's profile with a real gap: otherwise breathing/shadows
      // expose intersecting triangles at the shoulders and lower hem.
      const points = [new THREE.Vector2(.2374, -.12), new THREE.Vector2(.286, -.07), new THREE.Vector2(.2617, .10), new THREE.Vector2(.2104, .30), new THREE.Vector2(.1456, .36)];
      const g = new THREE.LatheGeometry(points, 28, .2, TAU - .4); vest = join(s, [part(g, '#ffffff')]);
    }
    const len = monk ? .4 : .245, legLen = monk ? .5 : .28;
    const arm = color => join(s, [part(new THREE.CapsuleGeometry(monk ? .085 : .073, len * .49, 4, 12), color, [0, -len * .40, 0]), part(sphere(monk ? .063 : .065, 14), C.skin, [0, -len, .008], [1, 1.07, .91]), part(sphere(.035, 10), C.skin, [.041, -len + .018, .035])]);
    const leg = color => join(s, [part(new THREE.CapsuleGeometry(monk ? .064 : .069, legLen * .45, 4, 12), color, [0, -legLen * .43, 0]), part(sphere(.08, 16), C.shoe, [0, -legLen + .047, .039], [1, .59, 1.40]), part(sphere(.047, 12), C.shoe, [0, -legLen + .06, .105], [1.35, .8, 1])]);
    const armGeometry = arm(monk ? C.monk : C.robe);
    const stick = join(s, [part(new THREE.CylinderGeometry(.009, .009, .25, 8), '#b18450', [0, -len - .05, -.025], [1, 1, 1], [PI / 2, 0, 0]), part(sphere(.026, 12), '#bc8c55', [0, -len - .05, -.15])]);
    const armWithStick = s.geom(mergeGeometries([armGeometry, stick], false));
    return { head, body, shroud, vest, arm: armGeometry, armWithStick, shroudArm: arm(C.shroud), leg: leg(monk ? C.monk : C.robe), shroudLeg: leg(C.shroud), r, len, legLen };
  });
}

function propGeometry(s, kind) {
  return cached(s, `prop:${kind}`, () => {
    const list = [];
    if (kind === 'broom') {
      list.push(part(new THREE.CylinderGeometry(.013, .016, .79, 8), '#90724b', [0, -.02, 0]));
      for (let i = 0; i < 11; i++) list.push(part(new THREE.ConeGeometry(.014, .30, 5), i % 2 ? '#b89a64' : '#967c4f', [(i - 5) * .018, -.52, 0], [1, 1, 1], [PI, 0, (i - 5) * .025]));
      list.push(part(new THREE.TorusGeometry(.045, .008, 5, 12), '#5c4732', [0, -.38, 0], [1, 1, 1], [PI / 2, 0, 0]));
    } else if (kind === 'cup') {
      list.push(part(new THREE.CylinderGeometry(.065, .05, .085, 18), '#d3d5bb', [0, .015, 0]), part(new THREE.CircleGeometry(.054, 18), '#88713d', [0, .059, 0], [1, 1, 1], [-PI / 2, 0, 0]), part(new THREE.TorusGeometry(.059, .008, 6, 20), '#e5e2c8', [0, .061, 0], [1, 1, 1], [PI / 2, 0, 0]));
    } else if (kind === 'incense') {
      for (let i = -1; i <= 1; i++) { list.push(part(new THREE.CylinderGeometry(.003, .003, .28, 5), '#795c3d', [i * .012, .1, 0])); list.push(part(sphere(.0045, 6), '#ffb35d', [i * .012, .24, 0])); }
    } else if (kind === 'letter') {
      list.push(part(new THREE.BoxGeometry(.16, .22, .003), '#f3e9cf', [0, .07, 0]));
    } else if (kind === 'moktak') {
      list.push(part(sphere(.12, 16), '#af6a33', [0, .03, .03], [1, .82, .86]), part(new THREE.TorusGeometry(.065, .018, 6, 16), '#965325', [0, .135, .01]), part(new THREE.BoxGeometry(.16, .007, .015), '#482c1b', [0, .02, .125]));
    }
    return list.length ? join(s, list) : null;
  });
}

const DURATIONS = { bow: 4.8, gassho: 1.6, hop: .5, nod: .6, sip: 1.8, pet: 1.5, pull: 1.2, incense: 2, toss: .8, sitUp: 1.2, wave: 1 };
function state(y) { return { y, z: 0, x: 0, yaw: 0, roll: 0, lean: 0, head: 0, az: 0, fz: 0, fy: 0, la: 0, ra: 0, lz: -.10, rz: .10, ly: 0, ry: 0, ll: 0, rl: 0, llz: 0, rlz: 0 }; }
function mix(a, b, t) { const o = {}; for (const k of Object.keys(a)) o[k] = THREE.MathUtils.lerp(a[k], b[k], t); return o; }
function keys(frames, t) { for (let i = 1; i < frames.length; i++) if (t <= frames[i][0]) return mix(frames[i - 1][1], frames[i][1], smooth((t - frames[i - 1][0]) / (frames[i][0] - frames[i - 1][0]))); return frames.at(-1)[1]; }

function human({ vest = '#e59a52', quality = 'high', role = null } = {}) {
  const s = library(quality), monk = !!role, p = humanParts(s, monk), root = new THREE.Group(), figure = new THREE.Group(), torso = new THREE.Group();
  root.name = monk ? `산사 식구:${role}` : '몽이'; root.add(figure); figure.add(torso);
  const hip = p.legLen, sitY = monk ? .34 : .12, headY = monk ? .795 : .58;
  const body = mesh(p.body, s.solid, torso);
  const vestMat = monk ? s.solid : new THREE.MeshStandardMaterial({ color: vest, roughness: .88, side: THREE.DoubleSide });
  const vestMesh = mesh(p.vest, vestMat, torso); vestMesh.visible = role !== 'novice';
  const head = new THREE.Group(); head.position.y = headY; torso.add(head); mesh(p.head, s.solid, head);
  const face = mesh(faceGeometry(s, p.r), s.faces[monk ? 'monk' : 'normal'], head); face.castShadow = false;
  const arms = [], legs = [], sleeves = [], trousers = [];
  for (const sign of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(sign * (monk ? .225 : .265), monk ? .47 : .265, 0); torso.add(a); arms.push(a); sleeves.push(mesh(p.arm, s.solid, a));
    const l = new THREE.Group(); l.position.set(sign * .105, 0, 0); figure.add(l); legs.push(l); trousers.push(mesh(p.leg, s.solid, l));
  }
  const hand = new THREE.Group(); hand.position.set(0, -p.len, .045); arms[1].add(hand);
  const leftHand = new THREE.Group(); leftHand.position.set(0, -p.len, .045); arms[0].add(leftHand);
  let held = null, heldMesh = null, outfit = 'robe', pose = 'idle', speed = 1, phase = 0, t = 0, expression = monk ? 'monk' : 'normal', blinkAt = 3 + Math.random() * 2, blinkEnd = -1, step = () => {}, clip = null, disposed = false;
  let shown = state(hip), blendFrom = shown, blendTime = .25, initialHop = 1;
  const emoteMat = new THREE.SpriteMaterial({ map: s.emotes.heart, transparent: true, depthWrite: false, toneMapped: false });
  const emoji = new THREE.Sprite(emoteMat); emoji.visible = false; emoji.scale.setScalar(.25); root.add(emoji); let emoteTime = 4;
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const v = new THREE.Vector3();
  function poseState(name) {
    const a = state(hip);
    if (name === 'walk' || name === 'prayWalk') {
      const f = Math.sin(phase), moving = Math.min(1, speed * 2);
      a.y += .04 * Math.abs(f) * moving + (initialHop < .3 ? .035 * Math.sin(initialHop / .3 * PI) : 0);
      a.roll = Math.sin(phase) * PI / 30 * moving; a.ll = f * .55 * moving; a.rl = -a.ll; a.la = -a.ll * .7; a.ra = -a.rl * .7;
    }
    if (name === 'sit' || name === 'zen') { a.y = sitY; a.ll = a.rl = -1.12; a.llz = 1.03; a.rlz = -1.03; a.fz = .12; a.fy = monk ? -.20 : 0; a.az = .10; a.la = a.ra = -.92; a.lz = monk ? .40 : .55; a.rz = -a.lz; }
    if (name === 'zen') { a.la = a.ra = -1.05; a.lz = monk ? .44 : .8; a.rz = -a.lz; }
    if (name === 'prayWalk') { a.az = .10; a.la = a.ra = -1.35; a.lz = monk ? .44 : .85; a.rz = -a.lz; }
    if (name === 'lie') { a.y = 0; a.z = -(monk ? .16 : .12); a.x = -PI / 2; a.yaw = PI; a.az = .10; a.la = a.ra = -.95; a.lz = monk ? .40 : .77; a.rz = -a.lz; }
    if (name === 'sweep') { a.lean = .18; a.ra = -1.05; a.la = -.55; a.rz = .3 + .4 * Math.sin(t * 2.7); a.roll = Math.sin(t * 2.7) * .055; }
    if (name === 'moktak') { Object.assign(a, poseState('zen')); a.la = -1.15; a.lz = .40; a.ra = -1.9 + .40 * Math.cos(t * TAU * 1.2); a.rz = -.55; }
    return a;
  }
  function actionState(c) {
    const f = clamp(c.time / c.duration, 0, 1), base = poseState(c.base), a = { ...base }, pulse = Math.sin(f * PI);
    const pray = { ...state(hip), az: .10, la: -1.35, ra: -1.35, lz: monk ? .44 : .85, rz: monk ? -.44 : -.85, head: .12 };
    if (c.name === 'bow') {
      const kneel = { ...pray, y: monk ? .35 : .17, ll: 1.08, rl: 1.08, head: .2 };
      const down = { ...kneel, y: monk ? .34 : .20, az: 0, lean: 70 * PI / 180, la: -1.9, ra: -1.9, lz: .35, rz: -.35, head: .15 };
      return keys([[0, base], [.13, pray], [.29, kneel], [.48, down], [.60, { ...down, ly: PI, ry: -PI }], [.70, down], [.83, kneel], [.94, pray], [1, base]], f);
    }
    if (c.name === 'gassho') return keys([[0, base], [.25, { ...pray, y: base.y, fz: base.fz, fy: base.fy, ll: base.ll, rl: base.rl, llz: base.llz, rlz: base.rlz }], [.62, { ...pray, y: base.y, fz: base.fz, fy: base.fy, lean: .18, head: .2, ll: base.ll, rl: base.rl, llz: base.llz, rlz: base.rlz }], [1, base]], f);
    if (c.name === 'hop') { a.y += .21 * pulse; a.la -= .5 * pulse; a.ra -= .5 * pulse; }
    if (c.name === 'nod') a.head += .28 * pulse;
    if (c.name === 'sip') { a.az = .10 * pulse; a.ra = THREE.MathUtils.lerp(base.ra, -2.3, pulse); a.rz = -.45 * pulse; a.head = .13 * pulse; }
    if (c.name === 'pet') { a.lean = .5 * pulse; a.ra = -1.1 * pulse + .12 * Math.sin(f * TAU * 3) * pulse; a.head = .2 * pulse; }
    if (c.name === 'pull') { a.la = a.ra = -2.6 * pulse; a.lean = -.16 * pulse; a.lz = .4 * pulse; a.rz = -.4 * pulse; }
    if (c.name === 'incense') { a.lean = .45 * pulse; a.ra = -1.4 * pulse; a.head = .23 * pulse; }
    if (c.name === 'toss') { a.ra = keys([[0, { r: 0 }], [.35, { r: .65 }], [.64, { r: -2.05 }], [1, { r: 0 }]], f).r; a.lean = -.08 * pulse; }
    if (c.name === 'sitUp') return mix(poseState('lie'), poseState('sit'), smooth(f));
    if (c.name === 'wave') { a.ra = -2.6 * pulse; a.rz = -.65 * pulse + Math.sin(f * TAU * 3) * .23 * pulse; }
    return a;
  }
  const api = {
    root, height: monk ? 1.50 : 1.174,
    setPose(name) {
      if (!['idle', 'walk', 'sit', 'lie', 'sweep', 'prayWalk', 'moktak', 'zen'].includes(name) || name === pose) return;
      if (clip) { clip.resolve(false); clip = null; }
      blendFrom = { ...shown }; blendTime = 0; if ((name === 'walk' || name === 'prayWalk') && pose !== 'walk' && pose !== 'prayWalk') initialHop = 0;
      pose = name; if (name === 'moktak') api.hold('moktak'); if (name === 'sweep') api.hold('broom');
    },
    play(name) {
      if (!DURATIONS[name] || disposed) return Promise.resolve();
      if (clip) clip.resolve(false);
      if (name === 'sip') api.hold('cup'); if (name === 'incense') api.hold('incense');
      if (name === 'gassho' || name === 'pet') api.setExpression('happy');
      blendFrom = { ...shown }; blendTime = 0;
      return new Promise(resolve => { clip = { name, duration: DURATIONS[name], time: 0, base: pose, resolve }; });
    },
    setSpeed(value) { speed = Number.isFinite(value) ? Math.max(0, value) : 0; },
    onStep(cb) { step = typeof cb === 'function' ? cb : () => {}; },
    setExpression(e) { if (s.faces[e]) expression = e; },
    emote(kind) { if (!s.emotes[kind]) return; emoteMat.map = s.emotes[kind]; emoteMat.needsUpdate = true; emoteTime = 0; emoji.visible = true; },
    get held() { return held; },
    hold(item) {
      if (item === held) return;
      if (heldMesh) { heldMesh.removeFromParent(); heldMesh = null; } held = item;
      sleeves[1].geometry = outfit === 'shroud' ? p.shroudArm : p.arm;
      if (!['broom', 'cup', 'incense', 'letter', 'moktak'].includes(item)) { held = null; return; }
      heldMesh = mesh(propGeometry(s, item), s.solid, item === 'moktak' ? leftHand : hand);
      if (item === 'moktak') sleeves[1].geometry = p.armWithStick;
    },
    setVest(hex) { if (!monk) vestMat.color.set(hex); },
    setOutfit(o) {
      const shroud = o === 'shroud'; outfit = shroud ? 'shroud' : 'robe'; body.geometry = shroud ? p.shroud : p.body; body.material = shroud ? s.cloth : s.solid;
      vestMesh.visible = !shroud && role !== 'novice';
      sleeves.forEach(m => { m.geometry = shroud ? p.shroudArm : p.arm; m.material = shroud ? s.cloth : s.solid; });
      trousers.forEach(m => { m.geometry = shroud ? p.shroudLeg : p.leg; m.material = shroud ? s.cloth : s.solid; });
      if (held === 'moktak') sleeves[1].geometry = p.armWithStick;
    },
    headPos(target = new THREE.Vector3()) { root.updateWorldMatrix(true, true); return head.getWorldPosition(target); },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return; t += dt; initialHop += dt; blendTime += dt;
      const oldPhase = phase; if ((pose === 'walk' || pose === 'prayWalk') && !clip) {
        phase += dt * speed / (.72 * root.scale.x) * TAU; /* 줄인 몸은 보폭도 작게 */
        for (let i = Math.floor(oldPhase / PI) + 1, end = Math.floor(phase / PI); i <= end; i++) step(i % 2 ? 'L' : 'R');
      }
      if (t >= blinkAt) { blinkEnd = t + .12; blinkAt = t + 3 + Math.random() * 2; }
      face.material = s.faces[t < blinkEnd ? 'closed' : expression];
      if (clip) clip.time += dt;
      const target = clip ? actionState(clip) : poseState(pose);
      shown = blendTime < .25 ? mix(blendFrom, target, smooth(blendTime / .25)) : target;
      // Quaternion interpolation keeps the supine transition smooth, including its 180° turn.
      const applyQ = a => q.setFromEuler(new THREE.Euler(a.x, a.yaw, a.roll, 'YXZ'));
      if (blendTime < .25) { qa.copy(applyQ(blendFrom)); qb.copy(applyQ(target)); figure.quaternion.slerpQuaternions(qa, qb, smooth(blendTime / .25)); } else figure.quaternion.copy(applyQ(shown));
      figure.position.set(0, shown.y, shown.z); torso.rotation.x = shown.lean; torso.scale.y = 1 + .02 * Math.sin(t * TAU * .25);
      head.rotation.x = shown.head;
      arms[0].rotation.set(shown.la, shown.ly, shown.lz); arms[1].rotation.set(shown.ra, shown.ry, shown.rz);
      arms.forEach((arm, i) => { arm.position.z = shown.az; arm.position.x = (i ? 1 : -1) * ((monk ? .225 : .265) - shown.az * .4); });
      legs[0].rotation.set(shown.ll, 0, shown.llz); legs[1].rotation.set(shown.rl, 0, shown.rlz);
      legs[0].position.z = legs[1].position.z = shown.fz;
      legs[0].position.y = legs[1].position.y = shown.fy;
      if (held === 'cup' || held === 'incense') hand.rotation.x = -shown.ra; else hand.rotation.x = 0;
      leftHand.rotation.x = held === 'moktak' ? -shown.la : 0;
      if (clip && clip.time >= clip.duration) { const done = clip; clip = null; if (done.name === 'sitUp') pose = 'sit'; blendFrom = { ...shown }; blendTime = 0; done.resolve(true); }
      emoteTime += dt;
      if (emoteTime < 2.3) { api.headPos(v); root.worldToLocal(v); emoji.position.copy(v).add(new THREE.Vector3(Math.sin(emoteTime * 3) * .035, p.r + .15 + emoteTime * .15, 0)); emoteMat.opacity = Math.sin(PI * emoteTime / 2.3); } else emoji.visible = false;
    },
    dispose() { if (disposed) return; disposed = true; clip?.resolve(false); root.removeFromParent(); emoteMat.dispose(); if (!monk) vestMat.dispose(); root.clear(); s.release(); }
  };
  if (role === 'novice') api.hold('broom');
  api.update(0); return api;
}

export function createMongi(options = {}) { return human(options); }
export function createMonk({ role } = {}) { return human({ role: ['abbot', 'tea', 'guide', 'novice'].includes(role) ? role : 'abbot' }); }

const COATS = {
  orange: { fur: '#f0b46a', belly: '#fff1d5', stripe: '#c98140', muzzle: '#fff2dd', ear: '#e4a29a', paw: '#fff0d4', tip: '#f9dfaf' },
  red: { fur: '#e79a55', belly: '#fff0d8', stripe: '#b8692f', muzzle: '#fff3e2', ear: '#e4a29a', paw: '#fff0d8', tip: '#f6d3a6' },
  cream: { fur: '#f3d29a', belly: '#fff6e6', stripe: '#e2b675', muzzle: '#fff8ec', ear: '#eaaa9f', paw: '#fff6e6', tip: '#fbe8c6' },
  black: { fur: '#2f2b2c', belly: '#3a3536', muzzle: '#3d3839', ear: '#7a5553', paw: '#2f2b2c', tip: '#2f2b2c', face: 'catDark' },
  tuxedo: { fur: '#2f2b2c', belly: '#fbf7f0', muzzle: '#fbf7f0', ear: '#7a5553', paw: '#fbf7f0', tip: '#fbf7f0', face: 'catTux' },
  calico: { fur: (x, y, z) => z < -.12 && x < -.02 && y > .2 ? '#e9a25a' : x > .04 && z < -.2 && y > .18 ? '#3a3434' : '#fbf6ee', head: (x, y) => y > .07 ? (x < 0 ? '#e9a25a' : '#3a3434') : '#fbf6ee', belly: '#fffaf3', muzzle: '#fffaf3', ear: '#efb2aa', paw: '#fffaf3', tip: '#3a3434', tail: '#e9a25a', leg: '#fbf6ee' },
  mackerel: { fur: '#9a9a94', belly: '#ece9e2', stripe: '#5e5f5a', muzzle: '#f1eee8', ear: '#dba39c', paw: '#ece9e2', tip: '#5e5f5a' },
  white: { fur: '#f7f3ec', belly: '#fffaf3', muzzle: '#fffaf3', ear: '#efb2aa', paw: '#fffaf3', tip: '#f7f3ec' },
  brown: { fur: '#a77b52', belly: '#f1e1c8', stripe: '#6e4b2f', muzzle: '#f1e1c8', ear: '#d99a8e', paw: '#f1e1c8', tip: '#6e4b2f' },
  point: { fur: '#f1e4cf', belly: '#fbf3e6', muzzle: '#d9bfa3', ear: '#d29b98', earOuter: '#5b4336', paw: '#5b4336', tip: '#5b4336', tail: '#5b4336', leg: '#5b4336' },
  blue: { fur: '#8c95a0', belly: '#aab2bb', muzzle: '#b5bcc4', ear: '#d29b98', paw: '#9aa3ad', tip: '#8c95a0' },
  mandu: { fur: (x, y, z) => y > .3 && z < -.05 && z > -.3 ? '#f0cf98' : '#fbf7f0', head: '#fbf7f0', belly: '#fffaf3', muzzle: '#fffaf3', ear: '#efb2aa', paw: '#fffaf3', tip: '#f0cf98', tail: '#f0cf98', leg: '#fbf7f0' },
};
export function createCat({ coat = 'orange', name = '보리', seed = 0 } = {}) {
  const s = library(), root = new THREE.Group(), bodyRig = new THREE.Group(), headRig = new THREE.Group(), tailRig = new THREE.Group(), C = COATS[coat] || COATS.orange, F = C.face || 'cat';
  root.name = '산사 식구:' + name; root.add(bodyRig); bodyRig.add(headRig, tailRig);
  const p = cached(s, 'catParts:' + (COATS[coat] ? coat : 'orange'), () => {
    const fur = C.fur, head = C.head || fur, tc = C.tail || fur;
    const body = join(s, [part(sphere(.22, 20), fur, [0, .24, -.045], [1, 1, 1.65]), part(sphere(.17, 16), C.belly, [0, .17, .04], [.88, .85, 1.4]), ...(C.stripe ? [-.19, -.05, .10].map(z => part(new THREE.TorusGeometry(.208, .014, 5, 16, PI), C.stripe, [0, .24, z], [1, 1, 1], [0, 0, 0])) : [])]);
    const hp = [part(sphere(.195, 24), head, [0, 0, 0], [1.1, .93, .91]), part(sphere(.13, 16), C.muzzle, [0, -.065, .095], [1.2, .65, .65])];
    for (const sign of [-1, 1]) { hp.push(part(new THREE.ConeGeometry(.086, .16, 3), C.earOuter || head, [sign * .135, .17, -.01], [1, 1, .6], [0, 0, -sign * .26])); hp.push(part(new THREE.ConeGeometry(.049, .095, 3), C.ear, [sign * .136, .182, .032], [1, 1, .3], [0, 0, -sign * .26])); }
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .10, -.18), new THREE.Vector3(.03, .32, -.30), new THREE.Vector3(.10, .39, -.24)]);
    const tail = join(s, [part(new THREE.TubeGeometry(tailCurve, 16, .042, 8, false), tc), part(sphere(.045, 10), C.tip, [.10, .39, -.24])]);
    const curled = new THREE.CatmullRomCurve3([[0,0,0],[.22,.02,-.05],[.32,.03,.20],[.18,.03,.43],[-.04,.03,.42]].map(p => new THREE.Vector3(...p)));
    const sleepTail = join(s, [part(new THREE.TubeGeometry(curled, 24, .042, 8, false), tc), part(sphere(.044, 10), C.tip, [-.04,.03,.42])]);
    return { body, head: join(s, hp), tail, sleepTail, leg: join(s, [part(new THREE.CapsuleGeometry(.05, .12, 4, 10), C.leg || fur, [0, -.07, 0]), part(sphere(.06, 12), C.paw, [0, -.15, .025], [1, .75, 1.2])]) };
  });
  const casters = [mesh(p.body, s.solid, bodyRig), mesh(p.head, s.solid, headRig)]; const face = mesh(faceGeometry(s, .196, .93), s.faces[F], headRig); face.castShadow = false; const tail = mesh(p.tail, s.solid, tailRig);
  const legs = [];
  for (const z of [-.22, .15]) for (const x of [-.13, .13]) { const leg = mesh(p.leg, s.solid, bodyRig); leg.position.set(x, .2, z); legs.push(leg); }
  casters.push(tail, ...legs);
  let pose = 'idle', oldPose = 'idle', blend = 1, speed = 1, t = Number(seed) || 0, clip = null, disposed = false;
  function configuration(name) {
    if (name === 'sleep') return { y: -.01, sx: 1.17, sy: .72, sz: .94, hx: -.12, hy: .25, hz: .12, hr: -.4, ry: 1.1, tx: 0, ty: .15, tz: -.26 };
    if (name === 'loaf') return { y: -.01, sx: 1.04, sy: .78, sz: 1, hx: 0, hy: .34, hz: .22, hr: .05, ry: 0, tx: 0, ty: .2, tz: -.3 };
    if (name === 'sit') return { y: 0, sx: .95, sy: 1.08, sz: .8, hx: 0, hy: .48, hz: .13, hr: 0, ry: 0, tx: 0, ty: .18, tz: -.25 };
    return { y: 0, sx: 1, sy: 1, sz: 1, hx: 0, hy: .40, hz: .24, hr: 0, ry: 0, tx: 0, ty: .26, tz: -.31 };
  }
  const api = { root, height: .74,
    setPose(name) { if (['idle', 'walk', 'sit', 'loaf', 'sleep'].includes(name) && pose !== name) { oldPose = pose; pose = name; blend = 0; } },
    play(name) { if (!['meow', 'stretch', 'purr'].includes(name) || disposed) return Promise.resolve(); clip?.resolve(); return new Promise(resolve => { clip = { name, t: 0, d: name === 'stretch' ? 2 : 1.3, resolve }; }); },
    setSpeed(value) { speed = Number.isFinite(value) ? Math.max(0, value) : 0; },
    shadow(on) { for (const m of casters) m.castShadow = !!on; },
    headPos(target = new THREE.Vector3()) { root.updateWorldMatrix(true, true); return headRig.getWorldPosition(target); },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return; t += dt; blend = Math.min(1, blend + dt / .25);
      const c = mix(configuration(oldPose), configuration(pose), smooth(blend));
      bodyRig.position.y = c.y; bodyRig.scale.set(c.sx, c.sy * (1 + .015 * Math.sin(t * 2)), c.sz);
      headRig.position.set(c.hx, c.hy, c.hz); headRig.rotation.set(c.hr, c.ry, 0); tailRig.position.set(c.tx, c.ty, c.tz);
      tail.geometry = pose === 'sleep' ? p.sleepTail : p.tail;
      tailRig.rotation.set(0, Math.sin(t * (pose === 'sleep' ? 1.3 : 2.5)) * (pose === 'sleep' ? .06 : .25), (pose === 'sleep' ? .03 : .13) * Math.sin(t * 1.7));
      face.material = s.faces[pose === 'sleep' || t % 4.1 < .12 ? F + 'Closed' : F];
      legs.forEach((l, i) => { l.visible = pose !== 'loaf' && pose !== 'sleep'; l.rotation.x = pose === 'walk' ? Math.sin(t * speed * 10 / root.scale.x + (i === 0 || i === 3 ? 0 : PI)) * .55 : 0; });
      if (clip) { clip.t += dt; const f = Math.min(1, clip.t / clip.d), a = Math.sin(f * PI); if (clip.name === 'stretch') { bodyRig.scale.z *= 1 + .25 * a; headRig.position.y -= .13 * a; tailRig.rotation.x -= .6 * a; } if (clip.name === 'meow') headRig.rotation.x -= .22 * a; if (clip.name === 'purr') { headRig.rotation.z = Math.sin(t * 22) * .017 * a; face.material = s.faces[F + 'Closed']; } if (f >= 1) { clip.resolve(); clip = null; } }
    },
    dispose() { if (disposed) return; disposed = true; clip?.resolve(); root.removeFromParent(); root.clear(); s.release(); }
  }; api.update(0); return api;
}

export function createMoktak() {
  const s = library(), root = new THREE.Group(), drum = new THREE.Group(), hammer = new THREE.Group(); root.add(drum, hammer);
  const p = cached(s, 'largeMoktak', () => {
    const seam = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => { const x = -.43 + i / 24 * .86; return new THREE.Vector3(x, -.045 + .06 * (x * x / .185), Math.sqrt(Math.max(0, .26 - x * x)) * .86 + .012); }));
    return { body: join(s, [part(sphere(.52, 36), '#b47b43', [0, 0, 0], [1, .82, .88]), part(new THREE.TorusGeometry(.23, .067, 10, 32), '#a86e3b', [0, .44, -.08], [1, 1.04, 1]), part(new THREE.TubeGeometry(seam, 24, .018, 7, false), '#39231a'), part(sphere(.024, 10), '#543622', [-.18, .10, .421]), part(sphere(.024, 10), '#543622', [.18, .10, .421])], true), striker: join(s, [part(new THREE.CylinderGeometry(.025, .03, .78, 10), '#b8814c', [0, -.36, 0]), part(sphere(.10, 18), '#c79762', [0, -.76, 0])], true) };
  });
  mesh(p.body, s.wood, drum); mesh(p.striker, s.wood, hammer); hammer.position.set(.72, .72, .65); hammer.rotation.z = -.7;
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const ring = mesh(cached(s, 'moktakRing', () => s.geom(new THREE.RingGeometry(.52, .535, 64))), ringMat, root); ring.position.z = .49; ring.visible = false; ring.castShadow = false;
  let clock = 9, disposed = false;
  return { root,
    strike() { clock = 0; ring.visible = true; },
    update(dt) { if (disposed) return; clock += Math.max(0, dt); const hit = Math.exp(-clock * 12) * Math.sin(clock * 31); drum.scale.set(1 + hit * .045, 1 - hit * .10, 1 + hit * .04); hammer.rotation.z = -.7 - .34 * Math.exp(-clock * 10); hammer.rotation.x = .3 * Math.exp(-clock * 10); ring.scale.setScalar(1 + clock * 2.2); ringMat.opacity = Math.max(0, 1 - clock / .7) * .6; ring.visible = clock < .7; },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); root.clear(); ringMat.dispose(); s.release(); }
  };
}

export function createBeads() {
  // 108 beads + guru on a ring seen from the side: the near strand runs straight down the middle of the
  // view, so "pull down" moves beads the way the finger goes. 110 slots: the guru bead takes two.
  const s = library(), R = 1, SLOTS = 110, step = TAU / SLOTS, tiltY = 1.15;
  const root = new THREE.Group(), tilt = new THREE.Group(), wheel = new THREE.Group();
  root.add(tilt); tilt.add(wheel); tilt.rotation.y = tiltY;
  root.position.set(R * Math.cos(tiltY), 0, -R * Math.sin(tiltY)); // the counting point sits on the origin
  const p = cached(s, 'beads', () => {
    const tassel = [part(sphere(.03, 14), '#8a5a33', [0, -.07, 0])];
    for (let i = 0; i < 13; i++) tassel.push(part(new THREE.CylinderGeometry(.0035, .006, .2 + (i % 3) * .02, 5), i % 2 ? '#c4a16a' : '#a56c3c', [(i - 6) * .0065, -.19 - (i % 3) * .01, .006 * Math.sin(i * 1.7)], [1, 1, 1], [0, 0, (i - 6) * .03]));
    return { bead: join(s, [part(sphere(.0272, 14), '#bc8750')], true), guru: join(s, [part(sphere(.05, 20), '#9b6438')], true), tassel: join(s, tassel, true), cord: join(s, [part(new THREE.TorusGeometry(R, .0045, 5, 220), '#805c39')]) };
  });
  const beads = new THREE.InstancedMesh(p.bead, s.wood, 108), dummy = new THREE.Object3D(), base = [];
  const white = new THREE.Color(1, 1, 1), warm = new THREE.Color(1.6, 1.28, .82), big = new THREE.Matrix4().makeScale(1.25, 1.25, 1.25), tmp = new THREE.Matrix4();
  beads.castShadow = true; wheel.add(beads);
  for (let i = 0; i < 108; i++) {
    const a = (i + 1.5) * step; // bead i sits on slot i+1.5; the guru owns slots -1..1
    dummy.position.set(-R * Math.cos(a), R * Math.sin(a), 0); dummy.rotation.set(i * .73, i * .31, a); dummy.updateMatrix();
    base.push(dummy.matrix.clone()); beads.setMatrixAt(i, dummy.matrix); beads.setColorAt(i, white);
  }
  mesh(p.guru, s.wood, wheel).position.set(-R, 0, 0); mesh(p.cord, s.wood, wheel);
  const tassel = mesh(p.tassel, s.wood, tilt); // hangs straight down from the guru wherever it is
  // cursor walks 109 stops per round (0 = guru, 1..108 = beads); counting always lands on a bead.
  let cursor = 0, pos = 0, target = 0, lit = -1, disposed = false;
  const slotOf = c => { const r = Math.floor(c / 109), j = c - r * 109; return r * SLOTS + (j ? j + .5 : 0); };
  const light = i => {
    if (i === lit) return;
    if (lit >= 0) { beads.setMatrixAt(lit, base[lit]); beads.setColorAt(lit, white); }
    lit = i; if (i >= 0) { beads.setMatrixAt(i, tmp.copy(base[i]).multiply(big)); beads.setColorAt(i, warm); }
    beads.instanceMatrix.needsUpdate = true; beads.instanceColor.needsUpdate = true;
  };
  return { root, view: { pos: [0, .28, 1.3], at: [0, -.03, 0] },
    get index() { const j = ((cursor % 109) + 109) % 109; return j ? j - 1 : -1; },
    advance(dir = 1) {
      if (disposed) return; const d = dir < 0 ? -1 : 1;
      cursor += d; if (((cursor % 109) + 109) % 109 === 0) cursor += d;
      target = slotOf(cursor); if (Math.abs(target - pos) > 4) pos = target - Math.sign(target - pos) * 4; // a fast flurry never lags far behind
    },
    update(dt) {
      if (disposed) return;
      pos += (target - pos) * (1 - Math.exp(-Math.max(0, dt) * 16)); if (Math.abs(target - pos) < 1e-3) pos = target;
      const rho = pos * step; wheel.rotation.z = rho; tassel.position.set(-R * Math.cos(rho), -R * Math.sin(rho), 0);
      const m = ((pos % SLOTS) + SLOTS) % SLOTS; light(m < 1 || m >= 109 ? -1 : Math.min(108, Math.max(1, Math.round(m - .5))) - 1);
    },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); beads.dispose(); root.clear(); s.release(); }
  };
}
