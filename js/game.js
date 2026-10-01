/* ============================================================
   BLOCKY BUDDIES - a tiny Roblox-like sandbox for ages 3-7
   Explore, build, collect stars. No enemies, no losing, just fun.
   ============================================================ */
import * as THREE from 'three';

/* ---------------- Config ---------------- */
const BLOCK = 1;
const WORLD_R = 21;            // island radius in blocks
const GRAVITY = -22;
const JUMP_V = 8.5;
const WALK_SPEED = 5.2;
const STAR_COUNT = 12;

/* ---------------- State ---------------- */
let scene, camera, renderer, clock;
let avatar, avatarParts = {};
let vel = new THREE.Vector3();
let onGround = true;
let yaw = 0;                    // camera/player facing angle
let keys = {};
let joy = { x: 0, y: 0, active: false };
let blockColor = 0x4d96ff;
let buddyColor = 0x4d96ff;
let starsCollected = 0;
let soundOn = true;
let started = false;
let audioCtx = null, musicTimer = null;
const placedBlocks = new Map(); // "x,y,z" -> mesh
const stars = [];
const bunnies = [];
const particles = [];
const clouds = [];

const key = (x, y, z) => `${x},${y},${z}`;

/* ---------------- Audio (tiny synth, no files) ---------------- */
function ac() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur = 0.15, type = 'sine', vol = 0.25, when = 0) {
  if (!soundOn) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  jump()    { tone(300, 0.18, 'sine', 0.22); tone(520, 0.15, 'sine', 0.18, 0.07); },
  collect() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.22, i * 0.07)); },
  place()   { tone(180, 0.1, 'square', 0.15); tone(240, 0.12, 'square', 0.12, 0.05); },
  dig()     { tone(420, 0.1, 'sawtooth', 0.12); tone(200, 0.14, 'sawtooth', 0.1, 0.06); },
  boing()   { tone(150, 0.25, 'sine', 0.2); },
};
function startMusic() {
  if (musicTimer || !soundOn) return;
  const melody = [523, 587, 659, 784, 659, 587, 523, 440];
  let i = 0;
  const play = () => {
    if (!soundOn || !started) return;
    tone(melody[i % melody.length], 0.35, 'sine', 0.06);
    i++;
    musicTimer = setTimeout(play, 420);
  };
  play();
}
function stopMusic() { clearTimeout(musicTimer); musicTimer = null; }

/* ---------------- Terrain ---------------- */
function terrainH(x, z) {
  const d = Math.hypot(x, z);
  if (d > WORLD_R) return -99; // ocean
  const h = Math.round(
    1.4 * Math.sin(x * 0.28) * Math.cos(z * 0.24) +
    0.8 * Math.sin(x * 0.12 + 2) * Math.sin(z * 0.15 + 1)
  );
  return h;
}
function groundYAt(x, z) {
  let g = terrainH(x, z);
  if (g < -50) return -99;
  const bx = Math.round(x), bz = Math.round(z);
  for (let y = g + 6; y > g; y--) {
    if (placedBlocks.has(key(bx, y, bz))) { g = y; break; }
  }
  return g + BLOCK / 2; // stand on top of block
}

