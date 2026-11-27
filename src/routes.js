export const routeSources = [
  { title: '中央党史和文献研究院 · 长征路线示意图与大事记', url: 'https://www.dswxyjy.org.cn/GB/427277/462086/index.html' },
  { title: '中央党史和文献研究院 · 红二十五军的长征', url: 'https://www.dswxyjy.org.cn/n1/2026/0903/c244516-40791810.html' },
  { title: '中国共产党新闻网 · 红军长征中的会师', url: 'https://cpc.people.com.cn/n1/2025/1030/c443712-40592732.html' },
  { title: '雅安党史方志网 · 中央红军、红四方面军翻越夹金山遗址', url: 'https://www.yadsfz.org.cn/news/dsfz_0603/2022118/3334.html' },
];

const bounds = { west: 98.5, east: 116.8, south: 24.5, north: 38.6 };
const labelOffsets = [[9, -7], [9, 13], [-9, -7], [-9, 13], [8, -19], [-8, -19]];
const font = '"Microsoft YaHei", "PingFang SC", sans-serif';

function station(month, name, longitude, latitude) {
  return { month, name, longitude, latitude };
}

function routeData(chapters) {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  function exhibit(month, id, name) {
    const { longitude, latitude } = byId.get(id);
    return { ...station(month, name, longitude, latitude), chapter: id };
  }

  // Months are indexed from October 1934. Coordinates approximate named places,
  // and the lines between points are only schematic links for the exhibit.
  return [
    {
      id: 'first',
      name: '红一方面军',
      color: '#942e29',
      dash: [7, 4],
      points: [
        station(0, '于都', 115.41, 25.95),
        exhibit(1, 'xiangjiang', '湘江'),
        station(2, '黎平', 109.14, 26.23),
        exhibit(3, 'zunyi', '遵义'),
        exhibit(3, 'chishui', '赤水河'),
        exhibit(7, 'jinsha', '皎平渡'),
        exhibit(7, 'dadu', '安顺场'),
        exhibit(7, 'luding', '泸定桥'),
        exhibit(8, 'snow-grass', '夹金山'),
        station(10, '松潘草地', 102.89, 32.78),
        station(11, '哈达铺', 104.22, 34.23),
        station(12, '吴起镇', 108.18, 36.93),
      ],
    },
    {
      id: 'second',
      name: '红二方面军',
      color: '#4b6552',
      dash: [2, 4],
      points: [
        station(13, '桑植刘家坪', 110.2, 29.41),
        station(17, '乌蒙山区', 104.6, 26.88),
        station(20, '甘孜', 99.99, 31.62),
        station(21, '川西北草地', 102.64, 33.11),
        station(24, '将台堡', 105.84, 35.82),
      ],
    },
    {
      id: 'fourth',
      name: '红四方面军',
      color: '#745a85',
      dash: [8, 3, 2, 3],
      points: [
        station(5, '苍溪', 105.94, 31.73),
        station(8, '小金', 102.36, 31.0),
        station(12, '宝兴', 102.81, 30.37),
        station(20, '甘孜', 99.99, 31.62),
        station(21, '川西北草地', 102.64, 33.11),
        station(24, '会宁', 105.05, 35.69),
      ],
    },
    {
      id: 'twenty-fifth',
      name: '红二十五军',
      color: '#8b6228',
      dash: [4, 4],
      points: [
        station(1, '罗山何家冲', 114.49, 31.8),
        station(1, '方城独树镇', 113.11, 33.36),
        station(2, '庾家河', 110.39, 33.92),
        station(9, '两当', 106.3, 33.9),
        station(11, '延川永坪镇', 109.83, 36.92),
      ],
    },
  ];
}

function monthLabel(month) {
  const offset = month + 9;
  return `${1934 + Math.floor(offset / 12)}年${offset % 12 + 1}月`;
}

function plotGrid(context, width, height, project, inset) {
  context.strokeStyle = '#c5b69e';
  context.lineWidth = 1;
  context.strokeRect(inset.x, inset.y, width - inset.x * 2, height - inset.y * 2);
  context.font = `10px ${font}`;
  context.fillStyle = '#635949';
  context.textAlign = 'center';

  context.beginPath();
  for (let longitude = 100; longitude <= 116; longitude += 2) {
    const [x] = project(longitude, bounds.south);
    context.moveTo(x, inset.y);
    context.lineTo(x, height - inset.y);
    context.fillText(`${longitude}°`, x, height - 8);
  }
  context.textAlign = 'right';
  for (let latitude = 26; latitude <= 38; latitude += 2) {
    const [, y] = project(bounds.west, latitude);
    context.moveTo(inset.x, y);
    context.lineTo(width - inset.x, y);
    context.fillText(`${latitude}°`, inset.x - 4, y + 3);
  }
  context.strokeStyle = '#d8cbb3';
  context.stroke();
}

