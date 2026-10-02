/*
 * RUBIKS CUBE 3D GAME
 *
 * Desktop controls are mouse/keyboard only.
 * Mobile controls are a completely separate touch implementation:
 *   - one finger drag anywhere on the game canvas = camera rotation
 *   - one finger tap on a cube piece = select it
 *   - two finger pinch = zoom
 */

let scene, camera, renderer, cubeGroup;
let cubies = [];
let isRotating = false;
let selectedCubie = null;
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

function clearSelection() {
  selectedCubie = null;
  cubies.forEach(c => c.material.forEach(m => { m.opacity = 1; }));
}

function setSelection(cubie) {
  clearSelection();
  selectedCubie = cubie;
  cubie.material.forEach(m => { m.opacity = 0.72; });
}

function getPointerNdc(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - r.left) / r.width) * 2 - 1,
    -((clientY - r.top) / r.height) * 2 + 1
  );
}

function pickCubie(clientX, clientY) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(getPointerNdc(clientX, clientY), camera);
  const hit = raycaster.intersectObjects(cubies, false);
  return hit.length ? hit[0].object : null;
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
    const cubie = pickCubie(t.clientX, t.clientY);
    if (cubie) {
      setSelection(cubie);
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
    const cubie = pickCubie(e.clientX, e.clientY);
    if (cubie) setSelection(cubie); else clearSelection();
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

function onKeyDown(e) {
  if (!selectedCubie || isRotating) return;
  const { x, y, z } = selectedCubie.position;
  const nx = Math.round(x);
  const ny = Math.round(y);
  const nz = Math.round(z);

  let rotationAxis;
  let rotationAngle = Math.PI / 2;
  if (Math.abs(nx) === 1) rotationAxis = 'x';
  else if (Math.abs(ny) === 1) rotationAxis = 'y';
  else rotationAxis = 'z';

  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') rotationAngle = -Math.PI / 2;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    rotateFace(rotationAxis, nx === 0 ? (ny === 0 ? nz : ny) : nx, rotationAngle);
  }
}

function setView(view) {
  switch (view) {
    case 'top': cameraRotation = { x: Math.PI / 2, y: 0 }; break;
    case 'bottom': cameraRotation = { x: -Math.PI / 2, y: 0 }; break;
    case 'front': cameraRotation = { x: 0, y: 0 }; break;
    case 'back': cameraRotation = { x: 0, y: Math.PI }; break;
    case 'left': cameraRotation = { x: 0, y: Math.PI / 2 }; break;
    case 'right': cameraRotation = { x: 0, y: -Math.PI / 2 }; break;
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
      playGameSound('move');
    })
    .start();
}

async function shuffleCube() {
  if (isRotating) return;
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
}

if (typeof THREE !== 'undefined' && typeof TWEEN !== 'undefined') init();
else console.error('three.js / tween.js failed to load');
