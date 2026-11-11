/* ══════════════════════════════════════════
   PLAY — 3D PEGBOARD
   Reads the pieces from <ul class="play-list"> and hangs them on a
   SKÅDIS-style pegboard. Units are millimetres.
   Runs on tablet and desktop when motion is allowed and WebGL works;
   otherwise the plain list stays (see play.css).
══════════════════════════════════════════ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BREAKPOINTS = { tablet: 768, desktop: 1200 };   // same as site.css
const COLS   = { desktop: 40, tablet: 20 };           // hole columns per breakpoint
const PITCH  = 40;    // mm between hole columns
const ROW    = 20;    // mm between hole rows; every other row shifted half a pitch
const EDGE   = 80;    // mm of empty board round the pieces (auto layout)
const MARGIN = { desktop: 30, tablet: 24 };           // mm of page shown round the board
const BOARD_T = 5;
const SLOT_R  = 2.5, SLOT_HALF = 5;                   // slot 5 x 15 mm
const PEG_R   = 2.3, PEG_L = 28;
const PANEL_T = 4, PANEL_OUT = 18;                    // panel thickness, how far its foot sits out
const FOV = 24;

const BOARD_COLOUR = 0xf3f2ef;   // white
const PEG_COLOUR   = 0x0000c4;   // Repo cobalt (sampled from the Repo brand frames)
const SCREW_R = 8, SCREW_H = 7;   // corner thumb screw head, mm
const EDGE_COLOUR  = 0xededeb;
const PLACEHOLDER  = 0xd8d8d8;

const html    = document.documentElement;
const stage   = document.querySelector('.peg-stage');
const list    = document.querySelector('.play-list');
const capBox  = stage.querySelector('.peg-caption');
const capText = stage.querySelector('.peg-caption-text');
const capLink = stage.querySelector('.peg-caption-link');
const capShut = stage.querySelector('.peg-caption-close');
const capNav  = stage.querySelector('.peg-caption-nav');
const capSound = stage.querySelector('.peg-sound');
const header  = document.querySelector('.header');
const capNum  = stage.querySelector('.peg-count');

const canRun = matchMedia(`(min-width: ${BREAKPOINTS.tablet}px) and (prefers-reduced-motion: no-preference)`);
const noHover = matchMedia('(hover: none)');

const items = [...list.children].map((li) => {
  const img = li.querySelector('img');
  const a = li.querySelector('a[href]');
  // Every image / video in the item, in order; the first is the front of the piece
  const media = [...li.querySelectorAll('img, video')].map((el) => el.tagName === 'IMG'
    ? { src: el.getAttribute('src'), video: null }                         // still shown on the board
    : { src: el.getAttribute('poster'), video: el.getAttribute('src'),     // video plays on hover / when opened
        sound: el.hasAttribute('data-sound') });
  return {
    media,
    fit: li.dataset.fit === 'contain',   // each image keeps its own shape inside the w x h box
    w: +li.dataset.w || 300,
    h: +li.dataset.h || 300,
    desktop: li.dataset.desktop ? li.dataset.desktop.split(',').map(Number) : null,
    src: media.length ? media[0].src : null,
    text: (li.querySelector('p') || img || li).textContent.trim() || (img && img.alt) || '',
    href: a ? a.href : null,
  };
});

let renderer, scene, camera, board, light, wall, studio;
let bp = null, layout = null;
let pieces = [];            // { item, group, panel, pegs, lift, base }
let hovered = null, focused = null;
let running = false, visible = false, started = false;
const pointer = { x: 0, y: 0, tx: 0, ty: 0, inside: false };
const view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), homePos: new THREE.Vector3(), homeLook: new THREE.Vector3() };
const textures = new Map();
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
let frame = 0, down = null;
let soundOn = true;                                  // opened videos play with sound unless switched off
const win = { s: 1, ch: 1, visH: 1, d: 1, off: 0, boardPx: 1, headerH: 0 };   // the visible window onto the board

/* ── Start / stop with the media query ── */
function sync() {
  if (canRun.matches) {
    if (!started && !start()) return;
    html.classList.add('peg-on');
    resize();
    running = true;
    loop();
  } else {
    html.classList.remove('peg-on');
    running = false;
    unfocus();
  }
}
canRun.addEventListener('change', sync);
sync();

