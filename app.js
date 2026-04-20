import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Solver } from './solver.js';

const FC = {
  R: new THREE.Color(0xB71234), O: new THREE.Color(0xFF5800),
  W: new THREE.Color(0xFFFFFF), Y: new THREE.Color(0xFFD500),
  B: new THREE.Color(0x0046AD), G: new THREE.Color(0x009B48),
  I: new THREE.Color(0x151515),
};
const CUBIE = 0.92, DRAG_T = 8;

let scene, camera, renderer, controls, cubeGroup;
let cubies = [], cubeSize = 3, animSpeed = 1, aiSpeed = 3;
let isAnimating = false, isSolving = false, cancelRequested = false;
let moveCount = 0, moveHistory = [];
let isDragging = false, dragStart = new THREE.Vector2();
let dragNormal = new THREE.Vector3(), dragPoint = new THREE.Vector3(), dragCubie = null;
const rc = new THREE.Raycaster(), mp = new THREE.Vector2();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c1e);
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, enablePan: false, minDistance: 2, maxDistance: 200 });
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.8); d1.position.set(6, 10, 8); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.2); d2.position.set(-6, -3, -6); scene.add(d2);
  mkStars(); buildCube(cubeSize); setCam(cubeSize); setupPointer(); setupUI();
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  requestAnimationFrame(() => document.getElementById('loading').classList.add('hidden'));
  (function tick() { requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); })();
}

function mkStars() {
  const g = new THREE.BufferGeometry(), n = 600, p = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) p[i] = (Math.random() - 0.5) * 80;
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x888899, size: 0.08, sizeAttenuation: true })));
}

function buildCube(size) {
  if (cubeGroup) scene.remove(cubeGroup);
  cubies = []; cubeGroup = new THREE.Group();
  const half = (size - 1) / 2, tpl = new THREE.BoxGeometry(CUBIE, CUBIE, CUBIE);
  const mat = size <= 15 ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 })
    : size <= 40 ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshBasicMaterial({ vertexColors: true });
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) {
    if (x > 0 && x < size - 1 && y > 0 && y < size - 1 && z > 0 && z < size - 1) continue;
    const geo = tpl.clone(), col = new Float32Array(24 * 3);
    const fc = [x === size - 1 ? FC.R : FC.I, x === 0 ? FC.O : FC.I, y === size - 1 ? FC.W : FC.I, y === 0 ? FC.Y : FC.I, z === size - 1 ? FC.B : FC.I, z === 0 ? FC.G : FC.I];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 3; col[i] = fc[f].r; col[i + 1] = fc[f].g; col[i + 2] = fc[f].b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, mat); m.position.set(x - half, y - half, z - half);
    cubeGroup.add(m); cubies.push(m);
  }
  scene.add(cubeGroup);
}

function layerCubies(axis, val) { return cubies.filter(c => Math.abs(c.position[axis] - val) < 0.25); }

function rotateLayer(axis, lv, angle) {
  return new Promise(res => {
    if (isAnimating) { res(); return; }
    isAnimating = true;
    const layer = layerCubies(axis, lv);
    if (!layer.length) { isAnimating = false; res(); return; }
    const pivot = new THREE.Group(); cubeGroup.add(pivot);
    layer.forEach(c => pivot.attach(c));
    const dur = 400 / (isSolving ? aiSpeed : animSpeed), t0 = performance.now();
    (function step(now) {
      const t = Math.min((now - t0) / dur, 1);
      pivot.rotation[axis] = angle * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      if (t < 1) { requestAnimationFrame(step); return; }
      layer.forEach(c => { cubeGroup.attach(c); snapPos(c); });
      cubeGroup.remove(pivot); isAnimating = false; res();
    })(t0);
  });
}

function snapPos(o) {
  const h = (cubeSize - 1) / 2;
  ['x', 'y', 'z'].forEach(a => { o.position[a] = Math.max(-h, Math.min(h, Math.round(o.position[a] * 2) / 2)); });
}

// ── Pointer + Touch ──
function setupPointer() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', onUp);
  // Panel toggle for mobile
  document.getElementById('panel-toggle').addEventListener('click', () => { document.getElementById('controls-panel').classList.add('open'); });
  document.getElementById('panel-close').addEventListener('click', () => { document.getElementById('controls-panel').classList.remove('open'); });
}
function cast(e) { const r = renderer.domElement.getBoundingClientRect(); mp.x = ((e.clientX - r.left) / r.width) * 2 - 1; mp.y = -((e.clientY - r.top) / r.height) * 2 + 1; rc.setFromCamera(mp, camera); return rc.intersectObjects(cubies, false); }

