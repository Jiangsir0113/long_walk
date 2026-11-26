import './style.css';
import { chapters } from './chapters.js';
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
let playback;
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

function chapterIdFromHash() {
  return /^#chapter-([a-z-]+)$/.exec(location.hash)?.[1];
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
  text('stage-label', visible3d ? '三维地形展台' : '地形展台');
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
  if (chapter.id === 'snow-grass') setVariant(index === 0 ? 'primary' : 'alternate');
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
        onOrientation(angle) {
          if (!sceneCanvas.hidden) stageViewport.style.setProperty('--north-angle', angle + 'deg');
        },
        onState(state) {
          if (sceneKey !== selectionKey()) return;
          sceneState = state;
          if (state.status === 'unavailable') mode = '2d';
          updateStage();
        },
      }))
      .catch(() => {
        sceneState = { status: 'unavailable' };
        mode = '2d';
        updateStage();
      });
  }
  scene = await sceneInit;
  if (!scene || mode !== '3d') return;
  const key = selectionKey();
  if (sceneKey === key) return;
  sceneKey = key;
  await scene.setChapter(chapter, { variant });
  if (sceneKey === key) {
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
}

function setVariant(nextVariant) {
  if (variant === nextVariant) return;
  variant = nextVariant;
  activeHotspot = -1;
  pressed(hotspotButtons.children, () => false);
  text('hotspot-text', '选择场景中的编号或上方看点，查看对应说明。');
  pressed(variantButtons, (item) => item.dataset.variant === variant);
  loadTerrain();
}

function setTimeline(index, updateView = true) {
  const event = chapter.timeline[index];
  activeStep = index;
  pressed(timelineSteps.children, (_, current) => index === current);
  text('timeline-note-date', event.date);
  text('timeline-note-title', event.title);
  text('timeline-note-text', event.text);
  if (updateView) {
    if (chapter.id === 'snow-grass') setVariant(index === 0 ? 'primary' : 'alternate');
    if (!playback || !reducedMotion.matches) setView(timelineViews[chapter.id][index]);
  }
}

function stopPlayback() {
  clearInterval(playback);
  playback = undefined;
  playTimeline.textContent = '▶ 播放时间线';
}

function togglePlayback() {
  if (playback) {
    stopPlayback();
    return;
  }
  if (activeStep === chapter.timeline.length - 1) setTimeline(0);
  playTimeline.textContent = 'Ⅱ 暂停时间线';
  playback = setInterval(() => {
    setTimeline(activeStep + 1);
    if (activeStep === chapter.timeline.length - 1) stopPlayback();
  }, 2800);
}

function renderChapter(nextChapter) {
  if (chapter === nextChapter) return;
  chapter = nextChapter;
  stopPlayback();
  variant = 'primary';
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
  text('artifact-title', chapter.artifact.title);
  text('artifact-details-title', chapter.artifact.title);
  text('artifact-preview', chapter.artifact.text);
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
      setTimeline(index);
    });
    timelineSteps.append(button);
  });
  setTimeline(0, false);
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
  text('hotspot-text', '选择场景中的编号或上方看点，查看对应说明。');
  loadTerrain();
}

function goToChapter(id, focus = true) {
  const nextChapter = chapters.find((item) => item.id === id);
  if (!nextChapter) return;
  const hash = '#chapter-' + id;
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
  button.addEventListener('click', () => setView(button.dataset.view));
});
variantButtons.forEach((button) => {
  button.addEventListener('click', () => setVariant(button.dataset.variant));
});
byId('reset-view').addEventListener('click', () => {
  resetViewButtons();
  scene?.resetView();
});
playTimeline.addEventListener('click', togglePlayback);
byId('read-sources').addEventListener('click', (event) => {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const evidence = byId('chapter-evidence');
  evidence.focus({ preventScroll: true });
  evidence.scrollIntoView({ block: 'start' });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPlayback();
});
window.addEventListener('popstate', () => {
  const id = chapterIdFromHash();
  if (id) renderChapter(chapters.find((item) => item.id === id) ?? chapters[0]);
  else if (!location.hash) renderChapter(chapters[0]);
});
window.addEventListener('hashchange', () => {
  const id = chapterIdFromHash();
  if (id) goToChapter(id, false);
});

const initialChapter = chapters.find((item) => item.id === chapterIdFromHash());
renderChapter(initialChapter ?? chapters[0]);
if (initialChapter) stageViewport.closest('.chapter').scrollIntoView({ block: 'start' });

const visibility = new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  inView = true;
  visibility.disconnect();
  void startScene();
}, { rootMargin: '120px' });
visibility.observe(stageViewport);

createRouteExplorer({
  canvas: byId('route-map'),
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
