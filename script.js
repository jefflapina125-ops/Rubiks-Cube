/**
 * 3D Rubik's Cube
 * Controls:
 * - Right Click + Drag: rotate camera
 * - Scroll: zoom
 * - Left Click a tile: select it (its neighbouring tiles on the same face light up)
 * - Left Click a highlighted neighbour: turn the layer so the selected tile moves toward it
 */

const SPACING = 1.05;                       // distance between cubie centres
const MAX_PITCH = Math.PI / 2 - 0.01;       // strictly avoid poles to prevent flipping

const COLORS = {
    front:  0xff0000, // Red
    back:   0xffa500, // Orange
    top:    0xffffff, // White
    bottom: 0xffff00, // Yellow
    left:   0x0000ff, // Blue
    right:  0x00ff00  // Green
};

let scene, camera, renderer, cubeGroup;
let cubies = [];
let isRotating = false;       // a layer turn is animating
let isAutoPlaying = false;    // shuffle / complete is running
let cubeVersion = 0;          // bumped on every rebuild so stale animations are ignored
let moveHistory = [];         // used by COMPLETE to undo moves

// Selection state
let selection = null;         // { cubie, grid, normal }
let overlayMeshes = [];       // all highlight meshes (selected + neighbours)
let neighborMeshes = [];      // clickable neighbour highlights

// Camera state
let cameraRotation = { x: -0.5, y: 0.5 };
let cameraZoom = 6;
let isRightMouseDown = false;
let lastMousePos = { x: 0, y: 0 };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const AXIS_DIRS = [
    new THREE.Vector3( 1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3( 0, 1, 0), new THREE.Vector3( 0,-1, 0),
    new THREE.Vector3( 0, 0, 1), new THREE.Vector3( 0, 0,-1)
];

/* ---------- Highlight visuals (shared geometry/materials) ---------- */

const overlayGeo = new THREE.PlaneGeometry(0.86, 0.86);
const outlineGeo = new THREE.EdgesGeometry(overlayGeo);
const arrowGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0.2, 0);
    s.lineTo(-0.1, 0.17);
    s.lineTo(-0.1, -0.17);
    s.closePath();
    return new THREE.ShapeGeometry(s);
})();

const overlayMatBase = {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
};
const selectedMat = new THREE.MeshBasicMaterial({ ...overlayMatBase, color: 0x38bdf8, opacity: 0.55 });
const neighborMat = new THREE.MeshBasicMaterial({ ...overlayMatBase, color: 0xfacc15, opacity: 0.55 });
const outlineMat  = new THREE.LineBasicMaterial({ color: 0xffffff });
const arrowMat    = new THREE.MeshBasicMaterial({ color: 0x0f172a });


function resizeRenderer() {
    if (!camera || !renderer) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

async function requestLandscapeOnMobile() {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
    if (!isMobile) return;
    // Orientation locking is permitted only by some browsers, often after install/fullscreen and a user gesture.
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            await screen.orientation.lock('landscape');
        }
    } catch (_) { /* Unsupported until installed, fullscreen, or user-initiated; CSS notice handles portrait. */ }
}

/* ---------- Setup ---------- */

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    createCube();
    setupEventListeners();
    animate();
}

function createCube() {
    cubeVersion++;
    clearSelection();
    if (cubeGroup) scene.remove(cubeGroup);
    cubeGroup = new THREE.Group();
    cubies = [];
    moveHistory = [];

    const dark = 0x111111;
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                if (x === 0 && y === 0 && z === 0) continue;

                const materials = [
                    new THREE.MeshLambertMaterial({ color: x ===  1 ? COLORS.right  : dark }),
                    new THREE.MeshLambertMaterial({ color: x === -1 ? COLORS.left   : dark }),
                    new THREE.MeshLambertMaterial({ color: y ===  1 ? COLORS.top    : dark }),
                    new THREE.MeshLambertMaterial({ color: y === -1 ? COLORS.bottom : dark }),
                    new THREE.MeshLambertMaterial({ color: z ===  1 ? COLORS.front  : dark }),
                    new THREE.MeshLambertMaterial({ color: z === -1 ? COLORS.back   : dark })
                ];

                const cubie = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
                cubie.position.set(x * SPACING, y * SPACING, z * SPACING);
                cubeGroup.add(cubie);
                cubies.push(cubie);
            }
        }
    }
    scene.add(cubeGroup);
}

/* ---------- Helpers ---------- */

function gridOf(cubie) {
    return new THREE.Vector3(
        Math.round(cubie.position.x / SPACING),
        Math.round(cubie.position.y / SPACING),
        Math.round(cubie.position.z / SPACING)
    );
}

function snapVector(v) {
    return new THREE.Vector3(Math.round(v.x) || 0, Math.round(v.y) || 0, Math.round(v.z) || 0);
}

