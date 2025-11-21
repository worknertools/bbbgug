(() => {
  'use strict';

  const DEFAULT_BACKGROUND_COLOR = '#FFFFFF';
  const DEFAULT_FOREGROUND_COLOR = '#000000';
  const DEMO_COLOR = '#FF6D00';

  const canvas = document.getElementById('pixelCanvas');
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

  let displayWidth = 520;
  let displayHeight = 520;
  let dpr = window.devicePixelRatio || 1;
  let isExporting = false; // 全局导出锁

  function resizeCanvas() {
    if (isExporting) return;
    const container = document.getElementById('previewCanvas');
    const rect = container.getBoundingClientRect();
    displayWidth = Math.floor(rect.width);
    displayHeight = Math.floor(rect.height);
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    renderPreview(); // 直接渲染，不清屏
  }

  const fileInput = document.getElementById('fileInput');
  const errorEl = document.getElementById('error');
  const uploadPreview = document.getElementById('uploadPreview');
  const uploadIcon = document.getElementById('uploadIcon');
  const emptyState = document.getElementById('emptyState');
  const previewCanvas = document.getElementById('previewCanvas');
  const exportPNGButton = document.getElementById('exportPNG');
  const exportSVGButton = document.getElementById('exportSVG');
  const resetLabel = document.querySelector('.panel__reset-label');

  const gridSizeSlider = document.getElementById('gridSize');
  const edgeSlider = document.getElementById('edgeThreshold');
  const detailSlider = document.getElementById('detailLevel');
  const lineSlider = document.getElementById('lineThickness');
  const outlineSlider = document.getElementById('outlineThickness');

  const gridSizeVal = document.getElementById('gridSizeVal');
  const edgeThresholdVal = document.getElementById('edgeThresholdVal');
  const detailLevelVal = document.getElementById('detailLevelVal');
  const lineThicknessVal = document.getElementById('lineThicknessVal');
  const outlineThicknessVal = document.getElementById('outlineThicknessVal');

  const bgSwatches = Array.from(document.querySelectorAll('.bg-swatch[data-color]'));
  const customBgPicker = document.getElementById('customBgPicker');
  const fgSwatches = Array.from(document.querySelectorAll('.fg-swatch[data-color]'));
  const customFgPicker = document.getElementById('customFgPicker');
  const styleButtons = document.querySelectorAll('.style-button');

  let styleMode = 'square';
  let processedImage = null;
  let demoImage = null;
  let hasImage = false;

  let gridSize = 10, edgeThreshold = 30, detailLevel = 1, lineThickness = 1, outlineThickness = 5;
  let backgroundColor = DEFAULT_BACKGROUND_COLOR;
  let foregroundColor = DEFAULT_FOREGROUND_COLOR;

  let offsetX = 0, offsetY = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;

  let cachedEdges = null;

  let typingTimeout = null;
  let isFirstAnimation = true;

  // ==================== 背景填充（只在必要时清屏） ====================
  function fillCanvasBackground(color) {
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = color;
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
    ctx.scale(dpr, dpr);
  }

  // ==================== 渲染预览（彻底消除闪跳） ====================
  function renderPreview() {
    if (!processedImage && !demoImage) return;

    const image = processedImage || demoImage;

    // 只有背景色变化时才重新填充背景
    if (previewCanvas.style.backgroundColor !== backgroundColor) {
      fillCanvasBackground(backgroundColor);
    }

    if (cachedEdges === null) {
      cachedEdges = detectEdges(image.preview, edgeThreshold, detailLevel);
    }

    const uniformScale = Math.min(displayWidth / image.previewWidth, displayHeight / image.previewHeight);
    const canvasOffsetX = (displayWidth - image.previewWidth * uniformScale) / 2 + offsetX;
    const canvasOffsetY = (displayHeight - image.previewHeight * uniformScale) / 2 + offsetY;

    renderPixels(ctx, cachedEdges, image.previewWidth, image.previewHeight, uniformScale, canvasOffsetX, canvasOffsetY, Math.max(1, gridSize));
  }

  // ==================== 动态文字 ====================
  function getReadableTextColor(hex) {
    const normalized = hex.replace('#', '').trim();
    const expanded = normalized.length === 3 ? normalized.split('').map(c => c+c).join('') : normalized;
    const r = parseInt(expanded.slice(0,2),16);
    const g = parseInt(expanded.slice(2,4),16);
    const b = parseInt(expanded.slice(4,6),16);
    const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
    return lum > 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.68)';
  }

  function updateBackgroundVisuals() {
    previewCanvas.style.backgroundColor = backgroundColor;
    emptyState.style.backgroundColor = backgroundColor;
    emptyState.style.color = getReadableTextColor(backgroundColor);

    const chars = document.querySelectorAll('.typing-char');

    if (hasImage || backgroundColor !== DEFAULT_BACKGROUND_COLOR) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
      emptyState.classList.add('hidden');
      chars.forEach(c => c.classList.remove('typing-char--visible'));
    } else {
      emptyState.classList.remove('hidden');
      if (!typingTimeout) runTypingAnimation(chars);
    }
  }

  function runTypingAnimation(chars) {
    if (isFirstAnimation) {
      chars.forEach((ch,i) => setTimeout(() => ch.classList.add('typing-char--visible'), i*35));
      typingTimeout = setTimeout(() => runTypingAnimation(chars), chars.length*35 + 1000);
      isFirstAnimation = false;
    } else {
      chars.forEach(ch => ch.classList.remove('typing-char--visible'));
      setTimeout(() => {
        chars.forEach((ch,i) => setTimeout(() => ch.classList.add('typing-char--visible'), i*35));
        typingTimeout = setTimeout(() => runTypingAnimation(chars), chars.length*35 + 1000);
      }, 100);
    }
  }

  // ==================== 图像处理 ====================
  function detectEdges(imageData, edgeThresholdValue, detailLevelValue) {
    const {data, width, height} = imageData;
    const gray = new Uint8Array(width*height);
    for (let i=0; i<width*height; i++) gray[i] = data[i*4]*0.3 + data[i*4+1]*0.59 + data[i*4+2]*0.11;

    const magnitude = new Float32Array(width*height);
    const direction = new Float32Array(width*height);
    for (let y=1; y<height-1; y++) for (let x=1; x<width-1; x++) {
      const gx = gray[(y-1)*width+(x+1)] + 2*gray[y*width+(x+1)] + gray[(y+1)*width+(x+1)] -
                 (gray[(y-1)*width+(x-1)] + 2*gray[y*width+(x-1)] + gray[(y+1)*width+(x-1)]);
      const gy = gray[(y-1)*width+(x-1)] + 2*gray[(y-1)*width+x] + gray[(y-1)*width+(x+1)] -
                 (gray[(y+1)*width+(x-1)] + 2*gray[(y+1)*width+x] + gray[(y+1)*width+(x+1)]);
      const idx = y*width + x;
      magnitude[idx] = Math.sqrt(gx*gx + gy*gy)/4;
      direction[idx] = Math.atan2(gy, gx);
    }

    const edges = [];
    const weakEdges = [];
    const factor = 1 - (detailLevelValue-1)/29*0.75;
    const high = Math.max(edgeThresholdValue * factor, 1);
    const low = high * 0.4;

    for (let y=1; y<height-1; y++) for (let x=1; x<width-1; x++) {
      const idx = y*width + x;
      if (magnitude[idx] <= low) continue;
      let dir = (direction[idx]*180/Math.PI + 180)%180;
      let d = dir<22.5||dir>=157.5?0:dir<67.5?45:dir<112.5?90:135;
      let n1,n2;
      if(d===0){n1=magnitude[idx-1];n2=magnitude[idx+1];}
      else if(d===45){n1=magnitude[idx+width-1];n2=magnitude[idx-width+1];}
      else if(d===90){n1=magnitude[idx-width];n2=magnitude[idx+width];}
      else {n1=magnitude[idx+width+1];n2=magnitude[idx-width-1];}
      if (magnitude[idx] >= n1 && magnitude[idx] >= n2) {
        if (magnitude[idx] >= high) edges.push(idx);
        else weakEdges.push(idx);
      }
    }

    const edgeSet = new Set(edges);
    const connected = new Set();
    weakEdges.forEach(idx => {
      const y = Math.floor(idx / width);
      const x = idx % width;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        if (dx===0 && dy===0) continue;
        const nIdx = (y+dy)*width + (x+dx);
        if (edgeSet.has(nIdx)) { connected.add(idx); break; }
      }
    });
    return [...edges, ...Array.from(connected)];
  }

  function prepareImage(image) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = w; fullCanvas.height = h;
    const fullCtx = fullCanvas.getContext('2d');
    fullCtx.drawImage(image,0,0,w,h);

    const target = 360;
    const maxDim = Math.max(w,h);
    const scale = maxDim > target ? target/maxDim : 1;
    const pw = Math.max(1, Math.round(w*scale));
    const ph = Math.max(1, Math.round(h*scale));

    const previewCanvasEl = document.createElement('canvas');
    previewCanvasEl.width = pw; previewCanvasEl.height = ph;
    const previewCtx = previewCanvasEl.getContext('2d');
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.drawImage(image,0,0,pw,ph);
    const preview = previewCtx.getImageData(0,0,pw,ph);

    return {preview, previewWidth:pw, previewHeight:ph};
  }

  function calculateShapeParams(x, y, uniformScale, canvasOffsetX, canvasOffsetY) {
    const baseSize = uniformScale * gridSize;
    const thicknessFactor = 1 + (lineThickness - 1) * 0.25;
    const rectSize = baseSize * thicknessFactor;
    const thicknessOffset = (rectSize - baseSize) / 2;
    const drawX = canvasOffsetX + x * uniformScale - thicknessOffset;
    const drawY = canvasOffsetY + y * uniformScale - thicknessOffset;
    return {drawX, drawY, rectSize};
  }

  // ==================== 渲染核心（filled 优化） ====================
  function renderPixels(targetCtx, edges, previewWidth, previewHeight, uniformScale, canvasOffsetX, canvasOffsetY, step) {
    targetCtx.imageSmoothingEnabled = false;
    const isExport = targetCtx.canvas.width === 2880 || targetCtx.canvas.height === 3840;
    const pixelRatio = isExport ? 1 : dpr;

    for (let i = 0; i < edges.length; i += step) {
      const index = edges[i];
      const y = Math.floor(index / previewWidth);
      const x = index % previewWidth;
      const params = calculateShapeParams(x, y, uniformScale, canvasOffsetX, canvasOffsetY);

      if (styleMode === 'square') {
        targetCtx.fillStyle = foregroundColor;
        targetCtx.fillRect(params.drawX, params.drawY, params.rectSize, params.rectSize);
      } else if (styleMode === 'circle') {
        const cx = params.drawX + params.rectSize / 2;
        const cy = params.drawY + params.rectSize / 2;
        const r = params.rectSize / 2;
        targetCtx.fillStyle = foregroundColor;
        targetCtx.beginPath();
        targetCtx.arc(cx, cy, r, 0, Math.PI * 2);
        targetCtx.fill();
      } else if (styleMode === 'filled') {
        const cx = params.drawX + params.rectSize / 2;
        const cy = params.drawY + params.rectSize / 2;
        const baseRadius = params.rectSize / 2;

        const maxStroke = baseRadius * 1.1;
        const minStroke = baseRadius * 0.07;
        const blackStrokeRaw = minStroke + (maxStroke - minStroke) * (outlineThickness - 1) / 9;
        const blackStroke = blackStrokeRaw * pixelRatio;

        targetCtx.fillStyle = '#000';
        targetCtx.beginPath();
        targetCtx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
        targetCtx.fill();

        const innerRadius = Math.max(baseRadius - blackStroke, 0);
        if (innerRadius > 0.4) {
          targetCtx.fillStyle = foregroundColor;
          targetCtx.beginPath();
          targetCtx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
          targetCtx.fill();
        }
      }
    }
  }

  // ==================== 颜色 & Reset ====================
  function setBackgroundColor(color) {
    backgroundColor = color.toUpperCase();
    customBgPicker.value = color;
    bgSwatches.forEach(s => s.classList.toggle('active', s.dataset.color?.toUpperCase() === color));
    updateBackgroundVisuals();
    renderPreview(); // 直接渲染，不闪
  }

  function setForegroundColor(color) {
    foregroundColor = color.toUpperCase();
    customFgPicker.value = color;
    fgSwatches.forEach(s => s.classList.toggle('active', s.dataset.color?.toUpperCase() === color));
    renderPreview();
  }

  function resetAll() {
    gridSize = 10; edgeThreshold = 30; detailLevel = 1; lineThickness = 1; outlineThickness = 5;
    gridSizeSlider.value = 10; gridSizeVal.textContent = '10';
    edgeSlider.value = 30; edgeThresholdVal.textContent = '30';
    detailSlider.value = 1; detailLevelVal.textContent = '1';
    lineSlider.value = 1; lineThicknessVal.textContent = '1';
    outlineSlider.value = 5; outlineThicknessVal.textContent = '5';

    setBackgroundColor(DEFAULT_BACKGROUND_COLOR);
    setForegroundColor(DEFAULT_FOREGROUND_COLOR);

    styleButtons.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-style="square"]').classList.add('active');
    styleMode = 'square';

    processedImage = null; demoImage = null; hasImage = false; cachedEdges = null;
    offsetX = offsetY = 0;
    uploadPreview.src = ''; uploadPreview.classList.add('hidden');
    uploadIcon.classList.remove('hidden');
    canvas.style.cursor = 'default';

    fillCanvasBackground(backgroundColor);
    updateBackgroundVisuals();
    fileInput.value = '';
  }

  // ==================== 拖拽 ====================
  canvas.addEventListener('mousedown', e => {
    if (!hasImage || e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX - offsetX;
    dragStartY = e.clientY - offsetY;
    canvas.style.cursor = 'grabbing';
    previewCanvas.classList.add('dragging');
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    offsetX = e.clientX - dragStartX;
    offsetY = e.clientY - dragStartY;
    renderPreview(); // 直接渲染，无闪跳
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'grab';
      previewCanvas.classList.remove('dragging');
    }
  });

  // ==================== 导出（彻底防重复） ====================
  function handleExportPNG() {
    if (!hasImage || isExporting) return;
    isExporting = true;
    exportPNGButton.disabled = true;
    exportPNGButton.style.opacity = '0.6';

    const image = processedImage || demoImage;
    if (cachedEdges === null) cachedEdges = detectEdges(image.preview, edgeThreshold, detailLevel);

    const w = 2880, h = 3840;
    const scale = Math.min(w / image.previewWidth, h / image.previewHeight);
    const ox = (w - image.previewWidth * scale) / 2;
    const oy = (h - image.previewHeight * scale) / 2;

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { alpha: false });
    x.fillStyle = backgroundColor;
    x.fillRect(0, 0, w, h);
    renderPixels(x, cachedEdges, image.previewWidth, image.previewHeight, scale, ox, oy, Math.max(1, gridSize));

    c.toBlob(blob => {
      downloadBlob(blob, `pixel-art-${Date.now()}.png`);
      isExporting = false;
      exportPNGButton.disabled = false;
      exportPNGButton.style.opacity = '1';
    }, 'image/png');
  }

  function handleExportSVG() {
    if (!hasImage || isExporting) return;
    isExporting = true;
    exportSVGButton.disabled = true;
    exportSVGButton.style.opacity = '0.6';

    const image = processedImage || demoImage;
    if (cachedEdges === null) cachedEdges = detectEdges(image.preview, edgeThreshold, detailLevel);

    const w = 2880, h = 3840;
    const scale = Math.min(w / image.previewWidth, h / image.previewHeight);
    const ox = (w - image.previewWidth * scale) / 2;
    const oy = (h - image.previewHeight * scale) / 2;
    const step = Math.max(1, gridSize);
    const shapes = [];

    for (let i = 0; i < cachedEdges.length; i += step) {
      const idx = cachedEdges[i];
      const y = Math.floor(idx / image.previewWidth);
      const x = idx % image.previewWidth;
      const p = calculateShapeParams(x, y, scale, ox, oy);

      if (styleMode === 'square') {
        shapes.push(`<rect x="${p.drawX.toFixed(2)}" y="${p.drawY.toFixed(2)}" width="${p.rectSize.toFixed(2)}" height="${p.rectSize.toFixed(2)}" fill="${foregroundColor}"/>`);
      } else if (styleMode === 'circle') {
        const cx = (p.drawX + p.rectSize/2).toFixed(2);
        const cy = (p.drawY + p.rectSize/2).toFixed(2);
        shapes.push(`<circle cx="${cx}" cy="${cy}" r="${(p.rectSize/2).toFixed(2)}" fill="${foregroundColor}"/>`);
      } else if (styleMode === 'filled') {
        const cx = (p.drawX + p.rectSize/2).toFixed(2);
        const cy = (p.drawY + p.rectSize/2).toFixed(2);
        const baseR = p.rectSize/2;
        const maxStroke = baseR * 1.1;
        const minStroke = baseR * 0.07;
        const stroke = minStroke + (maxStroke - minStroke) * (outlineThickness - 1)/9;
        shapes.push(`<circle cx="${cx}" cy="${cy}" r="${baseR.toFixed(2)}" fill="#000"/>`);
        const inner = Math.max(baseR - stroke, 0).toFixed(2);
        if (parseFloat(inner) > 0.4) shapes.push(`<circle cx="${cx}" cy="${cy}" r="${inner}" fill="${foregroundColor}"/>`);
      }
    }

    const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="background:${backgroundColor}">${shapes.join('')}</svg>`;
    downloadBlob(new Blob([svg], {type: 'image/svg+xml'}), `pixel-art-${Date.now()}.svg`);

    isExporting = false;
    exportSVGButton.disabled = false;
    exportSVGButton.style.opacity = '1';
  }

  // ==================== 事件绑定 ====================
  gridSizeSlider.addEventListener('input', e => { gridSize = +e.target.value; gridSizeVal.textContent = gridSize; renderPreview(); });
  edgeSlider.addEventListener('input', e => { edgeThreshold = +e.target.value; edgeThresholdVal.textContent = edgeThreshold; cachedEdges = null; renderPreview(); });
  detailSlider.addEventListener('input', e => { detailLevel = +e.target.value; detailLevelVal.textContent = detailLevel; cachedEdges = null; renderPreview(); });
  lineSlider.addEventListener('input', e => { lineThickness = +e.target.value; lineThicknessVal.textContent = lineThickness; renderPreview(); });
  outlineSlider.addEventListener('input', e => { outlineThickness = +e.target.value; outlineThicknessVal.textContent = outlineThickness; renderPreview(); });

  bgSwatches.forEach(btn => btn.addEventListener('click', () => btn.dataset.color && setBackgroundColor(btn.dataset.color)));
  customBgPicker.addEventListener('input', e => setBackgroundColor(e.target.value));

  fgSwatches.forEach(btn => btn.addEventListener('click', () => btn.dataset.color && setForegroundColor(btn.dataset.color)));
  customFgPicker.addEventListener('input', e => setForegroundColor(e.target.value));

  styleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      styleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      styleMode = btn.dataset.style;
      if (styleMode === 'filled') setForegroundColor(DEMO_COLOR);
      renderPreview();
    });
  });

  exportPNGButton.addEventListener('click', handleExportPNG);
  exportSVGButton.addEventListener('click', handleExportSVG);
  resetLabel.addEventListener('click', resetAll);

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errorEl.textContent = 'Please select an image file';
      errorEl.classList.remove('hidden');
      return;
    }
    errorEl.classList.add('hidden');

    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        processedImage = prepareImage(img);
        hasImage = true;
        cachedEdges = null;
        offsetX = offsetY = 0;
        uploadPreview.src = ev.target.result;
        uploadPreview.classList.remove('hidden');
        uploadIcon.classList.add('hidden');
        canvas.style.cursor = 'grab';
        renderPreview();
        updateBackgroundVisuals();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // ==================== 初始化 ====================
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  updateBackgroundVisuals();
  document.querySelector('[data-style="square"]').classList.add('active');

})();