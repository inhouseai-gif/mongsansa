/* 몽산 숲속교회 · Web Audio만으로 만든 소리. 외부 자산/라이브러리 없음.
 * 계약: INTERFACES.md §3.4. 시간은 모두 AudioContext의 초 단위다.
 * unlock 전에는 설정도 포함해 아무 동작을 하지 않는다.
 */
const TAU = Math.PI * 2;
const EPS = 0.00001;
const VOICE_LIMIT = 48;
const SOURCE_LIMIT = 192;
const ZONES = new Set(['outdoor', 'forest', 'water', 'bamboo', 'musang', 'hall', 'chamber', 'tea']);
const ROOMS = { outdoor: 1.2, hall: 3.2, chamber: 2.4, tea: 0.9 };
const clamp = (n, lo, hi, fallback = lo) => Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
const random = (lo, hi) => lo + Math.random() * (hi - lo);

export function createAudio() {
  let ctx = null, ready = false, disposed = false, timer = null;
  let master, limiter, safety, ambientDuck;
  let muted = false, duck = 1, totalSources = 0, dropped = 0;
  let roomKey = null, bpm = 56, targetBpm = 56, lastTick = 0;
  let fireIntensity = 0.65;
  const volumes = { master: 0.78, ambient: 0.68, sfx: 0.8, chant: 0.6 };
  const env = { zone: 'outdoor', hour: 13, nightFactor: 0 };
  const buses = {}, voices = new Set(), continuous = new Map();
  const buffers = new Map(), impulses = new Map(), rooms = new Map();
  const lastVoice = new Map(), due = {}, targets = new WeakMap();
  const environment = {}, eventGains = {}, infrastructure = new Set();

  function own(node) { infrastructure.add(node); return node; }
  function hold(param, at = ctx.currentTime) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
    else { const value = param.value; param.cancelScheduledValues(at); param.setValueAtTime(value, at); }
  }
  function fade(param, value, seconds = 0.1) {
    if (targets.get(param) === value) return;
    targets.set(param, value);
    const now = ctx.currentTime;
    hold(param, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.005, seconds));
  }
  function gainNode(value = 1) { const g = ctx.createGain(); g.gain.value = value; return g; }

  // 색잡음/주기음은 한 번 만든 버퍼를 재사용한다. 반복 경계는 교차 페이드한다.
  function noise(color = 'white') {
    if (buffers.has(color)) return buffers.get(color);
    const n = Math.ceil(ctx.sampleRate * 4), seam = Math.floor(ctx.sampleRate * 0.025);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate), data = buffer.getChannelData(0), tail = new Float32Array(seam);
    let brown = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < n + seam; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.022 * w) / 1.022;
      p0 = 0.997 * p0 + 0.029 * w;
      p1 = 0.985 * p1 + 0.067 * w;
      p2 = 0.95 * p2 + 0.153 * w;
      const s = color === 'brown' ? brown * 4 : color === 'pink' ? (p0 + p1 + p2 + w * 0.15) * 0.7 : w;
      if (i < n) data[i] = s; else tail[i - n] = s;
    }
    // 끝에서 이어 만든 소리를 앞머리에 섞어, 반복될 때 끝→처음이 끊기지 않게 한다(4초마다 '툭' 방지)
    for (let i = 0; i < seam; i++) {
      const t = (i / seam) * Math.PI / 2;
      data[i] = data[i] * Math.sin(t) + tail[i] * Math.cos(t);
    }
    buffers.set(color, buffer);
    return buffer;
  }
  function shapedBuffer(kind) {
    if (buffers.has(kind)) return buffers.get(kind);
    const seconds = kind === 'breathing' ? 12 : 2.8;
    const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      if (kind === 'breathing') {
        // 들숨 4초 / 멈춤 2초 / 날숨 6초. 끝점 0으로 반복 경계가 매끈하다.
        const e = t < 4 ? Math.sin(Math.PI * t / 4) * 0.8 : t < 6 ? 0 : Math.sin(Math.PI * (t - 6) / 6) * 0.62;
        data[i] = (Math.random() * 2 - 1) * e;
      } else {
        const group = t % 0.7, pulse = group % 0.065;
        const e = group < 0.36 ? Math.sin(Math.PI * pulse / 0.065) ** 4 : 0;
        const edge = Math.min(1, t / 0.03, (seconds - t) / 0.03);
        data[i] = 0.25 * e * edge * (Math.sin(TAU * 4300 * t + 1.8 * Math.sin(TAU * 42 * t)) + 0.3 * Math.sin(TAU * 4720 * t));
      }
    }
    buffers.set(kind, buffer);
    return buffer;
  }
  function impulse(key) {
    if (impulses.has(key)) return impulses.get(key);
    const seconds = ROOMS[key], n = Math.ceil(seconds * ctx.sampleRate);
    const buffer = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let low = 0;
      for (let i = 0; i < n; i++) {
        low = low * 0.55 + (Math.random() * 2 - 1) * 0.45;
        const t = i / n;
        data[i] = low * Math.exp(-7 * t) * Math.min(1, i / (ctx.sampleRate * 0.012));
      }
      for (const [sec, amp] of [[0.023, 0.22], [0.047, 0.14], [0.079, 0.09]]) {
        data[Math.floor((sec + c * 0.003) * ctx.sampleRate)] += amp;
      }
    }
    impulses.set(key, buffer);
    return buffer;
  }
  function setRoom(key) {
    if (key === roomKey) return;
    roomKey = key;
    if (!rooms.has(key)) {
      const routes = [];
      for (const name of ['ambient', 'sfx', 'chant']) {
        const convolver = ctx.createConvolver(), wet = gainNode(0), send = gainNode(name === 'ambient' ? 0.12 : 0.23);
        convolver.buffer = impulse(key);
        buses[name].input.connect(send);
        send.connect(convolver); convolver.connect(wet); wet.connect(buses[name].volume);
        routes.push({ name, convolver, wet, send });
      }
      rooms.set(key, { routes, retireAt: Infinity });
    }
    for (const [name, room] of rooms) {
      room.retireAt = name === key ? Infinity : ctx.currentTime + 2.1;
      for (const route of room.routes) fade(route.wet.gain, name === key ? 1 : 0, 2);
    }
  }
  function removeRoom(key, room) {
    for (const r of room.routes) {
      buses[r.name].input.disconnect(r.send);
      r.send.disconnect(); r.convolver.disconnect(); r.wet.disconnect();
      r.convolver.buffer = null;
    }
    rooms.delete(key);
  }

  // 음성 하나(여러 배음 포함)를 단위로 제한한다. 넘친 입력은 기존 꼬리를 끊지 않고 무시한다.
  function voice(key, { channel = 'sfx', gain = 1, limit = 4, gap = 0.018, dest = null, keep = false, group = null } = {}) {
    if (!ready || disposed || ctx.state !== 'running') return null;
    gain = clamp(gain, 0, 2, 1);
    if (!gain) return null;
    const now = ctx.currentTime;
    if (voices.size >= VOICE_LIMIT || totalSources >= SOURCE_LIMIT - 12 || now - (lastVoice.get(key) ?? -Infinity) < gap || [...voices].filter(v => v.key === key).length >= limit) {
      dropped++; return null;
    }
    lastVoice.set(key, now);
    const gate = gainNode(gain);
    gate.connect(dest || (channel === 'ambient' ? ambientDuck : buses[channel].input));
    const v = { key, gate, nodes: new Set([gate]), sources: new Set(), keep, group, sealed: false, released: false, end: now, deadAt: Infinity };
    voices.add(v);
    return v;
  }
  function cleanup(v) {
    if (!voices.delete(v)) return;
    for (const s of v.sources) { s.onended = null; try { s.stop(); } catch {} totalSources--; }
    v.sources.clear();
    for (const n of v.nodes) n.disconnect();
    v.nodes.clear();
  }
  function release(v, seconds = 0.4) {
    if (!v || v.released) return;
    v.released = true; v.keep = false;
    fade(v.gate.gain, 0, seconds);
    v.deadAt = ctx.currentTime + seconds + 0.05;
    for (const s of v.sources) { try { s.stop(ctx.currentTime + seconds + 0.02); } catch {} }
  }
  function track(v, node) { v.nodes.add(node); return node; }
  function source(v, node, start, duration, offset = 0) {
    if (totalSources >= SOURCE_LIMIT) { node.disconnect(); return false; }
    track(v, node); v.sources.add(node); totalSources++;
    node.onended = () => {
      if (!v.sources.delete(node)) return;
      totalSources--; node.disconnect(); v.nodes.delete(node); node.onended = null;
      if (v.sealed && !v.keep && !v.sources.size) cleanup(v);
    };
    if (node.buffer) node.start(start, offset); else node.start(start);
    if (Number.isFinite(duration)) { node.stop(start + duration); v.end = Math.max(v.end, start + duration); }
    return true;
  }
  function seal(v) {
    if (!v) return;
    v.sealed = true;
    if (!v.sources.size) cleanup(v);
  }
  function filter(v, type, frequency, q = 0.7) {
    const f = track(v, ctx.createBiquadFilter());
    f.type = type; f.frequency.value = Math.min(frequency, ctx.sampleRate * 0.45); f.Q.value = q;
    return f;
  }
  function envelope(v, amp, start, duration, attack = 0.005, tail = 0.001) {
    const g = track(v, gainNode(0));
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(Math.max(EPS, amp), start + Math.min(attack, duration * 0.2));
    g.gain.exponentialRampToValueAtTime(Math.max(EPS, amp * tail), start + duration * 0.96);
    g.gain.linearRampToValueAtTime(0, start + duration);
    return g;
  }
  function tone(v, frequency, amp, duration, { delay = 0, type = 'sine', endFrequency = null, attack = 0.004, tail = 0.001 } = {}) {
    const start = ctx.currentTime + 0.003 + delay, osc = ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration * 0.75);
    const e = envelope(v, amp, start, duration, attack, tail);
    osc.connect(e); e.connect(v.gate); source(v, osc, start, duration + 0.005);
    return osc;
  }
  function hiss(v, amp, duration, frequency = 1400, { delay = 0, color = 'white', type = 'bandpass', q = 0.7, attack = 0.005, tail = 0.001, endFrequency = null } = {}) {
    const start = ctx.currentTime + 0.003 + delay, src = ctx.createBufferSource();
    src.buffer = noise(color); src.loop = true;
    const f = filter(v, type, frequency, q), e = envelope(v, amp, start, duration, attack, tail);
    if (endFrequency) f.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    src.connect(f); f.connect(e); e.connect(v.gate);
    source(v, src, start, duration + 0.005, random(0, 3));
  }
  function loopNoise(v, color, amp, frequency, type = 'lowpass', rate = 0.08, depth = 0.2) {
    const src = ctx.createBufferSource(); src.buffer = noise(color); src.loop = true;
    const f = filter(v, type, frequency), g = track(v, gainNode(amp));
    src.connect(f); f.connect(g); g.connect(v.gate);
    source(v, src, ctx.currentTime, Infinity, random(0, 3));
    if (rate) {
      const lfo = ctx.createOscillator(), amount = track(v, gainNode(amp * depth));
      lfo.frequency.value = rate; lfo.connect(amount); amount.connect(g.gain);
      source(v, lfo, ctx.currentTime, Infinity);
    }
    return f;
  }
  function strike(kind, opts = {}, channel = 'sfx', dest = null, group = null) {
    const gain = opts?.gain ?? 1;
    const limit = { bell: 2, bowl: 3, moktak: 8, bead: 8, windChime: 3 }[kind] || 4;
    const v = voice(`${channel}:${kind}`, { channel, gain, limit, gap: kind === 'bell' ? 0.35 : kind === 'bead' ? 0.012 : 0.025, dest, group });
    if (!v) return;
    switch (kind) {
      case 'bell': {
        // 청동 교회 종: 밝은 중심음과 비정수 배음, 높은 배음부터 짧게 잦아든다.
        const modes = [[261.6, .18, 5.5], [523.9, .11, 4.7], [622.8, .065, 3.8], [1049, .038, 2.8], [1412.6, .020, 2], [1827, .009, 1.3]];
        for (const [f, a, d] of modes) tone(v, f, a, d, { attack: .012, tail: .002 });
        hiss(v, .10, .045, 1800, { type: 'lowpass' });
        break;
      }
      case 'moktak':
        // 손목으로 흔드는 핸드벨. 짧은 어택 뒤 약 2초 동안 금속 울림이 남는다.
        for (const [r, a, d] of [[1, .22, 2.1], [2.756, .075, 1.45], [5.404, .024, .8]]) tone(v, 784 * r, a, d, { attack: .006, tail: .002 });
        break;
      case 'bowl':
        for (const [r, a, d] of [[1, .14, 3.8], [2.013, .055, 2.8], [3.76, .025, 1.9], [5.43, .010, 1.2]]) tone(v, 523.25 * r, a, d, { attack: .045, tail: .002 });
        break;
      case 'yoryeong':
        // 기도 시간을 알리는 같은 높이의 핸드벨 세 번. 선율은 만들지 않는다.
        for (let j = 0; j < 3; j++) for (const [f, a] of [[880, .10], [2425, .035], [4756, .012]]) tone(v, f, a, 2 - j * .15, { delay: j * .24, attack: .008 }); break;
      case 'chime':
        for (const [f, a, d] of [[784, .12, 2.8], [1579, .035, 1.9], [2950, .014, 1.3]]) tone(v, f, a, d, { attack: .022 }); break;
      case 'windChime':
        for (let i = 0; i < 4; i++) {
          const f = [1450, 1912, 2530, 3210][i];
          tone(v, f, .06 / (1 + i * .3), 3.5 - i * .4, { delay: i * .18 + random(0, .11) });
          tone(v, f * 1.011, .021, 2.6, { delay: i * .18 });
        } break;
      case 'bead':
        tone(v, random(1300, 1650), .095, .034); tone(v, 750, .05, .045, { delay: .012 }); hiss(v, .10, .016, 2300); break;
      case 'jukbi':
        // 묵상의 시작과 끝을 알리는 작은 나무 두드림.
        hiss(v, .16, .055, 1400, { q: .65 }); tone(v, 520, .15, .10); tone(v, 1180, .055, .06, { delay: .006 }); break;
      case 'cloth': hiss(v, .13, .48, 1200, { attack: .10, endFrequency: 650 }); break;
      case 'match':
        hiss(v, .25, .08, 2800); hiss(v, .16, .75, 3800, { delay: .065, attack: .04, endFrequency: 1600 }); break;
      case 'pour':
        hiss(v, .23, 3, 2000, { type: 'lowpass', attack: .28, tail: .3, endFrequency: 3400 });
        for (let i = 0; i < 14; i++) tone(v, random(600, 1500), .018, .09, { delay: .15 + i * .19, endFrequency: random(350, 600) }); break;
      case 'sip':
        hiss(v, .17, .58, 1150, { q: 2, attack: .10, endFrequency: 500 }); tone(v, 320, .023, .12, { delay: .42, endFrequency: 190 }); break;
      case 'cupDown':
        tone(v, 2250, .07, .18); tone(v, 3810, .035, .10); tone(v, 190, .08, .06); hiss(v, .05, .03, 1500); break;
      case 'sweep':
        for (let i = 0; i < 3; i++) hiss(v, .25, .72, 1900, { delay: i * .78, attack: .18, endFrequency: 700, tail: .02 }); break;
      case 'leaves':
        for (let i = 0; i < 7; i++) hiss(v, random(.06, .12), .22, random(2000, 4500), { delay: i * .09, attack: .03 }); break;
      case 'logThud':
        tone(v, 100, .27, .24, { endFrequency: 62 }); tone(v, 230, .10, .11); hiss(v, .22, .12, 650, { color: 'brown' });
        for (let i = 0; i < 4; i++) hiss(v, .18, .025, random(1600, 4200), { delay: .08 + i * .065 }); break;
      case 'crackle':
        tone(v, 180, .14, .04); hiss(v, .32, .026, 2700); hiss(v, .12, .045, 4800, { delay: .028 }); break;
      case 'paperBurn':
        hiss(v, .15, 2.2, 2600, { attack: .15, tail: .03, endFrequency: 4200 });
        for (let i = 0; i < 7; i++) hiss(v, .08, .026, random(2000, 5000), { delay: .18 + i * .27 }); break;
      case 'lidClose':
        tone(v, 82, .30, .70, { endFrequency: 58 }); tone(v, 139, .12, 1.5); tone(v, 213, .07, 2.4);
        hiss(v, .32, .22, 480, { color: 'brown', type: 'lowpass' }); hiss(v, .08, .07, 1800, { delay: .025 }); break;
      case 'lidOpen':
        hiss(v, .30, 1.35, 480, { color: 'pink', attack: .14, tail: .05, endFrequency: 950 });
        for (let i = 0; i < 3; i++) tone(v, 170 + i * 35, .045, .15, { delay: .12 + i * .35 }); break;
      case 'shutter':
        hiss(v, .22, .023, 3000); tone(v, 920, .065, .025);
        hiss(v, .16, .035, 1900, { delay: .09 }); hiss(v, .07, .12, 4200, { delay: .11 }); break;
      case 'meow': {
        const start = ctx.currentTime + .003, osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(390, start); osc.frequency.linearRampToValueAtTime(620, start + .18); osc.frequency.exponentialRampToValueAtTime(270, start + .7);
        for (const [f, a, q] of [[850, .065, 2], [1650, .03, 3]]) {
          const band = filter(v, 'bandpass', f, q), e = envelope(v, a, start, .8, .08, .01);
          osc.connect(band); band.connect(e); e.connect(v.gate);
        }
        source(v, osc, start, .82); break;
      }
      case 'tap': tone(v, 760, .055, .055, { endFrequency: 540 }); break;
      default: cleanup(v); return;
    }
    seal(v);
  }

  function step(surface = 'gravel') {
    const v = voice('step', { limit: 5, gap: .075 });
    if (!v) return;
    if (surface === 'wood') {
      tone(v, random(140, 170), .11, .14); tone(v, 390, .04, .065); hiss(v, .08, .08, 1000);
    } else if (surface === 'stone') {
      tone(v, 105, .08, .07); hiss(v, .13, .07, 1850, { q: .6 });
    } else if (surface === 'grass') {
      hiss(v, .20, .20, 1800, { attack: .025 }); hiss(v, .06, .10, 4200, { delay: .03 });
    } else if (surface === 'dirt') {
      hiss(v, .20, .14, 700, { color: 'pink' }); tone(v, 85, .04, .08);
    } else {
      hiss(v, .19, .16, 1900, { color: 'pink' });
      for (let i = 0; i < 4; i++) hiss(v, .08, .026, random(2300, 4800), { delay: i * .024 });
      tone(v, 100, .04, .08);
    }
    seal(v);
  }
  function bird(dest, gain = 1, bright = false, group = null) {
    const v = voice(bright ? 'dawn-bird' : 'bird', { channel: 'ambient', dest, gain, limit: 5, gap: .1, group });
    if (!v) return;
    const species = Math.floor(Math.random() * 3), count = [3, 5, 2][species];
    for (let i = 0; i < count; i++) {
      const start = ctx.currentTime + .003 + i * [.15, .10, .24][species];
      const duration = [.12, .07, .22][species], base = [2200, 3200, 1750][species] * (bright ? 1.16 : 1);
      const carrier = ctx.createOscillator(), fm = ctx.createOscillator(), depth = track(v, gainNode([170, 310, 110][species]));
      carrier.frequency.setValueAtTime(base + i * 120, start);
      carrier.frequency.exponentialRampToValueAtTime(base * [1.45, .8, 1.7][species], start + duration * .45);
      carrier.frequency.exponentialRampToValueAtTime(base * [.9, 1.2, .8][species], start + duration);
      fm.frequency.value = [34, 62, 19][species]; fm.connect(depth); depth.connect(carrier.frequency);
      const e = envelope(v, bright ? .065 : .045, start, duration, .018, .005);
      carrier.connect(e); e.connect(v.gate);
      source(v, carrier, start, duration + .005); source(v, fm, start, duration + .005);
    }
    seal(v);
  }
  function owl() {
    const v = voice('owl', { channel: 'ambient', dest: eventGains.owl, limit: 1 });
    if (!v) return;
    tone(v, 330, .075, .50, { endFrequency: 280, attack: .08 });
    tone(v, 302, .065, .72, { delay: .65, endFrequency: 262, attack: .1 }); seal(v);
  }
  function bambooKnock() {
    const v = voice('bamboo-knock', { channel: 'ambient', dest: eventGains.bamboo, limit: 2 });
    if (!v) return;
    tone(v, 780, .06, .10); tone(v, 1210, .028, .05); hiss(v, .04, .022, 2100); seal(v);
  }
  function startContinuous(name, build, channel = 'sfx') {
    if (continuous.has(name)) return continuous.get(name);
    const v = voice(`loop:${name}`, { channel, keep: true, limit: 2, gap: 0, group: name });
    if (!v) return null;
    v.gate.gain.value = 0; build(v); seal(v); fade(v.gate.gain, 1, .5);
    continuous.set(name, v); return v;
  }
  function stopContinuous(name, seconds = .5) {
    const v = continuous.get(name); if (!v) return;
    continuous.delete(name); release(v, seconds);
    for (const other of voices) if (other !== v && other.group === name) release(other, seconds);
  }
  function fire(on, intensity = fireIntensity) {
    if (!ready) return;
    if (!on) { stopContinuous('fire'); return; }
    fireIntensity = clamp(intensity, 0, 1, fireIntensity);
    const v = startContinuous('fire', v => {
      loopNoise(v, 'brown', .29, 260, 'lowpass', .22, .28);
      loopNoise(v, 'pink', .035, 1300, 'bandpass', .43, .4);
      due.fire = ctx.currentTime + .2;
    }, 'ambient');
    if (v) fade(v.gate.gain, fireIntensity, .8);
  }
  function heartbeat(on, nextBpm = targetBpm) {
    if (!ready) return;
    if (!on) { stopContinuous('heartbeat', .2); return; }
    targetBpm = clamp(nextBpm, 25, 150, targetBpm);
    if (!continuous.has('heartbeat')) bpm = targetBpm;
    startContinuous('heartbeat', v => {
      // 제어용 무음 소스 하나: 다른 지속음과 같은 종료 규칙을 사용한다.
      loopNoise(v, 'brown', 0, 60, 'lowpass', 0);
      due.heartbeat = ctx.currentTime + .03;
    });
  }
  function heartBeatPair() {
    const root = continuous.get('heartbeat');
    const v = voice('heart-pair', { dest: root.gate, group: 'heartbeat', limit: 3, gap: .2 });
    if (!v) return;
    tone(v, 68, .24, .17, { endFrequency: 43, attack: .016 });
    tone(v, 76, .15, .14, { delay: Math.min(.23, 60 / bpm * .25), endFrequency: 48, attack: .014 });
    hiss(v, .055, .09, 110, { color: 'brown', type: 'lowpass' }); seal(v);
  }
  function breath(on) {
    if (!ready) return;
    if (!on) { stopContinuous('breath'); return; }
    startContinuous('breath', v => {
      const src = ctx.createBufferSource(); src.buffer = shapedBuffer('breathing'); src.loop = true;
      const band = filter(v, 'bandpass', 750, .6), level = track(v, gainNode(.19));
      src.connect(band); band.connect(level); level.connect(v.gate);
      source(v, src, ctx.currentTime, Infinity);
      const lfo = ctx.createOscillator(), amount = track(v, gainNode(320));
      lfo.frequency.value = 1 / 12; lfo.connect(amount); amount.connect(band.frequency); source(v, lfo, ctx.currentTime, Infinity);
    });
  }
  function chant(on) {
    if (!ready) return;
    if (!on) { stopContinuous('chant', .8); return; }
    startContinuous('chant', v => {
      const re = new Float32Array(20), im = new Float32Array(20);
      // 자체 구성한 고정 화음: 부드러운 오르간·허밍 결만 남기고 선율은 없다.
      for (let i = 1; i < im.length; i++) im[i] = 1 / i ** 2.4;
      const wave = ctx.createPeriodicWave(re, im);
      for (const f of [130.81, 164.81, 196]) {
        const osc = ctx.createOscillator(); osc.setPeriodicWave(wave); osc.frequency.value = f;
        const b = filter(v, 'lowpass', 950, .55), g = track(v, gainNode(0));
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(.042, ctx.currentTime + 3.2);
        osc.connect(b); b.connect(g); g.connect(v.gate);
        source(v, osc, ctx.currentTime, Infinity);
      }
      due.chant = ctx.currentTime + .05; due.bowl = ctx.currentTime + random(18, 28);
    }, 'chant');
  }
  function dawnBirds(on) {
    if (!ready) return;
    if (!on) { stopContinuous('dawnBirds', .8); return; }
    startContinuous('dawnBirds', v => {
      loopNoise(v, 'pink', .012, 1000, 'bandpass', 0); due.dawn = ctx.currentTime + .03;
    }, 'ambient');
  }
  function purr(on) {
    if (!ready) return;
    if (!on) { stopContinuous('purr'); return; }
    startContinuous('purr', v => {
      loopNoise(v, 'brown', .22, 210, 'lowpass', 25, .9);
      loopNoise(v, 'pink', .025, 430, 'bandpass', .28, .6);
    });
  }

  function mixEnvironment() {
    if (Object.keys(environment).length < 5) return;
    const z = env.zone, n = env.nightFactor;
    const indoor = ['hall', 'chamber', 'tea'].includes(z);
    const shelter = indoor ? .22 : 1, dawn = env.hour >= 4.5 && env.hour < 8;
    const birdLevel = (1 - n) * (z === 'musang' ? .13 : z === 'chamber' ? .08 : shelter) * (dawn ? 1.25 : 1);
    const levels = {
      wind: shelter * (z === 'forest' ? .9 : z === 'musang' ? .95 : .65),
      pine: z === 'musang' ? 1 : z === 'forest' ? .4 : indoor ? .05 : .12,
      water: z === 'water' ? 1 : z === 'bamboo' ? .18 : z === 'tea' ? .06 : .015,
      bamboo: z === 'bamboo' ? 1 : z === 'forest' ? .08 : 0,
      crickets: n * shelter * .75
    };
    for (const [name, value] of Object.entries(levels)) fade(environment[name].gate.gain, value, 2);
    const events = { bird: birdLevel, owl: n * shelter, chime: indoor ? .18 : .7, bell: indoor ? .2 : .45, bamboo: z === 'bamboo' ? 1 : 0 };
    for (const [name, value] of Object.entries(events)) fade(eventGains[name].gain, value, 2);
    setRoom(indoor ? z : 'outdoor');
  }
  function setEnvironment(next = {}) {
    if (!ready || !next) return;
    const zone = ZONES.has(next.zone) ? next.zone : env.zone;
    const hour = Number.isFinite(next.hour) ? ((next.hour % 24) + 24) % 24 : env.hour;
    const night = clamp(next.nightFactor, 0, 1, env.nightFactor);
    // game.js는 매 프레임 불러도 된다. 같은 목표로 페이드를 되감지 않는다.
    if (zone === env.zone && Math.abs(hour - env.hour) < .015 && Math.abs(night - env.nightFactor) < .002) return;
    Object.assign(env, { zone, hour, nightFactor: night }); mixEnvironment();
  }
  function tick() {
    if (!ready || ctx.state !== 'running') return;
    const now = ctx.currentTime, dt = Math.min(.5, Math.max(0, now - lastTick)); lastTick = now;
    for (const v of voices) if (now > v.deadAt || (!v.keep && now > v.end + .15)) cleanup(v);
    for (const [key, room] of rooms) if (now > room.retireAt) removeRoom(key, room);
    const z = env.zone, night = env.nightFactor;
    if (now >= due.bird) {
      if (night < .95) bird(eventGains.bird);
      due.bird = now + random(2.5, 7) * (z === 'musang' ? 3 : env.hour < 8 && env.hour > 4.5 ? .5 : 1);
    }
    if (now >= due.chime) { strike('windChime', { gain: .28 }, 'ambient', eventGains.chime); due.chime = now + random(19, 42); }
    if (now >= due.owl) { if (night > .3) owl(); due.owl = now + random(38, 78); }
    if (now >= due.bell) { strike('bell', { gain: .17 }, 'ambient', eventGains.bell); due.bell = now + random(85, 155); }
    if (now >= due.bamboo) { if (z === 'bamboo') bambooKnock(); due.bamboo = now + random(4, 10); }
    if (continuous.has('fire') && now >= due.fire) {
      if (fireIntensity > .01) strike('crackle', { gain: random(.12, .36) * fireIntensity }, 'ambient', continuous.get('fire').gate, 'fire');
      due.fire = now + random(.15, .8) / (.35 + fireIntensity);
    }
    if (continuous.has('heartbeat')) {
      bpm += (targetBpm - bpm) * (1 - Math.exp(-dt / 1.8));
      if (now >= due.heartbeat) { heartBeatPair(); due.heartbeat = now + 60 / bpm; }
    }
    if (continuous.has('chant')) {
      const root = continuous.get('chant');
      if (now + .025 >= due.chant) {
        strike('moktak', { gain: .32 }, 'chant', root.gate, 'chant');
        // 일정한 72bpm. 백그라운드 지연 뒤에는 밀린 타격을 몰아서 재생하지 않는다.
        due.chant = Math.max(due.chant + 60 / 72, now + .1);
      }
      if (now >= due.bowl) { strike('bowl', { gain: .30 }, 'chant', root.gate, 'chant'); due.bowl = now + random(25, 43); }
    }
    if (continuous.has('dawnBirds') && now >= due.dawn) {
      bird(continuous.get('dawnBirds').gate, .85, true, 'dawnBirds'); due.dawn = now + random(.7, 1.8);
    }
  }
  function initialize() {
    master = own(gainNode(volumes.master));
    const highpass = own(ctx.createBiquadFilter()); highpass.type = 'highpass'; highpass.frequency.value = 24; highpass.Q.value = .55;
    limiter = own(ctx.createDynamicsCompressor());
    limiter.threshold.value = -10; limiter.knee.value = 5; limiter.ratio.value = 20;
    limiter.attack.value = .002; limiter.release.value = .18;
    // Compressor의 짧은 피크도 ±0.92 아래에 두는 마지막 완만한 포화 단계.
    safety = own(ctx.createWaveShaper());
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) { const x = i * 2 / (curve.length - 1) - 1; curve[i] = .92 * Math.tanh(x / .92); }
    safety.curve = curve; safety.oversample = 'none';
    highpass.connect(master); master.connect(limiter); limiter.connect(safety); safety.connect(ctx.destination);
    for (const name of ['ambient', 'sfx', 'chant']) {
      const input = own(gainNode()), dry = own(gainNode(.94)), volume = own(gainNode(volumes[name]));
      input.connect(dry); dry.connect(volume); volume.connect(highpass); buses[name] = { input, dry, volume };
    }
    ambientDuck = own(gainNode(duck)); ambientDuck.connect(buses.ambient.input);
    for (const name of ['bird', 'owl', 'chime', 'bell', 'bamboo']) {
      eventGains[name] = own(gainNode(0)); eventGains[name].connect(ambientDuck);
    }
    ready = true;
    for (const name of ['wind', 'pine', 'water', 'bamboo', 'crickets']) {
      const v = voice(`environment:${name}`, { channel: 'ambient', keep: true, gap: 0 });
      // 처음 Context가 suspended이면 unlock의 resume 뒤 setupEnvironment를 부른다.
      if (v) setupLayer(name, v);
    }
  }
  function setupLayer(name, v) {
    v.gate.gain.value = 0;
    if (name === 'wind') loopNoise(v, 'pink', .12, 720, 'bandpass', .055, .55);
    if (name === 'pine') loopNoise(v, 'brown', .20, 700, 'lowpass', .035, .38);
    if (name === 'water') {
      loopNoise(v, 'white', .12, 2200, 'lowpass', 2.7, .14);
      loopNoise(v, 'pink', .05, 700, 'bandpass', .32, .2);
    }
    if (name === 'bamboo') loopNoise(v, 'pink', .11, 2200, 'highpass', .14, .70);
    if (name === 'crickets') {
      const src = ctx.createBufferSource(); src.buffer = shapedBuffer('crickets'); src.loop = true;
      const level = track(v, gainNode(.18)); src.connect(level); level.connect(v.gate); source(v, src, ctx.currentTime, Infinity);
    }
    seal(v); environment[name] = v;
  }
  function setupEnvironment() {
    for (const name of ['wind', 'pine', 'water', 'bamboo', 'crickets']) {
      if (!environment[name]) {
        const v = voice(`environment:${name}`, { channel: 'ambient', keep: true, gap: 0 });
        if (v) setupLayer(name, v);
      }
    }
    if (Object.keys(environment).length < 5) return;
    mixEnvironment();
    if (timer === null) {
      Object.assign(due, { bird: ctx.currentTime + 1.2, chime: ctx.currentTime + 15, owl: ctx.currentTime + 35, bell: ctx.currentTime + 70, bamboo: ctx.currentTime + 5 });
      lastTick = ctx.currentTime; timer = setInterval(tick, 50);
    }
  }
  async function unlock() {
    if (disposed) return false;
    try {
      if (!ctx) {
        const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioCtor) return false;
        ctx = new AudioCtor({ latencyHint: 'interactive' }); initialize();
      }
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') await ctx.resume();
      if (ctx.state === 'running') setupEnvironment();
      return ctx.state === 'running';
    } catch { return false; }
  }
  function setVolumes(next = {}) {
    if (!ready || !next) return;
    for (const name of ['master', 'ambient', 'sfx', 'chant']) {
      if (!Number.isFinite(next[name])) continue;
      volumes[name] = clamp(next[name], 0, 1);
      fade(name === 'master' ? master.gain : buses[name].volume.gain, name === 'master' && muted ? 0 : volumes[name], .08);
    }
  }
  function setMuted(on) { if (!ready) return; muted = Boolean(on); fade(master.gain, muted ? 0 : volumes.master, .08); }
  function setDuck(level, sec = 1.5) { if (!ready) return; duck = clamp(level, 0, 1, duck); fade(ambientDuck.gain, duck, clamp(sec, 0, 30, 1.5)); }
  async function suspend() { if (!ready) return; try { await ctx.suspend(); } catch {} }
  async function resume() {
    if (!ready) return;
    try { await ctx.resume(); if (ctx.state === 'running') setupEnvironment(); } catch {}
  }
  // 선택적인 시험/페이지 종료용. 게임은 계약상 아래 두 함수를 부르지 않아도 된다.
  function inspect() {
    return {
      ready, state: ctx?.state || 'locked', voices: voices.size, sources: totalSources,
      nodes: [...voices].reduce((sum, v) => sum + v.nodes.size, infrastructure.size) + rooms.size * 9,
      maxVoices: VOICE_LIMIT, maxSources: SOURCE_LIMIT, dropped,
      continuous: [...continuous.keys()], room: roomKey, reverbs: rooms.size,
      impulseSeconds: roomKey ? ROOMS[roomKey] : 0,
      buffers: buffers.size + impulses.size, environment: { ...env }, volumes: { ...volumes },
      muted, duck, bpm, targetBpm, fireIntensity, compressionDB: limiter?.reduction || 0,
      voiceKeys: [...voices].map(v => v.key)
    };
  }
  async function dispose() {
    if (!ready) return;
    disposed = true; ready = false;
    if (timer !== null) clearInterval(timer); timer = null;
    for (const v of voices) cleanup(v);
    continuous.clear();
    for (const [key, room] of rooms) removeRoom(key, room);
    for (const n of infrastructure) n.disconnect(); infrastructure.clear();
    buffers.clear(); impulses.clear();
    try { await ctx.close(); } catch {}
  }
  const api = { unlock, get ready() { return ready; }, setVolumes, setMuted, suspend, resume,
    setEnvironment, setDuck, step, fire, heartbeat, breath, chant, dawnBirds, purr, inspect, dispose };
  for (const name of ['moktak', 'bell', 'bowl', 'yoryeong', 'chime', 'bead', 'jukbi', 'windChime', 'cloth', 'match', 'pour', 'sip', 'cupDown', 'sweep', 'leaves', 'logThud', 'crackle', 'paperBurn', 'lidClose', 'lidOpen', 'shutter', 'meow', 'tap']) {
    api[name] = (opts) => { if (ready) strike(name, opts); };
  }
  return api;
}
