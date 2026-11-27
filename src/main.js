import './style.css';
import { chapters } from './chapters.js';
import { exhibitPhases } from './exhibit-phases.js';
import { createRelief } from './relief.js';
import { createRouteExplorer, routeSources } from './routes.js';

const byId = (id) => document.getElementById(id);
const stageViewport = byId('stage-viewport');
const sceneCanvas = byId('scene-canvas');
const reliefCanvas = byId('relief-canvas');
const sceneControls = byId('scene-controls');
const terrainStatus = byId('terrain-status');
const chapterLinks = byId('chapter-links');
const timelineSteps = byId('timeline-steps');
const playTimeline = byId('play-timeline');
const phaseScrub = byId('phase-scrub');
const playSpeed = byId('play-speed');
const sandTable = byId('sand-table');
const sequence = chapters.flatMap(item => item.timeline.map((_, step) => ({ chapter: item, step })));
phaseScrub.max = sequence.length;
const hotspotButtons = byId('hotspot-buttons');
const variants = byId('stage-variants');
const modeButtons = document.querySelectorAll('[data-mode]');
const viewButtons = document.querySelectorAll('[data-view]');
const variantButtons = variants.querySelectorAll('[data-variant]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const timelineViews = {
  xiangjiang: ['overview', 'ground', 'overview'],
  zunyi: ['overview', 'detail', 'ground'],
  chishui: ['ground', 'overview', 'overview'],
  jinsha: ['overview', 'detail', 'ground'],
  dadu: ['overview', 'detail', 'ground'],
  luding: ['overview', 'detail', 'ground'],
  'snow-grass': ['ground', 'overview', 'detail'],
};

let chapter;
let scene;
let sceneInit;
let sceneKey;
let inView = false;
let mode = '3d';
let variant = 'primary';
let view = 'overview';
let activeStep = 0;
let activeHotspot = -1;
let playing = false;
let playbackTimer;
const phaseDuration = 7000;
let remainingDuration = phaseDuration;
let clockStartedAt;
let clockRate = 1;
let reliefState;
let sceneState = { status: 'loading' };

function text(id, value) {
  byId(id).textContent = value;
}

function pressed(buttons, isActive) {
  Array.from(buttons).forEach((button, index) => button.setAttribute('aria-pressed', String(isActive(button, index))));
}

