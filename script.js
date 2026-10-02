/*
 * RUBIKS CUBE 3D GAME
 *
 * Desktop controls are mouse/keyboard only.
 * Mobile controls are a completely separate touch implementation:
 *   - one finger drag anywhere on the game canvas = camera rotation
 *   - one finger tap on a cube tile = select it (cross arrows appear on that tile)
 *   - tap an arrow = turn that row/column 90 degrees in the arrow's direction
 *   - two finger pinch = zoom
 */

let scene, camera, renderer, cubeGroup;
let cubies = [];
let isRotating = false;
let selectedCubie = null;
let selectedMat = 0;          // which sticker (material index) of the selected cubie was tapped
let arrowLayer = null;
let arrowButtons = [];
let arrowDefs = [];
let arrowsShown = false;
let cameraZoom = 6;
let cameraRotation = { x: -0.5, y: 0.5 };

const COLORS = {
  front: 0xff0000,
  back: 0xffa500,
  top: 0xffffff,
  bottom: 0xffff00,
  left: 0x0000ff,
  right: 0x00ff00
};

let mobileTouch = null;
let desktopMouse = null;

function resizeGame() {
  if (!renderer || !camera) return;
  const width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
  const height = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(5, 5, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.domElement.id = 'rubiks-canvas';
  renderer.domElement.setAttribute('aria-label', '3D Rubiks Cube');
  renderer.domElement.setAttribute('role', 'img');

  document.getElementById('canvas-container').appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.52);
  directionalLight.position.set(10, 20, 10);
  scene.add(directionalLight);

  createCube();
  createArrowUI();
  setupGameInput();
  updateCamera();
  resizeGame();
  animate();
}

function createCube() {
  if (cubeGroup) scene.remove(cubeGroup);
  cubeGroup = new THREE.Group();
  cubies = [];

  const spacing = 1.05;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = [
          new THREE.MeshLambertMaterial({ color: x === 1 ? COLORS.right : 0x111111, transparent: true }),
          new THREE.MeshLambertMaterial({ color: x === -1 ? COLORS.left : 0x111111, transparent: true }),
          new THREE.MeshLambertMaterial({ color: y === 1 ? COLORS.top : 0x111111, transparent: true }),
          new THREE.MeshLambertMaterial({ color: y === -1 ? COLORS.bottom : 0x111111, transparent: true }),
          new THREE.MeshLambertMaterial({ color: z === 1 ? COLORS.front : 0x111111, transparent: true }),
          new THREE.MeshLambertMaterial({ color: z === -1 ? COLORS.back : 0x111111, transparent: true })
        ];

        const cubie = new THREE.Mesh(geometry, materials);
        cubie.position.set(x * spacing, y * spacing, z * spacing);
        cubie.userData = { x, y, z };
        cubeGroup.add(cubie);
        cubies.push(cubie);
      }
    }
  }

  scene.add(cubeGroup);
  clearSelection();
}

/* ---------------- TILE SELECTION + CROSS ARROWS ---------------- */

const TILE_STEP = 1.05;                       // distance between cubie centres
const AXES = ['x', 'y', 'z'];
// Outward normal of each BoxGeometry material slot: +x, -x, +y, -y, +z, -z
const LOCAL_NORMALS = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function snapToAxis(v) {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(v.x), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(v.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(v.z));
}

// Which way a tile's sticker faces right now (cube space), snapped to an exact axis.
function tileNormal(cubie, matIdx) {
  const n = LOCAL_NORMALS[matIdx];
  return snapToAxis(new THREE.Vector3(n[0], n[1], n[2]).applyQuaternion(cubie.quaternion));
}

function faceName(n) {
  if (n.x > 0) return 'RIGHT';
  if (n.x < 0) return 'LEFT';
  if (n.y > 0) return 'TOP';
  if (n.y < 0) return 'BOTTOM';
  if (n.z > 0) return 'FRONT';
  return 'BACK';
}

function clearSelection() {
  selectedCubie = null;
  arrowDefs = [];
  cubies.forEach(c => c.material.forEach(m => { m.opacity = 1; m.emissive.setHex(0x000000); }));
  const label = document.getElementById('face-label');
  if (label) label.classList.remove('show');
  setArrowsShown(false);
}