/* ---------------- World building ---------------- */
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function buildWorld() {
  // Sky
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 95);

  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x7ec850, 0.95));
  const sun = new THREE.DirectionalLight(0xfff6d8, 1.6);
  sun.position.set(25, 40, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -35; sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35;
  scene.add(sun);

  // Terrain (instanced boxes)
  const geo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  const positions = [];
  for (let x = -WORLD_R; x <= WORLD_R; x++)
    for (let z = -WORLD_R; z <= WORLD_R; z++) {
      const h = terrainH(x, z);
      if (h < -50) continue;
      positions.push([x, h, z]);
    }
  const terrain = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), positions.length);
  const dummy = new THREE.Object3D();
  const cGrass = new THREE.Color(0x6fbf4a), cSand = new THREE.Color(0xe8d48b), tmp = new THREE.Color();
  positions.forEach(([x, h, z], i) => {
    dummy.position.set(x, h, z);
    dummy.updateMatrix();
    terrain.setMatrixAt(i, dummy.matrix);
    const d = Math.hypot(x, z);
    tmp.copy(cGrass);
    if (d > WORLD_R - 3) tmp.copy(cSand);                    // beach ring
    const v = 0.92 + Math.random() * 0.16;                   // variation
    terrain.setColorAt(i, tmp.clone().multiplyScalar(v));
  });
  terrain.receiveShadow = true;
  terrain.instanceColor.needsUpdate = true;
  scene.add(terrain);
  // keep terrain blocks targetable for placing on top
  terrain.userData.isTerrain = true;
  window.__terrainMesh = terrain;

  // Ocean
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshLambertMaterial({ color: 0x3aa7e0, transparent: true, opacity: 0.9 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.6;
  scene.add(ocean);

  // Sandy rim under island edge
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(WORLD_R + 0.6, WORLD_R + 0.2, 1.4, 40),
    new THREE.MeshLambertMaterial({ color: 0xe8d48b })
  );
  rim.position.y = -1.4;
  scene.add(rim);

  // Trees
  for (let i = 0; i < 14; i++) {
    let x = 0, z = 0;
    do {
      x = Math.round((Math.random() * 2 - 1) * (WORLD_R - 5));
      z = Math.round((Math.random() * 2 - 1) * (WORLD_R - 5));
    } while (Math.hypot(x, z) < 4 || Math.hypot(x, z) > WORLD_R - 5);
    const h = terrainH(x, z);
    const tree = new THREE.Group();
    tree.add(box(0.5, 1.6, 0.5, 0x8b5a2b, 0, h + 1.1, 0));
    const leafC = [0x3e9e4f, 0x4caf50, 0x2f8f3e][i % 3];
    tree.add(box(1.8, 1.4, 1.8, leafC, 0, h + 2.4, 0));
    tree.add(box(1.2, 1.0, 1.2, leafC, 0, h + 3.2, 0));
    tree.position.set(x, 0, z);
    scene.add(tree);
  }

  // Flowers
  const flowerGeo = new THREE.BoxGeometry(0.22, 0.5, 0.22);
  const flowerCols = [0xff6b9d, 0xffd93d, 0xffffff, 0xff9f45, 0xc084fc];
  for (let i = 0; i < 40; i++) {
    let x = 0, z = 0;
    do {
      x = Math.round((Math.random() * 2 - 1) * (WORLD_R - 3));
      z = Math.round((Math.random() * 2 - 1) * (WORLD_R - 3));
    } while (Math.hypot(x, z) < 3 || Math.hypot(x, z) > WORLD_R - 3);
    const f = new THREE.Mesh(flowerGeo, new THREE.MeshLambertMaterial({ color: flowerCols[i % 5] }));
    f.position.set(x + 0.3, terrainH(x, z) + 0.75, z - 0.2);
    scene.add(f);
  }

  // Clouds (drifting white box clusters)
  for (let i = 0; i < 7; i++) {
    const cl = new THREE.Group();
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    [[0, 0, 0, 4, 1.4, 2.4], [2.2, 0.3, 0.4, 2.6, 1.2, 2], [-2.2, 0.2, -0.3, 2.4, 1.1, 1.8]].forEach(([px, py, pz, w, h, d]) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cm);
      p.position.set(px, py, pz); cl.add(p);
    });
    cl.position.set((Math.random() * 2 - 1) * 55, 16 + Math.random() * 7, (Math.random() * 2 - 1) * 55);
    cl.userData.speed = 0.4 + Math.random() * 0.5;
    clouds.push(cl); scene.add(cl);
  }

  // Rainbow arch (pure decoration, kids love it)
  const rainbow = new THREE.Group();
  [0xff5b5b, 0xff9f45, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xb983ff].forEach((c, i) => {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(9 - i * 0.7, 0.35, 8, 40, Math.PI),
      new THREE.MeshBasicMaterial({ color: c })
    );
    arc.position.y = 0; rainbow.add(arc);
  });
  rainbow.position.set(-WORLD_R + 6, 2, -WORLD_R + 4);
  rainbow.rotation.y = Math.PI / 5;
  scene.add(rainbow);
}

