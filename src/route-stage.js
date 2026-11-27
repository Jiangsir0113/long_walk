import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const table = { width: 34, depth: 24 };
const hills = [
  [-12, -4, 1.22, 36],
  [-7, 4, 1.48, 39],
  [-3, -6, 0.7, 24],
  [4, 5, 0.61, 26],
  [10, -4, 0.45, 30],
];
const labelOffsets = [[7, -15], [-7, -15], [7, 5], [-7, 5]];

function schematicHeight(x, z) {
  const distanceToEdge = Math.min(table.width / 2 - Math.abs(x), table.depth / 2 - Math.abs(z));
  const edgeWeight = THREE.MathUtils.smoothstep(distanceToEdge, 0, 4);
  const relief = hills.reduce((sum, [cx, cz, height, spread]) => {
    return sum + height * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / spread);
  }, 0);
  const ripple = (Math.sin(x * 0.48 - z * 0.34) + Math.cos(z * 0.53 + x * 0.12)) * 0.12;
  return 0.05 + Math.max(0, relief + ripple) * edgeWeight;
}

function createSurface(terrain, bounds) {
  const { width, height, elevations, bounds: coverage, source } = terrain ?? {};
  if (!coverage || !source || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 2 || height < 2 || width > 256 || height > 256
    || !Array.isArray(elevations) || elevations.length !== width * height
    || !elevations.every(Number.isFinite)
    || !Object.values(bounds).every(Number.isFinite)
    || !Object.values(coverage).every(Number.isFinite)
    || coverage.west > bounds.west || coverage.east < bounds.east
    || coverage.south > bounds.south || coverage.north < bounds.north) {
    return { at: schematicHeight, columns: 72, rows: 52, source: null };
  }

  // Elevation samples advance east from the western edge and south from the northern edge.
  function at(x, z) {
    const longitude = bounds.west + (x / table.width + 0.5) * (bounds.east - bounds.west);
    const latitude = bounds.north - (z / table.depth + 0.5) * (bounds.north - bounds.south);
    const col = THREE.MathUtils.clamp((longitude - coverage.west) / (coverage.east - coverage.west), 0, 1) * (width - 1);
    const row = THREE.MathUtils.clamp((coverage.north - latitude) / (coverage.north - coverage.south), 0, 1) * (height - 1);
    const x0 = Math.floor(col);
    const y0 = Math.floor(row);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const top = THREE.MathUtils.lerp(elevations[y0 * width + x0], elevations[y0 * width + x1], col - x0);
    const bottom = THREE.MathUtils.lerp(elevations[y1 * width + x0], elevations[y1 * width + x1], col - x0);
    // The same vertical scale across the board preserves relative height at every landmark.
    return 0.05 + Math.max(0, THREE.MathUtils.lerp(top, bottom, row - y0)) / 2550;
  }
  return { at, columns: width - 1, rows: height - 1, source };
}

function reliefMesh(surface) {
  const geometry = new THREE.PlaneGeometry(table.width, table.depth, surface.columns, surface.rows);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = [];
  const low = new THREE.Color('#e9d4ae');
  const high = new THREE.Color('#a99877');
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const height = surface.at(position.getX(index), position.getZ(index));
    position.setY(index, height);
    color.copy(low).lerp(high, Math.min(height / 1.9, 1) * 0.72);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}

function referenceGrid(heightAt) {
  const vertices = [];
  function addLine(makePoint) {
    let previous = makePoint(0);
    for (let step = 1; step <= 60; step += 1) {
      const point = makePoint(step / 60);
      for (const [x, z] of [previous, point]) vertices.push(x, heightAt(x, z) + 0.022, z);
      previous = point;
    }
  }
  for (let index = 1; index < 9; index += 1) {
    addLine((ratio) => [(index / 9 - 0.5) * table.width, (ratio - 0.5) * table.depth]);
  }
  for (let index = 1; index < 7; index += 1) {
    addLine((ratio) => [(ratio - 0.5) * table.width, (index / 7 - 0.5) * table.depth]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: '#9a8768', transparent: true, opacity: 0.39,
  }));
}

