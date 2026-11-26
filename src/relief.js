export function createRelief(canvas, onState) {
  const context = canvas.getContext('2d');
  let request;
  let terrain;
  let bitmap;
  let lastId;

  function prepareBitmap() {
    const { elevations, width, height } = terrain;
    const minimum = Math.min(...elevations);
    const maximum = Math.max(...elevations);
    const spread = Math.max(1, maximum - minimum);
    const size = 420;
    bitmap = document.createElement('canvas');
    bitmap.width = size;
    bitmap.height = size;
    const painter = bitmap.getContext('2d');
    const image = painter.createImageData(size, size);
    const step = spread > 950 ? 100 : spread > 350 ? 50 : 25;

    function at(x, y) {
      const col = Math.max(0, Math.min(width - 1, x));
      const row = Math.max(0, Math.min(height - 1, y));
      const x0 = Math.floor(col);
      const y0 = Math.floor(row);
      const fractionX = col - x0;
      const fractionY = row - y0;
      const right = Math.min(x0 + 1, width - 1);
      const down = Math.min(y0 + 1, height - 1);
      const a = elevations[y0 * width + x0] * (1 - fractionX) + elevations[y0 * width + right] * fractionX;
      const b = elevations[down * width + x0] * (1 - fractionX) + elevations[down * width + right] * fractionX;
      return a * (1 - fractionY) + b * fractionY;
    }

    for (let py = 0; py < size; py++) {
      const y = py / (size - 1) * (height - 1);
      for (let px = 0; px < size; px++) {
        const x = px / (size - 1) * (width - 1);
        const elevation = at(x, y);
        const horizontal = at(x + .65, y) - at(x - .65, y);
        const vertical = at(x, y + .65) - at(x, y - .65);
        const altitude = (elevation - minimum) / spread;
        const gradient = Math.max(-34, Math.min(33, (horizontal + vertical * .7) * .8));
        const contourDistance = Math.abs(elevation - Math.round(elevation / step) * step);
        const contour = contourDistance < Math.min(step * .095, Math.hypot(horizontal, vertical) * .15) ? 24 : 0;
        const offset = (py * size + px) * 4;
        image.data[offset] = 165 + altitude * 62 + gradient - contour;
        image.data[offset + 1] = 157 + altitude * 48 + gradient - contour;
        image.data[offset + 2] = 119 + altitude * 58 + gradient - contour;
        image.data[offset + 3] = 255;
      }
    }
    painter.putImageData(image, 0, 0);
    return { minimum, maximum };
  }

  function paint() {
    if (!context || canvas.hidden) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = '#ddd0b5';
    context.fillRect(0, 0, width, height);

    if (bitmap) {
      const { bounds } = terrain;
      const latitude = (bounds.north + bounds.south) / 2 * Math.PI / 180;
      const ratio = (bounds.east - bounds.west) * Math.cos(latitude) / (bounds.north - bounds.south);
      const plotHeight = Math.min(height - 24, (width - 26) / ratio);
      const plotWidth = plotHeight * ratio;
      const left = (width - plotWidth) / 2;
      const top = (height - plotHeight) / 2;
      context.drawImage(bitmap, left, top, plotWidth, plotHeight);
      context.strokeStyle = '#78674f';
      context.strokeRect(left, top, plotWidth, plotHeight);
      context.strokeStyle = '#f8edd73f';
      for (let i = 1; i < 6; i++) {
        context.beginPath();
        context.moveTo(left + plotWidth * i / 6, top);
        context.lineTo(left + plotWidth * i / 6, top + plotHeight);
        context.moveTo(left, top + plotHeight * i / 6);
        context.lineTo(left + plotWidth, top + plotHeight * i / 6);
        context.stroke();
      }
      if (terrain.feature) {
        const { lon, lat } = terrain.feature;
        const px = left + (lon - bounds.west) / (bounds.east - bounds.west) * plotWidth;
        const py = top + (bounds.north - lat) / (bounds.north - bounds.south) * plotHeight;
        context.beginPath();
        context.arc(px, py, 4.5, 0, Math.PI * 2);
        context.fillStyle = '#943d31';
        context.fill();
        context.strokeStyle = '#fff7e6';
        context.lineWidth = 1.5;
        context.stroke();
      }
      return;
    }
    context.strokeStyle = '#c8b996';
    for (let offset = 14; offset < Math.max(width, height) / 2; offset += 11) {
      context.beginPath();
      context.ellipse(width * .53, height * .5, offset * 1.6, offset * .77, -.26, 0, Math.PI * 2);
      context.stroke();
    }
  }

  const observer = new ResizeObserver(paint);
  observer.observe(canvas);

  async function show(id) {
    if (lastId === id) return;
    lastId = id;
    request?.abort();
    const active = new AbortController();
    request = active;
    terrain = undefined;
    bitmap = undefined;
    paint();
    onState({ status: 'loading' });
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'terrain/' + id + '.json', { signal: active.signal });
      if (!response.ok) throw new Error('Terrain request failed');
      const data = await response.json();
      if (active.signal.aborted) return;
      if (!data.bounds || !data.width || !data.height || data.elevations?.length !== data.width * data.height) {
        throw new Error('Invalid elevation grid');
      }
      terrain = data;
      const range = prepareBitmap();
      paint();
      onState({ status: 'ready', source: data.source, feature: data.feature, ...range });
    } catch {
      if (active.signal.aborted) return;
      onState({ status: 'unavailable' });
    }
  }

  return { show, paint };
}