/* ---------------- Avatar (blocky buddy) ---------------- */
function buildAvatar(color) {
  const g = new THREE.Group();
  const skin = 0xffd9b3;
  const head = box(0.62, 0.55, 0.55, skin, 0, 1.62, 0);
  // eyes (white + pupil boxes stuck on face)
  const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeP = new THREE.MeshBasicMaterial({ color: 0x222222 });
  [-0.14, 0.14].forEach(ex => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.02), eyeW);
    w.position.set(ex, 1.66, 0.285); g.add(w);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.02), eyeP);
    p.position.set(ex, 1.65, 0.30); g.add(p);
  });
  // smile
  const smile = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x8a4b2a }));
  smile.position.set(0, 1.48, 0.285); g.add(smile);

  g.add(head);
  const body = box(0.62, 0.7, 0.4, color, 0, 1.0, 0); g.add(body);
  // limbs hang from shoulder/hip pivots so they can swing while walking
  const limb = (w, h, d, c, px, py, pz, cy) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    pivot.add(box(w, h, d, c, 0, cy - py, 0));
    g.add(pivot);
    return pivot;
  };
  avatarParts.armL = limb(0.20, 0.62, 0.24, color, -0.42, 1.30, 0, 1.00);
  avatarParts.armR = limb(0.20, 0.62, 0.24, color,  0.42, 1.30, 0, 1.00);
  avatarParts.legL = limb(0.24, 0.62, 0.28, 0x3a5a9c, -0.16, 0.64, 0, 0.33);
  avatarParts.legR = limb(0.24, 0.62, 0.28, 0x3a5a9c,  0.16, 0.64, 0, 0.33);
  avatarParts.head = head;
  return g;
}

/* ---------------- Stars ---------------- */
function makeStar() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.42 : 0.19;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    i === 0 ? shape.moveTo(Math.cos(a) * r, Math.sin(a) * r) : shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const star = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }),
    new THREE.MeshLambertMaterial({ color: 0xffd93d, emissive: 0x8a6d00 })
  );
  star.position.z = -0.09;
  g.add(star);
  return g;
}
function spawnStar() {
  const s = makeStar();
  let x = 0, z = 0;
  do {
    x = Math.round((Math.random() * 2 - 1) * (WORLD_R - 4));
    z = Math.round((Math.random() * 2 - 1) * (WORLD_R - 4));
  } while (Math.hypot(x, z) > WORLD_R - 4);
  const h = terrainH(x, z);
  s.position.set(x, h + 1.6, z);
  s.userData = { baseY: h + 1.6, phase: Math.random() * 6.28, alive: true, respawn: 0 };
  scene.add(s); stars.push(s);
}
function collectStar(s) {
  s.userData.alive = false; s.userData.respawn = 20;
  s.visible = false;
  starsCollected++;
  document.getElementById('star-count').textContent = starsCollected;
  localStorage.setItem('bb_stars', starsCollected);
  sfx.collect();
  burst(s.position, 0xffd93d, 14);
  if (starsCollected % 10 === 0) { // mini celebration every 10
    for (let i = 0; i < 3; i++)
      setTimeout(() => burst(avatar.position.clone().add(new THREE.Vector3(0, 2, 0)), [0xff6b6b, 0x4d96ff, 0x6bcb77][i], 16), i * 180);
  }
}

/* ---------------- Particles (confetti pops) ---------------- */
function burst(pos, color, n = 12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14),
      new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 5 + 2, (Math.random() - 0.5) * 5);
    m.userData.life = 0.9;
    scene.add(m); particles.push(m);
  }
}

