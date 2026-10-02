/* Mobile-first menu + level carousel.
   Touch and mouse navigation are intentionally separate:
   - Phones/tablets: native touch events only.
   - Desktop: mouse + keyboard only.
*/

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
const IN_APP = /RubiksCubeApp/.test(navigator.userAgent);
let lastTouchAt = 0;
let suppressClickUntil = 0;

let currentLevel = 1;
let currentOffset = 0;
let dragState = null;
let animating = false;

// Keep real browser/WebView history so Android's physical Back button works.
history.replaceState({screen:'home'}, '', location.pathname + location.search);


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
    const profiles = { tap:[520,.045,.035], slide:[220,.09,.045], start:[420,.16,.05] };
    const [freq,duration,volume] = profiles[type] || profiles.tap;
    osc.type = type === 'slide' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (type === 'slide') osc.frequency.exponentialRampToValueAtTime(300, now + duration);
    if (type === 'start') osc.frequency.exponentialRampToValueAtTime(760, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch (_) {}
}

function enterImmersive() {
  if (IN_APP) return; // the Android app is already fully immersive
  const root = document.documentElement;
  try {
    if (document.fullscreenElement !== root && root.requestFullscreen) {
      const p = root.requestFullscreen({navigationUI:'hide'});
      if (p?.catch) p.catch(() => {});
    }
  } catch (_) {}
  try {
    if (screen.orientation?.lock) {
      const p = screen.orientation.lock('landscape');
      if (p?.catch) p.catch(() => {});
    }
  } catch (_) {}
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  document.body.dataset.screen = name;

  if (name === 'levels') {
    requestAnimationFrame(() => {
      positionCards(0, false);
    });
  }
  if (name === 'game') {
    requestAnimationFrame(() => {
      if (typeof resizeGame === 'function') resizeGame();
    });
  }
}

function levelTone(n) { return n <= 3 ? 'green' : n <= 7 ? 'yellow' : 'red'; }

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
    green:['#28e29a','#f5d43f','#f04b55','#f8fbff','#3d7af1','#ff9b42'],
    yellow:['#f5d43f','#28e29a','#f04b55','#f8fbff','#3d7af1','#ff9b42'],
    red:['#f04b55','#f5d43f','#28e29a','#f8fbff','#3d7af1','#ff9b42']
  };
  const palette = palettes[levelTone(n)];
  for (let i=0;i<9;i++) {
    const tile = document.createElement('span');
    tile.style.setProperty('--face-color', palette[(i+n*2)%palette.length]);
    face.appendChild(tile);
  }
  return face;
}

function makeCard(n) {
  const card = document.createElement('article');
  card.className = `level-card ${n===1?'available':'locked'}`;
  card.dataset.level = String(n);

  const face = makeFace(n);
  const corner = document.createElement('div');
  corner.className = 'card-corner';
  corner.textContent = n === 1 ? 'READY' : '🔒';

  const info = document.createElement('div');
  info.className = 'card-info';
  info.innerHTML = `
    <div class="card-count">LEVEL ${String(n).padStart(2,'0')}</div>
    <div class="card-name">${names[n-1]}</div>
    <div class="card-status">${n===1?'AVAILABLE NOW':'COMING SOON'}</div>
  `;

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = `card-cta ${n===1?'start':'locked'}`;
  cta.textContent = n===1 ? 'START LEVEL' : 'LOCKED 🔒';
  cta.addEventListener('click', ev => {
    ev.stopPropagation();
    if (n !== 1) {
      playSound('tap');
      showToast('This level is coming soon.');
      return;
    }
    playSound('start');
    startLevel();
  });

  card.append(face,corner,info,cta);
  card.addEventListener('click', () => {
    if (animating) return;
    if (currentLevel !== n) goToLevel(n);
    else if (n===1) { playSound('start'); startLevel(); }
  });

  return card;
}

function buildCarousel() {
  track.replaceChildren();
  dots.replaceChildren();
  for (let n=1;n<=totalLevels;n++) {
    track.appendChild(makeCard(n));
    const dot = document.createElement('span');
    dot.className = n===currentLevel ? 'active' : '';
    dots.appendChild(dot);
  }
  updateLevelUI();
}

function updateLevelUI() {
  document.getElementById('level-number').textContent = String(currentLevel).padStart(2,'0');
  document.getElementById('level-caption').textContent = captions[currentLevel-1];
  const pill = document.getElementById('difficulty-pill');
  pill.className = `difficulty-pill ${currentLevel<=3?'easy':currentLevel<=7?'mid':'hard'}`;
  pill.textContent = currentLevel<=3?'BEGINNER · EASY':currentLevel<=7?'INTERMEDIATE · MEDIUM':'ADVANCED · HARD';
  applyTone(currentLevel);
  dots.querySelectorAll('span').forEach((d,i)=>d.classList.toggle('active',i+1===currentLevel));
}

