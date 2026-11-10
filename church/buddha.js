import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 몽산 숲속교회 · 단위 1 = 게임의 로컬 단위. 정면 +z, 제단 윗면 y=0.
// 외부 자산/비동기 작업 없음. 광원은 호출자가 배치한다.
const environments = new WeakMap();
let interiorTexture;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

function warmInterior() {
  if (interiorTexture) return interiorTexture;
  // 방위 u=.75가 +z: 현관에서 들어오는 넓은 빛, 양옆 창과 촛불.
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
  texture.name = '몽산 숲속교회 · 따뜻한 실내 반사';
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
  group.name = bodhi ? '예배당 · 꽃 받침대' : '예배당 · 나무 십자가';
  const materials = {
    gold: new THREE.MeshStandardMaterial({color:'#69472e', roughness:.82, envMap, envMapIntensity:.65, emissive:'#dfb573', emissiveIntensity:.04, vertexColors:true}),
    robe: new THREE.MeshStandardMaterial({color:0xffffff, roughness:.85, envMap, envMapIntensity:.5, vertexColors:true}),
    recess: new THREE.MeshBasicMaterial({color:'#ffdfaa', transparent:true, opacity:.08, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true, vertexColors:true})
  };
  materials.recess.name = '십자가 빛 면';
  const batches = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const templates = new Map();
  const transform = new THREE.Matrix4(), quat = new THREE.Quaternion(), euler = new THREE.Euler();
  function add(g, mat = 'gold', p = [0,0,0], s = [1,1,1], r = [0,0,0], tint = '#ffffff') {
    const part = g.index ? g.toNonIndexed() : g.clone(); g.dispose(); part.deleteAttribute('uv');
    quat.setFromEuler(euler.set(...r)); transform.compose(V(...p), quat, V(...s)); part.applyMatrix4(transform);
    const color = new THREE.Color(tint), colors = new Float32Array(part.attributes.position.count * 3);
    for (let i=0;i<colors.length;i+=3) colors.set([color.r,color.g,color.b],i);
    part.setAttribute('color',new THREE.BufferAttribute(colors,3)); batches[mat].push(part);
  }
  if (!bodhi) {
    // Back wall is behind local -z. Both arms are plain timber, with no text.
    add(new THREE.BoxGeometry(.20,1.92,.13),'gold',[0,1.04,-.87]);
    add(new THREE.BoxGeometry(1.35,.20,.14),'gold',[0,1.40,-.86]);
    add(new THREE.PlaneGeometry(.42,2.08),'recess',[0,1.04,-.955]);
    add(new THREE.PlaneGeometry(1.55,.40),'recess',[0,1.40,-.954]);
  } else {
    add(new THREE.BoxGeometry(.50,.08,.48),'gold',[0,.04,0]);
    add(new THREE.BoxGeometry(.13,.65,.13),'gold',[0,.38,0]);
    add(new THREE.BoxGeometry(.46,.07,.42),'gold',[0,.74,0]);
    add(new THREE.CylinderGeometry(.14,.10,.27,high?10:6),'robe',[0,.90,0],[1,1,1],[0,0,0],'#e8dfcd');
    for(let j=0;j<5;j++) {
      const a=j*TAU/5, x=Math.sin(a)*.16, z=Math.cos(a)*.12, y=1.19+(j%2)*.08;
      add(new THREE.CylinderGeometry(.009,.009,y-.96,4),'robe',[x/2,(y+.96)/2,z/2],[1,1,1],[0,0,-side*x*.7],'#6e855c');
      for(let k=0;k<5;k++) {
        const b=k*TAU/5;
        add(new THREE.IcosahedronGeometry(1,0),'robe',[x+Math.sin(b)*.052,y,z+Math.cos(b)*.052],[.062,.025,.055],[0,b,0],j%2?'#e3b9ae':'#f5ecdb');
      }
      add(new THREE.IcosahedronGeometry(1,0),'robe',[x,y+.016,z],[.025,.023,.025],[0,0,0],'#d5ad62');
    }
  }
  for (const [name, geometries] of Object.entries(batches)) {
    if (!geometries.length) { materials[name].dispose(); continue; }
    const g = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!g) throw new Error(`Church geometry merge failed: ${name}`);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials[name]); mesh.name = `${group.name} / ${name}`;
    mesh.castShadow = mesh.receiveShadow = name !== 'recess'; group.add(mesh);
  }
  for (const t of templates.values()) t.dispose();
  let disposed = false;
  group.userData.buildTime = {environmentMs, geometryMs:now()-started-environmentMs};
  group.userData.variant = bodhi ? 'bodhisattva' : 'buddha';
  group.userData.quality = high ? 'high' : 'low';
  group.userData.setEnvIntensity = v => {
    if (!Number.isFinite(v) || v < 0) return;
    for (const mesh of group.children) mesh.material.envMapIntensity = v;
  };
  group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    for (const mesh of group.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
    group.clear();
  };
  return group;
}