/* ---------------- Bunnies (friendly wanderers) ---------------- */
function makeBunny() {
  const g = new THREE.Group();
  const white = 0xfdfdfd;
  g.add(box(0.5, 0.42, 0.7, white, 0, 0.35, 0));
  g.add(box(0.42, 0.4, 0.42, white, 0, 0.72, 0.28));
  g.add(box(0.12, 0.5, 0.12, white, -0.12, 1.1, 0.28));
  g.add(box(0.12, 0.5, 0.12, white, 0.12, 1.1, 0.28));
  g.add(box(0.14, 0.14, 0.4, 0xffb3c7, 0, 0.35, -0.45)); // tail
  g.userData = {
    dir: Math.random() * Math.PI * 2, timer: 0,
    hopT: 0, home: new THREE.Vector3()
  };
  return g;
}
function spawnBunnies() {
  const cols = [0xfdfdfd, 0xe8d8c8, 0xcfd8dc];
  for (let i = 0; i < 3; i++) {
    const b = makeBunny();
    const x = (Math.random() * 2 - 1) * 10, z = (Math.random() * 2 - 1) * 10;
    b.position.set(x, terrainH(Math.round(x), Math.round(z)) + 0.5, z);
    b.children.forEach(c => { if (c.material.color) c.material = c.material.clone(); });
    b.children[0].material.color.setHex(cols[i]);
    b.children[1].material.color.setHex(cols[i]);
    scene.add(b); bunnies.push(b);
  }
}