function start() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    return false;                       // no WebGL: the list stays
  }
  started = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);

  // Soft studio reflections, used by the blue plastic only (they'd wash out the photos and board)
  const pmrem = new THREE.PMREMGenerator(renderer);
  studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe4e1dc, 2.2));
  light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.castShadow = true;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.4;
  light.shadow.radius = 3;
  scene.add(light, light.target);

  board = new THREE.Group();
  scene.add(board);

  // Wall behind the board: only its shadows are drawn, the page shows through
  wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.08 }));
  wall.position.z = -BOARD_T - 22;
  wall.receiveShadow = true;
  board.add(wall);

  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; pointer.tx = pointer.ty = 0; if (!noHover.matches && !focused) hovered = null; canvas.style.cursor = ''; loop(); });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  capShut.addEventListener('click', unfocus);
  capSound.addEventListener('click', () => { soundOn = !soundOn; capSound.textContent = soundOn ? '[Sound on]' : '[Sound off]'; loop(); });
  window.addEventListener('scroll', () => { scrollView(); loop(); }, { passive: true });
  stage.querySelector('.peg-prev').addEventListener('click', () => focused && step(focused, -1));
  stage.querySelector('.peg-next').addEventListener('click', () => focused && step(focused, 1));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') unfocus();
    else if (focused && e.key === 'ArrowRight') step(focused, 1);
    else if (focused && e.key === 'ArrowLeft') step(focused, -1);
  });
  window.addEventListener('resize', () => requestAnimationFrame(resize));
  document.addEventListener('visibilitychange', loop);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; playVideos(visible); loop(); }).observe(stage);
  return true;
}

/* ── Layout: where each piece hangs, per breakpoint ── */
function makeLayout(name) {
  const cols = COLS[name];
  const W = cols * PITCH;
  const placed = [];
  // Scattered like a real pegboard: each piece gets a random size (70–125 % of its
  // data-w/h), then tries a dozen random spots across the board and "drops" from the
  // top until it meets the pieces above (Tetris-style), with an uneven gap. It goes
  // where it lands highest, give or take a little chance. So big and small pieces,
  // one to three across, staggered. Seeded, so it's the same layout on every visit.
  const r = (() => { let k = name === 'desktop' ? 11 : 29; return () => rand(k++ * 13.37); })();
  const snap = (v, step = PITCH) => Math.round(v / step) * step;
  const maxW = name === 'desktop' ? W * 0.46 : W * 0.62;
  const boxes = [];                                    // taken space: piece + pegs + stack peek
  const PEG_ROOM = 40, PEEK = 24;

  for (const item of items) {
    const scale = 0.55 + r() * 0.65;                   // some small prints, some big
    const w = Math.min(item.w * scale, maxW), h = item.h * (w / item.w);
    // Candidate spots: random ones, plus tucked in beside each piece already up
    const xs = [];
    for (let c = 0; c < 10; c++) xs.push(EDGE / 2 + r() * (W - EDGE - w));
    for (const b of boxes) xs.push(b.x2 + 40 + r() * 60, b.x1 - w - PEEK - 40 - r() * 60);
    let best = null;
    for (const x0 of xs) {
      if (x0 < EDGE / 2 - 1 || x0 + w > W - EDGE / 2 + 1) continue;
      const x = snap(x0);
      const side = 40 + r() * 50;                      // 40–90 mm between neighbours
      const gap = 50 + r() * 110;                      // 50–160 mm of air above it
      let y = EDGE / 2 + r() * 60;
      for (const b of boxes) {
        if (x < b.x2 + side && x + w + PEEK > b.x1 - side) y = Math.max(y, b.y2 + gap);
      }
      const score = y + r() * 90;                      // mostly the highest spot, with a little chance
      if (!best || score < best.score) best = { x, y: snap(y, ROW), score };
    }
    const p = hang(item, best.x, best.y, w, h, W);
    placed.push(p);
    boxes.push({ x1: p.x, x2: p.x + p.w + PEEK, y2: p.pegY + PEG_ROOM });
  }
  const bottom = Math.max(...placed.map((p) => p.pegY)) + EDGE;
  const H = Math.ceil(bottom / PITCH) * PITCH;
  return { name, cols, W, H, placed, margin: MARGIN[name] };
}