function shortestDiff(cardLevel, centerLevel) {
  let d = cardLevel-centerLevel;
  if (d > totalLevels/2) d -= totalLevels;
  if (d < -totalLevels/2) d += totalLevels;
  return d;
}

function getStep() {
  return Math.min(310, Math.max(185, (carousel.clientWidth || innerWidth) * .235));
}

function positionCards(offset=0, animate=true) {
  const step = getStep();
  track.querySelectorAll('.level-card').forEach(card => {
    const n = Number(card.dataset.level);
    const d = shortestDiff(n,currentLevel);
    const distance = d + offset/step;
    const abs = Math.abs(distance);
    const x = distance*step;
    const scale = distance === 0 ? 1 : Math.max(.60,1-abs*.14);
    const opacity = abs>3 ? 0 : Math.max(.18,1-abs*.29);
    const blur = abs>1 ? Math.min(2.8,(abs-1)*1.25) : 0;
    card.style.transition = animate ? '' : 'none';
    card.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), -50%, 0) scale(${scale.toFixed(3)}) rotateY(${(-distance*8).toFixed(2)}deg)`;
    card.style.opacity = opacity.toFixed(3);
    card.style.filter = `grayscale(${n===1?0:.62}) blur(${blur.toFixed(2)}px)`;
    card.style.zIndex = String(100-Math.round(abs*10));
    card.classList.toggle('is-center', abs < .025);
  });
}

function finishMove(nextLevel) {
  currentLevel = ((nextLevel-1+totalLevels)%totalLevels)+1;
  currentOffset = 0;
  updateLevelUI();
  positionCards(0,false);
  requestAnimationFrame(() => positionCards(0,true));
  animating = false;
}

function animateToNext(direction) {
  if (animating) return;
  animating = true;
  const step = getStep();
  const oldLevel = currentLevel;
  const nextLevel = ((currentLevel-1+direction+totalLevels)%totalLevels)+1;
  playSound('slide');

  currentOffset = -direction * step;
  positionCards(currentOffset, true);

  const duration = 460;
  window.setTimeout(() => {
    // Preserve the current visual frame, then remap the circular positions invisibly.
    finishMove(nextLevel);
  }, duration + 18);

  void oldLevel;
}

function goToLevel(n) {
  n = ((n-1+totalLevels)%totalLevels)+1;
  if (n===currentLevel || animating) return;
  let d = shortestDiff(n,currentLevel);
  // A direct tap can move more than one level; animate in repeated steps.
  const direction = d > 0 ? 1 : -1;
  const count = Math.min(Math.abs(d), totalLevels-1);
  if (count <= 1) {
    animateToNext(direction);
    return;
  }
  let i=0;
  const run = () => {
    if (i>=count) return;
    animateToNext(direction);
    i++;
    setTimeout(run, 500);
  };
  run();
}

function touchStart(e) {
  if (e.touches.length !== 1 || animating) return;
  lastTouchAt = Date.now();
  const t = e.touches[0];
  dragState = {startX:t.clientX,startY:t.clientY,lastX:t.clientX,dragging:false};
}

function touchMove(e) {
  if (!dragState || e.touches.length !== 1 || animating) return;
  const t = e.touches[0];
  const dx = t.clientX-dragState.startX;
  const dy = t.clientY-dragState.startY;
  if (!dragState.dragging && Math.abs(dx)>10 && Math.abs(dx)>Math.abs(dy)) dragState.dragging=true;
  if (!dragState.dragging) return;
  e.preventDefault();
  const live = Math.max(-getStep(),Math.min(getStep(),dx));
  currentOffset = live;
  positionCards(live,false);
}

function touchEnd(e) {
  lastTouchAt = Date.now();
  if (!dragState || animating) { dragState=null; return; }
  const state = dragState;
  if (state.dragging) suppressClickUntil = Date.now() + 400;
  dragState = null;
  const touch = e.changedTouches[0];
  const dx = touch.clientX-state.startX;
  const dy = touch.clientY-state.startY;
  if (state.dragging && Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)) {
    animateToNext(dx<0?1:-1);
  } else if (state.dragging) {
    currentOffset=0;
    positionCards(0,true);
  }
}

function mouseDown(e) {
  if (Date.now()-lastTouchAt<800 || e.button!==0 || animating) return;
  dragState={startX:e.clientX,startY:e.clientY,lastX:e.clientX,dragging:false};
}
function mouseMove(e) {
  if (Date.now()-lastTouchAt<800 || !dragState || animating) return;
  const dx=e.clientX-dragState.startX;
  const dy=e.clientY-dragState.startY;
  if (!dragState.dragging && Math.abs(dx)>7 && Math.abs(dx)>Math.abs(dy)) dragState.dragging=true;
  if (!dragState.dragging) return;
  currentOffset=Math.max(-getStep(),Math.min(getStep(),dx));
  positionCards(currentOffset,false);
}
function mouseUp(e) {
  if (Date.now()-lastTouchAt<800 || !dragState || animating) return;
  const state=dragState; dragState=null;
  if (state.dragging) suppressClickUntil = Date.now() + 400;
  const dx=e.clientX-state.startX; const dy=e.clientY-state.startY;
  if (state.dragging && Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)) animateToNext(dx<0?1:-1);
  else if (state.dragging) { currentOffset=0; positionCards(0,true); }
}

function startLevel() {
  if (currentLevel!==1) return;
  enterImmersive();
  navigateTo('game');
  if (typeof createCube==='function') {
    createCube();
    if (typeof clearSelection==='function') clearSelection();
  }
}

function showToast(message) {
  const toast=document.getElementById('toast');
  toast.textContent=message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove('show'),1600);
}

// Navigation is kept in browser history for the Android hardware Back button.
function navigateTo(name) {
  if (screens[name].classList.contains('active')) return;
  history.pushState({screen:name}, '', `#${name}`);
  showScreen(name);
}