function plotLegendSymbol(context, routeIndex, x, y, radius) {
  context.beginPath();
  if (routeIndex === 0) {
    context.arc(x, y, radius, 0, Math.PI * 2);
  } else {
    const sides = routeIndex === 2 ? 3 : 4;
    const angle = routeIndex === 3 ? Math.PI / 4 : -Math.PI / 2;
    for (let index = 0; index < sides; index += 1) {
      const theta = angle + (index * Math.PI * 2) / sides;
      const cornerX = x + Math.cos(theta) * radius;
      const cornerY = y + Math.sin(theta) * radius;
      if (index === 0) context.moveTo(cornerX, cornerY);
      else context.lineTo(cornerX, cornerY);
    }
    context.closePath();
  }
  context.fill();
  context.stroke();
}

function plotLabels(context, markers, width, height, inset) {
  const placed = [];
  const eligible = [...markers].sort((first, second) => {
    return Number(second.important) - Number(first.important);
  });

  for (const marker of eligible) {
    if (placed.some(({ name }) => name === marker.name)) continue;
    if (width < 460 && !marker.important) continue;
    const fontSize = width < 460 ? 11 : 12;
    context.font = `${marker.chapter ? '600 ' : ''}${fontSize}px ${font}`;
    const textWidth = context.measureText(marker.name).width;
    for (const [dx, dy] of labelOffsets) {
      const x = marker.x + dx;
      const y = marker.y + dy;
      const left = dx > 0 ? x : x - textWidth;
      const right = left + textWidth;
      const top = y - fontSize;
      const bottom = y + 3;
      if (left < inset.x || right > width - 4 || top < 0 || bottom > height - 16) continue;
      if (placed.some((label) => left - 3 < label.right && right + 3 > label.left
        && top - 2 < label.bottom && bottom + 2 > label.top)) continue;
      if (markers.some((point) => point !== marker && point.x > left - 3 && point.x < right + 3
        && point.y > top - 3 && point.y < bottom + 3)) continue;
      context.textAlign = dx > 0 ? 'left' : 'right';
      context.lineWidth = 3;
      context.strokeStyle = '#eae0cd';
      context.strokeText(marker.name, x, y);
      context.fillStyle = marker.color;
      context.fillText(marker.name, x, y);
      placed.push({ name: marker.name, left, right, top, bottom });
      break;
    }
  }
}