// Snap a piece onto two pegs in the nearest row of holes under it.
// Hole centres (y down from the board's top-left): y = 10 + 20r, x = 10 or 30 + 40c.
function hang(item, x, y, w, h, W) {
  const want = y + h + PEG_R - SLOT_HALF;                 // hole centre that puts the peg under the foot
  const r = Math.max(0, Math.round((want - 10) / ROW));
  const holeY = 10 + r * ROW;
  const pegY = holeY + SLOT_HALF;                         // pegs drop to the bottom of their slots
  const off = r % 2 ? 30 : 10;
  const near = (t) => Math.min(W - 10, Math.max(off, off + Math.round((t - off) / PITCH) * PITCH));
  const pegsX = w < 140 ? [near(x + w / 2)] : [...new Set([near(x + w * 0.2), near(x + w * 0.8)])];
  const foot = pegY - PEG_R;
  return { item, x, y: foot - h, w, h, pegY, pegsX };
}

/* ── Build the board and hang the pieces ── */
function build(name) {
  for (const pc of pieces) updateVideo(pc, false);   // shared video textures stay cached
  for (const c of [...board.children]) if (c !== wall) { board.remove(c); disposeTree(c); }
  pieces = []; hovered = null; focused = null; capBox.hidden = true;

  layout = makeLayout(name);
  const { W, H } = layout;
  const toX = (x) => x - W / 2;
  const toY = (y) => H / 2 - y;

  // Board = one 40 x 40 mm tile with two slots, instanced across the board
  const tile = new THREE.Shape().moveTo(0, 0).lineTo(PITCH, 0).lineTo(PITCH, PITCH).lineTo(0, PITCH).lineTo(0, 0);
  tile.holes.push(slot(10, 30), slot(30, 10));
  const tileGeo = new THREE.ExtrudeGeometry(tile, { depth: BOARD_T, bevelEnabled: false, curveSegments: 5 });
  tileGeo.translate(0, 0, -BOARD_T);
  const boardMat = new THREE.MeshStandardMaterial({ color: BOARD_COLOUR, roughness: 0.85 });
  const across = layout.cols, down = H / PITCH;
  const tiles = new THREE.InstancedMesh(tileGeo, boardMat, across * down);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) {
    m.makeTranslation(-W / 2 + i * PITCH, H / 2 - (j + 1) * PITCH, 0);
    tiles.setMatrixAt(n++, m);
  }
  tiles.castShadow = tiles.receiveShadow = true;
  board.add(tiles);

  wall.scale.set(W * 3, H * 3, 1);

  // Pegs: a rod out of the slot with a short upturn in front of the panel
  // Moulded plastic: satin base with a thin glossy skin, like injection-moulded ABS
  const pegMat = new THREE.MeshPhysicalMaterial({
    color: PEG_COLOUR, roughness: 0.38, ior: 1.5, specularIntensity: 0.6,
    clearcoat: 0.6, clearcoatRoughness: 0.18,
    envMap: studio, envMapIntensity: 0.9,
  });
  const rodGeo = new THREE.CylinderGeometry(PEG_R, PEG_R, PEG_L + BOARD_T, 16).rotateX(Math.PI / 2).translate(0, 0, (PEG_L - BOARD_T) / 2);
  const tipGeo = new THREE.CylinderGeometry(PEG_R, PEG_R, 8, 16).translate(0, 4, PEG_L - PEG_R);
  const capGeo = new THREE.SphereGeometry(PEG_R, 16, 8).translate(0, 8, PEG_L - PEG_R);

  const sideMat = new THREE.MeshStandardMaterial({ color: EDGE_COLOUR, roughness: 0.7 });

  layout.placed.forEach((p, i) => {
    // Panel: pivot on its foot, leaning back so its top rests on the board
    const group = new THREE.Group();
    const stack = Math.min(p.item.media.length - 1, 2);   // cards stacked behind (several images)
    const lean = Math.asin(Math.min(0.5, (PANEL_OUT - 1 - stack * 2) / p.h));
    const sway = (rand(i * 7.3) - 0.5) * 0.012;           // slightly uneven, as hung by hand
    group.position.set(toX(p.x + p.w / 2), toY(p.y + p.h), PANEL_OUT);
    group.rotation.set(-lean, 0, sway);

    const aspect = p.item.fit ? null : p.w / p.h;          // null: the panel takes the image's shape
    const front = frontMaterial(p.item.src, aspect);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, PANEL_T), [sideMat, sideMat, sideMat, sideMat, front, sideMat]);
    panel.position.set(0, p.h / 2, PANEL_T / 2);
    panel.castShadow = panel.receiveShadow = true;
    group.add(panel);

    // The next images peek out behind, top right, like a small pile of prints
    const cards = [];
    for (let j = 1; j <= stack; j++) {
      const card = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 1.2),
        [sideMat, sideMat, sideMat, sideMat, frontMaterial(p.item.media[j].src, aspect), sideMat]);
      card.position.set(j * 7, p.h / 2 + j * 6, -j * 1.5);
      card.rotation.z = (j % 2 ? -1 : 1) * 0.012;
      card.castShadow = card.receiveShadow = true;
      group.add(card);
      cards.push(card);
    }
    board.add(group);

    const pegs = p.pegsX.map((px) => {
      const peg = new THREE.Group();
      for (const g of [rodGeo, tipGeo, capGeo]) {
        const mesh = new THREE.Mesh(g, pegMat);
        mesh.castShadow = mesh.receiveShadow = true;
        peg.add(mesh);
      }
      peg.position.set(toX(px), toY(p.pegY), 0);
      board.add(peg);
      return peg;
    });

    const pc = { item: p.item, p, group, panel, cards, index: 0, pegs, lift: 0, base: { y: group.position.y, z: PANEL_OUT, rx: -lean, rz: sway } };
    pieces.push(pc);
    if (p.item.fit) {
      restack(pc);
      for (const m of p.item.media) {
        const t = imageTexture(m.src);
        if (!(t.image && t.image.width)) t.userData.onLoad.push(() => restack(pc));
      }
    }
  });

  // Knurled thumb screws in the four corners, on solid board between the slots
  const screwMat = pegMat;
  const headGeo = knurled(SCREW_R, SCREW_H);
  const washerGeo = new THREE.CylinderGeometry(SCREW_R + 1.8, SCREW_R + 1.8, 1, 40).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  for (const [x, y] of [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20]]) {
    const screw = new THREE.Group();
    for (const g of [washerGeo, headGeo]) {
      const mesh = new THREE.Mesh(g, screwMat);
      mesh.castShadow = mesh.receiveShadow = true;
      screw.add(mesh);
    }
    screw.position.set(toX(x), toY(y), 0);
    screw.rotation.z = rand(x + y) * Math.PI;
    board.add(screw);
  }

  // Raking light from the top left, so holes and pegs throw shadows.
  // Its shadow camera covers the visible window and follows it (scrollView).
  const sc = light.shadow.camera;
  sc.near = 10; sc.far = 6000;
  const size = name === 'desktop' ? 4096 : 2048;
  if (light.shadow.mapSize.x !== size) {
    light.shadow.mapSize.set(size, size);
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
  }
}

