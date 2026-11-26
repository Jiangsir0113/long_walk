import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const themeByKind = {
  river: { colors: [0x636747, 0x8b8b61, 0xb8a770], water: 0x7e9b90, axis: 'z', relief: 0.66 },
  hall: { colors: [0x777253, 0xa4996c, 0xc9b887], relief: 0.42 },
  canyon: { colors: [0x685e43, 0x8e815c, 0xb5a176], water: 0x91a49b, axis: 'z', relief: 1.45 },
  crossing: { colors: [0x6c6246, 0xa08b5c, 0xc9b078], water: 0x75928c, axis: 'x', relief: 1.65 },
  ferry: { colors: [0x5b634a, 0x888657, 0xbbaa78], water: 0x77938c, axis: 'x', relief: 1.5 },
  bridge: { colors: [0x4c5b4c, 0x77765a, 0xb4a77f], water: 0x72968a, axis: 'z', relief: 1.75 },
  snow: { colors: [0x535e56, 0x8b8d7d, 0xe5e3d7], relief: 2.9 },
  grass: { colors: [0x57654a, 0x838b59, 0xa4aa68], relief: 0.7 },
};

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const defaultSource = { name: '三维地貌示意', attribution: '地形数据暂不可用，当前场景为示意。' };

function makeSchematic(chapter, theme) {
  const width = 49;
  const height = 49;
  const elevations = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = column / (width - 1) * 2 - 1;
      const z = row / (height - 1) * 2 - 1;
      const along = theme.axis === 'x' ? x : z;
      const across = theme.axis === 'x' ? z : x;
      const valley = Math.min(1, Math.abs(across - Math.sin(along * 3.2) * 0.2) ** 0.85);
      const waves = 0.37 + Math.sin(x * 5 + z * 3) * 0.19 + Math.cos(z * 6 - x * 4) * 0.18;
      const shape = theme.axis ? valley * (0.35 + waves * 0.65) : waves;
      elevations.push(shape * 760 * theme.relief + Math.sin(x * 11 - z * 9) * 9 + 20);
    }
  }
  const longitude = Number(chapter.longitude) || 105;
  const latitude = Number(chapter.latitude) || 29;
  return {
    width, height, elevations, source: defaultSource,
    bounds: { west: longitude - 0.035, east: longitude + 0.035, south: latitude - 0.03, north: latitude + 0.03 },
  };
}

function validateTerrain(data) {
  const { width, height, elevations, bounds } = data;
  const dimensions = [width, height].every(size => Number.isInteger(size) && size >= 2 && size <= 1024);
  const validBounds = bounds && [bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)
    && bounds.west < bounds.east && bounds.south < bounds.north;
  if (!dimensions || !validBounds || !Array.isArray(elevations)
    || elevations.length !== width * height || !elevations.every(Number.isFinite)) {
    throw new Error('无效的高程数据');
  }
  return data;
}