function setSelection(cubie, matIdx) {
  clearSelection();
  selectedCubie = cubie;
  selectedMat = matIdx;
  refreshSelection();
}

function selectTile(tile) {
  if (isRotating) return;
  if (selectedCubie === tile.cubie && selectedMat === tile.matIdx) clearSelection();
  else setSelection(tile.cubie, tile.matIdx);
}

// Re-derives highlight, face label and arrows. Called on select and after every turn,
// because the selected tile travels with its slice and may end up on a different face.
function refreshSelection() {
  if (!selectedCubie) return;
  const n = tileNormal(selectedCubie, selectedMat);
  const sliceAxes = AXES.filter(a => Math.abs(n[a]) < 0.5);   // the two axes lying in the tile's face

  cubies.forEach(c => {
    const inCross = sliceAxes.some(a => Math.round(c.position[a]) === Math.round(selectedCubie.position[a]));
    c.material.forEach(m => { m.opacity = inCross ? 1 : 0.4; m.emissive.setHex(0x000000); });
  });
  selectedCubie.material[selectedMat].emissive.setHex(0x555555);

  const label = document.getElementById('face-label');
  if (label) {
    label.textContent = faceName(n) + ' FACE';
    label.classList.add('show');
    positionFaceLabel();
  }

  buildArrowDefs(n);
}

// One arrow per direction (up/down/left/right on the tile's face).
// Moving a tile in direction d means turning the slice about axis (n x d).
function buildArrowDefs(n) {
  arrowDefs = [];
  AXES.filter(a => Math.abs(n[a]) < 0.5).forEach(a => {
    [1, -1].forEach(sign => {
      const dir = new THREE.Vector3();
      dir[a] = sign;
      const rot = new THREE.Vector3().crossVectors(n, dir);
      const axis = AXES.find(k => Math.abs(rot[k]) > 0.5);
      arrowDefs.push({
        dir,
        axis,
        layer: Math.round(selectedCubie.position[axis]),
        angle: Math.sign(rot[axis]) * Math.PI / 2,
        sx: 0, sy: 0
      });
    });
  });
}

function createArrowUI() {
  arrowLayer = document.createElement('div');
  arrowLayer.id = 'arrow-layer';
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-arrow';
    b.setAttribute('aria-label', 'Turn slice');
    b.innerHTML = ARROW_SVG;
    b.addEventListener('click', e => {
      e.stopPropagation();
      const def = arrowDefs[i];
      if (def && selectedCubie && !isRotating) rotateFace(def.axis, def.layer, def.angle);
    });
    arrowLayer.appendChild(b);
    arrowButtons.push(b);
  }
  document.getElementById('game-screen').appendChild(arrowLayer);
}

function setArrowsShown(show) {
  if (!arrowLayer || show === arrowsShown) return;
  arrowsShown = show;
  arrowLayer.classList.toggle('show', show);
}

function projectToLayer(worldPos, rect) {
  const v = worldPos.clone().project(camera);
  return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
}

// Runs every frame: pins the 4 arrows to the selected tile. An arrow sits one tile away in its
// direction, so on an edge tile with no neighbour it floats just outside the cube.
function updateArrows() {
  if (!arrowLayer) return;
  if (!selectedCubie || isRotating || arrowDefs.length !== 4) { setArrowsShown(false); return; }

  const n = tileNormal(selectedCubie, selectedMat);
  const center = selectedCubie.position.clone().addScaledVector(n, 0.52);
  const centerW = cubeGroup.localToWorld(center.clone());
  const nW = n.clone().transformDirection(cubeGroup.matrixWorld);
  const facing = camera.position.clone().sub(centerW).normalize().dot(nW);
  if (facing < 0.1) { setArrowsShown(false); return; }   // tile is edge-on or on the far side

  const rect = arrowLayer.getBoundingClientRect();
  const c0 = projectToLayer(centerW, rect);
  arrowDefs.forEach((def, i) => {
    const pW = cubeGroup.localToWorld(center.clone().addScaledVector(def.dir, TILE_STEP));
    const p = projectToLayer(pW, rect);
    const ang = Math.atan2(p.y - c0.y, p.x - c0.x);
    def.sx = Math.cos(ang);
    def.sy = Math.sin(ang);
    const x = clamp(p.x, 30, rect.width - 30);
    const y = clamp(p.y, 30, rect.height - 30);
    arrowButtons[i].style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) rotate(' + ang + 'rad)';
  });
  setArrowsShown(true);
}