// Thumb screw head: a short cylinder with 24 ridges round the side and a chamfered top
function knurled(r, h) {
  const n = 96;
  const geo = new THREE.CylinderGeometry(r * 0.88, r, h, n, 1).rotateX(Math.PI / 2).translate(0, 0, 1 + h / 2);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = Math.hypot(v.x, v.y);
    if (len < r * 0.5) continue;                            // cap centres
    const seg = Math.round(Math.atan2(v.y, v.x) / (Math.PI * 2 / n));
    const s = seg % 2 ? 0.95 : 1;
    pos.setXY(i, v.x * s, v.y * s);
  }
  geo.computeVertexNormals();
  return geo;
}

function slot(cx, cy) {
  const p = new THREE.Path();
  p.moveTo(cx + SLOT_R, cy - SLOT_HALF);
  p.lineTo(cx + SLOT_R, cy + SLOT_HALF);
  p.absarc(cx, cy + SLOT_HALF, SLOT_R, 0, Math.PI, false);
  p.lineTo(cx - SLOT_R, cy - SLOT_HALF);
  p.absarc(cx, cy - SLOT_HALF, SLOT_R, Math.PI, Math.PI * 2, false);
  return p;
}

function frontMaterial(src, aspect) {
  const mat = new THREE.MeshStandardMaterial({ color: src ? 0xffffff : PLACEHOLDER, roughness: 0.55 });
  const tex = src ? imageTexture(src) : null;
  if (tex) {
    mat.map = tex.clone();
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const fit = () => { if (aspect) cover(mat.map, aspect); };
    if (tex.image && (tex.image.width || tex.image.videoWidth)) fit();
    else tex.userData.onLoad.push(() => { mat.map.image = tex.image; mat.map.needsUpdate = true; fit(); });
  }
  return mat;
}

