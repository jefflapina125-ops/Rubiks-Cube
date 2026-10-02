const screens = {
  home: document.getElementById('home-screen'),
  levels: document.getElementById('levels-screen'),
  settings: document.getElementById('settings-screen'),
  game: document.getElementById('game-screen')
};

const totalLevels = 10;
const names = ['FIRST STEPS','COLOR THEORY','TURN TRAINING','THE TWIST','SIDE QUEST','COLOR SHIFT','CROSSROADS','RED ALERT','FINAL MIX','THE GRAND CUBE'];
const captions = ['Start simple. Learn the turns.','Build your rhythm.','Every move matters.','Take it one face at a time.','Keep your sides in sight.','Find a new way around.','Think ahead.','A tougher twist awaits.','Master the mix.','The ultimate cube challenge.'];
const ambient = document.querySelector('.ambient-bg');
const carousel = document.getElementById('level-carousel');
const track = document.getElementById('level-track');
const dots = document.getElementById('carousel-dots');
let currentLevel = 1;
let currentOffset = 0;
let targetOffset = 0;
let pointerState = null;
let lastFrame = performance.now();

function getSoundEnabled() {
  return localStorage.getItem('rubiksSound') !== '0';
}

let audioContext = null;
function playSound(type='tap') {
  if (!getSoundEnabled()) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const profiles = {
      tap: [520, 0.045, 0.035],
      slide: [220, 0.085, 0.045],
      start: [420, 0.16, 0.05]
    };
    const [freq, duration, volume] = profiles[type] || profiles.tap;
    osc.type = type === 'slide' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (type === 'slide') osc.frequency.exponentialRampToValueAtTime(300, now + duration);
    if (type === 'start') osc.frequency.exponentialRampToValueAtTime(760, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch (_) {}
}

async function enterImmersive() {
  try {
    const root = document.documentElement;
    if (document.fullscreenElement !== root && root.requestFullscreen) {
      await root.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (_) {}
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch (_) {}
}

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'game') {
    setTimeout(() => {
      if (typeof resizeGame === 'function') resizeGame();
      else if (typeof camera !== 'undefined' && typeof renderer !== 'undefined') {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }, 50);
  }
}

function levelTone(n) {
  return n <= 3 ? 'green' : n <= 7 ? 'yellow' : 'red';
}

function applyTone(n) {
  const tone = levelTone(n);
  document.body.classList.remove('level-green','level-yellow','level-red');
  document.body.classList.add(`level-${tone}`);
  ambient.classList.remove('green','yellow','red');
  ambient.classList.add(tone);
}

function makeFace(n) {
  const face = document.createElement('div');
  face.className = 'level-face';
  const palettes = {
    green: ['#28e29a','#f5d43f','#f04b55','#f8fbff','#3d7af1','#ff9b42'],
    yellow: ['#f5d43f','#28e29a','#f04b55','#f8fbff','#3d7af1','#ff9b42'],
    red: ['#f04b55','#f5d43f','#28e29a','#f8fbff','#3d7af1','#ff9b42']
  };
  const palette = palettes[levelTone(n)];
  for (let i = 0; i < 9; i++) {
    const tile = document.createElement('span');
    tile.style.setProperty('--face-color', palette[(i + n * 2) % palette.length]);
    face.appendChild(tile);
  }
  return face;
}

function makeCard(n) {
  const card = document.createElement('article');
  card.className = 'level-card' + (n === 1 ? ' available' : ' locked');
  card.dataset.level = String(n);
  card.tabIndex = 0;

  const face = makeFace(n);
  const corner = document.createElement('div');
  corner.className = 'card-corner';
  corner.innerHTML = n === 1 ? 'PLAYABLE' : '🔒';

  const info = document.createElement('div');
  info.className = 'card-info';
  info.innerHTML = `
    <div class="card-count">LEVEL ${String(n).padStart(2,'0')}</div>
    <div class="card-name">${names[n-1]}</div>
    <div class="card-status">${n === 1 ? 'AVAILABLE NOW' : 'COMING SOON'}</div>
  `;

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = n === 1 ? 'card-cta start' : 'card-cta locked';
  cta.textContent = n === 1 ? 'START LEVEL  →' : 'LOCKED  🔒';
  cta.addEventListener('click', e => {
    e.stopPropagation();
    if (n !== 1) {
      playSound('tap');
      showToast('This level is coming soon.');
      return;
    }
    if (currentLevel !== 1) {
      goToLevel(1);
      return;
    }
    playSound('start');
    startLevel();
  });

  card.append(face, corner, info, cta);
  card.addEventListener('click', () => {
    if (currentLevel !== n) {
      goToLevel(n);
    } else if (n === 1) {
      playSound('start');
      startLevel();
    }
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (n === 1 && currentLevel === 1) startLevel(); else goToLevel(n);
    }
  });
  return card;
}

function buildCarousel() {
  track.innerHTML = '';
  dots.innerHTML = '';
  for (let n = 1; n <= totalLevels; n++) {
    track.appendChild(makeCard(n));
    const dot = document.createElement('span');
    dot.className = n === currentLevel ? 'active' : '';
    dot.setAttribute('aria-hidden', 'true');
    dots.appendChild(dot);
  }
  updateLevelUI();
}

function updateLevelUI() {
  document.getElementById('level-number').textContent = String(currentLevel).padStart(2,'0');
  document.getElementById('level-caption').textContent = captions[currentLevel-1];
  const pill = document.getElementById('difficulty-pill');
  pill.className = `difficulty-pill ${currentLevel <= 3 ? 'easy' : currentLevel <= 7 ? 'mid' : 'hard'}`;
  pill.textContent = currentLevel <= 3 ? 'BEGINNER · EASY' : currentLevel <= 7 ? 'INTERMEDIATE · MEDIUM' : 'ADVANCED · HARD';
  applyTone(currentLevel);
  dots.querySelectorAll('span').forEach((dot, i) => dot.classList.toggle('active', i + 1 === currentLevel));
}

function shortestDiff(cardLevel, centerLevel) {
  let d = cardLevel - centerLevel;
  if (d > totalLevels / 2) d -= totalLevels;
  if (d < -totalLevels / 2) d += totalLevels;
  return d;
}

function positionCards(offset=0, animate=true) {
  const width = carousel.clientWidth || window.innerWidth;
  const step = Math.min(330, Math.max(205, width * 0.265));
  const cards = track.querySelectorAll('.level-card');
  cards.forEach(card => {
    const n = Number(card.dataset.level);
    const d = shortestDiff(n, currentLevel);
    const distance = d + offset / step;
    const abs = Math.abs(distance);
    const x = distance * step;
    const scale = distance === 0 ? 1 : Math.max(0.60, 1 - abs * 0.14);
    const opacity = abs > 3 ? 0 : Math.max(0.22, 1 - abs * 0.28);
    const blur = abs > 1 ? Math.min(2.5, (abs - 1) * 1.2) : 0;
    card.style.transition = animate ? '' : 'none';
    card.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), -50%, 0) scale(${scale}) rotateY(${(-distance * 8).toFixed(2)}deg)`;
    card.style.opacity = opacity.toFixed(3);
    card.style.filter = `grayscale(${n === 1 ? 0 : 0.62}) blur(${blur.toFixed(2)}px)`;
    card.style.zIndex = String(50 - Math.round(abs * 10));
    card.setAttribute('aria-hidden', abs > 2.2 ? 'true' : 'false');
    card.classList.toggle('is-center', Math.abs(distance) < 0.02);
  });
}

function animateToLevel(nextLevel) {
  currentLevel = nextLevel;
  targetOffset = 0;
  updateLevelUI();
  positionCards(currentOffset, true);
  requestAnimationFrame(() => {
    currentOffset = 0;
    positionCards(0, true);
  });
}

function goToLevel(n) {
  n = ((n - 1 + totalLevels) % totalLevels) + 1;
  if (n === currentLevel) return;
  playSound('slide');
  const direction = shortestDiff(n, currentLevel) > 0 ? 1 : -1;
  currentLevel = n;
  updateLevelUI();
  // Start from the old visual state then animate into the new center.
  currentOffset = direction * Math.min(330, Math.max(205, (carousel.clientWidth || window.innerWidth) * 0.265));
  positionCards(currentOffset, false);
  requestAnimationFrame(() => {
    currentOffset = 0;
    positionCards(0, true);
  });
}

function stepLevel(direction) {
  const next = ((currentLevel - 1 + direction + totalLevels) % totalLevels) + 1;
  goToLevel(next);
}

function handlePointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointerState = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  carousel.setPointerCapture?.(e.pointerId);
}

function handlePointerMove(e) {
  if (!pointerState || pointerState.id !== e.pointerId) return;
  const dx = e.clientX - pointerState.x;
  const dy = e.clientY - pointerState.y;
  if (Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy)) pointerState.moved = true;
  if (pointerState.moved) {
    const clamped = Math.max(-170, Math.min(170, dx));
    positionCards(clamped, false);
  }
}

function handlePointerUp(e) {
  if (!pointerState || pointerState.id !== e.pointerId) return;
  const dx = e.clientX - pointerState.x;
  const dy = e.clientY - pointerState.y;
  const moved = pointerState.moved;
  pointerState = null;
  if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) {
    stepLevel(dx < 0 ? 1 : -1);
  } else if (moved) {
    positionCards(0, true);
  }
}

function startLevel() {
  if (currentLevel !== 1) return;
  enterImmersive();
  showScreen('game');
  if (typeof createCube === 'function') {
    createCube();
    if (typeof clearSelection === 'function') clearSelection();
    setTimeout(() => typeof resizeGame === 'function' && resizeGame(), 80);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1600);
}

// Main navigation
async function handleMainInteraction(action) {
  await enterImmersive();
  playSound('tap');
  action();
}

document.getElementById('play-btn').addEventListener('click', () => handleMainInteraction(() => showScreen('levels')));
document.getElementById('settings-btn').addEventListener('click', () => handleMainInteraction(() => showScreen('settings')));
document.getElementById('levels-back').addEventListener('click', () => { playSound('tap'); showScreen('home'); });
document.getElementById('settings-back').addEventListener('click', () => { playSound('tap'); showScreen('home'); });
document.getElementById('game-back').addEventListener('click', () => { playSound('tap'); showScreen('levels'); });
document.getElementById('home-fullscreen').addEventListener('click', enterImmersive);
document.getElementById('settings-fullscreen').addEventListener('click', enterImmersive);
document.getElementById('game-fullscreen').addEventListener('click', enterImmersive);

document.getElementById('motion-toggle').addEventListener('change', e => document.body.classList.toggle('no-motion', !e.target.checked));
const savedSound = localStorage.getItem('rubiksSound');
const soundToggle = document.getElementById('sound-toggle');
soundToggle.checked = savedSound !== '0';
soundToggle.addEventListener('change', e => {
  localStorage.setItem('rubiksSound', e.target.checked ? '1' : '0');
  if (e.target.checked) playSound('tap');
});

carousel.addEventListener('pointerdown', handlePointerDown);
carousel.addEventListener('pointermove', handlePointerMove);
carousel.addEventListener('pointerup', handlePointerUp);
carousel.addEventListener('pointercancel', () => { pointerState = null; positionCards(0, true); });
carousel.addEventListener('pointerleave', e => { if (pointerState && e.pointerType === 'mouse') handlePointerUp(e); });

window.addEventListener('resize', () => positionCards(0, false));
window.addEventListener('keydown', e => {
  if (!screens.levels.classList.contains('active')) return;
  if (e.key === 'ArrowRight') stepLevel(1);
  if (e.key === 'ArrowLeft') stepLevel(-1);
  if (e.key === 'Escape') showScreen('home');
});

buildCarousel();
positionCards(0, false);