// Keep the face label visible: drop it under the toolbar if they would overlap.
function positionFaceLabel() {
  const label = document.getElementById('face-label');
  const bar = document.getElementById('game-toolbar');
  const screenEl = document.getElementById('game-screen');
  if (!label || !bar || !screenEl) return;
  label.style.top = '';
  const sr = screenEl.getBoundingClientRect();
  const br = bar.getBoundingClientRect();
  const lr = label.getBoundingClientRect();
  if (lr.right > br.left && lr.left < br.right && lr.top < br.bottom) {
    label.style.top = (br.bottom - sr.top + 8) + 'px';
  }
}

function getPointerNdc(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - r.left) / r.width) * 2 - 1,
    -((clientY - r.top) / r.height) * 2 + 1
  );
}

// Returns { cubie, matIdx } for the outward-facing tile under the pointer, or null.
function pickTile(clientX, clientY) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(getPointerNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObjects(cubies, false);
  for (const h of hits) {
    const cubie = h.object;
    const matIdx = h.face.materialIndex;
    const n = tileNormal(cubie, matIdx);
    // Only stickers on the outside of the cube count (skip hidden inner/side faces seen through gaps).
    const depth = cubie.position.clone().divideScalar(TILE_STEP).dot(n);
    if (Math.round(depth) === 1) return { cubie, matIdx };
  }
  return null;
}

function updateCamera() {
  if (!camera) return;
  camera.position.x = cameraZoom * Math.sin(cameraRotation.y) * Math.cos(cameraRotation.x);
  camera.position.y = cameraZoom * Math.sin(cameraRotation.x);
  camera.position.z = cameraZoom * Math.cos(cameraRotation.y) * Math.cos(cameraRotation.x);
  camera.lookAt(0, 0, 0);
}

function playGameSound(type='tap') {
  if (typeof playSound === 'function') playSound(type === 'move' ? 'slide' : type);
}

function setupGameInput() {
  window.addEventListener('resize', resizeGame, { passive: true });
  window.addEventListener('resize', positionFaceLabel, { passive: true });
  document.addEventListener('fullscreenchange', resizeGame);

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Touch (phones/tablets). preventDefault on touchstart also suppresses emulated mouse events.
  canvas.addEventListener('touchstart', mobileTouchStart, { passive: false });
  canvas.addEventListener('touchmove', mobileTouchMove, { passive: false });
  canvas.addEventListener('touchend', mobileTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', mobileTouchCancel, { passive: false });

  // Mouse + wheel (desktop).
  canvas.addEventListener('mousedown', desktopMouseDown);
  canvas.addEventListener('mousemove', desktopMouseMove);
  canvas.addEventListener('mouseup', desktopMouseUp);
  canvas.addEventListener('mouseleave', desktopMouseLeave);
  window.addEventListener('mouseup', desktopWindowMouseUp);
  window.addEventListener('wheel', desktopWheel, { passive: true });

  document.getElementById('shuffle-btn').addEventListener('click', () => { playGameSound('start'); shuffleCube(); });
  document.getElementById('solve-btn').addEventListener('click', () => { playGameSound('start'); solveCube(); });
  document.getElementById('restart-btn').addEventListener('click', () => { playGameSound('tap'); createCube(); });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      playGameSound('tap');
      setView(btn.dataset.view);
    });
  });

  document.getElementById('view-toggle').addEventListener('click', () => {
    playGameSound('tap');
    document.getElementById('view-panel').classList.toggle('collapsed');
  });

  window.addEventListener('keydown', onKeyDown);
}

/* ---------------- MOBILE TOUCH ---------------- */