function imageTexture(src) {
  if (!textures.has(src)) {
    const tex = new THREE.Texture();
    tex.userData.onLoad = [];
    new THREE.ImageLoader().load(src, (img) => {
      tex.image = img; tex.needsUpdate = true;
      tex.userData.onLoad.forEach((f) => f()); tex.userData.onLoad = [];
      loop();
    });
    textures.set(src, tex);
  }
  return textures.get(src);
}

function videoTexture(src) {
  if (!textures.has(src)) {
    const v = Object.assign(document.createElement('video'), { src, muted: true, loop: true, playsInline: true, preload: 'auto' });
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.onLoad = [];
    v.addEventListener('loadeddata', () => { tex.userData.onLoad.forEach((f) => f()); tex.userData.onLoad = []; }, { once: true });
    textures.set(src, tex);
  }
  return textures.get(src);
}

function playVideos(on) {
  if (!on) for (const t of textures.values()) if (t.isVideoTexture) t.image.pause();
}

// Video pieces show their still until hovered or opened, then play on the panel
function updateVideo(pc, want) {
  const src = (pc.item.media[pc.index] || {}).video;
  if (!src) return false;
  const front = pc.panel.material[4];
  if (want) {
    const tex = pc.video || (pc.video = videoTexture(src));
    const v = tex.image;
    v.muted = !(pc === focused && soundOn);   // silent on hover, sound once opened (a click allows it)
    if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    if (front.map !== tex && v.readyState >= 2 && !v.paused) {
      cover(tex, pc.p.w / pc.p.h);
      pc.still = front.map;
      front.map = tex; front.needsUpdate = true;
    }
    return true;
  }
  if (pc.video) {
    if (!pc.video.image.paused) pc.video.image.pause();
    if (front.map === pc.video && pc.still) { front.map = pc.still; front.needsUpdate = true; }
  }
  return false;
}

// Flip a stacked piece to its next / previous image; the cards behind show what comes after
function step(pc, dir) {
  const n = pc.item.media.length;
  if (n < 2) return;
  updateVideo(pc, false);
  pc.video = null; pc.still = null;
  pc.index = (pc.index + dir + n) % n;
  const swap = (mesh, src) => {
    const old = mesh.material[4];
    mesh.material[4] = frontMaterial(src, pc.item.fit ? null : pc.p.w / pc.p.h);
    if (old.map) old.map.dispose();
    old.dispose();
  };
  swap(pc.panel, pc.item.media[pc.index].src);
  pc.cards.forEach((card, j) => swap(card, pc.item.media[(pc.index + j + 1) % n].src));
  restack(pc);
  capNum.textContent = `${pc.index + 1} / ${n}`;
  if (pc === focused) showSound(pc);
  loop();
}

// data-fit="contain" stacks: each print is sized to its photo inside the w x h box,
// standing on the pegs; the prints behind take its shape (cropped) and peek out top right
function restack(pc) {
  const { w, h } = pc.p, A = w / h, n = pc.item.media.length;
  const size = (src) => {
    const t = imageTexture(src);
    const a = t.image && t.image.width ? t.image.width / t.image.height : A;
    return a > A ? [w, w / a] : [h * a, h];
  };
  const [fw, fh] = size(pc.item.media[pc.index].src);
  pc.panel.scale.set(fw / w, fh / h, 1);
  pc.panel.position.set(0, fh / 2, PANEL_T / 2);
  pc.cards.forEach((card, i) => {
    const j = i + 1;
    card.scale.set(fw / w, fh / h, 1);                      // same shape as the front print,
    card.position.set(j * 7, fh / 2 + j * 6, -j * 1.5);     // just its edge peeking out
    const map = card.material[4].map;
    if (map && map.image && map.image.width) cover(map, fw / fh);
  });
  loop();
}

