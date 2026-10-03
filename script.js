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
let selectedSpot = null;      // WHERE on the cube the tap happened (grid cell + face); stays put when the cube turns
let selectionGroup = null;    // 3D tile frame + arrow stickers
let frameMesh = null;
let arrowMeshes = [];
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
  createSelectionVisuals();
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

        materials.forEach(m => { m.userData.base = m.color.getHex(); });
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

// Shading: how dark the pressed tile becomes (1 = no change, lower = darker).
const SHADE = 0.5;

function resetShading() {
  cubies.forEach(c => c.material.forEach(m => {
    m.opacity = 1;
    m.emissive.setHex(0x000000);
    if (m.userData.base !== undefined) m.color.setHex(m.userData.base);
  }));
}

// The selection is a SPOT on the cube (grid cell + face direction), not a particular tile. After a
// turn the arrows, frame and darkening stay on that spot, and whichever tile is there now is used.
function spotOf(cubie, matIdx) {
  return {
    gx: Math.round(cubie.position.x / TILE_STEP),
    gy: Math.round(cubie.position.y / TILE_STEP),
    gz: Math.round(cubie.position.z / TILE_STEP),
    n: tileNormal(cubie, matIdx)
  };
}

function sameSpot(a, b) {
  return a.gx === b.gx && a.gy === b.gy && a.gz === b.gz && a.n.equals(b.n);
}

// Finds the cubie + sticker currently sitting on the selected spot.
function resolveSpot() {
  const sp = selectedSpot;
  if (!sp) return false;
  const c = cubies.find(q =>
    Math.round(q.position.x / TILE_STEP) === sp.gx &&
    Math.round(q.position.y / TILE_STEP) === sp.gy &&
    Math.round(q.position.z / TILE_STEP) === sp.gz);
  if (!c) return false;
  for (let i = 0; i < 6; i++) {
    if (tileNormal(c, i).equals(sp.n)) { selectedCubie = c; selectedMat = i; return true; }
  }
  return false;
}

function clearSelection() {
  selectedSpot = null;
  selectedCubie = null;
  arrowDefs = [];
  resetShading();
  const label = document.getElementById('face-label');
  if (label) label.classList.remove('show');
  setArrowsShown(false);
}

function setSelection(cubie, matIdx) {
  clearSelection();
  selectedSpot = spotOf(cubie, matIdx);
  selectedCubie = cubie;
  selectedMat = matIdx;
  refreshSelection();
}

function selectTile(tile) {
  if (isRotating) return;
  if (selectedSpot && sameSpot(selectedSpot, spotOf(tile.cubie, tile.matIdx))) clearSelection();
  else setSelection(tile.cubie, tile.matIdx);
}

// Re-derives highlight, face label and arrows. Called on select and after every turn. The spot stays
// where it was tapped; only the tile sitting on it changes.
function refreshSelection() {
  if (!selectedSpot || !resolveSpot()) return;
  const n = tileNormal(selectedCubie, selectedMat);

  // Darken ONLY the pressed tile. Every other tile keeps its normal colour.
  resetShading();
  const pressed = selectedCubie.material[selectedMat];
  pressed.color.setHex(pressed.userData.base).multiplyScalar(SHADE);

  const label = document.getElementById('face-label');
  if (label) {
    label.textContent = faceName(n) + ' FACE';
    label.classList.add('show');
    positionFaceLabel();
  }

  buildArrowDefs(n);
  placeSelectionVisuals(n);
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

/* ----- 3D sticker visuals: highlight frame on the tapped tile + 4 flat arrows ----- */

function squareRing(outer, inner, color, lift) {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer); shape.lineTo(-outer, -outer);
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner); hole.lineTo(-inner, inner); hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner); hole.lineTo(-inner, -inner);
  shape.holes.push(hole);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), stickerMaterial(color));
  mesh.position.z = lift;
  return mesh;
}

function arrowShape(scale) {
  const pts = [[-0.30,-0.11],[0.04,-0.11],[0.04,-0.24],[0.33,0],[0.04,0.24],[0.04,0.11],[-0.30,0.11]]
    .map(p => new THREE.Vector2(p[0] * scale, p[1] * scale));
  return new THREE.Shape(pts);
}

function stickerMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
}