function mobileTouchStart(e) {
  e.preventDefault();

  if (e.touches.length >= 2) {
    const a = e.touches[0];
    const b = e.touches[1];
    mobileTouch = {
      mode: 'pinch',
      startDistance: distanceXY(a.clientX, a.clientY, b.clientX, b.clientY),
      startZoom: cameraZoom
    };
    return;
  }

  const t = e.touches[0];
  mobileTouch = {
    mode: 'rotate',
    startX: t.clientX,
    startY: t.clientY,
    lastX: t.clientX,
    lastY: t.clientY,
    moved: false
  };
}

function mobileTouchMove(e) {
  if (!mobileTouch) return;
  e.preventDefault();

  if (e.touches.length >= 2) {
    if (mobileTouch.mode !== 'pinch') {
      const a = e.touches[0];
      const b = e.touches[1];
      mobileTouch = {
        mode: 'pinch',
        startDistance: distanceXY(a.clientX, a.clientY, b.clientX, b.clientY),
        startZoom: cameraZoom
      };
    }

    const a = e.touches[0];
    const b = e.touches[1];
    const currentDistance = distanceXY(a.clientX, a.clientY, b.clientX, b.clientY);
    cameraZoom = clamp(
      mobileTouch.startZoom * (mobileTouch.startDistance / Math.max(30, currentDistance)),
      3.1,
      14
    );
    updateCamera();
    return;
  }

  if (mobileTouch.mode !== 'rotate') return;
  const t = e.touches[0];
  const dxTotal = t.clientX - mobileTouch.startX;
  const dyTotal = t.clientY - mobileTouch.startY;

  if (!mobileTouch.moved && Math.hypot(dxTotal, dyTotal) > 7) mobileTouch.moved = true;
  if (!mobileTouch.moved) return;

  const dx = t.clientX - mobileTouch.lastX;
  const dy = t.clientY - mobileTouch.lastY;

  cameraRotation.y -= dx * 0.0085;
  cameraRotation.x += dy * 0.0085;
  cameraRotation.x = clamp(cameraRotation.x, -Math.PI * 0.49, Math.PI * 0.49);
  updateCamera();

  mobileTouch.lastX = t.clientX;
  mobileTouch.lastY = t.clientY;
}

function mobileTouchEnd(e) {
  if (!mobileTouch) return;
  e.preventDefault();

  // Pinch ended with one finger still down: seamlessly continue as a camera drag.
  if (e.touches.length === 1) {
    const t = e.touches[0];
    mobileTouch = {
      mode: 'rotate',
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      moved: true
    };
    return;
  }

  const state = mobileTouch;
  mobileTouch = null;

  if (state.mode === 'rotate' && !state.moved) {
    const t = e.changedTouches[0];
    const tile = pickTile(t.clientX, t.clientY);
    if (tile) {
      selectTile(tile);
      playGameSound('tap');
    } else {
      clearSelection();
    }
  }
}

function mobileTouchCancel(e) {
  e.preventDefault();
  mobileTouch = null;
}

/* ---------------- DESKTOP MOUSE ---------------- */

function desktopMouseDown(e) {
  if (e.button === 2) {
    desktopMouse = { mode:'camera', lastX:e.clientX, lastY:e.clientY };
    return;
  }
  if (e.button === 0) {
    desktopMouse = { mode:'select', startX:e.clientX, startY:e.clientY, moved:false };
  }
}

function desktopMouseMove(e) {
  if (!desktopMouse) return;

  if (desktopMouse.mode === 'camera') {
    const dx = e.clientX - desktopMouse.lastX;
    const dy = e.clientY - desktopMouse.lastY;
    cameraRotation.y -= dx * 0.01;
    cameraRotation.x += dy * 0.01;
    cameraRotation.x = clamp(cameraRotation.x, -Math.PI * 0.49, Math.PI * 0.49);
    updateCamera();
    desktopMouse.lastX = e.clientX;
    desktopMouse.lastY = e.clientY;
    return;
  }

  if (desktopMouse.mode === 'select' && Math.hypot(e.clientX-desktopMouse.startX, e.clientY-desktopMouse.startY) > 6) {
    desktopMouse.moved = true;
  }
}