function makeTerrain(data, chapter, theme) {
  const { width, height, bounds, elevations } = data;
  const latitude = (bounds.north + bounds.south) / 2;
  const eastWest = (bounds.east - bounds.west) * Math.cos(latitude * Math.PI / 180);
  const northSouth = bounds.north - bounds.south;
  const scale = 14 / Math.max(eastWest, northSouth);
  const spanX = eastWest * scale;
  const spanZ = northSouth * scale;
  let low = Infinity;
  let high = -Infinity;
  for (const elevation of elevations) {
    low = Math.min(low, elevation);
    high = Math.max(high, elevation);
  }
  const range = high - low;
  const verticalScale = Math.min(3.1 / Math.max(1, range), scale / 111000 * 1.45);
  const heightAt = (x, z) => {
    const gridX = clamp((x / spanX + 0.5) * (width - 1), 0, width - 1);
    const gridZ = clamp((z / spanZ + 0.5) * (height - 1), 0, height - 1);
    const column = Math.floor(gridX);
    const row = Math.floor(gridZ);
    const right = Math.min(column + 1, width - 1);
    const next = Math.min(row + 1, height - 1);
    const a = mix(elevations[row * width + column], elevations[row * width + right], gridX - column);
    const b = mix(elevations[next * width + column], elevations[next * width + right], gridX - column);
    return (mix(a, b, gridZ - row) - low) * verticalScale;
  };

  const columns = Math.min(width, 97);
  const rows = Math.min(height, 97);
  const vertices = [];
  const colors = [];
  const faces = [];
  const group = new THREE.Group();
  const [bank, slope, summit] = theme.colors.map(value => new THREE.Color(value));
  const color = new THREE.Color();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column / (columns - 1) - 0.5) * spanX;
      const z = (row / (rows - 1) - 0.5) * spanZ;
      const elevation = heightAt(x, z);
      const level = elevation / Math.max(verticalScale * range, 0.001);
      if (level < 0.5) color.copy(bank).lerp(slope, level * 2);
      else color.copy(slope).lerp(summit, (level - 0.5) * 2);
      color.multiplyScalar(0.93 + (Math.sin(column * 2.41 + row * 1.79) + 1) * 0.035);
      vertices.push(x, elevation, z);
      colors.push(color.r, color.g, color.b);
      if (row < rows - 1 && column < columns - 1) {
        const northWest = row * columns + column;
        faces.push(northWest, northWest + columns, northWest + 1,
          northWest + 1, northWest + columns, northWest + columns + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(faces);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const edges = [];
  for (let column = 0; column < columns; column += 1) edges.push(column);
  for (let row = 1; row < rows; row += 1) edges.push(row * columns + columns - 1);
  for (let column = columns - 2; column >= 0; column -= 1) edges.push((rows - 1) * columns + column);
  for (let row = rows - 2; row > 0; row -= 1) edges.push(row * columns);
  const sides = [];
  for (let index = 0; index < edges.length; index += 1) {
    const a = edges[index] * 3;
    const b = edges[(index + 1) % edges.length] * 3;
    const first = vertices.slice(a, a + 3);
    const second = vertices.slice(b, b + 3);
    const floorA = [first[0], -0.48, first[2]];
    const floorB = [second[0], -0.48, second[2]];
    sides.push(...first, ...floorA, ...second, ...second, ...floorA, ...floorB);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(sides, 3));
  side.computeVertexNormals();
  group.add(new THREE.Mesh(side, new THREE.MeshLambertMaterial({ color: 0x655945, side: THREE.DoubleSide })));

  const contours = [];
  const step = Math.max(verticalScale * 40, range * verticalScale / 12);
  if (step > 0) {
    for (let triangle = 0; triangle < faces.length; triangle += 3) {
      const a = faces[triangle] * 3;
      const b = faces[triangle + 1] * 3;
      const c = faces[triangle + 2] * 3;
      const start = Math.min(vertices[a + 1], vertices[b + 1], vertices[c + 1]);
      const end = Math.max(vertices[a + 1], vertices[b + 1], vertices[c + 1]);
      for (let level = (Math.floor(start / step) + 1) * step; level < end; level += step) {
        for (const [first, second] of [[a, b], [b, c], [c, a]]) {
          const firstY = vertices[first + 1];
          const secondY = vertices[second + 1];
          if ((firstY < level) === (secondY < level)) continue;
          const t = (level - firstY) / (secondY - firstY);
          contours.push(mix(vertices[first], vertices[second], t), level + 0.008,
            mix(vertices[first + 2], vertices[second + 2], t));
        }
      }
    }
  }
  if (contours.length) {
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(contours, 3));
    group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({
      color: 0x35291b, transparent: true, opacity: 0.17,
    })));
  }

  const longitude = Number(data.feature?.lon ?? chapter.longitude);
  const anchorLat = Number(data.feature?.lat ?? chapter.latitude);
  const focusX = Number.isFinite(longitude)
    ? clamp(((longitude - bounds.west) / (bounds.east - bounds.west) - 0.5) * spanX, -spanX * 0.24, spanX * 0.24) : 0;
  const focusZ = Number.isFinite(anchorLat)
    ? clamp(((bounds.north - anchorLat) / northSouth - 0.5) * spanZ, -spanZ * 0.24, spanZ * 0.24) : 0;
  return { group, heightAt, spanX, spanZ, focusX, focusZ };
}