// Like CSS object-fit: cover
function cover(tex, aspect) {
  const img = tex.image;
  const ia = (img.videoWidth || img.width) / (img.videoHeight || img.height);
  tex.repeat.set(1, 1); tex.offset.set(0, 0);
  if (ia > aspect) { tex.repeat.x = aspect / ia; tex.offset.x = (1 - tex.repeat.x) / 2; }
  else { tex.repeat.y = ia / aspect; tex.offset.y = (1 - tex.repeat.y) / 2; }
  tex.needsUpdate = true;
}

/* ── Resize: fit the camera to the board's width ── */
function resize() {
  if (!started || !canRun.matches) return;
  const name = window.innerWidth >= BREAKPOINTS.desktop ? 'desktop' : 'tablet';
  if (name !== bp) { bp = name; build(name); }

  const { W, H, margin } = layout;
  const vw = W + 2 * margin, vh = H + 2 * margin;
  const cw = stage.clientWidth;
  win.s = cw / vw;                                    // px per mm: the board fills the width
  win.boardPx = Math.round(vh * win.s);
  win.headerH = header ? header.getBoundingClientRect().height : 0;
  win.ch = Math.min(win.boardPx, Math.round(window.innerHeight - win.headerH));
  stage.style.height = win.boardPx + 'px';            // the page scrolls the length of the board
  renderer.setSize(cw, win.ch);
  camera.aspect = cw / win.ch;
  camera.updateProjectionMatrix();
  win.visH = win.ch / win.s;
  win.d = (win.visH / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) + PANEL_OUT;

  const sc = light.shadow.camera, half = Math.max(W, win.visH) * 0.7;
  sc.left = sc.bottom = -half; sc.right = sc.top = half;
  sc.updateProjectionMatrix();

  scrollView(true);
  if (focused) focusOn(focused);
  draw();
}

// The canvas stays pinned under the header; scrolling moves the camera down the board
function scrollView(jump) {
  if (!layout) return;
  const vh = layout.H + 2 * layout.margin;
  const top = stage.getBoundingClientRect().top;
  const off = Math.min(Math.max(win.headerH - top, 0), win.boardPx - win.ch);
  const cy = vh / 2 - off / win.s - win.visH / 2;
  const dy = cy - view.homeLook.y;
  view.homePos.set(0, cy, win.d);
  view.homeLook.set(0, cy, 0);
  if (jump) { view.pos.copy(view.homePos); view.look.copy(view.homeLook); }
  else if (!focused) { view.pos.y += dy; view.look.y += dy; }   // follow the scroll exactly
  if (focused && Math.abs(off - win.off) > 120) unfocus();     // scrolling away closes it
  if (!focused) win.off = off;
  light.target.position.set(0, cy, 0);
  light.position.set(-800, cy + 1100, 900);
}