/* ---------------- Build / Dig ---------------- */
const raycaster = new THREE.Raycaster();
let highlight = null;
function getHighlightMesh() {
  if (!highlight) {
    highlight = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 1.04),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }));
    highlight.renderOrder = 5;
    highlight.visible = false;
    scene.add(highlight);
  }
  return highlight;
}
function getTarget() {
  if (!avatar) return null;
  // Aim from the buddy's head along the camera's view direction, so blocks
  // always land in front of the buddy where the kid is looking.
  const origin = avatar.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const dir = camera.getWorldDirection(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = 12;
  const meshes = [...placedBlocks.values()];
  if (window.__terrainMesh) meshes.push(window.__terrainMesh);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits[0] || null;
}
/* Block coordinates of whatever the crosshair is pointing at.
   Handles both the instanced terrain and individually placed blocks. */
function targetBlockPos(t) {
  if (t.object.userData.isTerrain && t.instanceId !== undefined) {
    const m = new THREE.Matrix4();
    window.__terrainMesh.getMatrixAt(t.instanceId, m);
    return new THREE.Vector3().setFromMatrixPosition(m).round();
  }
  return t.object.position.clone().round();
}
function updateHighlight() {
  const t = getTarget();
  const hl = getHighlightMesh();
  if (!t) { hl.visible = false; return; }
  hl.visible = true;
  hl.position.copy(targetBlockPos(t));
}
function blockKeyOf(mesh) {
  for (const [k, v] of placedBlocks) if (v === mesh) return k;
  return null;
}
function placeBlock() {
  const t = getTarget();
  if (!t) return;
  const bp = targetBlockPos(t).add(t.face.normal.clone().round());
  const k = key(bp.x, bp.y, bp.z);
  if (placedBlocks.has(k)) return;
  if (Math.hypot(bp.x, bp.z) > WORLD_R + 1 || bp.y > 14 || bp.y < -2) return;
  // don't place inside the buddy
  const ap = avatar.position;
  if (Math.abs(bp.x - ap.x) < 1 && Math.abs(bp.z - ap.z) < 1 && bp.y < ap.y + 2 && bp.y > ap.y - 1) return;
  const m = box(BLOCK, BLOCK, BLOCK, blockColor, bp.x, bp.y, bp.z);
  scene.add(m); placedBlocks.set(k, m);
  sfx.place();
  burst(bp.clone(), blockColor, 6);
}
function digBlock() {
  const t = getTarget();
  if (!t) return;
  const k = blockKeyOf(t.object);
  if (!k) return; // only player-built blocks can be dug
  const m = placedBlocks.get(k);
  burst(m.position.clone(), m.material.color.getHex(), 8);
  scene.remove(m);
  m.geometry.dispose(); m.material.dispose();
  placedBlocks.delete(k);
  getHighlightMesh().visible = false;
  sfx.dig();
}

/* ---------------- Controls ---------------- */
function setupControls() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    window.__dbgLastKey = e.code;
    if (e.code === 'Space') { e.preventDefault(); doJump(); }
    if (e.code === 'KeyE') placeBlock();
    if (e.code === 'KeyQ') digBlock();
  });
  addEventListener('keyup', e => keys[e.code] = false);

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
    || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (isTouch) {
    document.getElementById('touch-controls').classList.remove('hidden');
    const joyEl = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let joyId = null;
    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    joyEl.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joy.active = true; }, { passive: true });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const r = joyEl.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const max = 42, len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        setKnob(dx, dy);
        joy.x = dx / max; joy.y = dy / max;
      }
    }, { passive: true });
    const endJoy = e => {
      for (const t of e.changedTouches) if (t.identifier === joyId) {
        joyId = null; joy.active = false; joy.x = joy.y = 0; setKnob(0, 0);
      }
    };
    addEventListener('touchend', endJoy); addEventListener('touchcancel', endJoy);
    document.getElementById('btn-jump').addEventListener('touchstart', e => { e.preventDefault(); doJump(); }, { passive: false });
    document.getElementById('btn-place').addEventListener('touchstart', e => { e.preventDefault(); placeBlock(); }, { passive: false });
    document.getElementById('btn-dig').addEventListener('touchstart', e => { e.preventDefault(); digBlock(); }, { passive: false });
  } else {
    document.getElementById('key-hints').classList.remove('hidden');
  }

  // color pickers
  document.querySelectorAll('#color-picker .color-dot').forEach(d => {
    d.addEventListener('click', () => {
      document.querySelectorAll('#color-picker .color-dot').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      blockColor = parseInt(d.dataset.color);
      tone(600, 0.08, 'sine', 0.12);
    });
  });
  document.querySelectorAll('#buddy-colors .buddy-dot').forEach(d => {
    d.addEventListener('click', () => {
      document.querySelectorAll('#buddy-colors .buddy-dot').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      buddyColor = parseInt(d.dataset.color);
      localStorage.setItem('bb_color', buddyColor);
      tone(600, 0.08, 'sine', 0.12);
    });
  });

  // HUD buttons
  document.getElementById('sound-btn').addEventListener('click', function () {
    soundOn = !soundOn;
    this.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) startMusic(); else stopMusic();
  });
  document.getElementById('help-btn').addEventListener('click', () =>
    document.getElementById('help-overlay').classList.remove('hidden'));
  document.getElementById('help-close').addEventListener('click', () =>
    document.getElementById('help-overlay').classList.add('hidden'));
  document.getElementById('play-btn').addEventListener('click', startGame);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function doJump() {
  if (!started || !onGround) return;
  vel.y = JUMP_V; onGround = false;
  sfx.jump();
}

