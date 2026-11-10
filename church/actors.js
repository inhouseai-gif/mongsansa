import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Every instance owns its rig, but shares all rigid-part geometry and face maps.
// Idle Mongi/monk: 8 draws; a held object + an emote still fit the 10/12 budget.
const PI = Math.PI, TAU = PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const C = { skin: '#f7dcc0', scalp: '#433029', robe: '#f1e5cd', shroud: '#faf8f1', shoe: '#f5f0e5', monk: '#334963', sash: '#334963' };
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
function humanParts(s, monk, role) {
  return cached(s, monk ? 'monkParts:' + role : 'mongiParts', () => {
    const r = monk ? .215 : .33, seg = s.quality === 'low' ? 16 : 28;
    const palette = {
      abbot: { hair: '#92918d', shirt: '#f8f5ed', coat: '#334963', pants: '#343b46' },
      tea: { hair: '#aaa6a1', shirt: '#f4e9d9', coat: '#b97b85', pants: '#645763' },
      guide: { hair: '#29272a', shirt: '#64856b', coat: '#4d6e58', pants: '#c6b492' },
      novice: { hair: '#29272a', shirt: '#a7a9ad', coat: '#8d9096', pants: '#506e91' }
    }[role] || { hair: C.scalp, shirt: C.robe, coat: '#ffffff', pants: C.robe };
    const hp = [part(sphere(r, seg), C.skin, [0, 0, 0], [1, .95, 1]),
      ...[-1, 1].map(sign => part(sphere(monk ? .043 : .06, 12), C.skin, [sign * r * .96, -.025, 0], [.72, 1, .8])),
      part(new THREE.SphereGeometry(r + .015, seg, 12, 0, TAU, 0, 1.28), palette.hair, [0, .006, 0], [1, .97, 1]),
      part(new THREE.SphereGeometry(r + .014, seg, 12, PI, PI, 1.05, monk ? .57 : .94), palette.hair, [0, 0, 0], [1, .98, 1])];
    for (const sign of [-1, 1]) hp.push(part(sphere(monk ? .065 : .105, 12), palette.hair, [sign * r * .86, monk ? .06 : -.01, -.015], [.60, monk ? 1.3 : 1.65, 1.3]));
    // The fringe and back cap leave the eyes clear, including on Mongi's bob.
    for (let i = -1; i <= 1; i++) hp.push(part(sphere(monk ? .073 : .11, 12), palette.hair, [i * r * .40, r * .66 - i * .013, r * .61], [1.1, .55, .55], [0, 0, -.18]));
    if (role === 'tea') for (let i = 0; i < 18; i++) {
      const a = i * TAU / 9, y = i < 9 ? .13 : .20, rr = i < 9 ? .17 : .10;
      hp.push(part(sphere(.054, 10), i % 3 ? palette.hair : '#bcb8b2', [Math.cos(a) * rr, y, Math.sin(a) * rr], [1, .9, 1]));
    }
    if (role === 'abbot' || role === 'guide') {
      for (const sign of [-1, 1]) {
        hp.push(part(new THREE.TorusGeometry(.061, .006, 6, 20), '#554c43', [sign * .079, -.025, .209]));
        hp.push(part(new THREE.BoxGeometry(.008, .008, .15), '#554c43', [sign * .143, -.025, .136], [1, 1, 1], [0, sign * .25, 0]));
      }
      hp.push(part(new THREE.BoxGeometry(.038, .007, .008), '#554c43', [0, -.02, .215]));
    }
    const head = join(s, hp);
    const bottom = monk ? -.08 : -.12, top = monk ? .59 : .36, radius = monk ? .21 : .27;
    const profile = [[0, bottom], [radius * .82, bottom], [radius, bottom + .05], [radius * .91, bottom + .22], [radius * .86, top - .06], [radius * .48, top], [0, top]];
    const lathe = () => new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 24);
    const bodyParts = () => {
      const list = [part(lathe(), palette.shirt)];
      if (role === 'abbot') for (const sign of [-1, 1]) list.push(part(new THREE.BoxGeometry(.065, .10, .016), '#fffdf7', [sign * .04, .52, .129], [1, 1, 1], [0, 0, sign * .32]));
      if (role === 'novice') {
        list.push(part(sphere(.17, 16), palette.coat, [0, .48, -.13], [1, .85, .65]), part(new THREE.BoxGeometry(.18, .10, .018), palette.coat, [0, .12, .201]));
        for (const sign of [-1, 1]) list.push(part(new THREE.CylinderGeometry(.007, .007, .14, 6), '#e5e2dc', [sign * .05, .40, .18]));
      }
      return list;
    };
    const skirt = mode => mode === 'floor'
      ? part(sphere(.27, 20), palette.pants, [0, -.005, .12], [1.35, .28, 1.15])
      : mode === 'chair'
        ? part(sphere(.25, 20), palette.pants, [0, -.05, .18], [1.03, .40, 1.35])
        : part(new THREE.CylinderGeometry(.17, .29, .43, 24), palette.pants, [0, -.205, 0]);
    const body = join(s, [...bodyParts(), ...(role === 'tea' ? [skirt('stand')] : [])]);
    const bodyFloor = role === 'tea' ? join(s, [...bodyParts(), skirt('floor')]) : body;
    const bodyChair = role === 'tea' ? join(s, [...bodyParts(), skirt('chair')]) : body;
    const shroud = join(s, [part(lathe(), C.shroud)]);
    let vest;
    if (!monk || role === 'abbot' || role === 'tea') {
      const points = profile.slice(1, -1).map(([x, y]) => new THREE.Vector2(x + .014, y));
      vest = join(s, [part(new THREE.LatheGeometry(points, 28, .24, TAU - .48), palette.coat)]);
    } else {
      vest = join(s, [part(new THREE.TorusGeometry(.105, .015, 6, 20), palette.coat, [0, top - .006, 0], [1, 1, 1], [PI / 2, 0, 0])]);
    }
    const len = monk ? .4 : .245, legLen = monk ? .5 : .28;
    const arm = color => join(s, [part(new THREE.CapsuleGeometry(monk ? .085 : .073, len * .49, 4, 12), color, [0, -len * .40, 0]), part(sphere(monk ? .063 : .065, 14), C.skin, [0, -len, .008], [1, 1.07, .91]), part(sphere(.035, 10), C.skin, [.041, -len + .018, .035])]);
    const leg = color => {
      const calf = new THREE.CapsuleGeometry(monk ? .064 : .069, legLen * .45, 4, 12), calfCount = calf.index.count;
      const g = join(s, [part(calf, color, [0, -legLen * .43, 0]), part(sphere(.08, 16), C.shoe, [0, -legLen + .047, .039], [1, .59, 1.40]), part(sphere(.047, 12), C.shoe, [0, -legLen + .06, .105], [1.35, .8, 1])]);
      // Blend a bent knee and backward shin into the same mesh: no extra draw.
      const bent = g.clone(), points = bent.getAttribute('position'), knee = legLen * .4;
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
        if (i >= calfCount) points.setXYZ(i, -x, y + legLen - knee, -z - legLen * .43);
        else if (y < -knee) points.setXYZ(i, x, -knee - z, y + knee);
      }
      bent.computeVertexNormals();
      g.morphAttributes.position = [points]; g.morphAttributes.normal = [bent.getAttribute('normal')]; bent.dispose();
      return g;
    };
    const armGeometry = arm(monk && (role === 'abbot' || role === 'tea') ? palette.coat : palette.shirt);
    return { head, body, bodyFloor, bodyChair, shroud, vest, arm: armGeometry, shroudArm: arm(C.shroud), leg: leg(palette.pants), shroudLeg: leg(C.shroud), r, len, legLen, bottom };
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
      list.push(part(new THREE.CylinderGeometry(.016, .017, .28, 12), '#fff0cf', [0, .10, 0]),
        part(new THREE.CylinderGeometry(.002, .002, .025, 6), '#4e3e30', [0, .247, 0]),
        part(sphere(.017, 10), '#ffb84c', [0, .279, 0], [.65, 1.9, .65]),
        part(sphere(.009, 8), '#fff6c5', [0, .271, .008], [.7, 1.5, .7]));
    } else if (kind === 'letter') {
      list.push(part(new THREE.BoxGeometry(.16, .22, .003), '#f3e9cf', [0, .07, 0]));
    } else if (kind === 'moktak') {
      list.push(part(new THREE.CylinderGeometry(.022, .025, .16, 10), '#8f623c', [0, .035, 0]),
        part(new THREE.CylinderGeometry(.036, .10, .14, 20, 1, true), '#c5a35a', [0, -.11, 0]),
        part(new THREE.TorusGeometry(.098, .009, 6, 20), '#e0be74', [0, -.18, 0], [1, 1, 1], [PI / 2, 0, 0]),
        part(sphere(.022, 12), '#755a32', [0, -.183, 0]));
    }
    return list.length ? join(s, list) : null;
  });
}

