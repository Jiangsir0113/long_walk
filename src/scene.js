import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { exhibitPhases } from './exhibit-phases.js';

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

const neutralLight = [0xffedd5, 0xffe5be, 0xffecd2];
const sceneLighting = {
  river: [0xffedd5, 0xffe0b0, 0xf6ca96],
  hall: [0xffe6bf, 0xffd6a4, 0xf6e6cb],
  canyon: [0xffe7c3, 0xffddb5, 0xf9d69e],
  crossing: [0xffedd5, 0xffe4b8, 0xffdbad],
  ferry: [0xffedd5, 0xffd9a4, 0xf2e9d3],
  bridge: [0xffedd5, 0xffdfb6, 0xf3e8d8],
  snow: [0xdeedff, 0xdfeeff, 0xe8f0ff],
  grass: [0xebedd4, 0xe6eacb, 0xf6daa9],
};

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
  const x = water?.x ?? focusX;
  const z = water?.z ?? focusZ;
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

function exhibitBuilder() {
  const geometry = new Map();
  const materials = new Map();
  const body = (parent, shape, tint, position, size, yaw = 0) => {
    if (!materials.has(tint)) materials.set(tint, new THREE.MeshLambertMaterial({ color: tint }));
    if (!geometry.has(shape)) {
      const shapes = {
        box: () => new THREE.BoxGeometry(1, 1, 1),
        stone: () => new THREE.DodecahedronGeometry(0.55),
        post: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
        ring: () => new THREE.TorusGeometry(0.5, 0.09, 7, 18),
        guide: () => new THREE.TorusGeometry(0.51, 0.024, 6, 26),
      };
      geometry.set(shape, shapes[shape]());
    }
    const object = new THREE.Mesh(geometry.get(shape), materials.get(tint));
    object.position.set(...position);
    object.scale.set(...size);
    object.rotation.y = yaw;
    parent.add(object);
    return object;
  };
  return { body, box: (parent, tint, position, size, yaw) => body(parent, 'box', tint, position, size, yaw) };
}