function makeSurveyLine(terrain, theme) {
  const { spanX, spanZ, focusX, focusZ, heightAt, group } = terrain;
  if (!theme.axis) return null;
  const acrossX = theme.axis === 'z';
  const spanAlong = acrossX ? spanZ : spanX;
  const spanAcross = acrossX ? spanX : spanZ;
  const focusAcross = acrossX ? focusX : focusZ;
  const focusAlong = acrossX ? focusZ : focusX;
  const heights = (across, along) => acrossX ? heightAt(across, along) : heightAt(along, across);
  const layout = (across, y, along) => acrossX ? [across, y, along] : [along, y, across];
  const segments = 48;
  const centers = [];
  let closest = 0;
  let previous = focusAcross;
  for (let index = 0; index <= segments; index += 1) {
    const along = (index / segments - 0.5) * (spanAlong - 0.24);
    let across = previous;
    let best = Infinity;
    for (let candidate = 0; candidate <= 56; candidate += 1) {
      const sample = (candidate / 56 - 0.5) * (spanAcross - 0.32);
      const distance = Math.abs(sample - previous);
      const penalty = distance * distance * (index === 0 ? 0.018 : 0.12);
      const score = heights(sample, along) + penalty + Math.abs(sample - focusAcross) * 0.011;
      if (score < best) {
        best = score;
        across = sample;
      }
    }
    centers.push({ along, across });
    previous = across;
    if (Math.abs(along - focusAlong) < Math.abs(centers[closest].along - focusAlong)) closest = index;
  }
  const ribbon = [];
  const width = Math.min(spanAcross * 0.036, 0.42);
  centers.forEach(({ along, across }, index) => {
    const average = (centers[Math.max(index - 1, 0)].across + across * 2
      + centers[Math.min(index + 1, segments)].across) / 4;
    const level = heights(average, along) + 0.04;
    ribbon.push(...layout(average - width / 2, level, along), ...layout(average + width / 2, level, along));
  });
  const faces = [];
  for (let index = 0; index < segments * 2; index += 2) {
    faces.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(faces);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: theme.water, side: THREE.DoubleSide })));
  const crossing = centers[closest];
  const [x, y, z] = layout(crossing.across, heights(crossing.across, crossing.along) + 0.07, crossing.along);
  return { x, y, z, width, acrossX };
}