/* ---------------- Game loop ---------------- */
let walkPhase = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (started) {
    // --- movement input ---
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz -= 1;
    if (keys.KeyS || keys.ArrowDown) iz += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    if (joy.active) { ix += joy.x; iz += joy.y; }
    const moving = Math.hypot(ix, iz) > 0.15;

    if (moving) {
      const mag = Math.min(1, Math.hypot(ix, iz));
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      // camera-relative: W = away from camera, D = camera's right
      let mx = sin * -iz + (-cos) * ix;
      let mz = cos * -iz + sin * ix;
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      // smooth turn toward desired facing (shortest angle)
      const desired = Math.atan2(mx, mz);
      let dyaw = desired - yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      yaw += dyaw * Math.min(1, dt * 10);
      avatar.rotation.y = yaw;
      // walk forward along facing
      const sp = WALK_SPEED * mag * dt;
      const nx = avatar.position.x + Math.sin(yaw) * sp;
      const nz = avatar.position.z + Math.cos(yaw) * sp;
      if (Math.hypot(nx, nz) < WORLD_R - 0.6) { avatar.position.x = nx; avatar.position.z = nz; }
      walkPhase += dt * 11;
      const s = Math.sin(walkPhase) * 0.55;
      avatarParts.armL.rotation.x = s; avatarParts.armR.rotation.x = -s;
      avatarParts.legL.rotation.x = -s; avatarParts.legR.rotation.x = s;
    } else {
      avatarParts.armL.rotation.x *= 0.85; avatarParts.armR.rotation.x *= 0.85;
      avatarParts.legL.rotation.x *= 0.85; avatarParts.legR.rotation.x *= 0.85;
    }

    // --- gravity & ground ---
    vel.y += GRAVITY * dt;
    avatar.position.y += vel.y * dt;
    const gy = groundYAt(avatar.position.x, avatar.position.z);
    if (avatar.position.y <= gy) {
      if (!onGround && vel.y < -9) sfx.boing();
      avatar.position.y = gy; vel.y = 0; onGround = true;
    } else onGround = false;
    if (avatar.position.y < -12) { // safety net
      avatar.position.set(0, groundYAt(0, 0), 4); vel.y = 0;
    }

    // --- camera follow ---
    const camDist = 7.5, camH = 4.6;
    const cx = avatar.position.x - Math.sin(yaw) * camDist;
    const cz = avatar.position.z - Math.cos(yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(cx, avatar.position.y + camH, cz), 1 - Math.pow(0.001, dt));
    camera.lookAt(avatar.position.x, avatar.position.y + 1.4, avatar.position.z);

    updateHighlight();

    // --- stars ---
    for (const s of stars) {
      const u = s.userData;
      if (!u.alive) {
        u.respawn -= dt;
        if (u.respawn <= 0) {
          let x = 0, z = 0;
          do {
            x = Math.round((Math.random() * 2 - 1) * (WORLD_R - 4));
            z = Math.round((Math.random() * 2 - 1) * (WORLD_R - 4));
          } while (Math.hypot(x, z) > WORLD_R - 4);
          const h = terrainH(x, z);
          s.position.set(x, h + 1.6, z);
          u.baseY = h + 1.6; u.alive = true; s.visible = true;
        }
        continue;
      }
      s.rotation.y += dt * 2.2;
      s.position.y = u.baseY + Math.sin(t * 2.4 + u.phase) * 0.25;
      if (s.position.distanceTo(avatar.position.clone().add(new THREE.Vector3(0, 1, 0))) < 1.4) collectStar(s);
    }

    // --- bunnies hop around ---
    for (const b of bunnies) {
      const u = b.userData;
      u.timer -= dt;
      if (u.timer <= 0) { u.dir = Math.random() * Math.PI * 2; u.timer = 1.5 + Math.random() * 2.5; }
      u.hopT += dt * 6;
      const hop = Math.abs(Math.sin(u.hopT)) * 0.45;
      b.position.x += Math.sin(u.dir) * dt * 1.6;
      b.position.z += Math.cos(u.dir) * dt * 1.6;
      if (Math.hypot(b.position.x, b.position.z) > WORLD_R - 3) u.dir += Math.PI;
      b.position.y = terrainH(Math.round(b.position.x), Math.round(b.position.z)) + 0.5 + hop;
      b.rotation.y = u.dir;
    }

    // --- particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= dt;
      p.userData.v.y -= 12 * dt;
      p.position.addScaledVector(p.userData.v, dt);
      p.rotation.x += dt * 5; p.rotation.y += dt * 4;
      if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    }
  }

  // clouds always drift
  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 65) c.position.x = -65;
  }

  renderer.render(scene, camera);
  window.__dbgFrames++;
}