/* ── Pointer: hover lifts, click (or second tap) opens ── */
function ndc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function pick(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const hit = raycaster.intersectObjects(pieces.map((p) => p.panel), false)[0];
  return hit ? pieces.find((p) => p.panel === hit.object) : null;
}
function onMove(e) {
  if (e.pointerType !== 'mouse') return;
  const v = ndc(e);
  pointer.inside = true; pointer.tx = v.x; pointer.ty = v.y;
  hovered = pick(e);
  renderer.domElement.style.cursor = hovered ? 'pointer' : '';
  loop();
}
function onDown(e) { down = { x: e.clientX, y: e.clientY }; }
function onUp(e) {
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (focused && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { down = null; step(focused, dx < 0 ? 1 : -1); return; }   // swipe
  if (Math.hypot(dx, dy) > 8) { down = null; return; }
  down = null;
  const hit = pick(e);
  if (e.pointerType === 'mouse') {
    if (hit && hit !== focused) focus(hit); else if (!hit || hit === focused) unfocus();
  } else {
    if (!hit) { hovered = null; unfocus(); }
    else if (hit === focused) unfocus();
    else if (hit === hovered) focus(hit);       // second tap opens
    else { hovered = hit; if (focused) unfocus(); }
  }
  loop();
}

function focus(piece) {
  focused = piece;
  hovered = piece;
  focusOn(piece);
  capText.textContent = piece.item.text;
  capLink.hidden = !piece.item.href;
  if (piece.item.href) { capLink.href = piece.item.href; capLink.target = /^https?:/.test(piece.item.href) && !piece.item.href.startsWith(location.origin) ? '_blank' : ''; }
  capNav.hidden = piece.item.media.length < 2;
  capNum.textContent = `${piece.index + 1} / ${piece.item.media.length}`;
  showSound(piece);
  capBox.hidden = false;
}
function showSound(piece) {
  capSound.hidden = !(piece.item.media[piece.index] || {}).sound;
  capSound.textContent = soundOn ? '[Sound on]' : '[Sound off]';
}
function focusOn(piece) {
  const { p } = piece;
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const dist = Math.max((p.h * 1.35) / 2 / t, (p.w * 1.35) / 2 / (t * camera.aspect));
  const cx = p.x + p.w / 2 - layout.W / 2;
  const cy = layout.H / 2 - (p.y + p.h / 2);
  view.focusLook = new THREE.Vector3(cx, cy, PANEL_OUT + 30);
  view.focusPos = new THREE.Vector3(cx, cy, PANEL_OUT + 30 + dist);
}
function unfocus() {
  if (!focused) return;
  focused = null;
  if (noHover.matches) hovered = null;
  capBox.hidden = true;
  loop();
}

/* ── Animation ── */
function loop() {
  if (frame || !running || !visible || document.hidden) return;
  clock.getDelta();
  frame = requestAnimationFrame(tick);
}
function tick() {
  frame = 0;
  if (!running || !visible || document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const k = 1 - Math.exp(-dt * 7);
  const t = performance.now() / 1000;
  let moving = false;

  // Board tilt: follows the mouse, or sways gently on touch screens
  let tx = 0, ty = 0;
  if (!focused) {
    if (noHover.matches) { tx = Math.sin(t * 0.35) * 0.5; ty = Math.sin(t * 0.27 + 1) * 0.35; moving = true; }
    else if (pointer.inside) { tx = pointer.tx; ty = pointer.ty; }
  }
  pointer.x += (tx - pointer.x) * k;
  pointer.y += (ty - pointer.y) * k;
  const tiltX = pointer.x * 0.035 * win.d, tiltY = pointer.y * 0.025 * win.d;
  if (Math.abs(tx - pointer.x) + Math.abs(ty - pointer.y) > 0.0005) moving = true;

  // Lift the hovered / opened piece off its pegs
  for (const pc of pieces) {
    const target = pc === hovered || pc === focused ? 1 : 0;
    pc.lift += (target - pc.lift) * k;
    if (Math.abs(target - pc.lift) > 0.001) moving = true;
    const l = pc.lift;
    pc.group.position.y = pc.base.y + l * 10;
    pc.group.position.z = pc.base.z + l * 34;
    pc.group.rotation.x = pc.base.rx * (1 - l * 0.85);
    pc.group.rotation.z = pc.base.rz * (1 - l);
    if (updateVideo(pc, pc === hovered || pc === focused)) moving = true;
  }

  // Camera: home, or flown in to the opened piece
  const goPos = focused ? view.focusPos : view.homePos;
  const goLook = focused ? view.focusLook : view.homeLook;
  const kc = 1 - Math.exp(-dt * 4);
  view.pos.lerp(goPos, kc);
  view.look.lerp(goLook, kc);
  if (view.pos.distanceTo(goPos) > 0.05) moving = true;
  camera.position.copy(view.pos);
  camera.position.x += tiltX;
  camera.position.y += tiltY;
  camera.lookAt(view.look);

  draw();
  if (moving) loop();
}
function draw() { if (renderer && layout) renderer.render(scene, camera); }

/* ── Helpers ── */
function rand(s) { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}