function makeLandmark(terrain, chapter, water) {
  const { group, heightAt, focusX, focusZ } = terrain;
  const building = new THREE.Group();
  let x = water?.x ?? focusX;
  let z = water?.z ?? focusZ;
  let y = water?.y ?? heightAt(x, z);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const wood = new THREE.MeshLambertMaterial({ color: 0x755136 });
  const brick = new THREE.MeshLambertMaterial({ color: 0xb3a181 });
  const slate = new THREE.MeshLambertMaterial({ color: 0x4c4c45 });
  const red = new THREE.MeshLambertMaterial({ color: 0x823d30 });
  const addBox = (px, py, pz, sx, sy, sz, material) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(px, py, pz);
    mesh.scale.set(sx, sy, sz);
    building.add(mesh);
    return mesh;
  };

  if (chapter.kind === 'hall') {
    y = Math.max(y, ...[-1, 1].flatMap(horizontal => [-1, 1].map(vertical =>
      heightAt(x + horizontal * 1.08, z + vertical * 0.65))));
    addBox(0, 0.05, 0, 2.3, 0.1, 1.55, slate);
    addBox(0, 0.16, 0, 2.16, 0.12, 1.34, brick);
    for (const side of [-1, 1]) {
      addBox(side * 1.02, 0.55, 0, 0.14, 0.75, 1.3, brick);
      for (const column of [-0.88, -0.43, 0.43, 0.88]) {
        addBox(column, 0.55, side * 0.63, 0.075, 0.74, 0.075, red);
      }
    }
    addBox(0, 0.52, -0.64, 1.97, 0.6, 0.09, brick);
    addBox(0, 0.94, 0, 2.24, 0.1, 1.4, wood);
    addBox(0, 1.26, -0.61, 2.06, 0.56, 0.12, brick);
    const glassColors = [0xa0a69a, 0xbda46b, 0x82483a];
    for (const [index, color] of glassColors.entries()) {
      const glass = new THREE.MeshLambertMaterial({ color });
      for (const side of [-1, 1]) {
        addBox(side * (0.72 + index * 0.066), 1.29, 0.61, 0.063, 0.28, 0.024, glass);
      }
    }
    for (const column of [-0.85, -0.42, 0, 0.42, 0.85]) {
      addBox(column, 1.24, 0.61, 0.07, 0.5, 0.075, red);
    }
    for (const side of [-1, 1]) {
      const roof = addBox(0, 1.64, side * 0.38, 2.4, 0.085, 0.87, slate);
      roof.rotation.x = side * 0.31;
    }
    addBox(0, 1.19, 0.14, 0.94, 0.068, 0.33, wood);
    for (const corner of [-1, 1]) {
      for (const side of [-1, 1]) addBox(corner * 0.37, 1.09, 0.14 + side * 0.11, 0.04, 0.2, 0.04, wood);
    }
    for (const column of [-0.34, 0, 0.34]) {
      for (const side of [-1, 1]) {
        addBox(column, 1.041, 0.14 + side * 0.285, 0.15, 0.085, 0.13, red);
        addBox(column, 1.12, 0.14 + side * 0.32, 0.15, 0.145, 0.026, red);
      }
    }
  } else if (chapter.kind === 'bridge' && water) {
    const half = clamp(water.width * 1.8, 0.58, 0.9);
    const left = water.acrossX ? heightAt(x - half, z) : heightAt(x, z - half);
    const right = water.acrossX ? heightAt(x + half, z) : heightAt(x, z + half);
    y = Math.max(y, left, right) + 0.06;
    for (let index = 0; index < 23; index += 1) {
      const position = (index / 22 * 2 - 1) * half;
      addBox(position, -0.06 * Math.cos(position / half * Math.PI / 2), 0, half / 11, 0.027, 0.24, wood);
    }
    for (const side of [-1, 1]) {
      addBox(side * half, 0.07, 0, 0.13, 0.26, 0.43, brick);
      for (const edge of [-1, 1]) {
        addBox(side * half, 0.23, edge * 0.15, 0.045, 0.31, 0.045, red);
      }
    }
    for (const edge of [-1, -0.65, 0.65, 1]) {
      const points = Array.from({ length: 24 }, (_, index) => {
        const t = index / 23 * 2 - 1;
        const chainHeight = Math.abs(edge) === 1 ? 0.23 + 0.15 * t * t : -0.11 + 0.09 * t * t;
        return new THREE.Vector3(t * half, chainHeight, edge * 0.15);
      });
      const chain = new THREE.CatmullRomCurve3(points);
      building.add(new THREE.Mesh(new THREE.TubeGeometry(chain, 24, 0.012, 5, false), slate));
    }
    if (!water.acrossX) building.rotation.y = Math.PI / 2;
  } else if (['crossing', 'ferry'].includes(chapter.kind) && water) {
    const [a, b] = water.acrossX ? [0, 1] : [1, 0];
    x += a * 0.22;
    z += b * 0.22;
    y += 0.02;
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.08, 0.09, 8), wood);
    hull.scale.set(1, 1, 2.25);
    building.add(hull);
    addBox(0, 0.055, 0, 0.25, 0.02, 0.57, brick);
    for (const position of [-0.19, 0, 0.19]) addBox(0, 0.081, position, 0.27, 0.03, 0.05, wood);
    if (!water.acrossX) building.rotation.y = Math.PI / 2;
  }
  building.position.set(x, y, z);
  if (building.children.length) group.add(building);
  else for (const resource of [box, wood, brick, slate, red]) resource.dispose();
  if (building.children.length) {
    for (const material of [wood, brick, slate, red]) {
      if (!building.children.some(child => child.material === material)) material.dispose();
    }
  }
  return { x, y, z };
}