export function createRouteExplorer({
  canvas, filters, slider, dateOutput, pointList, stage, toggle, reset, status,
}, { chapters, onChapter }) {
  const routes = routeData(chapters);
  const context = canvas.getContext('2d');
  const names = new Map(chapters.map(({ id, title }) => [id, title]));
  let selected = 'all';
  let visible = [];
  let markers = [];
  let routeStage;
  let show3D = false;

  const buttons = [{ id: 'all', name: '全部队伍' }, ...routes].map(({ id, name, color }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    if (color) {
      const swatch = document.createElement('span');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.cssText = `display:inline-block;width:.57em;height:.57em;margin-inline-end:.35em;
        border:1px solid #f7f0e6;border-radius:50%;background:${color}`;
      button.prepend(swatch);
    }
    button.addEventListener('click', () => {
      selected = id;
      update();
    });
    filters.append(button);
    return { id, button };
  });

  function draw() {
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const inset = { x: 33, y: 22 };
    function project(longitude, latitude) {
      return [
        inset.x + ((longitude - bounds.west) / (bounds.east - bounds.west)) * (width - inset.x * 2),
        inset.y + ((bounds.north - latitude) / (bounds.north - bounds.south)) * (height - inset.y * 2),
      ];
    }

    plotGrid(context, width, height, project, inset);
    markers = [];
    for (const route of visible) {
      const points = route.points.map((point, index) => {
        const [x, y] = project(point.longitude, point.latitude);
        return {
          ...point, x, y,
          color: route.color,
          routeIndex: routes.findIndex(({ id }) => id === route.id),
          important: Boolean(point.chapter) || index === 0 || index === route.points.length - 1,
        };
      });
      if (points.length === 0) continue;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.setLineDash(route.dash);
      context.lineWidth = selected === 'all' ? 1.7 : 2.4;
      context.strokeStyle = route.color;
      context.stroke();
      markers.push(...points);
    }

    context.setLineDash([]);
    context.lineWidth = 1.25;
    context.strokeStyle = '#f7f0e6';
    for (const marker of markers) {
      context.fillStyle = marker.color;
      plotLegendSymbol(context, marker.routeIndex, marker.x, marker.y, marker.chapter ? 4.3 : 3.6);
    }
    plotLabels(context, markers, width, height, inset);
  }

  function update() {
    const month = Number(slider.value);
    const label = monthLabel(month);
    dateOutput.value = label;
    slider.setAttribute('aria-valuetext', label);
    for (const { id, button } of buttons) button.setAttribute('aria-pressed', String(id === selected));
    visible = routes
      .filter(({ id }) => selected === 'all' || selected === id)
      .map((route) => ({ ...route, points: route.points.filter((point) => point.month <= month) }));

    const points = visible.flatMap((route) => route.points.map((point) => ({ ...point, route: route.name })))
      .sort((first, second) => first.month - second.month);
    const rows = points.map((point) => {
      const row = document.createElement('li');
      const entry = document.createElement(point.chapter ? 'a' : 'span');
      entry.textContent = names.get(point.chapter) || point.name;
      if (point.chapter) {
        entry.href = `#chapter-${point.chapter}`;
        entry.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          event.preventDefault();
          onChapter(point.chapter);
        });
      }
      const date = document.createElement('small');
      date.textContent = selected === 'all'
        ? `${point.route} · ${monthLabel(point.month)}`
        : monthLabel(point.month);
      entry.append(date);
      row.append(entry);
      return row;
    });
    if (rows.length === 0) {
      const row = document.createElement('li');
      const entry = document.createElement('span');
      entry.textContent = '此时这支队伍尚未开始长征。';
      row.append(entry);
      rows.push(row);
    }
    pointList.replaceChildren(...rows);
    pointList.scrollTop = 0;
    if (show3D) routeStage.update(visible);
    else draw();
  }

  function hit(event) {
    const { left, top } = canvas.getBoundingClientRect();
    let result;
    let nearest = 15;
    for (const marker of markers) {
      if (!marker.chapter) continue;
      const distance = Math.hypot(event.clientX - left - marker.x, event.clientY - top - marker.y);
      if (distance < nearest) {
        result = marker.chapter;
        nearest = distance;
      }
    }
    return result;
  }

  canvas.addEventListener('pointermove', (event) => { canvas.style.cursor = hit(event) ? 'pointer' : ''; });
  canvas.addEventListener('click', (event) => {
    const chapter = hit(event);
    if (chapter) onChapter(chapter);
  });
  slider.addEventListener('input', update);
  new ResizeObserver(draw).observe(canvas);
  update();

  if (stage) {
    let inView = false;
    let attempted = false;
    let disposed = false;
    const terrainRequest = new AbortController();
    const stageObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (routeStage) routeStage.setActive(inView && show3D);
      if (inView && !attempted) {
        attempted = true;
        void loadStage();
      }
    }, { rootMargin: '90px' });
    stageObserver.observe(canvas.parentElement);

    function setMode(use3D) {
      show3D = use3D;
      stage.hidden = !use3D;
      canvas.hidden = use3D;
      if (toggle) toggle.textContent = use3D ? '查看二维路线' : '查看三维沙盘';
      if (reset) reset.hidden = !use3D;
      if (status) {
        if (!use3D) status.textContent = '二维路线图';
        else if (routeStage.source) status.textContent = '三维沙盘 · Mapzen 现代区域高程（高差放大）';
        else status.textContent = '三维示意沙盘 · 示意地表';
      }
      if (routeStage) {
        routeStage.setActive(use3D && inView);
        if (use3D) routeStage.update(visible);
      }
      if (!use3D) draw();
    }

    function useFallback() {
      routeStage?.dispose();
      routeStage = undefined;
      setMode(false);
      if (toggle) toggle.hidden = true;
      if (status) status.textContent = '三维不可用，已显示二维路线';
      stageObserver.disconnect();
    }

    async function loadStage() {
      try {
        const terrain = fetch(`${import.meta.env.BASE_URL}terrain/overview.json`, { signal: terrainRequest.signal })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
        const [{ createRouteStage }, data] = await Promise.all([import('./route-stage.js'), terrain]);
        if (disposed) return;
        routeStage = createRouteStage(stage, { bounds, terrain: data, onChapter, onUnavailable: useFallback });
        if (!routeStage) {
          useFallback();
          return;
        }
        if (toggle) toggle.hidden = false;
        setMode(true);
      } catch {
        useFallback();
      }
    }

    toggle?.addEventListener('click', () => setMode(!show3D));
    reset?.addEventListener('click', () => routeStage?.reset());
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      disposed = true;
      stageObserver.disconnect();
      terrainRequest.abort();
      routeStage?.dispose();
    });
  }
}