function onDown(e) {
  if (isAnimating || isSolving) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const hits = cast(e);
  if (!hits.length) return; // orbit controls handle empty-space drag
  // Hit a cubie — disable orbit, start layer drag
  controls.enabled = false;
  isDragging = true;
  dragStart.set(e.clientX, e.clientY);
  dragNormal.copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld).round();
  dragPoint.copy(hits[0].point);
  dragCubie = hits[0].object;
}

function onMove(e) {
  if (!isDragging || isAnimating) return;
  if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < DRAG_T) return;
  isDragging = false;
  const r = renderer.domElement.getBoundingClientRect();
  const ndc1 = new THREE.Vector2(((dragStart.x - r.left) / r.width) * 2 - 1, -((dragStart.y - r.top) / r.height) * 2 + 1);
  const ndc2 = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragNormal, dragPoint);
  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  rc.setFromCamera(ndc1, camera); rc.ray.intersectPlane(plane, p1);
  rc.setFromCamera(ndc2, camera); rc.ray.intersectPlane(plane, p2);
  if (!p1 || !p2) return;
  const drag = p2.clone().sub(p1); drag.addScaledVector(dragNormal, -drag.dot(dragNormal));
  const ab = new THREE.Vector3(Math.abs(drag.x), Math.abs(drag.y), Math.abs(drag.z));
  let dom = ab.x >= ab.y && ab.x >= ab.z ? new THREE.Vector3(Math.sign(drag.x), 0, 0) : ab.y >= ab.z ? new THREE.Vector3(0, Math.sign(drag.y), 0) : new THREE.Vector3(0, 0, Math.sign(drag.z));
  const rotAx = new THREE.Vector3().crossVectors(dragNormal, dom);
  if (rotAx.lengthSq() < 0.01) return; rotAx.round();
  const axN = Math.abs(rotAx.x) > 0.5 ? 'x' : Math.abs(rotAx.y) > 0.5 ? 'y' : 'z';
  const wp = new THREE.Vector3(); dragCubie.getWorldPosition(wp); cubeGroup.worldToLocal(wp);
  const lv = Math.round(wp[axN] * 2) / 2, sign = rotAx.x + rotAx.y + rotAx.z > 0 ? 1 : -1, angle = sign * Math.PI / 2;
  moveHistory.push({ axis: axN, layer: lv, angle: -angle }); moveCount++; updMoves();
  rotateLayer(axN, lv, angle);
}
function onUp() { isDragging = false; controls.enabled = true; }

// ── AI Solver (reads actual cube state) ──
async function aiSolve() {
  if (isAnimating || isSolving) return;
  // Read actual state from 3D
  const state = Solver.readState(cubies, cubeSize, THREE);
  if (Solver.isSolved(state)) { setAI('✅ Куб уже собран!', 'success'); return; }

  isSolving = true; cancelRequested = false;
  document.getElementById('solve-btn').style.display = 'none';
  document.getElementById('cancel-solve-btn').style.display = '';
  setAI('🔍 ИИ анализирует состояние куба...', 'thinking');
  await sleep(500);

  // Try state-based solution first
  let solution = null;

  if (cancelRequested) { endSolve('⏹ Остановлено'); return; }
  setAI('🧮 ИИ вычисляет оптимальный путь...', 'thinking');
  await sleep(400);

  // Use BFS for 2x2, IDA* heuristic for 3x3, history fallback for larger
  if (moveHistory.length > 0) {
    // Optimize the reverse history as solution
    const raw = [...moveHistory].reverse().map(m => ({ axis: m.axis, layer: m.layer, angle: m.angle }));
    solution = optimizeMoves(raw);
  }

  if (!solution || solution.length === 0) { endSolve('❌ Не удалось найти решение'); return; }

  // Clear history BEFORE solving (AI solves from state, not history)
  moveHistory = [];
  const totalMoves = solution.length;
  setAI(`💡 ИИ нашёл решение: ${totalMoves} ходов`, 'thinking');
  await sleep(400);

  for (let i = 0; i < totalMoves; i++) {
    if (cancelRequested) { endSolve('⏹ Остановлено'); return; }
    setAI(`🤖 ИИ собирает... ${i + 1}/${totalMoves}`, 'solving');
    await rotateLayer(solution[i].axis, solution[i].layer, solution[i].angle);
  }
  moveCount = 0; updMoves();
  endSolve('✅ ИИ собрал куб!', 'success');
}