function createSelectionVisuals() {
  selectionGroup = new THREE.Group();
  selectionGroup.visible = false;

  // Tile highlight: dark border with a white line inside it, readable on every tile colour.
  frameMesh = new THREE.Group();
  frameMesh.add(squareRing(0.5, 0.40, 0x0b1220, 0));
  frameMesh.add(squareRing(0.47, 0.43, 0xffffff, 0.006));
  selectionGroup.add(frameMesh);

  // Arrow stickers: white arrow with a dark outline, plus an invisible tap area.
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.ShapeGeometry(arrowShape(1.3)), stickerMaterial(0x0b1220)));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape(1)), stickerMaterial(0xffffff));
    fill.position.z = 0.006;
    root.add(fill);
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    hit.userData.index = i;
    root.add(hit);
    selectionGroup.add(root);
    arrowMeshes.push({ root, hit });
  }
  scene.add(selectionGroup);
}

// Lay an object flat on a face: local +X -> xDir, local +Z -> the face normal.
function orient(obj, xDir, zDir) {
  const y = new THREE.Vector3().crossVectors(zDir, xDir);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDir, y, zDir));
}

// Each arrow sits one tile away from the tapped tile, flat on the face. If a tile is there it looks
// like a sticker on it; at the cube's edge there is no tile, so the arrow just floats in that spot.
function placeSelectionVisuals(n) {
  if (!selectionGroup || !selectedCubie) return;
  const tangent = new THREE.Vector3();
  tangent[AXES.find(a => Math.abs(n[a]) < 0.5)] = 1;
  frameMesh.position.copy(selectedCubie.position).addScaledVector(n, 0.51);
  orient(frameMesh, tangent, n);
  arrowDefs.forEach((def, i) => {
    const root = arrowMeshes[i].root;
    root.position.copy(selectedCubie.position).addScaledVector(n, 0.52).addScaledVector(def.dir, TILE_STEP);
    orient(root, def.dir, n);
  });
}

function setArrowsShown(show) {
  if (!selectionGroup || show === arrowsShown) return;
  arrowsShown = show;
  selectionGroup.visible = show;
}

// Runs every frame: hides the visuals while a turn animates or the tile faces away, and keeps the
// on-screen direction of each arrow up to date (used by the keyboard arrows).
function updateArrows() {
  if (!selectionGroup) return;
  if (!selectedCubie || isRotating || arrowDefs.length !== 4) { setArrowsShown(false); return; }

  const n = tileNormal(selectedCubie, selectedMat);
  const center = selectedCubie.position.clone().addScaledVector(n, 0.52);
  const facing = camera.position.clone().sub(center).normalize().dot(n);
  if (facing < 0.1) { setArrowsShown(false); return; }   // tile is edge-on or on the far side

  const c0 = center.clone().project(camera);
  arrowDefs.forEach(def => {
    const p = center.clone().addScaledVector(def.dir, TILE_STEP).project(camera);
    const dx = p.x - c0.x, dy = -(p.y - c0.y);
    const len = Math.hypot(dx, dy) || 1;
    def.sx = dx / len;
    def.sy = dy / len;
  });
  setArrowsShown(true);
}

function pickArrow(clientX, clientY) {
  if (!arrowsShown) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(getPointerNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObjects(arrowMeshes.map(a => a.hit), false);
  return hits.length ? arrowDefs[hits[0].object.userData.index] : null;
}

// One tap: an arrow sticker turns its slice, a tile selects, empty space deselects.
function handleTap(clientX, clientY) {
  if (isRotating) return;
  const arrow = pickArrow(clientX, clientY);
  if (arrow) {
    rotateFace(arrow.axis, arrow.layer, arrow.angle);
    return;
  }
  const tile = pickTile(clientX, clientY);
  if (tile) {
    selectTile(tile);
    playGameSound('tap');
  } else {
    clearSelection();
  }
}

// Put the face label in the free space at the top right: just left of the VIEW panel when there is
// room beside the toolbar, otherwise right under the VIEW panel. It never covers the cube.
function positionFaceLabel() {
  const label = document.getElementById('face-label');
  const screenEl = document.getElementById('game-screen');
  const panel = document.getElementById('view-panel');
  const bar = document.getElementById('game-toolbar');
  if (!label || !screenEl) return;

  label.style.transform = 'none';
  label.style.left = 'auto';
  label.style.right = '10px';
  label.style.top = '10px';

  const sr = screenEl.getBoundingClientRect();
  const pr = panel ? panel.getBoundingClientRect() : null;
  const br = bar ? bar.getBoundingClientRect() : null;
  const lw = label.offsetWidth;
  const gap = 10;

  if (pr && br && (pr.left - gap) - (br.right + gap) >= lw) {
    label.style.right = (sr.right - pr.left + gap) + 'px';
    label.style.top = (pr.top - sr.top + 6) + 'px';
  } else if (pr) {
    label.style.right = (sr.right - pr.right) + 'px';
    label.style.top = (pr.bottom - sr.top + 8) + 'px';
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
    handleTap(t.clientX, t.clientY);
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
    handleTap(e.clientX, e.clientY);
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