function addVegetation(terrain, kind, water) {
  const { group, spanX, spanZ, heightAt, focusX, focusZ } = terrain;
  const grass = kind === 'grass';
  if (kind === 'snow') return;
  const count = grass ? 70 : 52;
  const model = new THREE.ConeGeometry(1, 1, grass ? 3 : 5);
  const material = new THREE.MeshLambertMaterial({ color: grass ? 0xa39e6f : 0x596247 });
  const vegetation = new THREE.InstancedMesh(model, material, count);
  const transform = new THREE.Object3D();
  for (let index = 0; index < count; index += 1) {
    const x = (Math.sin((index + 1) * 39.7) * 0.5) * spanX * 0.87;
    const z = (Math.sin((index + 1) * 21.13) * 0.5) * spanZ * 0.87;
    const nearLandmark = Math.hypot(x - focusX, z - focusZ) < 1.6;
    const elevation = heightAt(x, z);
    const steep = Math.abs(heightAt(x + 0.15, z) - elevation) > 0.15;
    if (nearLandmark || steep || (water && elevation < water.y + 0.17)) {
      transform.scale.setScalar(0);
    } else {
      const variation = 0.75 + (index % 13) * 0.034;
      const height = (grass ? 0.13 : 0.36) * variation;
      const width = (grass ? 0.027 : 0.1) * variation;
      transform.position.set(x, elevation + height / 2, z);
      transform.rotation.y = index;
      transform.scale.set(width, height, width);
    }
    transform.updateMatrix();
    vegetation.setMatrixAt(index, transform.matrix);
  }
  group.add(vegetation);
}

function markerTexture(index, active) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(48, 48, 39, 0, Math.PI * 2);
  context.fillStyle = active ? '#9d3e32' : '#eee3c9';
  context.fill();
  context.strokeStyle = active ? '#f9ebce' : '#77382e';
  context.lineWidth = 5;
  context.stroke();
  context.font = 'bold 39px Georgia, serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = active ? '#fff4df' : '#692b23';
  context.fillText(String(index + 1), 48, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMarkers(terrain, landmark, chapter) {
  const { group, spanX, spanZ, heightAt } = terrain;
  const positions = [
    [-0.16 * spanX, 0.12 * spanZ, 0],
    [0.06 * spanX, -0.052 * spanZ, 0],
    [0.19 * spanX, -0.14 * spanZ, 0],
  ];
  if (chapter.kind === 'hall') positions.splice(0, 3, [0, 0.38, 1.18], [0.88, 0.58, 1.29], [-1.32, 0.33, 0]);
  if (chapter.kind === 'bridge') positions[1] = [0.32, -0.18, 0.19];
  if (['ferry', 'crossing'].includes(chapter.kind)) positions[2] = [0.15, 0.25, 0.08];
  const visibleIndices = chapter.kind === 'snow' ? [0] : chapter.kind === 'grass' ? [1, 2] : [0, 1, 2];
  return visibleIndices.filter(index => index < (chapter.hotspots?.length ?? 3)).map(index => {
    const [offsetX, offsetZ, offsetY] = positions[index];
    const x = clamp(landmark.x + offsetX, -spanX * 0.43, spanX * 0.43);
    const z = clamp(landmark.z + offsetZ, -spanZ * 0.43, spanZ * 0.43);
    const elevation = offsetY ? Math.max(heightAt(x, z), landmark.y + offsetY) : heightAt(x, z);
    const normal = markerTexture(index, false);
    const active = markerTexture(index, true);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: normal, depthTest: false, depthWrite: false, sizeAttenuation: false,
    }));
    const elevationOffset = chapter.kind === 'hall' ? 0.51 : 0.82;
    sprite.position.set(x, elevation + elevationOffset, z);
    sprite.renderOrder = 5;
    sprite.userData = { index, normal, active };
    const stem = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, elevation + 0.045, z), new THREE.Vector3(x, elevation + elevationOffset - 0.15, z),
    ]);
    group.add(sprite, new THREE.Line(stem, new THREE.LineBasicMaterial({ color: 0x833f32 })));
    return sprite;
  });
}