const DURATIONS = { bow: 4.8, gassho: 1.6, hop: .5, nod: .6, sip: 1.8, pet: 1.5, pull: 1.2, incense: 2, toss: .8, sitUp: 1.2, wave: 1 };
function state(y) { return { y, z: 0, x: 0, yaw: 0, roll: 0, lean: 0, head: 0, az: 0, fz: 0, fy: 0, la: 0, ra: 0, lz: -.10, rz: .10, ly: 0, ry: 0, ll: 0, rl: 0, llz: 0, rlz: 0, knee: 0 }; }
function mix(a, b, t) { const o = {}; for (const k of Object.keys(a)) o[k] = THREE.MathUtils.lerp(a[k], b[k], t); return o; }
function keys(frames, t) { for (let i = 1; i < frames.length; i++) if (t <= frames[i][0]) return mix(frames[i - 1][1], frames[i][1], smooth((t - frames[i - 1][0]) / (frames[i][0] - frames[i - 1][0]))); return frames.at(-1)[1]; }

function human({ vest = '#e59a52', quality = 'high', role = null } = {}) {
  const s = library(quality), monk = !!role, p = humanParts(s, monk, role), root = new THREE.Group(), figure = new THREE.Group(), torso = new THREE.Group();
  root.name = monk ? `교회 식구:${role}` : '몽이'; root.add(figure); figure.add(torso);
  const hip = p.legLen, sitY = -p.bottom, headY = monk ? .795 : .58;
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
  let held = null, heldMesh = null, outfit = 'robe', pose = 'idle', speed = 1, phase = 0, t = 0, expression = monk ? 'monk' : 'normal', blinkAt = 3 + Math.random() * 2, blinkEnd = -1, step = () => {}, clip = null, disposed = false, seatHeight = 0;
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
    if (name === 'sit' || name === 'zen') {
      a.y = sitY; a.ll = a.rl = -1.12; a.llz = 1.03; a.rlz = -1.03; a.fz = .12; a.fy = monk ? .06 : 0; a.az = .10; a.la = a.ra = -.92; a.lz = monk ? .40 : .55; a.rz = -a.lz;
      if (seatHeight >= .3) { a.ll = a.rl = -1.25; a.llz = a.rlz = 0; a.fz = .03; a.fy = 0; } // 바닥 앉기 a.fy: 산사판처럼 포갠 다리가 방석 위에 얹히게(가장 낮은 점 -.03)
    }
    if (name === 'zen') { a.la = a.ra = -1.48; a.lz = monk ? .46 : .85; a.rz = -a.lz; a.head = .12; }
    if (name === 'prayWalk') { a.az = .10; a.la = a.ra = -1.35; a.lz = monk ? .44 : .85; a.rz = -a.lz; }
    if (name === 'lie') { a.y = 0; a.z = -(monk ? .16 : .12); a.x = -PI / 2; a.yaw = PI; a.az = .10; a.la = a.ra = -.95; a.lz = monk ? .40 : .77; a.rz = -a.lz; }
    if (name === 'sweep') { a.lean = .18; a.ra = -1.05; a.la = -.55; a.rz = .3 + .4 * Math.sin(t * 2.7); a.roll = Math.sin(t * 2.7) * .055; }
    if (name === 'moktak') { Object.assign(a, poseState('zen')); a.la = -1.15; a.lz = .40; a.ra = -1.05; a.rz = -.35; }
    return a;
  }
  function actionState(c) {
    const f = clamp(c.time / c.duration, 0, 1), base = poseState(c.base), a = { ...base }, pulse = Math.sin(f * PI);
    const pray = { ...state(hip), az: .10, la: -1.65, ra: -1.65, lz: monk ? .46 : .85, rz: monk ? -.46 : -.85, head: .12 };
    if (c.name === 'bow') {
      const kneel = { ...pray, y: p.legLen * .4 + .075, knee: 1, head: .18, lean: .12 };
      const down = { ...kneel, la: -1.9, ra: -1.9, head: .20, lean: .12 };
      return keys([[0, base], [.13, pray], [.29, pray], [.48, down], [.83, down], [1, base]], f);
    }
    if (c.name === 'gassho') {
      const clasp = { ...base, az: pray.az, la: pray.la, ra: pray.ra, lz: pray.lz, rz: pray.rz, head: .10 };
      return keys([[0, base], [.25, clasp], [.62, { ...clasp, head: .24 }], [1, base]], f);
    }
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
    setSeat(h) {
      const next = Number.isFinite(h) ? h : 0;
      if (next === seatHeight) return; // NPC and route walkers call this every frame; only a real change re-applies the pose
      seatHeight = next;
      if (pose === 'sit' || pose === 'zen') { blendTime = .25; api.update(0); }
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
    },
    setVest(hex) { if (!monk) vestMat.color.set(hex); },
    setOutfit(o) {
      const shroud = o === 'shroud'; outfit = shroud ? 'shroud' : 'robe'; body.geometry = shroud ? p.shroud : p.body; body.material = shroud ? s.cloth : s.solid;
      vestMesh.visible = !shroud && role !== 'novice';
      sleeves.forEach(m => { m.geometry = shroud ? p.shroudArm : p.arm; m.material = shroud ? s.cloth : s.solid; });
      trousers.forEach(m => { m.geometry = shroud ? p.shroudLeg : p.leg; m.material = shroud ? s.cloth : s.solid; });
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
      if (role === 'tea' && outfit !== 'shroud') {
        const seated = pose === 'sit' || pose === 'zen' || pose === 'moktak';
        body.geometry = clip?.name === 'bow' ? p.bodyFloor : seated ? (seatHeight >= .3 ? p.bodyChair : p.bodyFloor) : p.body;
      }
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
      trousers.forEach(m => { m.morphTargetInfluences[0] = shown.knee; });
      if (held === 'cup' || held === 'incense') hand.rotation.x = -shown.ra; else hand.rotation.x = 0;
      leftHand.rotation.x = held === 'moktak' ? -shown.la : 0;
      leftHand.rotation.z = held === 'moktak' ? .30 * Math.sin(t * TAU * 1.2) : 0;
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
  root.name = '교회 식구:' + name; root.add(bodyRig); bodyRig.add(headRig, tailRig);
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
    return { body: join(s, [
      part(new THREE.CylinderGeometry(.065, .08, .43, 16), '#92653d', [0, .49, 0]),
      part(sphere(.085, 16), '#a67a4a', [0, .72, 0], [1, .65, 1]),
      part(new THREE.LatheGeometry([[.12, .28], [.15, .20], [.18, .08], [.26, -.10], [.40, -.27], [.43, -.30], [.40, -.33], [.37, -.28], [.23, -.08], [.15, .10], [.10, .25]].map(([x, y]) => new THREE.Vector2(x, y)), 36), '#c5a35a'),
      part(new THREE.TorusGeometry(.415, .022, 8, 36), '#e4c67e', [0, -.30, 0], [1, 1, 1], [PI / 2, 0, 0])]),
      striker: join(s, [part(new THREE.CylinderGeometry(.016, .016, .43, 10), '#80633a', [0, -.015, 0]), part(sphere(.067, 16), '#917342', [0, -.25, 0])]) };
  });
  root.name = '핸드벨';
  mesh(p.body, s.wood, drum); mesh(p.striker, s.wood, hammer); drum.add(hammer);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const ring = mesh(cached(s, 'moktakRing', () => s.geom(new THREE.RingGeometry(.52, .535, 64))), ringMat, root); ring.position.z = .49; ring.visible = false; ring.castShadow = false;
  let clock = 9, disposed = false;
  return { root,
    strike() { clock = 0; ring.visible = true; },
    update(dt) { if (disposed) return; clock += Math.max(0, dt); const hit = Math.exp(-clock * 5) * Math.sin(clock * 31); drum.rotation.z = hit * .26; hammer.rotation.z = -hit * .42; ring.scale.setScalar(1 + clock * 2.2); ringMat.opacity = Math.max(0, 1 - clock / .7) * .6; ring.visible = clock < .7; },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); root.clear(); ringMat.dispose(); s.release(); }
  };
}