/* ---------------- Boot ---------------- */
function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, 6, 12);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);
  clock = new THREE.Clock();

  buildWorld();
  for (let i = 0; i < STAR_COUNT; i++) spawnStar();
  spawnBunnies();

  const savedColor = parseInt(localStorage.getItem('bb_color') || buddyColor);
  buddyColor = savedColor;
  avatar = buildAvatar(buddyColor);
  const gy = groundYAt(0, 4);
  avatar.position.set(0, gy, 4);
  scene.add(avatar);

  starsCollected = parseInt(localStorage.getItem('bb_stars') || '0');
  document.getElementById('star-count').textContent = starsCollected;

  // reflect saved buddy color in picker
  document.querySelectorAll('#buddy-colors .buddy-dot').forEach(d => {
    d.classList.toggle('selected', parseInt(d.dataset.color) === buddyColor);
  });

  setupControls();
  animate();
}

function startGame() {
  ac(); // unlock audio on user gesture
  started = true;
  document.getElementById('start-overlay').classList.add('hidden');
  document.getElementById('color-picker').classList.remove('hidden');
  // rebuild avatar with chosen color
  scene.remove(avatar);
  avatarParts = {};
  avatar = buildAvatar(buddyColor);
  const gy = groundYAt(0, 4);
  avatar.position.set(0, gy, 4);
  scene.add(avatar);
  startMusic();
  tone(523, 0.15, 'triangle', 0.2); tone(784, 0.2, 'triangle', 0.2, 0.12);
}

/* Debug hooks (used by automated smoke tests) */
window.__dbgPos = () => avatar ? avatar.position.toArray().map(v => v.toFixed(2)).join(',') : 'no-avatar';
window.__dbgBlocks = () => placedBlocks.size;
window.__dbgTeleport = (x, z) => { avatar.position.set(x, groundYAt(x, z), z); vel.y = 0; };
window.__dbgStars = () => stars.filter(s => s.userData.alive).map(s => [Math.round(s.position.x), Math.round(s.position.z)]);
window.__dbgDig = () => { digBlock(); return placedBlocks.size; };
window.__dbgAim = () => { const t = getTarget(); return t ? (blockKeyOf(t.object) || 'terrain') : 'none'; };
window.__dbgBlockInfo = () => {
  const arr = [...placedBlocks.values()];
  let manual = null, mw = null;
  if (arr.length) {
    const m = arr[0];
    const origin = avatar.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const rc = new THREE.Raycaster(origin, dir); rc.far = 8;
    const hits = rc.intersectObject(m, false);
    manual = hits.length ? +hits[0].distance.toFixed(2) : 'miss';
    mw = [...m.matrixWorld.elements].map(v => +v.toFixed(2));
  }
  return {
    count: arr.length,
    pos: arr.map(m => m.position.toArray().map(v => +v.toFixed(2))),
    inScene: arr.map(m => m.parent === scene),
    visible: arr.map(m => m.visible),
    manualHit: manual,
    matrixWorld: mw,
  };
};
window.__dbgRay = () => {
  const t = getTarget();
  if (!t) return { hit: 'none' };
  return {
    hit: blockKeyOf(t.object) || (t.object.userData.isTerrain ? 'terrain' : 'other'),
    dist: +t.distance.toFixed(2),
    point: t.point.toArray().map(v => +v.toFixed(2)),
    normal: t.face ? t.face.normal.toArray().map(v => +v.toFixed(2)) : null,
    avatar: avatar.position.toArray().map(v => +v.toFixed(2)),
  };
};
window.__dbgLastKey = null;
window.__dbgFrames = 0;
window.__dbgForceUpdate = () => {
  scene.updateMatrixWorld(true);
  const arr = [...placedBlocks.values()];
  return arr.length ? [...arr[0].matrixWorld.elements].map(v => +v.toFixed(2)) : null;
};
window.__dbgCam = () => ({
  pos: camera.position.toArray().map(v => +v.toFixed(2)),
  dir: camera.getWorldDirection(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)),
});

init();