function desktopMouseUp(e) {
  if (!desktopMouse) return;
  const state = desktopMouse;
  desktopMouse = null;

  if (state.mode === 'select' && e.button === 0 && !state.moved) {
    const tile = pickTile(e.clientX, e.clientY);
    if (tile) selectTile(tile); else clearSelection();
  }
}

function desktopWindowMouseUp(e) {
  if (desktopMouse?.mode === 'camera' && e.button === 2) desktopMouse = null;
}

function desktopMouseLeave() {
  // Camera dragging is allowed to continue if the pointer leaves the canvas;
  // mouseup on window will end it.
}

function desktopWheel(e) {
  if (document.body.dataset.screen !== 'game') return;
  cameraZoom = clamp(cameraZoom + e.deltaY * 0.004, 3.1, 14);
  updateCamera();
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distanceXY(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// Arrow keys press whichever on-screen arrow points that way.
function onKeyDown(e) {
  const keys = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const want = keys[e.key];
  if (!want || !selectedCubie || isRotating || !arrowsShown) return;
  e.preventDefault();
  let best = null, bestDot = -2;
  arrowDefs.forEach(def => {
    const d = def.sx * want[0] + def.sy * want[1];
    if (d > bestDot) { bestDot = d; best = def; }
  });
  if (best && bestDot > 0.3) rotateFace(best.axis, best.layer, best.angle);
}

function setView(view) {
  switch (view) {
    case 'top': cameraRotation = { x: Math.PI / 2, y: 0 }; break;
    case 'bottom': cameraRotation = { x: -Math.PI / 2, y: 0 }; break;
    case 'front': cameraRotation = { x: 0, y: 0 }; break;
    case 'back': cameraRotation = { x: 0, y: Math.PI }; break;
    case 'left': cameraRotation = { x: 0, y: -Math.PI / 2 }; break;
    case 'right': cameraRotation = { x: 0, y: Math.PI / 2 }; break;
  }
  updateCamera();
}

function rotateFace(axis, layer, angle) {
  if (isRotating) return;
  isRotating = true;
  const group = new THREE.Group();
  scene.add(group);

  const rotatingCubies = cubies.filter(c => {
    const p = c.position;
    return axis === 'x' ? Math.round(p.x) === layer : axis === 'y' ? Math.round(p.y) === layer : Math.round(p.z) === layer;
  });

  rotatingCubies.forEach(c => group.add(c));

  const state = { angle: 0 };
  new TWEEN.Tween(state)
    .to({ angle }, 260)
    .easing(TWEEN.Easing.Cubic.InOut)
    .onUpdate(() => { group.rotation[axis] = state.angle; })
    .onComplete(() => {
      rotatingCubies.forEach(c => {
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        c.getWorldPosition(worldPos);
        c.getWorldQuaternion(worldQuat);
        cubeGroup.add(c);
        c.position.copy(worldPos);
        c.quaternion.copy(worldQuat);
      });
      scene.remove(group);
      isRotating = false;
      refreshSelection();
      playGameSound('move');
    })
    .start();
}

async function shuffleCube() {
  if (isRotating) return;
  clearSelection();
  const diff = parseInt(document.getElementById('difficulty').value, 10);
  const axes = ['x','y','z'];
  const layers = [-1,0,1];
  for (let i=0;i<diff;i++) {
    while (isRotating) await new Promise(r=>setTimeout(r,10));
    const axis = axes[Math.floor(Math.random()*axes.length)];
    const layer = layers[Math.floor(Math.random()*layers.length)];
    const angle = Math.random() > .5 ? Math.PI/2 : -Math.PI/2;
    rotateFace(axis, layer, angle);
    await new Promise(r=>setTimeout(r,285));
  }
}

function solveCube() {
  if (isRotating) return;
  clearSelection();
  isRotating = true;
  new TWEEN.Tween(cubeGroup.rotation)
    .to({x:0,y:0,z:0},700)
    .easing(TWEEN.Easing.Cubic.InOut)
    .onComplete(() => { createCube(); isRotating=false; })
    .start();
}

function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  renderer.render(scene,camera);
  updateArrows();
}

if (typeof THREE !== 'undefined' && typeof TWEEN !== 'undefined') init();
else console.error('three.js / tween.js failed to load');