function snapCubie(c) {
    c.position.set(
        Math.round(c.position.x / SPACING) * SPACING,
        Math.round(c.position.y / SPACING) * SPACING,
        Math.round(c.position.z / SPACING) * SPACING
    );
    const m = new THREE.Matrix4().makeRotationFromQuaternion(c.quaternion);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m.elements[i] = Math.round(m.elements[i]);
    c.quaternion.setFromRotationMatrix(m);
}

/* ---------- Selection & highlighting ---------- */

function clearSelection() {
    overlayMeshes.forEach(m => m.parent && m.parent.remove(m));
    overlayMeshes = [];
    neighborMeshes = [];
    selection = null;
    if(document.getElementById("face-label")) document.getElementById("face-label").innerText = "";
}

function makeOverlay(grid, normal, dir, material, isNeighbor) {
    const mesh = new THREE.Mesh(overlayGeo, material);
    const yAxis = new THREE.Vector3().crossVectors(normal, dir);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, yAxis, normal));
    mesh.position.copy(grid).multiplyScalar(SPACING).addScaledVector(normal, 0.506);

    const outline = new THREE.LineSegments(outlineGeo, outlineMat);
    outline.position.z = 0.001;
    mesh.add(outline);

    if (isNeighbor) {
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.z = 0.002;
        mesh.add(arrow);
        mesh.userData = { isNeighbor: true, dir: dir.clone() };
    }

    cubeGroup.add(mesh);
    overlayMeshes.push(mesh);
    return mesh;
}

function selectSticker({ cubie, grid, normal }) {
    clearSelection();
    selection = { cubie, grid, normal };
    updateFaceLabel(normal);

    const planeDirs = AXIS_DIRS.filter(d => Math.abs(d.dot(normal)) < 0.5);
    makeOverlay(grid, normal, planeDirs[0], selectedMat, false);

    for (const d of planeDirs) {
        const ng = grid.clone().add(d);
        if (Math.abs(ng.x) > 1 || Math.abs(ng.y) > 1 || Math.abs(ng.z) > 1) continue;
        neighborMeshes.push(makeOverlay(ng, normal, d, neighborMat, true));
    }
}

function stickerFromHit(hit) {
    const cubie = hit.object;
    if (!cubies.includes(cubie) || !hit.face) return null;
    const normal = snapVector(hit.face.normal.clone().applyQuaternion(cubie.quaternion));
    const grid = gridOf(cubie);
    if (Math.round(grid.dot(normal)) !== 1) return null;
    return { cubie, grid, normal };
}

function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(cubies.concat(neighborMeshes), false);
    return hits.length ? hits[0] : null;
}

function turnTowards(dir) {
    const { grid, normal } = selection;
    const axisVec = new THREE.Vector3().crossVectors(normal, dir);
    const axis = Math.abs(axisVec.x) > 0.5 ? 'x' : Math.abs(axisVec.y) > 0.5 ? 'y' : 'z';
    const sign = Math.sign(axisVec[axis]);
    const layer = grid[axis];

    clearSelection();
    rotateFace(axis, layer, sign * Math.PI / 2);
}

/* ---------- Events ---------- */

function setupEventListeners() {
    const canvas = renderer.domElement;
    window.addEventListener('resize', resizeRenderer);
    window.addEventListener('orientationchange', () => setTimeout(resizeRenderer, 150));
    document.getElementById('orientation-continue')?.addEventListener('click', () => {
        document.getElementById('orientation-notice').style.display = 'none';
    });
    requestLandscapeOnMobile();
    window.addEventListener('wheel', (e) => {
        cameraZoom += e.deltaY * 0.005;
        cameraZoom = Math.max(3, Math.min(15, cameraZoom));
        updateCamera();
    });
    window.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            isRightMouseDown = true;
            lastMousePos = { x: e.clientX, y: e.clientY };
        }
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) isRightMouseDown = false;
    });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
        if (!isRightMouseDown) return;
        cameraRotation.y -= (e.clientX - lastMousePos.x) * 0.01;
        cameraRotation.x -= (e.clientY - lastMousePos.y) * 0.01;
        cameraRotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cameraRotation.x));
        updateCamera();
        lastMousePos = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || isRotating || isAutoPlaying) return;
        const hit = pick(e);
        if (!hit) { clearSelection(); return; }
        if (hit.object.userData.isNeighbor) {
            turnTowards(hit.object.userData.dir);
            return;
        }
        const sticker = stickerFromHit(hit);
        if (!sticker) { clearSelection(); return; }
        if (selection && selection.cubie === sticker.cubie && selection.normal.equals(sticker.normal)) {
            clearSelection();
        } else {
            selectSticker(sticker);
        }
    });
    canvas.addEventListener('pointermove', (e) => {
        if (isRightMouseDown || !neighborMeshes.length) {
            canvas.style.cursor = 'default';
            return;
        }
        const hit = pick(e);
        canvas.style.cursor = hit && hit.object.userData.isNeighbor ? 'pointer' : 'default';
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') clearSelection();
    });
    document.getElementById('shuffle-btn').addEventListener('click', shuffleCube);
    document.getElementById('solve-btn').addEventListener('click', solveCube);
    document.getElementById('restart-btn').addEventListener('click', () => {
        isAutoPlaying = false;
        createCube();
    });
    document.getElementById('stop-btn').addEventListener('click', () => {
        isAutoPlaying = false;
    });
    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => setView(btn.dataset.view));
    });
}

