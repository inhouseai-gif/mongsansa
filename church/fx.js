import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2, clamp = THREE.MathUtils.clamp;
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const vec = p => p?.isVector3 ? p.clone() : new THREE.Vector3(p?.x || 0, p?.y || 0, p?.z || 0);
const noiseGLSL = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
float fbm(vec2 p){return .55*noise(p)+.28*noise(p*2.03)+.14*noise(p*4.07);}
`;
const output = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
function shader(options) { return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, forceSinglePass: true, ...options }); }

function canvasTexture(w, h, paint) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export function createFx({ scene, camera, renderer, quality = 'high' }) {
  const root = new THREE.Group(); root.name = '몽산 숲속교회 효과'; scene.add(root);
  const owned = new Set(), fires = [], jobs = [], papers = new Set();
  let now = 0, disposed = false;
  const own = object => (owned.add(object), object);
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = n => Math.max(1, Math.round(n * (reduced() ? .45 : 1)));
  const drawingSize = new THREE.Vector2();
  const temp = new THREE.Vector3(), color = new THREE.Color();

  // One preallocated GPU buffer serves all short-lived effects; no objects are
  // allocated per sparkle, heart, leaf, ash flake, or steam puff.
  const capacity = quality === 'low' ? 640 : 1280;
  const positions = new Float32Array(capacity * 3), colors = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity), kinds = new Float32Array(capacity), angles = new Float32Array(capacity);
  const particles = Array.from({ length: capacity }, () => ({ live: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, size: .05, alpha: 1, kind: 0, angle: 0, spin: 0, r: 1, g: 1, b: 1, mode: '', obj: null, seed: 0, radius: 0 }));
  let cursor = 0;
  const pg = own(new THREE.BufferGeometry());
  for (const [key, data, size] of [['position', positions, 3], ['color', colors, 3], ['aSize', sizes, 1], ['aAlpha', alphas, 1], ['aKind', kinds, 1], ['aAngle', angles, 1]]) pg.setAttribute(key, new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage));
  const pm = own(shader({ vertexColors: true, uniforms: { uPixels: { value: 900 } },
    vertexShader: `attribute float aSize,aAlpha,aKind,aAngle; uniform float uPixels; varying vec3 vColor; varying float vAlpha,vKind,vAngle; void main(){vColor=color;vAlpha=aAlpha;vKind=aKind;vAngle=aAngle; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*uPixels/max(.1,-mv.z),1.,128.);}`,
    fragmentShader: `${noiseGLSL} varying vec3 vColor; varying float vAlpha,vKind,vAngle;
    void main(){ vec2 p=gl_PointCoord*2.-1.; float cs=cos(vAngle),sn=sin(vAngle);p=mat2(cs,-sn,sn,cs)*p;float a=0.;
      if(vKind<.5){float d=length(p);a=pow(max(0.,1.-d),1.1)+.3*exp(-abs(p.x)*20.)*max(0.,1.-abs(p.y))+.3*exp(-abs(p.y)*20.)*max(0.,1.-abs(p.x));}
      else if(vKind<1.5){p.y=-p.y; p*=1.2;p.y+=.15;float q=dot(p,p)-.72;a=1.-smoothstep(-.03,.03,q*q*q-p.x*p.x*p.y*p.y*p.y);}
      else if(vKind<2.5){float d=abs(p.x)*1.5+pow(abs(p.y),1.5);a=1.-smoothstep(.75,.9,d);a*=.75+.25*smoothstep(.02,.06,abs(p.x));}
      else if(vKind<3.5){a=exp(-dot(p,p)*3.6)*(.6+.4*noise(p*4.+vAngle));}
      else {a=(1.-smoothstep(.5,.85,abs(p.x)))*(1.-smoothstep(.5,.85,abs(p.y)));}
      if(a*vAlpha<.007)discard;gl_FragColor=vec4(vColor,a*vAlpha);${output}}
    ` }));
  const points = new THREE.Points(pg, pm); points.frustumCulled = false; points.visible = false; root.add(points);

  function emit(pos, opts = {}) {
    let p = null;
    for (let n = 0; n < capacity; n++) { const candidate = particles[cursor]; cursor = (cursor + 1) % capacity; if (!candidate.live) { p = candidate; break; } }
    if (!p) return;
    color.set(opts.color || '#fff2c4');
    Object.assign(p, { live: true, age: 0, life: opts.life ?? 1.4, x: pos.x, y: pos.y, z: pos.z, vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0, gravity: opts.gravity || 0, drag: opts.drag || 0, size: opts.size || .06, alpha: opts.alpha ?? 1, kind: opts.kind || 0, angle: Math.random() * TAU, spin: opts.spin || 0, r: color.r, g: color.g, b: color.b, mode: opts.mode || '', obj: opts.obj || null, seed: Math.random() * TAU, radius: opts.radius || .6 });
  }
  const ringGeometry = own(new THREE.RingGeometry(.98, 1, 80));
  const rings = Array.from({ length: 10 }, () => {
    const material = own(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, color: '#f3d9a4', side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true }));
    const mesh = new THREE.Mesh(ringGeometry, material); mesh.visible = false; root.add(mesh); return { mesh, live: false, age: 0, duration: 1, radius: 3, vertical: false };
  });

  const bark = own(canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#6b4934'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 3) { c.strokeStyle = x % 2 ? '#8c6546' : '#332820'; c.lineWidth = 1 + Math.random() * 2; c.beginPath(); c.moveTo(x, 0); for (let y = 0; y <= h; y += 12) c.lineTo(x + Math.sin(y * .06 + x) * 3, y); c.stroke(); }
  }));
  const charMap = own(canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#291b10'; c.fillRect(0, 0, w, h); c.lineCap = 'round';
    for (let i = 0; i < 30; i++) { const x = Math.random() * w, y = Math.random() * h; c.strokeStyle = i % 3 ? '#f35d14' : '#ffbe51'; c.lineWidth = .6 + Math.random() * 1.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y + 12); c.lineTo(x - 2, y + 21); c.stroke(); }
  }));
  bark.wrapS = bark.wrapT = charMap.wrapS = charMap.wrapT = THREE.RepeatWrapping;
  const logGeometry = own(new THREE.CylinderGeometry(.095, .135, 1.12, 12, 1));
  const logMat = own(new THREE.MeshStandardMaterial({ color: '#aaa092', map: bark, emissive: '#ff7a27', emissiveMap: charMap, emissiveIntensity: .32, roughness: .96 }));
  const logs = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(logGeometry, logMat); m.visible = false; m.castShadow = true; root.add(m); return { mesh: m, live: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), onLand: null, landed: false }; });
  const paperGeometry = own(new THREE.PlaneGeometry(.82, .58, 24, 20));
  const beamGeometry = own(new THREE.CylinderGeometry(.56, .92, 4.8, 24, 1, true));
  const beams = Array.from({ length: 4 }, () => {
    const m = own(shader({ side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `${noiseGLSL} uniform float uAlpha,uTime;varying vec2 vUv;void main(){float bands=.65+.35*sin(vUv.x*38.+uTime*.4);float a=pow(1.-vUv.y,1.4)*smoothstep(0.,.08,vUv.y)*bands*uAlpha;gl_FragColor=vec4(1.,.84,.57,a);${output}}` }));
    const mesh = new THREE.Mesh(beamGeometry, m); mesh.visible = false; root.add(mesh); return { mesh, live: false, t: 0, sec: 1 };
  });

  function createFire(pos) {
    const fireRoot = new THREE.Group(); fireRoot.name = '모닥불'; fireRoot.position.copy(vec(pos)); root.add(fireRoot);
    const uniforms = { uTime: { value: 0 }, uLevel: { value: 1 } };
    const pieces = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.PlaneGeometry(.82 + (i % 3) * .14, 1.65 + (i % 2) * .30, 10, 20); g.translate(0, .98, 0);
      g.rotateY(i * PI / 3); g.translate(Math.sin(i * 2.4) * .16, 0, Math.cos(i * 2.4) * .16);
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(Array(g.getAttribute('position').count).fill(i * 1.73), 1)); pieces.push(g);
    }
    const flameGeometry = own(mergeGeometries(pieces)); pieces.forEach(g => g.dispose());
    const flameMat = own(shader({ side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms,
      vertexShader: `uniform float uTime,uLevel;attribute float aSeed;varying vec2 vUv;varying float vSeed;void main(){vUv=uv;vSeed=aSeed;vec3 p=position;p.x+=sin(p.y*3.8-uTime*3.2+aSeed)*pow(uv.y,1.6)*.18;p.z+=cos(p.y*4.4-uTime*2.7+aSeed)*uv.y*uv.y*.13;p.y*=.35+.65*uLevel;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `${noiseGLSL} uniform float uTime,uLevel;varying vec2 vUv;varying float vSeed;
      void main(){vec2 uv=vUv;float n=fbm(vec2(uv.x*5.+vSeed,uv.y*7.-uTime*2.5));float x=abs(uv.x-.5+.08*sin(uv.y*8.-uTime*3.+vSeed));float width=.42*pow(max(0.,1.-uv.y),.68);float fork=smoothstep(.63,.92,uv.y)*(1.-smoothstep(.0,.09,x))*.15;float edge=width-x+(n-.5)*.16-fork;float mask=smoothstep(-.025,.065,edge)*smoothstep(0.,.11,uv.y);mask*=1.-smoothstep(.88,1.,uv.y+(n-.5)*.15);float hot=clamp((edge+.02)*3.2*(1.-uv.y*.65),0.,1.);vec3 rgb=mix(vec3(.65,.035,.008),vec3(1.8,.34,.025),smoothstep(0.,.35,hot));rgb=mix(rgb,vec3(2.2,1.35,.34),smoothstep(.3,.7,hot));rgb=mix(rgb,vec3(2.4,2.05,1.25),smoothstep(.72,1.,hot));if(mask<.01)discard;gl_FragColor=vec4(rgb,mask*(.64+.12*n));${output}}` }));
    const flames = new THREE.Mesh(flameGeometry, flameMat); flames.frustumCulled = false; fireRoot.add(flames);

    const woods = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, bottom = new THREE.Vector3(Math.sin(a) * .55, .12, Math.cos(a) * .55), top = new THREE.Vector3(Math.sin(a + .12) * .12, .87, Math.cos(a + .12) * .12);
      const g = logGeometry.clone(); g.applyMatrix4(new THREE.Matrix4().compose(bottom.clone().add(top).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize()), new THREE.Vector3(1, bottom.distanceTo(top) / 1.12, 1))); woods.push(g);
    }
    const woodGeometry = own(mergeGeometries(woods)); woods.forEach(g => g.dispose());
    const woodMaterial = own(logMat.clone()); const wood = new THREE.Mesh(woodGeometry, woodMaterial); wood.castShadow = true; wood.receiveShadow = true; fireRoot.add(wood);
    const glowTexture = own(canvasTexture(128, 128, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,172,63,.45)'); g.addColorStop(.25, 'rgba(255,113,31,.22)'); g.addColorStop(1, 'rgba(255,70,10,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }));
    const glowMat = own(new THREE.SpriteMaterial({ map: glowTexture, color: '#ffb663', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Sprite(glowMat); glow.position.y = .8; glow.scale.set(3.7, 3.7, 1); fireRoot.add(glow);
    // Physical candela, measured against the 4 m floor/seat patches in _t_fx.
    // A point light is kept in the scene when hidden; only its intensity changes.
    const light = new THREE.PointLight('#ff9a4a', 64, 12, 2); light.position.y = 1.05; light.castShadow = false; fireRoot.add(light);

    const sparkGeometry = own(new THREE.BufferGeometry()), seeds = new Float32Array(200 * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(200 * 3), 3)); sparkGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    const sparkMat = own(shader({ blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uBurst: { value: 8 }, uPixels: { value: 900 } },
      vertexShader: `attribute vec3 aSeed;uniform float uTime,uLevel,uBurst,uPixels;varying float vAge;void main(){float age=fract(aSeed.x+uTime*(.16+aSeed.y*.15));float h=age*(2.1+aSeed.z*1.7)*uLevel;vec3 p=vec3(sin(aSeed.z*62.+uTime*.9+h*2.)*(.15+age*.42),.3+h,cos(aSeed.y*43.+uTime*.7+h)*(.15+age*.4));if(aSeed.x<.1&&uBurst<1.3){age=uBurst/1.3;float a=aSeed.z*62.;p=vec3(sin(a)*uBurst*(.8+aSeed.y),.65+2.8*uBurst-1.5*uBurst*uBurst,cos(a)*uBurst*(.8+aSeed.y));}vAge=age;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.012+aSeed.y*.012)*uPixels/max(.1,-mv.z)*(1.-age*.6),1.,10.);}`,
      fragmentShader: `varying float vAge;void main(){float d=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-d),1.4)*sin(vAge*3.14159);vec3 c=mix(vec3(2.,1.3,.40),vec3(.7,.065,.012),vAge);gl_FragColor=vec4(c,a);${output}}` }));
    // First 20 seeds are the crackle burst, exactly 20 points.
    for (let i = 0; i < 200; i++) seeds[i * 3] = i < 20 ? .001 + i * .0048 : .11 + Math.random() * .89;
    const sparks = new THREE.Points(sparkGeometry, sparkMat); sparks.frustumCulled = false; fireRoot.add(sparks);
    const smokeGeometry = own(new THREE.BufferGeometry()), smokeSeed = new Float32Array(24 * 3); for (let i = 0; i < smokeSeed.length; i++) smokeSeed[i] = Math.random();
    smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3)); smokeGeometry.setAttribute('aSeed', new THREE.BufferAttribute(smokeSeed, 3));
    const smokeMat = own(shader({ uniforms: { uTime: { value: 0 }, uPixels: { value: 900 }, uLevel: { value: 1 } },
      vertexShader: `attribute vec3 aSeed;uniform float uTime,uPixels,uLevel;varying float vAge,vSeed;void main(){float a=fract(aSeed.x+uTime*(.08+aSeed.y*.035));vAge=a;vSeed=aSeed.z;vec3 p=vec3(sin(aSeed.z*32.+a*5.)*.25+a*.48,1.3+a*3.8*uLevel,cos(aSeed.y*32.+a*4.)*.23);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.32+a*.9)*uPixels/max(.1,-mv.z),1.,210.);}`,
      fragmentShader: `${noiseGLSL}varying float vAge,vSeed;void main(){vec2 p=gl_PointCoord*2.-1.;float a=exp(-dot(p,p)*3.5)*(.5+.5*noise(p*3.+vSeed*9.))*sin(vAge*3.14159)*.045;gl_FragColor=vec4(.42,.42,.43,a);${output}}` }));
    const smoke = new THREE.Points(smokeGeometry, smokeMat); smoke.frustumCulled = false; fireRoot.add(smoke);
    let level = 1, flareUntil = -10, nextCrackle = 2 + Math.random() * 3, burstAt = -20, cb = () => {}, visible = true;
    const api = { root: fireRoot, light,
      get level() { return level; },
      setLevel(v) { if (Number.isFinite(v)) level = clamp(v, .3, 1.6); },
      flare() { flareUntil = now + 3; burstAt = now; if (visible) cb(); },
      onCrackle(fn) { cb = typeof fn === 'function' ? fn : () => {}; },
      setVisible(on) { visible = !!on; for (const o of [flames, wood, glow, sparks, smoke]) o.visible = visible; light.intensity = visible ? 64 * level : 0; },
      _update(dt, pixels) {
        if (!visible) { light.intensity = 0; return; }
        const f = flareUntil > now ? 1 + .6 * Math.sin((flareUntil - now) / 3 * PI / 2) : 1;
        const strength = level * f, flicker = .925 + .10 * Math.sin(now * 11.3) + .045 * Math.sin(now * 17.7 + 2) + .03 * Math.sin(now * 29.1);
        uniforms.uTime.value = now; uniforms.uLevel.value = level; flames.scale.set(Math.sqrt(level) * f, f, Math.sqrt(level) * f);
        woodMaterial.emissiveIntensity = .5 + .4 * strength + .15 * Math.sin(now * 2.3);
        light.intensity = 64 * strength * clamp(flicker, .75, 1.1); glowMat.opacity = .58 + .20 * strength;
        if (now >= nextCrackle) { burstAt = now; nextCrackle = now + 2.5 + Math.random() * 3.3; cb(); }
        sparkMat.uniforms.uTime.value = smokeMat.uniforms.uTime.value = now;
        sparkMat.uniforms.uLevel.value = smokeMat.uniforms.uLevel.value = strength;
        sparkMat.uniforms.uBurst.value = now - burstAt;
        sparkMat.uniforms.uPixels.value = smokeMat.uniforms.uPixels.value = pixels;
      }
    }; fires.push(api); return api;
  }

  const api = { createFire,
    sparkle(pos, { count = 14, color = '#fff2c4' } = {}) {
      const p = vec(pos); for (let i = 0; i < number(count); i++) { const a = Math.random() * TAU, speed = .25 + Math.random() * .65; emit(p, { color, vx: Math.sin(a) * speed, vy: .3 + Math.random() * .8, vz: Math.cos(a) * speed, gravity: -.4, drag: .8, size: .045 + Math.random() * .05, life: .8 + Math.random() * .9 }); }
    },
    hearts(pos, { count = 5 } = {}) {
      const p = vec(pos); for (let i = 0; i < number(count); i++) emit(p, { color: ['#f6a3ab', '#f8c0b5', '#e8899b'][i % 3], kind: 1, size: .13 + Math.random() * .09, vx: (Math.random() - .5) * .28, vy: .32 + Math.random() * .22, vz: (Math.random() - .5) * .18, life: 1.6 + Math.random() * .7, mode: 'float' });
    },
    ripple(pos, { color = '#f3d9a4', radius = 3, duration = 1.6, vertical = false } = {}) {
      const r = rings.find(r => !r.live) || rings[0]; Object.assign(r, { live: true, age: 0, duration: Math.max(.05, duration), radius, vertical }); r.mesh.position.copy(vec(pos)); if (!vertical) r.mesh.position.y += .025; r.mesh.material.color.set(color); r.mesh.visible = true; r.mesh.scale.setScalar(.01);
    },
    leafBurst(pos, { count = 24 } = {}) {
      const p = vec(pos); for (let i = 0; i < number(count); i++) { const a = Math.random() * TAU; emit(p, { color: ['#dfab42', '#c96232', '#b48b3e', '#ad4935'][i % 4], kind: 2, size: .10 + Math.random() * .10, vx: Math.sin(a) * (1 + Math.random()), vz: Math.cos(a) * (1 + Math.random()), vy: .6 + Math.random(), gravity: -.8, drag: .7, spin: (Math.random() - .5) * 5, life: 1.2 + Math.random() * 1.2 }); }
    },
    steam(pos, sec = 3) { jobs.push({ kind: 'steam', pos: vec(pos), time: 0, sec: Math.max(.05, sec), tick: 0 }); },
    async burnPaper({ from, to, text = '', onLanded, onDone }) {
      if (disposed) return;
      const origin = vec(from), target = vec(to); text = String(text).slice(0, 60);
      if (document.fonts?.load) await Promise.race([document.fonts.load('48px "Nanum Pen Script"', text || '걱정').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2500))]);
      if (disposed) { text = ''; return; }
      const texture = canvasTexture(768, 512, (c, w, h) => {
        c.fillStyle = '#f3e7c8'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 3300; i++) { const x = Math.random() * w, y = Math.random() * h; c.strokeStyle = i % 2 ? 'rgba(160,132,87,.08)' : 'rgba(255,255,240,.2)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.random() * 14, y + (Math.random() - .5) * 4); c.stroke(); }
        c.fillStyle = '#51463b'; c.font = '48px "Nanum Pen Script", cursive'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const lines = []; let line = ''; for (const char of text) { if (char === '\n' || (line && c.measureText(line + char).width > w - 100)) { lines.push(line); line = char === '\n' ? '' : char; } else line += char; } if (line) lines.push(line);
        lines.forEach((line, i) => c.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 63));
      });
      // The text is never attached to scene metadata, a queue, storage, or a log.
      text = '';
      const material = shader({ side: THREE.DoubleSide, uniforms: { uMap: { value: texture }, uBurn: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `uniform float uBurn,uTime;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;float curl=uBurn*3.;p.z+=pow(abs(uv.x-.5)*2.,2.)*curl*.14+sin(uv.y*8.+uTime*5.)*.012; p.x*=1.-uBurn*.28;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader: `${noiseGLSL}uniform sampler2D uMap;uniform float uBurn,uTime;varying vec2 vUv;void main(){vec2 uv=vUv;float d=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));float n=fbm(uv*24.);float edge=d+n*.10-uBurn*.68;float alive=smoothstep(-.012,.008,edge);if(alive<.01)discard;vec3 c=texture2D(uMap,uv).rgb;float charred=1.-smoothstep(.012,.065,edge);c=mix(c,vec3(.10,.055,.025),charred*.8);float hot=exp(-abs(edge-.008)*100.)*smoothstep(0.,.07,uBurn);c+=vec3(3.,.62,.055)*hot;gl_FragColor=vec4(c,alive);${output}}` });
      const mesh = new THREE.Mesh(paperGeometry, material); root.add(mesh); mesh.position.copy(origin); mesh.quaternion.copy(camera.quaternion);
      return new Promise(resolve => papers.add({ mesh, texture, material, origin, target, time: 0, landed: false, onLanded, onDone, resolve, tick: 0 }));
    },
    tossLog({ from, to, onLand }) {
      const log = logs.find(l => !l.live);
      if (!log) { onLand?.(); return; }
      Object.assign(log, { live: true, t: 0, onLand, landed: false }); log.from.copy(vec(from)); log.to.copy(vec(to)); log.mesh.visible = true; log.mesh.position.copy(log.from); log.mesh.scale.setScalar(1);
    },
    swirl(obj, sec = 2) {
      const p = obj?.getWorldPosition ? obj.getWorldPosition(new THREE.Vector3()) : vec(obj);
      for (let i = 0; i < number(40); i++) emit(p, { color: i % 3 ? '#f8df9b' : '#fff8d8', size: .035 + Math.random() * .04, life: Math.max(.1, sec), mode: 'swirl', obj: obj?.isObject3D ? obj : null, radius: .4 + Math.random() * .28 });
    },
    lightBeam(pos, sec = 3) {
      const b = beams.find(b => !b.live) || beams[0]; b.live = true; b.t = 0; b.sec = Math.max(.1, sec); b.mesh.position.copy(vec(pos)).add(new THREE.Vector3(0, 2.4, 0)); b.mesh.visible = true;
      api.sparkle(vec(pos).add(new THREE.Vector3(0, .5, 0)), { count: 22 });
    },
    update(dt, t) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return; now += dt;
      renderer?.getDrawingBufferSize?.(drawingSize); const pixels = drawingSize.y || 900; pm.uniforms.uPixels.value = pixels;
      for (const fire of fires) fire._update(dt, pixels);
      for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i]; j.time += dt; j.tick += dt;
        while (j.tick > .10 && j.time <= j.sec) { j.tick -= .10; emit(j.pos, { color: '#eee8d9', kind: 3, size: .10, alpha: .19, vy: .18 + Math.random() * .08, vx: .02, life: 1.6, mode: 'steam' }); }
        if (j.time >= j.sec) jobs.splice(i, 1);
      }
      let active = 0;
      for (const p of particles) {
        if (!p.live) continue; p.age += dt; if (p.age >= p.life) { p.live = false; p.obj = null; continue; }
        const f = p.age / p.life;
        if (p.mode === 'swirl') {
          if (p.obj) p.obj.getWorldPosition(temp); else temp.set(p.x, p.y, p.z);
          const a = p.seed + p.age * 4.5, radius = p.radius * (f < .75 ? 1 - .35 * f : .75 + (f - .75) * 3);
          positions[active * 3] = temp.x + Math.sin(a) * radius; positions[active * 3 + 1] = temp.y + .15 + f * 1.5; positions[active * 3 + 2] = temp.z + Math.cos(a) * radius;
        } else {
          p.vy += p.gravity * dt; const drag = Math.exp(-p.drag * dt); p.vx *= drag; p.vz *= drag;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          positions[active * 3] = p.x + (p.mode === 'float' || p.mode === 'steam' ? Math.sin(p.age * 3 + p.seed) * .035 : 0); positions[active * 3 + 1] = p.y; positions[active * 3 + 2] = p.z;
        }
        colors[active * 3] = p.r; colors[active * 3 + 1] = p.g; colors[active * 3 + 2] = p.b;
        sizes[active] = p.size * (p.kind === 3 ? 1 + f * 3.2 : 1); alphas[active] = p.alpha * Math.min(1, p.age * 12) * (1 - ease((f - .45) / .55)); kinds[active] = p.kind; angles[active] = p.kind === 1 ? 0 : p.angle + p.age * p.spin; active++;
      }
      points.visible = active > 0; pg.setDrawRange(0, active); for (const a of Object.values(pg.attributes)) a.needsUpdate = true;
      for (const r of rings) if (r.live) { r.age += dt; const f = clamp(r.age / r.duration, 0, 1); r.mesh.scale.setScalar(.05 + ease(f) * r.radius); r.mesh.material.opacity = (1 - f) ** 1.5 * .6; if (r.vertical) camera.getWorldQuaternion(r.mesh.quaternion); else r.mesh.rotation.set(-PI / 2, 0, 0); if (f >= 1) r.live = r.mesh.visible = false; }
      for (const l of logs) if (l.live) {
        l.t += dt; const f = Math.min(1, l.t / 1.15); l.mesh.position.lerpVectors(l.from, l.to, f); l.mesh.position.y += 4 * f * (1 - f) * 1.5;
        l.mesh.rotation.set(f * PI * 2 + .7, f * 2, .7);
        if (f === 1 && !l.landed) { l.landed = true; l.onLand?.(); l.onLand = null; }
        if (l.t > 2) l.mesh.scale.setScalar(Math.max(.001, 1 - (l.t - 2) / .6)); if (l.t >= 2.6) l.live = l.mesh.visible = false;
      }
      for (const p of papers) {
        p.time += dt; const flight = Math.min(1, p.time / 1.3), burn = clamp((p.time - 1.3) / 3.6, 0, 1); p.material.uniforms.uTime.value = now; p.material.uniforms.uBurn.value = burn;
        p.mesh.position.lerpVectors(p.origin, p.target, flight); p.mesh.position.y += 4 * flight * (1 - flight) * 1.15 + burn * .16;
        p.mesh.rotation.set(-PI / 2 * ease(flight), .18 * Math.sin(p.time * 3), .15 * Math.sin(p.time * 4) * (1 - flight));
        if (flight === 1 && !p.landed) { p.landed = true; p.onLanded?.(); p.onLanded = null; }
        if (burn > 0) { p.tick += dt; while (p.tick > .08) { p.tick -= .08; temp.copy(p.mesh.position).add(new THREE.Vector3((Math.random() - .5) * .6, .02, (Math.random() - .5) * .4)); emit(temp, { color: burn < .75 ? '#e69b4d' : '#8d8379', kind: 4, size: .015 + Math.random() * .025, vy: .35 + Math.random() * .4, vx: .1 + Math.random() * .1, vz: (Math.random() - .5) * .2, spin: 3, life: 1.8 }); } }
        if (burn >= 1) { clearPaper(p); p.onDone?.(); p.resolve(); papers.delete(p); }
      }
      for (const b of beams) if (b.live) { b.t += dt; const f = clamp(b.t / b.sec, 0, 1); b.mesh.material.uniforms.uAlpha.value = Math.sin(f * PI) * .20; b.mesh.material.uniforms.uTime.value = now; if (f >= 1) b.live = b.mesh.visible = false; }
    },
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent();
      for (const p of papers) { clearPaper(p); p.resolve(); } papers.clear();
      particles.forEach(p => { p.obj = null; }); jobs.length = 0;
      for (const object of owned) object.dispose(); owned.clear(); root.clear();
    }
  };
  function clearPaper(p) {
    p.mesh.removeFromParent(); const cv = p.texture.image; cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height); cv.width = cv.height = 1; p.texture.dispose(); p.material.dispose(); p.onLanded = null;
  }
  return api;
}

const PI = Math.PI;