export function createBeads() {
  // 33 beads + a wooden cross: 34 counting stops, 35 geometric slots.
  // The cross occupies two slots; advance skips it when counting beads.
  const s = library(), R = 1, SLOTS = 35, step = TAU / SLOTS, tiltY = 1.15;
  const root = new THREE.Group(), tilt = new THREE.Group(), wheel = new THREE.Group();
  root.add(tilt); tilt.add(wheel); tilt.rotation.y = tiltY;
  root.position.set(R * Math.cos(tiltY), 0, -R * Math.sin(tiltY)); // the counting point sits on the origin
  const p = cached(s, 'beads', () => {
    return { bead: join(s, [part(sphere(.055, 14), '#bc8750')], true),
      guru: join(s, [part(new THREE.BoxGeometry(.042, .25, .036), '#9b6438', [0, -.025, 0]), part(new THREE.BoxGeometry(.15, .040, .038), '#9b6438', [0, .035, 0])], true),
      cord: join(s, [part(new THREE.TorusGeometry(R, .0045, 5, 140), '#805c39')]) };
  });
  const beads = new THREE.InstancedMesh(p.bead, s.wood, 33), dummy = new THREE.Object3D(), base = [];
  const white = new THREE.Color(1, 1, 1), warm = new THREE.Color(1.6, 1.28, .82), big = new THREE.Matrix4().makeScale(1.25, 1.25, 1.25), tmp = new THREE.Matrix4();
  beads.castShadow = true; wheel.add(beads);
  for (let i = 0; i < 33; i++) {
    const a = (i + 1.5) * step; // bead i sits on slot i+1.5; the cross owns slots -1..1
    dummy.position.set(-R * Math.cos(a), R * Math.sin(a), 0); dummy.rotation.set(i * .73, i * .31, a); dummy.updateMatrix();
    base.push(dummy.matrix.clone()); beads.setMatrixAt(i, dummy.matrix); beads.setColorAt(i, white);
  }
  mesh(p.cord, s.wood, wheel);
  const tassel = mesh(p.guru, s.wood, tilt); // The cross stays upright while travelling around the loop.
  tassel.position.set(-R, 0, 0); root.name = '감사 구슬';
  // cursor walks 34 stops per round (0 = cross, 1..33 = beads).
  let cursor = 0, pos = 0, target = 0, lit = -1, disposed = false;
  const slotOf = c => { const r = Math.floor(c / 34), j = c - r * 34; return r * SLOTS + (j ? j + .5 : 0); };
  const light = i => {
    if (i === lit) return;
    if (lit >= 0) { beads.setMatrixAt(lit, base[lit]); beads.setColorAt(lit, white); }
    lit = i; if (i >= 0) { beads.setMatrixAt(i, tmp.copy(base[i]).multiply(big)); beads.setColorAt(i, warm); }
    beads.instanceMatrix.needsUpdate = true; beads.instanceColor.needsUpdate = true;
  };
  return { root, view: { pos: [0, .28, 1.3], at: [0, -.03, 0] },
    get index() { const j = ((cursor % 34) + 34) % 34; return j ? j - 1 : -1; },
    advance(dir = 1) {
      if (disposed) return; const d = dir < 0 ? -1 : 1;
      cursor += d; if (((cursor % 34) + 34) % 34 === 0) cursor += d;
      target = slotOf(cursor); if (Math.abs(target - pos) > 4) pos = target - Math.sign(target - pos) * 4; // a fast flurry never lags far behind
    },
    update(dt) {
      if (disposed) return;
      pos += (target - pos) * (1 - Math.exp(-Math.max(0, dt) * 16)); if (Math.abs(target - pos) < 1e-3) pos = target;
      const rho = pos * step; wheel.rotation.z = rho; tassel.position.set(-R * Math.cos(rho), -R * Math.sin(rho), 0);
      const m = ((pos % SLOTS) + SLOTS) % SLOTS; light(m < 1 || m >= 34 ? -1 : Math.min(33, Math.max(1, Math.round(m - .5))) - 1);
    },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); beads.dispose(); root.clear(); s.release(); }
  };
}