/* ---------- Camera ---------- */

function updateCamera() {
    camera.position.x = cameraZoom * Math.sin(cameraRotation.y) * Math.cos(cameraRotation.x);
    camera.position.y = cameraZoom * Math.sin(cameraRotation.x);
    camera.position.z = cameraZoom * Math.cos(cameraRotation.y) * Math.cos(cameraRotation.x);
    camera.lookAt(0, 0, 0);
}

function updateFaceLabel(normal) {
    let label = "Unknown";
    if (normal.x === 1) label = "Right";
    else if (normal.x === -1) label = "Left";
    else if (normal.y === 1) label = "Top";
    else if (normal.y === -1) label = "Bottom";
    else if (normal.z === 1) label = "Front";
    else if (normal.z === -1) label = "Back";
    const el = document.getElementById("face-label");
    if(el) el.innerText = label;
}

function setView(view) {
    switch (view) {
        case 'top':    cameraRotation = { x:  MAX_PITCH, y: 0 }; break;
        case 'bottom': cameraRotation = { x: -MAX_PITCH, y: 0 }; break;
        case 'front':  cameraRotation = { x: 0, y: 0 }; break;
        case 'back':   cameraRotation = { x: 0, y: Math.PI }; break;
        case 'left':   cameraRotation = { x: 0, y: Math.PI / 2 }; break;
        case 'right':  cameraRotation = { x: 0, y: -Math.PI / 2 }; break;
    }
    updateCamera();
}

/* ---------- Turning layers ---------- */

function rotateFace(axis, layer, angle, duration = 300, record = true) {
    return new Promise((resolve) => {
        if (isRotating) { resolve(); return; }
        isRotating = true;
        const version = cubeVersion;
        const pivot = new THREE.Group();
        cubeGroup.add(pivot);
        const moving = cubies.filter(c => gridOf(c)[axis] === layer);
        moving.forEach(c => pivot.attach(c));
        const state = { t: 0 };
        new TWEEN.Tween(state)
            .to({ t: angle }, duration)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(() => { pivot.rotation[axis] = state.t; })
            .onComplete(() => {
                if (version === cubeVersion) {
                    pivot.rotation[axis] = angle;
                    pivot.updateMatrixWorld(true);
                    moving.forEach(c => { cubeGroup.attach(c); snapCubie(c); });
                    cubeGroup.remove(pivot);
                    if (record) {
                        const last = moveHistory[moveHistory.length - 1];
                        if (last && last.axis === axis && last.layer === layer && last.angle === -angle) {
                            moveHistory.pop();
                        } else {
                            moveHistory.push({ axis, layer, angle });
                        }
                    }
                }
                isRotating = false;
                resolve();
            })
            .start();
    });
}

async function shuffleCube() {
    if (isRotating || isAutoPlaying) return;
    isAutoPlaying = true;
    clearSelection();
    const version = cubeVersion;
    const diff = parseInt(document.getElementById('difficulty').value);
    const axes = ['x', 'y', 'z'];
    const layers = [-1, 0, 1];
    for (let i = 0; i < diff; i++) {
        if (!isAutoPlaying || version !== cubeVersion) break;
        const axis = axes[Math.floor(Math.random() * 3)];
        const layer = layers[Math.floor(Math.random() * 3)];
        const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
        await rotateFace(axis, layer, angle, 200);
    }
    if (version === cubeVersion) isAutoPlaying = false;
}

async function solveCube() {
    if (isRotating || isAutoPlaying) return;
    isAutoPlaying = true;
    clearSelection();
    const version = cubeVersion;
    while (moveHistory.length && isAutoPlaying && version === cubeVersion) {
        const m = moveHistory.pop();
        await rotateFace(m.axis, m.layer, -m.angle, 150, false);
    }
    if (version === cubeVersion) isAutoPlaying = false;
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    neighborMat.opacity = 0.45 + 0.2 * Math.sin(performance.now() / 250);
    renderer.render(scene, camera);
}

init();
updateCamera();