function addCabinet(terrain, chapter) {
  const { spanX, spanZ, group } = terrain;
  const plinth = new THREE.Group();
  const { body, box } = exhibitBuilder();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 4.6, spanZ + 4.6), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 coordinate;
      void main() {
        coordinate = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 coordinate;
      void main() {
        vec2 offset = abs(coordinate - vec2(0.5)) * 2.0;
        float outline = pow(pow(offset.x, 8.0) + pow(offset.y, 8.0), 0.125);
        float opacity = 0.61 * (1.0 - smoothstep(0.69, 0.97, outline));
        gl_FragColor = vec4(0.04, 0.03, 0.026, opacity);
      }`,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.22, -1.08, 0.33);
  plinth.add(shadow);
  box(plinth, 0x372824, [0, -0.77, 0], [spanX + 0.86, 0.31, spanZ + 0.86]);
  box(plinth, 0x57362c, [0, -0.53, 0], [spanX + 0.61, 0.25, spanZ + 0.61]);
  box(plinth, 0xac8149, [0, -0.40, 0], [spanX + 0.57, 0.046, spanZ + 0.57]);
  box(plinth, 0x6a4833, [0, -0.36, 0], [spanX + 0.48, 0.045, spanZ + 0.48]);
  for (const direction of [-1, 1]) {
    for (const x of [-1, 1]) {
      body(plinth, 'post', 0x8b693e, [x * (spanX / 2 - 0.52), -0.975, direction * (spanZ / 2 - 0.52)], [0.61, 0.17, 0.61]);
    }
  }
  for (let index = -4; index <= 4; index += 1) {
    const size = index % 2 === 0 ? 0.12 : 0.07;
    box(plinth, 0xc6a76c, [index * spanX / 10, -0.332, spanZ / 2 + 0.18], [0.018, 0.018, size]);
    box(plinth, 0xc6a76c, [spanX / 2 + 0.18, -0.332, index * spanZ / 10], [size, 0.018, 0.018]);
  }
  box(plinth, 0xbd985d, [spanX * 0.29, -0.73, spanZ / 2 + 0.44], [1.18, 0.16, 0.028]);
  for (const side of [-1, 1]) {
    body(plinth, 'post', 0x6a4833, [spanX * 0.29 + side * 0.48, -0.73, spanZ / 2 + 0.46], [0.038, 0.02, 0.038]).rotation.x = Math.PI / 2;
  }
  const marks = Number(chapter.number) || 1;
  for (let index = 0; index < marks; index += 1) {
    box(plinth, 0x805631, [spanX * 0.29 + (index - (marks - 1) / 2) * 0.067, -0.73, spanZ / 2 + 0.46], [0.022, 0.066, 0.017]);
  }
  group.add(plinth);
}

const phaseLayouts = {
  'river-bends': [['house', 1.65, 0.78, 0.93], ['house', 2.62, 1.13, 0.69, -0.12], ['fields', -1.5, 0.8, 1.4]],
  'ferry-stones': [['steps', 0.69, 0.1, 1.27], ['boat', 0, 0.78, 0.87], ['house', 1.55, 0.9, 0.75]],
  'memorial-lantern': [['lantern', 1, 0.05, 1.34], ['lantern', 1.67, 0.35, 0.81], ['lantern', 2.2, 0.43, 0.63], ['marker', 0.64, 0.56, 0.67]],
  'residence-windows': [['house', -1.9, -0.43, 0.9], ['house', -1.89, 0.88, 0.73], ['door', 0.23, 0.98, 1.18]],
  'meeting-table': [['papers', 0, 0.18, 0.43, 0.02, 1.24], ['lantern', 0.38, 0.11, 0.21, 0, 1.24], ['chair', 0.76, 0.2, 0.52, -1.57, 0.99]],
  'document-desk': [['desk', 0.15, 1.21, 1.14, -0.19], ['papers', -0.11, 0.05, 0.51, -0.2, 1.24]],
  'tucheng-ferry': [['steps', 0.63, 0.21, 0.98], ['boat', 0.04, 0.82, 0.8], ['house', 1.38, 0.6, 0.77]],
  'river-settlement': [['house', 1.15, 0.36, 1.09], ['house', 2.05, 0.77, 0.81], ['house', 2.68, -0.27, 0.66, -0.18], ['house', 1.9, -0.88, 0.67]],
  'tucheng-memorial': [['marker', 0.97, 0.48, 1.3], ['lantern', 1.59, 0.83, 0.74], ['steps', 0.67, -0.34, 0.85]],
  'gorge-lookout': [['lookout', 1.31, 0.82, 1.15], ['stones', 1.92, -0.67, 1.28]],
  'wooden-ferry': [['boat', 0.03, 0.23, 1.38], ['steps', 0.67, -0.24, 0.92], ['oar', 0.45, 0.99, 0.62, 0.21]],
  'opposite-shore': [['lookout', -1.41, 0.5, 1.12], ['house', -2.03, 0.09, 0.92], ['stones', -2.45, -0.58, 0.88]],
  'riverbank-steps': [['steps', 0.59, 0.05, 1.36], ['lookout', 1.17, 0.55, 0.84], ['house', 2.16, -0.44, 0.71]],
  'ferryman-oar': [['boat', 0.02, 0.31, 1.43], ['boat', 0.23, -1.02, 0.67], ['oar', 0.64, 0.54, 1.11]],
  'crossing-comparison': [['comparison', 0.94, 0.58, 1.36], ['steps', 0.51, -0.82, 0.89]],
  'bridge-approach': [['door', 0.94, -0.04, 1.16], ['lookout', 1.66, 0.86, 0.92], ['house', -1.17, 0.85, 0.68]],
  'iron-chain-study': [['chain', 0.96, 0.62, 1.23], ['steps', 1.25, -0.54, 0.77]],
  'memory-plaque': [['marker', 1.26, 0.28, 1.38], ['lantern', 1.76, 0.84, 0.72], ['house', 2.1, -0.34, 0.72]],
  'high-pass': [['snowdrift', 0.25, 0.32, 1.12], ['snowdrift', -0.78, -0.31, 0.86], ['stones', 0.96, 0.6, 1.16]],
  'marsh-pool': [['pool', 0.06, 0.18, 1.55], ['pool', -1.34, -0.52, 1.36], ['pool', 1.36, 0.51, 1.03]],
  'leather-belt': [['belt', 0.27, 0.21, 1.44], ['pool', -1.04, -0.31, 0.91], ['pool', 1.49, 0.64, 0.74]],
};

const woodTone = 0x855738;
const darkWood = 0x64402a;
const wallTone = 0xcbb597;
const stoneTone = 0x797265;
const shadeTone = 0x424845;
const accentTone = 0xa0693a;

function buildProp(type, model, kit) {
  const { box, body } = kit;
  const block = (tint, x, y, z, width, height, depth, yaw) => box(model, tint, [x, y, z], [width, height, depth], yaw);
  const simple = (shape, tint, x, y, z, width, height, depth, yaw) => body(model, shape, tint, [x, y, z], [width, height, depth], yaw);
  const paperStack = (y) => {
    for (let leaf = 0; leaf < 4; leaf += 1) block(leaf % 2 ? 0xe9d4a5 : 0xf2e1bf, 0.03 * leaf, y + leaf * 0.012, 0, 0.56, 0.018, 0.34, leaf * 0.04);
    for (let line = 0; line < 5; line += 1) block(0x8e7762, 0.08, y + 0.052, -0.105 + line * 0.045, 0.38 - line * 0.022, 0.006, 0.009, 0.12);
  };
  const display = () => {
    block(shadeTone, 0, 0.047, 0, 1.05, 0.094, 0.65);
    block(accentTone, 0, 0.13, 0, 0.95, 0.074, 0.55);
    block(0xd6c1a0, 0, 0.175, 0, 0.89, 0.032, 0.47);
  };

  switch (type) {
    case 'house': {
      block(stoneTone, 0, 0.07, 0, 0.94, 0.14, 0.71);
      block(wallTone, 0, 0.32, 0, 0.80, 0.43, 0.57);
      block(darkWood, 0.07, 0.23, 0.29, 0.17, 0.31, 0.032);
      for (const windowX of [-0.24, 0.29]) {
        block(darkWood, windowX, 0.39, 0.29, 0.12, 0.12, 0.025);
        block(0xa58c55, windowX, 0.39, 0.31, 0.065, 0.068, 0.015);
      }
      for (const slope of [-1, 1]) {
        const roof = block(shadeTone, 0, 0.6, slope * 0.16, 0.96, 0.052, 0.42);
        roof.rotation.x = slope * 0.42;
        for (let tile = -3; tile <= 3; tile += 1) {
          const rib = block(0x585d55, tile * 0.118, 0.634, slope * 0.16, 0.036, 0.022, 0.405);
          rib.rotation.x = slope * 0.42;
        }
      }
      block(0x575950, 0, 0.68, 0, 0.97, 0.045, 0.054);
      break;
    }
    case 'fields':
      for (let row = 0; row < 6; row += 1) block(row % 2 ? 0x8c8656 : 0xafa06a, row * 0.13 - 0.32, 0.04, 0, 0.10, 0.06, 0.74 - row * 0.035, -0.14);
      break;
    case 'steps':
      for (let step = 0; step < 6; step += 1) block(step % 2 ? 0x99917d : 0xaea38d, step * 0.095, 0.045 + step * 0.041, 0, 0.15, 0.09 + step * 0.08, 0.52);
      block(stoneTone, 0.54, 0.23, 0.28, 0.047, 0.43, 0.045);
      block(stoneTone, 0.54, 0.23, -0.28, 0.047, 0.43, 0.045);
      break;
    case 'boat': {
      const bottom = [[0, -0.5], [0.14, -0.29], [0.18, 0.17], [0.09, 0.38], [0, 0.48], [-0.09, 0.38], [-0.18, 0.17], [-0.14, -0.29]];
      const positions = [];
      const indices = [];
      bottom.forEach(([x, z], index) => {
        const height = index % 4 === 0 ? 0.23 : 0.16;
        positions.push(x * 0.71, 0.02, z * 0.86, x, height, z);
        const start = index * 2;
        const next = (start + 2) % (bottom.length * 2);
        indices.push(start, start + 1, next, start + 1, next + 1, next);
      });
      const hull = new THREE.BufferGeometry();
      hull.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      hull.setIndex(indices);
      hull.computeVertexNormals();
      model.add(new THREE.Mesh(hull, new THREE.MeshLambertMaterial({ color: darkWood, side: THREE.DoubleSide })));
      block(woodTone, 0, 0.063, 0, 0.2, 0.04, 0.60);
      for (const z of [-0.23, 0.03, 0.24]) block(0xb27c4b, 0, 0.149, z, 0.31 - Math.abs(z) * 0.14, 0.035, 0.085);
      const oar = block(wallTone, 0.035, 0.21, 0.03, 0.69, 0.026, 0.042, -0.24);
      oar.rotation.z = -0.11;
      break;
    }
    case 'lantern':
      block(stoneTone, 0, 0.065, 0, 0.28, 0.13, 0.26);
      block(darkWood, 0, 0.31, 0, 0.07, 0.38, 0.07);
      block(0xffc477, 0, 0.6, 0, 0.21, 0.23, 0.21);
      block(shadeTone, 0, 0.48, 0, 0.28, 0.057, 0.28);
      block(shadeTone, 0, 0.75, 0, 0.32, 0.07, 0.32);
      for (const x of [-1, 1]) for (const z of [-1, 1]) block(woodTone, x * 0.11, 0.61, z * 0.11, 0.048, 0.23, 0.048);
      break;
    case 'marker':
      block(stoneTone, 0, 0.085, 0, 0.64, 0.17, 0.45);
      block(wallTone, 0, 0.37, -0.05, 0.39, 0.54, 0.17);
      block(accentTone, 0, 0.5, 0.045, 0.28, 0.17, 0.025);
      for (let line = 0; line < 4; line += 1) block(shadeTone, 0, 0.493 + line * 0.024, 0.06, 0.18, 0.011, 0.01);
      break;
    case 'lookout':
    case 'door':
      block(stoneTone, 0, 0.05, 0, 0.92, 0.10, 0.53);
      for (const side of [-1, 1]) block(darkWood, side * 0.31, 0.31, 0, 0.065, 0.6, 0.08);
      block(woodTone, 0, 0.55, 0, 0.71, 0.095, 0.095);
      if (type === 'door') {
        for (const side of [-1, 1]) {
          const top = block(shadeTone, 0, 0.67, side * 0.16, 0.89, 0.066, 0.42);
          top.rotation.x = side * 0.36;
        }
      }
      break;
    case 'chair':
      block(woodTone, 0, 0.23, 0, 0.34, 0.055, 0.29);
      block(darkWood, 0, 0.43, -0.13, 0.33, 0.31, 0.07);
      for (const x of [-1, 1]) for (const z of [-1, 1]) block(darkWood, x * 0.13, 0.11, z * 0.11, 0.047, 0.22, 0.047);
      break;
    case 'papers':
    case 'desk':
      if (type === 'desk') {
        block(woodTone, 0, 0.47, 0, 0.92, 0.11, 0.58);
        for (const x of [-1, 1]) for (const z of [-1, 1]) block(darkWood, x * 0.36, 0.24, z * 0.21, 0.067, 0.49, 0.067);
      }
      paperStack(type === 'desk' ? 0.55 : 0.02);
      break;
    case 'stones':
      for (let index = 0; index < 5; index += 1) simple('stone', index % 2 ? stoneTone : shadeTone, (index - 2) * 0.18, 0.07, Math.sin(index * 1.84) * 0.12, 0.25, 0.16 + 0.021 * index, 0.28, index);
      break;
    case 'oar':
      display();
      block(0x97643d, -0.04, 0.235, 0, 0.69, 0.045, 0.045, 0.2);
      block(0xb27c4b, 0.31, 0.238, -0.075, 0.26, 0.045, 0.114, 0.2);
      break;
    case 'comparison':
      display();
      block(woodTone, -0.26, 0.243, 0, 0.33, 0.09, 0.17, 0.23);
      block(shadeTone, 0.27, 0.26, 0, 0.35, 0.054, 0.075);
      for (const post of [0.11, 0.43]) block(stoneTone, post, 0.237, 0, 0.045, 0.11, 0.13);
      break;
    case 'chain':
      display();
      for (let link = -2; link <= 2; link += 1) {
        const ring = simple('ring', shadeTone, link * 0.16, 0.27, 0, 0.24, 0.135, 0.19, 0);
        ring.rotation.x = link % 2 ? Math.PI / 2 : 0;
      }
      break;
    case 'belt':
      display();
      for (let section = 0; section < 9; section += 1) {
        const angle = section * 0.41 - 1.64;
        block(0x743922, Math.sin(angle) * 0.30, 0.239, Math.cos(angle) * 0.158 - 0.048, 0.116, 0.065, 0.086, angle * 0.65);
      }
      for (const dot of [-0.07, 0.03, 0.12]) simple('post', 0x3a281e, dot, 0.274, 0.10, 0.029, 0.006, 0.029);
      break;
  }
}

function buildLandscapeProp(type, model, kit, terrain) {
  const snow = type === 'snowdrift';
  const { x, y, z } = model.position;
  const { x: scale } = model.scale;
  const ground = (u, v) => (terrain.heightAt(x + u * scale, z + v * scale) - y) / scale;
  const positions = [0, ground(0, 0) + 0.028, 0];
  const colors = [];
  const faces = [];
  const segments = 24;
  const tint = new THREE.Color(snow ? 0xe8ecde : 0x75938c);
  const edgeTint = new THREE.Color(snow ? 0xd0d6c5 : 0x526d66);
  colors.push(tint.r, tint.g, tint.b);
  for (const [ringIndex, radius] of [0.33, 0.66, 1].entries()) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = 2 * Math.PI * segment / segments;
      const shape = radius * (0.88 + Math.sin(angle * 3 + x) * 0.11 + Math.cos(angle * 7 + z) * 0.056);
      const u = Math.cos(angle) * shape * (snow ? 0.62 : 0.57);
      const v = Math.sin(angle) * shape * (snow ? 0.33 : 0.39);
      positions.push(u, ground(u, v) + (snow ? 0.043 : 0.026), v);
      const color = tint.clone().lerp(edgeTint, radius * radius * (0.72 + Math.sin(angle + 2) * 0.12));
      colors.push(color.r, color.g, color.b);
      const first = 1 + ringIndex * segments + segment;
      const next = 1 + ringIndex * segments + (segment + 1) % segments;
      if (ringIndex === 0) faces.push(0, next, first);
      else faces.push(first - segments, next, first, first - segments, next - segments, next);
    }
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  patch.setIndex(faces);
  patch.computeVertexNormals();
  model.add(new THREE.Mesh(patch, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (snow) return;
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI / 8;
    const u = Math.cos(angle) * (0.48 + Math.sin(index) * 0.04);
    const v = Math.sin(angle) * (0.35 + Math.cos(index) * 0.04);
    const height = 0.07 + (index % 4) * 0.023;
    const reed = kit.box(model, index % 2 ? 0xa2935d : 0x7e753f,
      [u, ground(u, v) + height / 2, v], [0.013, height, 0.01], angle);
    reed.rotation.z = 0.34 * Math.sin(index);
  }
}

function makePhaseExhibits(terrain, landmark, chapter, variant, water) {
  const kit = exhibitBuilder();
  return exhibitPhases[chapter.id].map((phase, phaseIndex) => {
    if (phase.variant && phase.variant !== variant) return null;
    const layout = phaseLayouts[phase.setting];
    const phaseGroup = new THREE.Group();
    phaseGroup.visible = false;
    layout.forEach(([type, across, along, scale, yaw = 0, height]) => {
      const rotate = water && !water.acrossX;
      const x = landmark.x + (rotate ? along : across);
      const z = landmark.z + (rotate ? across : along);
      const model = new THREE.Group();
      model.position.set(x, height === undefined ? terrain.heightAt(x, z) + 0.04 : landmark.y + height, z);
      model.rotation.y = yaw + (rotate ? -Math.PI / 2 : 0);
      model.scale.setScalar(scale);
      if (type === 'snowdrift' || type === 'pool') buildLandscapeProp(type, model, kit, terrain);
      else buildProp(type, model, kit);
      phaseGroup.add(model);
    });
    const [first] = phaseGroup.children;
    const landscapeOrInterior = ['high-pass', 'marsh-pool', 'meeting-table'].includes(phase.setting);
    if (!landscapeOrInterior) {
      const ring = kit.body(phaseGroup, 'guide', [0xb5915c, 0xe9b870, 0xb99054][phaseIndex],
        [first.position.x, first.position.y + 0.024, first.position.z], [1.24, 1.24, 0.38]);
      ring.rotation.x = Math.PI / 2;
    }
    terrain.group.add(phaseGroup);
    return phaseGroup;
  });
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
      setView() {}, setActiveHotspot() {}, setPhase() {}, setPlaying() {}, resetView() {}, dispose() {},
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(0xffecd2, 0x60564d, 2.35));
  const key = new THREE.DirectionalLight(0xfff0d6, 2.15);
  key.position.set(-5, 10, -6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf1e3cb, 0.56);
  fill.position.set(5, 3, 9);
  scene.add(fill);
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
  let phaseIndex = 0;
  let transition;
  let cameraMotion;
  let playing = false;
  let playRate = 1;
  let pointerStart;
  let contextLost = false;
  let disposed = false;
  const raycaster = new THREE.Raycaster();
  const spherical = new THREE.Spherical();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function requestRender() {
    if (frame || contextLost || disposed) return;
    frame = requestAnimationFrame((now) => {
      frame = 0;
      if (transition) {
        const elapsed = transition.start === undefined ? 0 : now - transition.start;
        transition.start ??= now;
        const progress = reducedMotion?.matches || canvas.hidden ? 1 : Math.min(elapsed / 360, 1);
        const ease = 1 - (1 - progress) ** 3;
        transition.group.position.y = -0.09 * (1 - ease);
        key.color.lerpColors(transition.from, transition.to, ease);
        if (progress < 1) requestRender();
        else transition = undefined;
      }
      if (cameraMotion) {
        const motion = cameraMotion;
        motion.elapsed += Math.max(0, now - (motion.lastFrame ?? now)) * playRate;
        motion.lastFrame = now;
        const progress = reducedMotion?.matches || canvas.hidden ? 1 : Math.min(motion.elapsed / 840, 1);
        const ease = progress * progress * (3 - 2 * progress);
        controls.target.lerpVectors(motion.fromTarget, motion.target, ease);
        camera.position.lerpVectors(motion.fromEye, motion.eye, ease);
        controls.update();
        if (progress < 1) requestRender();
        else cameraMotion = undefined;
      }
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
    if (current && viewName === 'overview') setView('overview', true);
    requestRender();
  }

  function setView(name, immediate = false) {
    viewName = name;
    if (!current) return;
    const { landmark, terrain } = current;
    const aspectFit = Math.max(1, 1.35 / camera.aspect);
    const target = new THREE.Vector3();
    const eye = new THREE.Vector3();
    if (name === 'ground') {
      target.set(landmark.x, landmark.y + 0.32, landmark.z);
      const x = landmark.x + 2.7;
      const z = landmark.z + 2.35;
      const height = Math.max(landmark.y + 0.95, terrain.heightAt(x, z) + 0.72);
      eye.set(x, height, z);
    } else if (name === 'detail') {
      const modelCenter = current.kind === 'hall' ? 0.93 : 0.38;
      target.set(landmark.x, landmark.y + modelCenter, landmark.z);
      const x = landmark.x + 2.78 * aspectFit;
      const z = landmark.z + 3.63 * aspectFit;
      eye.set(x, Math.max(landmark.y + 2.6, terrain.heightAt(x, z) + 0.8), z);
    } else {
      target.set(0, -0.96, 0);
      eye.set(12.95 * aspectFit, 13.81 * aspectFit, 16.29 * aspectFit);
    }
    const guided = playing && !immediate && !canvas.hidden && !reducedMotion?.matches;
    const focus = current.activeGroup?.children[0]?.position;
    if (focus && (guided || name === 'detail')) {
      const weight = name === 'overview' ? 0.16 : 0.48;
      const shiftX = clamp((focus.x - target.x) * weight, -0.7, 0.7);
      const shiftZ = clamp((focus.z - target.z) * weight, -0.7, 0.7);
      target.x += shiftX;
      target.z += shiftZ;
      eye.x += shiftX;
      eye.z += shiftZ;
      eye.y = Math.max(eye.y, terrain.heightAt(eye.x, eye.z) + 0.66);
    }
    if (guided) {
      cameraMotion = { fromTarget: controls.target.clone(), fromEye: camera.position.clone(), target, eye, elapsed: 0 };
    } else {
      cameraMotion = undefined;
      controls.target.copy(target);
      camera.position.copy(eye);
      controls.update();
    }
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

  function setPhase(index, animate = true) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    phaseIndex = index;
    if (!current || current.activePhase === index) return;
    current.activePhase = index;
    const group = current.phases[index] ?? current.phases.find(Boolean);
    current.activeGroup = group;
    current.phases.filter(Boolean).forEach(phase => {
      phase.visible = phase === group;
      phase.position.y = 0;
    });
    const light = (sceneLighting[current.kind] ?? neutralLight)[index];
    if (animate && !reducedMotion?.matches && !canvas.hidden) {
      transition = { group, from: key.color.clone(), to: new THREE.Color(light) };
      group.position.y = -0.09;
      if (playing) setView(viewName);
    } else {
      transition = undefined;
      key.color.setHex(light);
    }
    requestRender();
  }

  function stopGuide() {
    cameraMotion = undefined;
  }

  function setPlaying(next, speed = 1) {
    const wasPlaying = playing;
    playing = Boolean(next);
    playRate = clamp(Number(speed) || 1, 0.5, 2);
    if (playing) {
      if (!wasPlaying && current && !reducedMotion?.matches) setView(viewName);
    } else {
      stopGuide();
      if (transition) {
        transition.group.position.y = 0;
        key.color.copy(transition.to);
        transition = undefined;
        requestRender();
      }
    }
  }

  async function setChapter(chapter, { variant = 'primary' } = {}) {
    if (disposed) return;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    if (current) disposeGroup(current.terrain.group);
    current = null;
    transition = undefined;
    stopGuide();
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
    addCabinet(terrain, chapter);
    addVegetation(terrain, kind, surveyLine);
    const phases = makePhaseExhibits(terrain, landmark, chapter, variant, surveyLine);
    const markers = createMarkers(terrain, landmark, { ...chapter, kind });
    scene.add(terrain.group);
    current = { terrain, landmark, markers, phases, kind };
    setView(viewName, true);
    setActiveHotspot(activeIndex);
    setPhase(phaseIndex, false);
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
    stopGuide();
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
  controls.addEventListener('start', stopGuide);
  canvas.addEventListener('pointerdown', startPointer);
  canvas.addEventListener('pointerup', selectPointer);
  canvas.addEventListener('keydown', handleKeys);
  canvas.addEventListener('webglcontextlost', loseContext);
  canvas.addEventListener('webglcontextrestored', restoreContext);
  resize();

  return {
    setChapter, setView, setActiveHotspot, setPhase, setPlaying,
    resetView() { setView('overview', true); },
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