function goBack() {
  if (history.state?.screen && history.state.screen !== 'home') {
    history.back();
  } else {
    showScreen('home');
  }
}

// Main navigation: do NOT await fullscreen. Waiting can lose Android's user gesture.
function runAction(action, targetName) {
  enterImmersive();
  playSound('tap');
  if (targetName) navigateTo(targetName);
  else action();
}

document.getElementById('play-btn').addEventListener('click',()=>runAction(null,'levels'));
document.getElementById('settings-btn').addEventListener('click',()=>runAction(null,'settings'));
document.getElementById('levels-back').addEventListener('click',()=>{playSound('tap');goBack();});
document.getElementById('settings-back').addEventListener('click',()=>{playSound('tap');goBack();});
document.getElementById('game-back').addEventListener('click',()=>{playSound('tap');goBack();});
document.getElementById('home-fullscreen').addEventListener('click',enterImmersive);
document.getElementById('levels-fullscreen').addEventListener('click',enterImmersive);
document.getElementById('settings-fullscreen').addEventListener('click',enterImmersive);
document.getElementById('game-fullscreen').addEventListener('click',enterImmersive);

window.addEventListener('popstate',e=>{
  const name=e.state?.screen || 'home';
  showScreen(screens[name] ? name : 'home');
});

document.getElementById('motion-toggle').addEventListener('change',e=>document.body.classList.toggle('no-motion',!e.target.checked));
const soundToggle=document.getElementById('sound-toggle');
soundToggle.checked=localStorage.getItem('rubiksSound')!=='0';
soundToggle.addEventListener('change',e=>{
  localStorage.setItem('rubiksSound',e.target.checked?'1':'0');
  if(e.target.checked) playSound('tap');
});

carousel.addEventListener('touchstart',touchStart,{passive:true});
carousel.addEventListener('touchmove',touchMove,{passive:false});
carousel.addEventListener('touchend',touchEnd,{passive:true});
carousel.addEventListener('touchcancel',()=>{dragState=null;currentOffset=0;positionCards(0,true)},{passive:true});
carousel.addEventListener('mousedown',mouseDown);
carousel.addEventListener('mousemove',mouseMove);
carousel.addEventListener('mouseup',mouseUp);
carousel.addEventListener('mouseleave',e=>{if(dragState)mouseUp(e);});
// A swipe that starts on a card/button must not also count as a tap on it.
carousel.addEventListener('click',e=>{ if (Date.now()<suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

window.addEventListener('resize',()=>positionCards(0,false));
window.addEventListener('keydown',e=>{
  if(!screens.levels.classList.contains('active')) return;
  if(e.key==='ArrowRight') animateToNext(1);
  if(e.key==='ArrowLeft') animateToNext(-1);
  if(e.key==='Escape') goBack();
});

document.addEventListener('fullscreenchange',()=>{
  document.body.classList.toggle('is-fullscreen',!!document.fullscreenElement);
});

buildCarousel();
positionCards(0,false);

// Inside the Android app the system is already fullscreen: drop the useless fullscreen controls.
if (IN_APP) {
  document.documentElement.classList.add('in-app');
  ['home-fullscreen','levels-fullscreen','game-fullscreen'].forEach(id => document.getElementById(id)?.remove());
  document.getElementById('settings-fullscreen')?.closest('.settings-card')?.remove();
}
