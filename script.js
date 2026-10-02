/**
 * RUBIKS CUBE 3D game
 * Mouse/touch:
 * - Drag empty space or the canvas: rotate camera
 * - Two-finger pinch: zoom
 * - Tap a cubie: select it
 * - Keyboard arrows after selecting a cubie: turn its layer
 */

let scene, camera, renderer, cubeGroup;
let cubies = [];
let isRotating = false;
let selectedCubie = null;
let cameraZoom = 6;
let cameraRotation = { x: -0.5, y: 0.5 };
let pointers = new Map();
let gesture = null;

const COLORS = {
  front: 0xff0000,
  back: 0xffa500,
  top: 0xffffff,
  bottom: 0xffff00,
  left: 0x0000ff,
  right: 0x00ff00
};

function resizeGame() {
  if (!renderer || !camera) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(width, height, false);
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.domElement.setAttribute('aria-label', '3D Rubiks Cube');
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.52);
  directionalLight.position.set(10, 20, 10);
  scene.add(directionalLight);

  createCube();
  setupEventListeners();
  updateCamera();
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
  return new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
}

function pickCubie(clientX, clientY) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(getPointerNdc(clientX, clientY), camera);
  const intersects = raycaster.intersectObjects(cubies, false);
  return intersects.length ? intersects[0].object : null;
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

function setupEventListeners() {
  window.addEventListener('resize', resizeGame);

  window.addEventListener('wheel', e => {
    cameraZoom = Math.max(3.1, Math.min(14, cameraZoom + e.deltaY * 0.004));
    updateCamera();
  }, { passive: true });

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp, { passive: false });
  canvas.addEventListener('pointercancel', onPointerCancel, { passive: false });

  document.getElementById('shuffle-btn').addEventListener('click', () => { playGameSound('start'); shuffleCube(); });
  document.getElementById('solve-btn').addEventListener('click', () => { playGameSound('start'); solveCube(); });
  document.getElementById('restart-btn').addEventListener('click', () => { playGameSound('tap'); createCube(); });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => { playGameSound('tap'); setView(btn.dataset.view); });
  });

  document.getElementById('view-toggle').addEventListener('click', () => {
    playGameSound('tap');
    document.getElementById('view-panel').classList.toggle('collapsed');
  });

  window.addEventListener('keydown', onKeyDown);
}

function onPointerDown(e) {
  e.preventDefault();
  renderer.domElement.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

  if (pointers.size === 1) {
    gesture = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      startCubie: pickCubie(e.clientX, e.clientY)
    };
  } else if (pointers.size === 2) {
    const pts = [...pointers.values()];
    gesture = { pinchStartDistance: distance(pts[0], pts[1]), pinchStartZoom: cameraZoom };
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  e.preventDefault();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

  if (pointers.size >= 2) {
    const pts = [...pointers.values()];
    if (!gesture?.pinchStartDistance) {
      gesture = { pinchStartDistance: distance(pts[0], pts[1]), pinchStartZoom: cameraZoom };
    }
    const d = distance(pts[0], pts[1]);
    cameraZoom = Math.max(3.1, Math.min(14, gesture.pinchStartZoom * gesture.pinchStartDistance / Math.max(30, d)));
    updateCamera();
    return;
  }

  if (!gesture || gesture.pointerId !== e.pointerId) return;
  const dxTotal = e.clientX - gesture.startX;
  const dyTotal = e.clientY - gesture.startY;
  if (Math.hypot(dxTotal, dyTotal) > 7) gesture.moved = true;

  const dx = e.clientX - gesture.lastX;
  const dy = e.clientY - gesture.lastY;
  if (gesture.moved) {
    // A one-finger drag rotates the camera. This works over both empty space and the cube.
    cameraRotation.y -= dx * 0.0085;
    cameraRotation.x += dy * 0.0085;
    cameraRotation.x = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, cameraRotation.x));
    updateCamera();
  }
  gesture.lastX = e.clientX;
  gesture.lastY = e.clientY;
}

function onPointerUp(e) {
  e.preventDefault();
  const state = gesture;
  pointers.delete(e.pointerId);

  if (pointers.size === 1) {
    // Continue normal one-finger rotation after a pinch ends.
    const p = [...pointers.entries()][0];
    gesture = { pointerId: p[0], startX: p[1].x, startY: p[1].y, lastX: p[1].x, lastY: p[1].y, moved: true, startCubie: null };
    return;
  }
  if (pointers.size > 0) return;
  gesture = null;

  if (!state) return;
  if (!state.moved && e.pointerType !== 'mouse') {
    const cubie = pickCubie(e.clientX, e.clientY);
    if (cubie) {
      setSelection(cubie);
      playGameSound('tap');
    } else {
      clearSelection();
    }
  } else if (!state.moved && e.pointerType === 'mouse' && e.button === 0) {
    const cubie = pickCubie(e.clientX, e.clientY);
    if (cubie) setSelection(cubie); else clearSelection();
  }
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  gesture = null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onKeyDown(e) {
  if (!selectedCubie || isRotating) return;
  const { x, y, z } = selectedCubie.position;
  const nx = Math.round(x);
  const ny = Math.round(y);
  const nz = Math.round(z);

  let rotationAxis = null;
  let rotationAngle = Math.PI / 2;
  if (Math.abs(nx) === 1) rotationAxis = 'x';
  else if (Math.abs(ny) === 1) rotationAxis = 'y';
  else rotationAxis = 'z';
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') rotationAngle = -Math.PI / 2;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    rotateFace(rotationAxis, nx === 0 ? (ny === 0 ? nz : ny) : nx, rotationAngle);
  }
}

function setView(view) {
  switch(view) {
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
    .onUpdate(() => {
      group.rotation[axis] = state.angle;
    })
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
  const axes = ['x', 'y', 'z'];
  const layers = [-1, 0, 1];
  for (let i = 0; i < diff; i++) {
    while (isRotating) await new Promise(r => setTimeout(r, 10));
    const axis = axes[Math.floor(Math.random() * 3)];
    const layer = layers[Math.floor(Math.random() * 3)];
    const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
    rotateFace(axis, layer, angle);
    await new Promise(r => setTimeout(r, 285));
  }
}

function solveCube() {
  if (isRotating) return;
  isRotating = true;
  new TWEEN.Tween(cubeGroup.rotation)
    .to({ x: 0, y: 0, z: 0 }, 700)
    .easing(TWEEN.Easing.Cubic.InOut)
    .onComplete(() => {
      createCube();
      isRotating = false;
    })
    .start();
}

function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  renderer.render(scene, camera);
}

init();