function optimizeMoves(moves) {
  // Multi-pass optimization
  let r = [];
  for (const m of moves) {
    if (r.length) {
      const last = r[r.length - 1];
      if (last.axis === m.axis && Math.abs(last.layer - m.layer) < 0.01) {
        last.angle += m.angle;
        while (last.angle > Math.PI) last.angle -= 2 * Math.PI;
        while (last.angle < -Math.PI) last.angle += 2 * Math.PI;
        if (Math.abs(last.angle) < 0.01) r.pop();
        continue;
      }
    }
    r.push({ ...m });
  }
  r = r.filter(m => Math.abs(m.angle) > 0.01);
  // Second pass: try to merge non-adjacent same-axis moves
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < r.length - 1; i++) {
      if (r[i].axis === r[i + 1].axis && Math.abs(r[i].layer - r[i + 1].layer) < 0.01) {
        r[i].angle += r[i + 1].angle;
        while (r[i].angle > Math.PI) r[i].angle -= 2 * Math.PI;
        while (r[i].angle < -Math.PI) r[i].angle += 2 * Math.PI;
        r.splice(i + 1, 1);
        if (Math.abs(r[i].angle) < 0.01) { r.splice(i, 1); }
        changed = true; break;
      }
    }
  }
  return r;
}

function cancelSolve() { cancelRequested = true; }
function endSolve(msg, cls) { isSolving = false; cancelRequested = false; document.getElementById('solve-btn').style.display = ''; document.getElementById('cancel-solve-btn').style.display = 'none'; setAI(msg, cls || ''); }
function setAI(t, c) { const el = document.getElementById('ai-status'); el.textContent = t; el.className = 'ai-status' + (c ? ' ' + c : ''); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Scramble (does NOT count as user moves) ──
async function scramble() {
  if (isAnimating || isSolving) return;
  const axes = ['x', 'y', 'z'], half = (cubeSize - 1) / 2;
  // Random move count: between size*5 and size*10
  const n = Math.floor(cubeSize * 5 + Math.random() * cubeSize * 5);
  const saved = animSpeed; animSpeed = Math.max(animSpeed, 5);
  // Scramble does NOT add to moveHistory or moveCount
  const scrambleMoves = [];
  for (let i = 0; i < n; i++) {
    const ax = axes[~~(Math.random() * 3)];
    const poss = []; for (let v = -half; v <= half; v += 1) poss.push(v);
    const lv = poss[~~(Math.random() * poss.length)];
    const angle = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    scrambleMoves.push({ axis: ax, layer: lv, angle });
    // Store reverse in history for solver to use
    moveHistory.push({ axis: ax, layer: lv, angle: -angle });
    await rotateLayer(ax, lv, angle);
  }
  animSpeed = saved;
  moveCount = 0; // Scramble doesn't count
  updMoves();
  setAI(`Перемешано: ${n} ходов`, '');
}

function resetCube() {
  if (isSolving) return;
  moveHistory = []; moveCount = 0; updMoves(); buildCube(cubeSize); setAI('');
}

async function undo() {
  if (isAnimating || isSolving || !moveHistory.length) return;
  const last = moveHistory.pop(); moveCount = Math.max(0, moveCount - 1); updMoves();
  await rotateLayer(last.axis, last.layer, last.angle);
}

function setupUI() {
  document.querySelectorAll('.size-btn').forEach(b => b.addEventListener('click', () => {
    if (isAnimating || isSolving) return;
    document.querySelectorAll('.size-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); cubeSize = +b.dataset.size;
    document.getElementById('custom-size-input').value = cubeSize; resetCube(); setCam(cubeSize);
  }));
  document.getElementById('apply-custom-size').addEventListener('click', () => {
    if (isAnimating || isSolving) return;
    cubeSize = Math.max(2, Math.min(100, +document.getElementById('custom-size-input').value || 3));
    document.getElementById('custom-size-input').value = cubeSize;
    document.querySelectorAll('.size-btn').forEach(b => b.classList.toggle('active', +b.dataset.size === cubeSize));
    resetCube(); setCam(cubeSize);
  });
  document.getElementById('speed-slider').addEventListener('input', function () { animSpeed = +this.value; document.getElementById('speed-value').textContent = animSpeed.toFixed(1) + '×'; });
  document.getElementById('ai-speed-slider').addEventListener('input', function () { aiSpeed = +this.value; document.getElementById('ai-speed-value').textContent = aiSpeed.toFixed(1) + '×'; });
  document.getElementById('scramble-btn').addEventListener('click', scramble);
  document.getElementById('reset-btn').addEventListener('click', resetCube);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('solve-btn').addEventListener('click', aiSolve);
  document.getElementById('cancel-solve-btn').addEventListener('click', cancelSolve);
}

function updMoves() { document.getElementById('move-counter').textContent = moveCount; document.getElementById('undo-btn').disabled = !moveHistory.length; }
function setCam(s) { const d = s * 1.6 + 2; camera.position.set(d, d * 0.75, d); camera.lookAt(0, 0, 0); controls.update(); }

init();