function disposeGroup(group) {
  const resources = new Set();
  group.traverse(object => {
    if (object.geometry && !object.isSprite) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
    if (object.isInstancedMesh) resources.add(object);
    if (object.isSprite) {
      resources.add(object.userData.normal);
      resources.add(object.userData.active);
    }
  });
  for (const resource of resources) resource?.dispose();
  group.removeFromParent();
}

export function createTerrainStage(canvas, {
  onState = () => {}, onHotspot = () => {}, onOrientation = () => {}, background = '#d6c9ac',
} = {}) {
  let renderer;
  try {
    const context = canvas.getContext('webgl2', { antialias: true, powerPreference: 'low-power' });
    if (!context) throw new Error('WebGL 2 unavailable');
    renderer = new THREE.WebGLRenderer({ canvas, context });
  } catch {
    return {
      async setChapter(_chapter, { variant = 'primary' } = {}) { onState({ status: 'unavailable', variant }); },
      setView() {}, setActiveHotspot() {}, resetView() {}, dispose() {},
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(0xffecd2, 0x60564d, 2.35));
  const key = new THREE.DirectionalLight(0xfff0d6, 2.15);
  key.position.set(-5, 10, -6);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.04, 80);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 1.3;
  controls.maxDistance = 44;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.enablePan = false;
  controls.rotateSpeed = 0.52;
  controls.zoomSpeed = 0.8;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));

  let current = null;
  let loadController;
  let status;
  let frame;
  let viewportHeight = 300;
  let viewName = 'overview';
  let activeIndex = -1;
  let pointerStart;
  let contextLost = false;
  let disposed = false;
  const raycaster = new THREE.Raycaster();
  const spherical = new THREE.Spherical();

  function requestRender() {
    if (frame || contextLost || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const cameraScale = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / viewportHeight;
      current?.markers.forEach(marker => {
        marker.scale.setScalar(cameraScale * (marker.userData.index === activeIndex ? 36 : 30));
      });
      renderer.render(scene, camera);
      const projectedNorth = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion.clone().invert());
      const angle = Math.round(THREE.MathUtils.radToDeg(Math.atan2(projectedNorth.x, projectedNorth.y)));
      onOrientation(angle);
    });
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    viewportHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (current && viewName === 'overview') setView('overview');
    requestRender();
  }

  function setView(name) {
    viewName = name;
    if (!current) return;
    const { landmark, terrain } = current;
    const aspectFit = Math.max(1, 1.35 / camera.aspect);
    if (name === 'ground') {
      controls.target.set(landmark.x, landmark.y + 0.32, landmark.z);
      const x = landmark.x + 2.7;
      const z = landmark.z + 2.35;
      const height = Math.max(landmark.y + 0.95, terrain.heightAt(x, z) + 0.72);
      camera.position.set(x, height, z);
    } else if (name === 'detail') {
      const modelCenter = current.kind === 'hall' ? 0.93 : 0.38;
      controls.target.set(landmark.x, landmark.y + modelCenter, landmark.z);
      const x = landmark.x + 2.45 * aspectFit;
      const z = landmark.z + 3.22 * aspectFit;
      camera.position.set(x, Math.max(landmark.y + 2.25, terrain.heightAt(x, z) + 0.8), z);
    } else {
      controls.target.set(0, -0.48, 0);
      camera.position.set(12.95 * aspectFit, 13.81 * aspectFit, 16.29 * aspectFit);
    }
    controls.update();
    requestRender();
  }

  function setActiveHotspot(index) {
    activeIndex = index;
    current?.markers.forEach(marker => {
      const selected = marker.userData.index === index;
      marker.material.map = selected ? marker.userData.active : marker.userData.normal;
    });
    requestRender();
  }

  async function setChapter(chapter, { variant = 'primary' } = {}) {
    if (disposed) return;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    if (current) disposeGroup(current.terrain.group);
    current = null;
    status = { status: 'loading', variant };
    if (!contextLost) onState(status);
    requestRender();

    const alternate = chapter.id === 'snow-grass' && variant === 'alternate';
    const kind = alternate ? 'grass' : chapter.kind;
    const theme = themeByKind[kind] ?? themeByKind.river;
    const id = alternate ? 'snow-grass-alt' : chapter.id;
    let data;
    let fallback = false;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}terrain/${id}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error('高程资料暂不可用');
      data = validateTerrain(await response.json());
    } catch {
      if (controller.signal.aborted) return;
      fallback = true;
      data = makeSchematic(chapter, theme);
    }
    if (controller.signal.aborted || disposed) return;
    const terrain = makeTerrain(data, chapter, theme);
    const surveyLine = makeSurveyLine(terrain, theme);
    const landmark = makeLandmark(terrain, chapter, surveyLine);
    addVegetation(terrain, kind, surveyLine);
    const markers = createMarkers(terrain, landmark, { ...chapter, kind });
    scene.add(terrain.group);
    current = { terrain, landmark, markers, kind };
    setView(viewName);
    setActiveHotspot(activeIndex);
    status = { status: fallback ? 'fallback' : 'ready', source: data.source, variant };
    if (!contextLost) onState(status);
  }

  function startPointer(event) {
    if (event.isPrimary && event.button === 0) pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    else pointerStart = null;
  }

  function selectPointer(event) {
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.id !== event.pointerId || !current
      || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6) return;
    const bounds = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
      -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const [hit] = raycaster.intersectObjects(current.markers, false);
    if (hit) onHotspot(hit.object.userData.index);
  }

  function handleKeys(event) {
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return;
    event.preventDefault();
    spherical.setFromVector3(camera.position.clone().sub(controls.target));
    if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
    if (event.key === 'ArrowRight') spherical.theta += 0.12;
    if (event.key === 'ArrowUp') spherical.phi -= 0.095;
    if (event.key === 'ArrowDown') spherical.phi += 0.095;
    if (event.key === '+' || event.key === '=') spherical.radius *= 0.87;
    if (event.key === '-') spherical.radius *= 1.15;
    spherical.phi = clamp(spherical.phi, 0.04, controls.maxPolarAngle);
    spherical.radius = clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.setFromSpherical(spherical).add(controls.target);
    controls.update();
    requestRender();
  }

  function loseContext(event) {
    event.preventDefault();
    contextLost = true;
    onState({ status: 'unavailable', variant: status?.variant });
  }

  function restoreContext() {
    contextLost = false;
    if (status) onState(status);
    requestRender();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  controls.addEventListener('change', requestRender);
  canvas.addEventListener('pointerdown', startPointer);
  canvas.addEventListener('pointerup', selectPointer);
  canvas.addEventListener('keydown', handleKeys);
  canvas.addEventListener('webglcontextlost', loseContext);
  canvas.addEventListener('webglcontextrestored', restoreContext);
  resize();

  return {
    setChapter, setView, setActiveHotspot,
    resetView() { setView('overview'); },
    dispose() {
      disposed = true;
      loadController?.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      canvas.removeEventListener('pointerdown', startPointer);
      canvas.removeEventListener('pointerup', selectPointer);
      canvas.removeEventListener('keydown', handleKeys);
      canvas.removeEventListener('webglcontextlost', loseContext);
      canvas.removeEventListener('webglcontextrestored', restoreContext);
      if (current) disposeGroup(current.terrain.group);
      renderer.dispose();
    },
  };
}