function appendText(parent, tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function phaseFromHash() {
  const match = /^#chapter-([a-z-]+)(?:\/(\d+))?$/.exec(location.hash);
  if (!match) return undefined;
  const item = chapters.find(entry => entry.id === match[1]);
  if (item) return { chapter: item, step: Math.min(item.timeline.length - 1, Math.max(0, Number(match[2] ?? 1) - 1)) };
}

function phaseHash(item, step) {
  return '#chapter-' + item.id + (step ? '/' + (step + 1) : '');
}

function updateCoordinates() {
  const feature = reliefState?.feature;
  const latitude = feature?.lat ?? chapter.latitude;
  const longitude = feature?.lon ?? chapter.longitude;
  text('stage-coordinates', latitude.toFixed(3) + '° N  /  ' + longitude.toFixed(3) + '° E');
}

function selectionKey() {
  return chapter.id + ':' + variant;
}

function updateStage() {
  const visible3d = mode === '3d' && ['ready', 'fallback'].includes(sceneState.status);
  sceneCanvas.hidden = !visible3d;
  reliefCanvas.hidden = visible3d;
  sceneControls.hidden = !visible3d;
  if (!visible3d) {
    stageViewport.style.setProperty('--north-angle', '0deg');
    relief.paint();
  }
  pressed(modeButtons, (button) => button.dataset.mode === mode);
  text('stage-label', visible3d ? '三维沙盘' : '地形图');
  text('scene-hint', visible3d ? '拖动旋转 · 滚轮缩放 · 选择编号看点' : '上北 · 选中下方看点继续阅读');
  const source = visible3d ? sceneState.source : reliefState?.source;
  terrainStatus.replaceChildren();

  if (source?.name) {
    if (source.url) {
      const link = appendText(terrainStatus, 'a', source.name);
      link.href = source.url;
    } else {
      terrainStatus.append(source.name);
    }
    if (visible3d) {
      terrainStatus.append(' · 河面与场景构件为示意');
    } else if (Number.isFinite(reliefState?.minimum)) {
      terrainStatus.append(' · ' + reliefState.minimum + '–' + reliefState.maximum + ' 米');
    }
  } else if (visible3d) {
    terrainStatus.append('示意地形 · 实测高程暂时无法加载');
  } else if (reliefState?.status === 'unavailable') {
    terrainStatus.append('示意图 · 实测高程暂时无法加载');
  } else {
    terrainStatus.append('正在准备地形');
  }
  if (sceneState.status === 'unavailable') {
    terrainStatus.append(' · 3D 暂不可用');
  } else if (mode === '3d' && !visible3d) {
    terrainStatus.append(' · 3D 加载中');
  }
}

const relief = createRelief(reliefCanvas, (state) => {
  reliefState = state;
  updateCoordinates();
  updateStage();
});

function setHotspot(index) {
  if (!chapter.hotspots[index]) return;
  stopPlayback();
  if (chapter.id === 'snow-grass' && activeStep !== index) seekTo(sequenceIndex() - activeStep + index);
  activeHotspot = index;
  pressed(hotspotButtons.children, (_, current) => index === current);
  text('hotspot-text', chapter.hotspots[index].text);
  scene?.setActiveHotspot(index);
}

function resetViewButtons() {
  view = 'overview';
  pressed(viewButtons, (button) => button.dataset.view === view);
}

function setView(nextView) {
  view = nextView;
  pressed(viewButtons, (button) => button.dataset.view === view);
  scene?.setView(view);
}

async function startScene() {
  if (mode !== '3d' || !inView) return;
  if (!sceneInit) {
    sceneInit = import('./scene.js')
      .then(({ createTerrainStage }) => createTerrainStage(sceneCanvas, {
        onHotspot: setHotspot,
        background: '#303631',
        onOrientation(angle) {
          if (!sceneCanvas.hidden) stageViewport.style.setProperty('--north-angle', angle + 'deg');
        },
        onState(state) {
          if (sceneKey !== selectionKey()) return;
          sceneState = state;
          if (state.status === 'unavailable') mode = '2d';
          updateStage();
          schedulePlayback();
        },
      }))
      .catch(() => {
        sceneState = { status: 'unavailable' };
        mode = '2d';
        updateStage();
        schedulePlayback();
      });
  }
  scene = await sceneInit;
  if (!scene || mode !== '3d') return;
  const key = selectionKey();
  if (sceneKey === key) return;
  sceneKey = key;
  await scene.setChapter(chapter, { variant });
  if (sceneKey === key) {
    scene.setPlaying(playing && mode === '3d', Number(playSpeed.value));
    scene.setPhase(activeStep);
    scene.setView(view);
    scene.setActiveHotspot(activeHotspot);
  }
}

function loadTerrain() {
  sceneKey = undefined;
  sceneState = { status: 'loading' };
  resetViewButtons();
  relief.show(variant === 'alternate' ? chapter.id + '-alt' : chapter.id);
  updateStage();
  void startScene();
}

function setMode(nextMode) {
  if (mode === nextMode) return;
  mode = nextMode;
  if (mode === '3d' && sceneState.status === 'unavailable') {
    sceneKey = undefined;
    sceneState = { status: 'loading' };
    if (!scene) sceneInit = undefined;
  }
  updateStage();
  if (mode === '3d') void startScene();
  schedulePlayback();
}

function setVariant(nextVariant) {
  if (variant === nextVariant) return;
  variant = nextVariant;
  activeHotspot = -1;
  pressed(hotspotButtons.children, () => false);
  text('hotspot-text', '');
  pressed(variantButtons, (item) => item.dataset.variant === variant);
  loadTerrain();
}

function setTimeline(index, updateView = true) {
  const event = chapter.timeline[index];
  const phase = exhibitPhases[chapter.id][index];
  activeStep = index;
  const cursor = sequenceIndex();
  phaseScrub.value = cursor + 1;
  phaseScrub.setAttribute('aria-valuetext', chapter.title + '，' + event.title + '，全程第' + (cursor + 1) + '幕');
  text('phase-count', (cursor + 1) + ' / ' + sequence.length + ' 幕');
  byId('previous-phase').disabled = cursor === 0;
  byId('next-phase').disabled = cursor === sequence.length - 1;
  pressed(timelineSteps.children, (_, current) => index === current);
  text('timeline-note-date', event.date);
  text('timeline-note-title', event.title);
  text('timeline-note-text', event.text);
  text('phase-caption', phase.caption);
  activeHotspot = -1;
  pressed(hotspotButtons.children, () => false);
  text('hotspot-text', '');
  scene?.setActiveHotspot(-1);
  if (updateView && phase.variant) setVariant(phase.variant);
  if (sceneKey === selectionKey()) scene?.setPhase(index);
  if (updateView && (!playing || !reducedMotion.matches)) setView(timelineViews[chapter.id][index]);
  playTimeline.textContent = playing ? 'Ⅱ 暂停推演' : cursor === sequence.length - 1 ? '↺ 从头播放' : '▶ 播放推演';
  schedulePlayback(true);
}

function sequenceIndex() {
  return sequence.findIndex(item => item.chapter === chapter && item.step === activeStep);
}

function seekTo(cursor) {
  const target = sequence[cursor];
  if (!target) return;
  if (target.chapter === chapter) setTimeline(target.step);
  else renderChapter(target.chapter, target.step);
  history.replaceState(null, '', phaseHash(target.chapter, target.step));
}

function schedulePlayback(reset = false) {
  clearTimeout(playbackTimer);
  if (clockStartedAt !== undefined) {
    remainingDuration = Math.max(0, remainingDuration - (performance.now() - clockStartedAt) * clockRate);
    clockStartedAt = undefined;
  }
  if (reset) remainingDuration = phaseDuration;
  clockRate = Number(playSpeed.value);
  const running = playing && !document.hidden && !(mode === '3d' && sceneState.status === 'loading');
  scene?.setPlaying(running && mode === '3d', clockRate);
  if (!running) return;
  clockStartedAt = performance.now();
  playbackTimer = setTimeout(() => {
    const next = sequenceIndex() + 1;
    if (next === sequence.length) stopPlayback();
    else seekTo(next);
  }, remainingDuration / clockRate);
}

function stopPlayback() {
  playing = false;
  schedulePlayback();
  playTimeline.textContent = sequenceIndex() === sequence.length - 1 ? '↺ 从头播放' : '▶ 播放推演';
}

function togglePlayback() {
  if (playing) {
    stopPlayback();
    return;
  }
  if (sequenceIndex() === sequence.length - 1) seekTo(0);
  playing = true;
  playTimeline.textContent = 'Ⅱ 暂停推演';
  schedulePlayback();
}

function renderChapter(nextChapter, step = 0) {
  if (chapter === nextChapter) {
    setTimeline(step);
    return;
  }
  chapter = nextChapter;
  sceneKey = undefined;
  variant = exhibitPhases[chapter.id][step].variant ?? 'primary';
  activeHotspot = -1;
  pressed(variantButtons, (button) => button.dataset.variant === variant);
  variants.hidden = chapter.id !== 'snow-grass';
  document.title = chapter.title + ' · 长征纪念馆';
  for (const link of chapterLinks.children) {
    if (link.dataset.chapter === chapter.id) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
  text('chapter-number', chapter.number);
  text('chapter-title', chapter.title);
  text('chapter-location', chapter.location);
  text('chapter-date', chapter.date);
  text('chapter-summary', chapter.summary);
  text('chapter-context', chapter.context);
  text('chapter-legacy', chapter.legacy);
  text('artifact-details-title', chapter.artifact.title);
  text('artifact-details', chapter.artifact.text);

  const sources = byId('source-list');
  sources.replaceChildren();
  for (const source of chapter.sources) {
    const item = document.createElement('li');
    const link = appendText(item, 'a', source.title);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener';
    sources.append(item);
  }
  timelineSteps.replaceChildren();
  chapter.timeline.forEach((event, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline__step';
    appendText(button, 'small', event.date);
    appendText(button, 'strong', event.title);
    button.addEventListener('click', () => {
      stopPlayback();
      seekTo(sequenceIndex() - activeStep + index);
    });
    timelineSteps.append(button);
  });
  hotspotButtons.replaceChildren();
  chapter.hotspots.forEach((hotspot, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    appendText(button, 'span', String(index + 1)).setAttribute('aria-hidden', 'true');
    button.append(hotspot.title);
    button.addEventListener('click', () => setHotspot(index));
    hotspotButtons.append(button);
  });
  loadTerrain();
  setTimeline(step, false);
  if (step && (!playing || !reducedMotion.matches)) setView(timelineViews[chapter.id][step]);
}

function goToChapter(id, focus = true) {
  const nextChapter = chapters.find((item) => item.id === id);
  if (!nextChapter) return;
  const hash = '#chapter-' + id;
  stopPlayback();
  if (location.hash !== hash) history.pushState(null, '', hash);
  renderChapter(nextChapter);
  if (focus) {
    byId('chapter-title').focus({ preventScroll: true });
    stageViewport.closest('.chapter').scrollIntoView({ block: 'start' });
  }
}

for (const item of chapters) {
  const link = document.createElement('a');
  link.className = 'chapter-link';
  link.dataset.chapter = item.id;
  link.href = '#chapter-' + item.id;
  appendText(link, 'span', item.number, 'chapter-link__number').setAttribute('aria-hidden', 'true');
  const labels = document.createElement('span');
  appendText(labels, 'strong', item.title);
  appendText(labels, 'small', item.date);
  link.append(labels);
  appendText(link, 'span', '›', 'chapter-link__arrow').setAttribute('aria-hidden', 'true');
  link.addEventListener('click', (event) => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goToChapter(item.id);
  });
  chapterLinks.append(link);
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});
viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    stopPlayback();
    setView(button.dataset.view);
  });
});
variantButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (variant === button.dataset.variant) return;
    stopPlayback();
    seekTo(sequenceIndex() - activeStep + (button.dataset.variant === 'primary' ? 0 : 1));
  });
});
byId('reset-view').addEventListener('click', () => {
  stopPlayback();
  resetViewButtons();
  scene?.resetView();
});
playTimeline.addEventListener('click', togglePlayback);
phaseScrub.addEventListener('input', () => {
  stopPlayback();
  seekTo(Number(phaseScrub.value) - 1);
});
for (const [id, delta] of [['previous-phase', -1], ['next-phase', 1]]) {
  byId(id).addEventListener('click', () => {
    stopPlayback();
    seekTo(sequenceIndex() + delta);
  });
}
playSpeed.addEventListener('change', () => schedulePlayback());
for (const eventName of ['pointerdown', 'wheel', 'keydown']) {
  sceneCanvas.addEventListener(eventName, () => { if (playing) stopPlayback(); }, { passive: true });
}
const expandStage = byId('expand-stage');
expandStage.hidden = !document.fullscreenEnabled || !sandTable.requestFullscreen;
expandStage.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === sandTable) await document.exitFullscreen();
    else await sandTable.requestFullscreen();
  } catch {
    text('scene-hint', '浏览器暂时无法进入全屏，可继续在本页操作。');
  }
});
document.addEventListener('fullscreenchange', () => {
  expandStage.textContent = document.fullscreenElement === sandTable ? '退出全屏' : '全屏';
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPlayback();
});
window.addEventListener('popstate', () => {
  stopPlayback();
  const target = phaseFromHash();
  if (target) renderChapter(target.chapter, target.step);
  else if (!location.hash) renderChapter(chapters[0]);
});
window.addEventListener('hashchange', () => {
  const target = phaseFromHash();
  if (target && (chapter !== target.chapter || activeStep !== target.step)) {
    stopPlayback();
    renderChapter(target.chapter, target.step);
  }
});

const initial = phaseFromHash();
renderChapter(initial?.chapter ?? chapters[0], initial?.step ?? 0);
if (initial) sandTable.scrollIntoView({ block: 'start' });

const visibility = new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  inView = true;
  visibility.disconnect();
  void startScene();
}, { rootMargin: '120px' });
visibility.observe(stageViewport);

const playbackVisibility = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting && playing) stopPlayback();
});
playbackVisibility.observe(sandTable);

createRouteExplorer({
  canvas: byId('route-map'),
  stage: byId('route-stage'),
  toggle: byId('route-view-toggle'),
  reset: byId('route-view-reset'),
  status: byId('route-view-status'),
  filters: byId('route-filters'),
  slider: byId('route-month'),
  dateOutput: byId('route-date-value'),
  pointList: byId('route-points'),
}, { chapters, onChapter: goToChapter });

for (const source of routeSources) {
  const item = document.createElement('li');
  const link = appendText(item, 'a', source.title);
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener';
  byId('route-source-list').append(item);
}