function dashGeometry(points, pattern, layer, heightAt) {
  const vertices = [];
  const baseHeight = 0.12 + layer * 0.012;
  for (let index = 1; index < points.length; index += 1) {
    const { x: startX, z: startZ } = points[index - 1];
    const { x: endX, z: endZ } = points[index];
    const length = Math.hypot(endX - startX, endZ - startZ);
    if (length < 0.025) continue;
    const dx = (endX - startX) / length;
    const dz = (endZ - startZ) / length;
    const halfWidth = 0.052;
    function vertex(distance, side) {
      const x = startX + dx * distance - dz * side * halfWidth;
      const z = startZ + dz * distance + dx * side * halfWidth;
      return [x, heightAt(x, z) + baseHeight, z];
    }
    let start = 0;
    let indexInPattern = 0;
    while (start < length) {
      const end = Math.min(length, start + pattern[indexInPattern] * 0.082);
      if (indexInPattern % 2 === 0) {
        const steps = Math.ceil((end - start) / 0.12);
        for (let step = 0; step < steps; step += 1) {
          const from = start + (end - start) * step / steps;
          const to = start + (end - start) * (step + 1) / steps;
          const a = vertex(from, -1);
          const b = vertex(from, 1);
          const c = vertex(to, -1);
          const d = vertex(to, 1);
          vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
        }
      }
      start = end;
      indexInPattern = (indexInPattern + 1) % pattern.length;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function edgeWall(surface, material) {
  const w = table.width / 2;
  const h = table.depth / 2;
  const edges = [[-w, -h, w, -h], [w, -h, w, h], [w, h, -w, h], [-w, h, -w, -h]];
  const vertices = [];
  edges.forEach(([x0, z0, x1, z1], index) => {
    const count = index % 2 === 0 ? surface.columns : surface.rows;
    let startX = x0;
    let startZ = z0;
    let startY = surface.at(startX, startZ);
    for (let step = 1; step <= count; step += 1) {
      const endX = THREE.MathUtils.lerp(x0, x1, step / count);
      const endZ = THREE.MathUtils.lerp(z0, z1, step / count);
      const endY = surface.at(endX, endZ);
      vertices.push(startX, 0.01, startZ, endX, 0.01, endZ, startX, startY, startZ);
      vertices.push(endX, 0.01, endZ, endX, endY, endZ, startX, startY, startZ);
      startX = endX;
      startY = endY;
      startZ = endZ;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function createRouteStage(host, { bounds, terrain, onChapter, onUnavailable }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'route-stage-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '长征路线三维示意沙盘。方向键旋转，正负键缩放。展章可在路线列表中打开。');
  const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.setClearColor('#eae0cd');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const surface = createSurface(terrain, bounds);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 140);
  camera.position.set(3.7, 36, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = 1.16;
  controls.minZoom = 0.75;
  controls.maxZoom = 2.65;
  controls.update();
  controls.saveState();

  const lamp = new THREE.DirectionalLight('#fff4df', 2);
  lamp.position.set(-12, 18, -2);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(table.width + 0.25, 0.72, table.depth + 0.25),
    new THREE.MeshStandardMaterial({ color: '#978061', roughness: 0.85 }),
  );
  base.position.y = -0.34;
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#bba588', roughness: 0.9, side: THREE.DoubleSide });
  scene.add(
    new THREE.AmbientLight('#fff5e3', 1.5),
    lamp, base, edgeWall(surface, wallMaterial), reliefMesh(surface), referenceGrid(surface.at),
  );

  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const pinGeometry = new THREE.SphereGeometry(0.17, 12, 8);
  const stemGeometry = new THREE.CylinderGeometry(0.026, 0.032, 0.29, 7);
  const brass = new THREE.MeshStandardMaterial({ color: '#a17d4f', roughness: 0.56 });
  const markers = [];
  const projected = [];
  const pointerStart = new THREE.Vector2();
  const screenPosition = new THREE.Vector3();
  const keyboardOrbit = new THREE.Spherical();
  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';

  let width = 0;
  let height = 0;
  let frame = 0;
  let active = false;
  let disposed = false;
  let pointerId = null;
  let visibleKey = '';
  let routeResources = [];

  host.append(canvas, overlay);

  function project(point) {
    return {
      x: ((point.longitude - bounds.west) / (bounds.east - bounds.west) - 0.5) * table.width,
      z: (0.5 - (point.latitude - bounds.south) / (bounds.north - bounds.south)) * table.depth,
    };
  }

  function requestRender() {
    if (!active || frame || disposed) return;
    frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    if (!active || disposed || !width || !height) return;
    renderer.render(scene, camera);
    projected.length = 0;
    const placed = [];
    const labels = new Set();
    const ordered = [...markers].sort((first, second) => Number(Boolean(second.id)) - Number(Boolean(first.id)));
    for (const marker of ordered) {
      screenPosition.copy(marker.position).project(camera);
      const x = (screenPosition.x * 0.5 + 0.5) * width;
      const y = (0.5 - screenPosition.y * 0.5) * height;
      const onScreen = x >= 0 && x <= width && y >= 0 && y <= height && Math.abs(screenPosition.z) <= 1;
      if (marker.id && onScreen) projected.push({ x, y, id: marker.id });
      if (!marker.label) continue;
      marker.label.hidden = true;
      if (!onScreen || labels.has(marker.name)) continue;
      const labelWidth = 9 + marker.name.length * 12;
      for (const [dx, dy] of labelOffsets) {
        const left = x + dx - (dx < 0 ? labelWidth : 0);
        const right = left + labelWidth;
        const top = y + dy;
        if (left < 0 || right > width || top < 0 || top + 16 > height) continue;
        if (placed.some((label) => left < label.right && right > label.left && Math.abs(top - label.top) < 18)) continue;
        marker.label.hidden = false;
        marker.label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        placed.push({ left, right, top });
        labels.add(marker.name);
        break;
      }
    }
  }

  function resize() {
    if (!active || disposed) return;
    const nextWidth = host.clientWidth;
    const nextHeight = host.clientHeight;
    if (!nextWidth || !nextHeight) return;
    if (width !== nextWidth || height !== nextHeight) {
      width = nextWidth;
      height = nextHeight;
      const halfWidth = Math.max(19, (width / height) * 12);
      const halfHeight = halfWidth * height / width;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    requestRender();
  }

  function clearRoutes() {
    routeGroup.clear();
    for (const resource of routeResources) resource.dispose();
    routeResources = [];
    markers.length = 0;
    projected.length = 0;
    overlay.replaceChildren();
  }

  function update(routes) {
    const key = routes.map(({ id, points }) => `${id}:${points.length}`).join(',');
    if (disposed || key === visibleKey) return;
    visibleKey = key;
    clearRoutes();
    for (const [routeIndex, route] of routes.entries()) {
      if (route.points.length === 0) continue;
      const points = route.points.map(project);
      const geometry = dashGeometry(points, route.dash, routeIndex, surface.at);
      const line = new THREE.MeshBasicMaterial({ color: route.color, side: THREE.DoubleSide });
      const colored = new THREE.MeshStandardMaterial({ color: route.color, roughness: 0.66 });
      routeResources.push(geometry, line, colored);
      routeGroup.add(new THREE.Mesh(geometry, line));
      for (const [index, { x, z }] of points.entries()) {
        const point = route.points[index];
        const pin = new THREE.Mesh(pinGeometry, colored);
        const stem = new THREE.Mesh(stemGeometry, brass);
        const ground = surface.at(x, z);
        pin.position.set(x, ground + 0.34, z);
        pin.scale.setScalar(point.chapter ? 1.1 : 0.8);
        stem.position.set(x, ground + 0.15, z);
        routeGroup.add(pin, stem);
        const marker = { id: point.chapter, name: point.name, position: pin.position };
        if (point.chapter || index === 0 || index === points.length - 1) {
          const label = document.createElement('span');
          label.hidden = true;
          label.textContent = point.name;
          label.className = 'route-stage-label';
          label.style.cssText = `position:absolute;top:0;left:0;white-space:nowrap;padding:1px 3px;
            border-radius:2px;background:#f7f0e6e8;color:${route.color};font-size:11px;font-weight:700`;
          overlay.append(label);
          marker.label = label;
        }
        markers.push(marker);
      }
    }
    requestRender();
  }

  function getHit(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let id;
    let closest = 15;
    for (const point of projected) {
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < closest) {
        closest = distance;
        id = point.id;
      }
    }
    return id;
  }

  const listeners = new AbortController();
  const options = { signal: listeners.signal };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointerId = event.pointerId;
    pointerStart.set(event.clientX, event.clientY);
  }, options);
  canvas.addEventListener('pointermove', (event) => {
    canvas.style.cursor = pointerId === null && getHit(event) ? 'pointer' : 'grab';
  }, options);
  canvas.addEventListener('pointercancel', () => { pointerId = null; }, options);
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (Math.hypot(pointerStart.x - event.clientX, pointerStart.y - event.clientY) > 6) return;
    const chapter = getHit(event);
    if (chapter) onChapter(chapter);
  }, options);
  canvas.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const angle = 0.12;
    let azimuth = 0;
    let tilt = 0;
    switch (event.key) {
      case 'ArrowLeft': azimuth = -angle; break;
      case 'ArrowRight': azimuth = angle; break;
      case 'ArrowUp': tilt = -angle; break;
      case 'ArrowDown': tilt = angle; break;
      case '+':
      case '=':
      case '-':
        camera.zoom = THREE.MathUtils.clamp(camera.zoom * (event.key === '-' ? 0.9 : 1.11), controls.minZoom, controls.maxZoom);
        camera.updateProjectionMatrix();
        requestRender();
        break;
      default: return;
    }
    if (azimuth || tilt) {
      keyboardOrbit.setFromVector3(camera.position.clone().sub(controls.target));
      keyboardOrbit.theta += azimuth;
      keyboardOrbit.phi = THREE.MathUtils.clamp(keyboardOrbit.phi + tilt, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.setFromSpherical(keyboardOrbit).add(controls.target);
      controls.update();
    }
    event.preventDefault();
  }, options);
  canvas.addEventListener('webglcontextlost', onUnavailable, options);
  controls.addEventListener('change', requestRender);
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  return {
    source: surface.source,
    update,
    reset: () => controls.reset(),
    setActive(value) {
      active = value;
      if (active) resize();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      listeners.abort();
      observer.disconnect();
      controls.dispose();
      clearRoutes();
      for (const object of scene.children) {
        object.geometry?.dispose();
        object.material?.dispose();
      }
      pinGeometry.dispose();
      stemGeometry.dispose();
      brass.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      overlay.remove();
    },
  };
}
