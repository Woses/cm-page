(() => {
  'use strict';

  const GRID_WIDTH = 1000;
  const GRID_HEIGHT = 1000;
  const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;
  const STORAGE_KEY = 'pixelCanvasStateJsonV4';
  const IMAGE_FILE = 'testbild.jpg';
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 40;
  const ZOOM_FACTOR = 1.2;

  const canvas = document.getElementById('pixel-canvas');
  const viewer = document.getElementById('viewer');
  const ctx = canvas.getContext('2d', { alpha: false });

  const soldCounterEl = document.getElementById('sold-counter');
  const progressTextEl = document.getElementById('progress-text');
  const zoomTextEl = document.getElementById('zoom-text');
  const statsSoldEl = document.getElementById('stats-sold');
  const statsFreeEl = document.getElementById('stats-free');
  const statsPercentEl = document.getElementById('stats-percent');
  const statsZoomEl = document.getElementById('stats-zoom');
  const pixelCountInput = document.getElementById('pixel-count-input');
  const toastEl = document.getElementById('toast');

  const buyButton = document.getElementById('buy-button');
  const confirmBuyButton = document.getElementById('confirm-buy-button');
  const zoomInButton = document.getElementById('zoom-in-button');
  const zoomOutButton = document.getElementById('zoom-out-button');
  const fitViewButton = document.getElementById('fit-view-button');
  const exportJsonButton = document.getElementById('export-json-button');
  const resetButton = document.getElementById('reset-button');

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = GRID_WIDTH;
  offscreenCanvas.height = GRID_HEIGHT;
  const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = GRID_WIDTH;
  sourceCanvas.height = GRID_HEIGHT;
  const sourceCtx = sourceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });

  let sourceImageData = null;
  let toastTimer = null;
  let renderPending = false;

  const state = {
    soldCount: 0,
    bits: new Uint8Array(Math.ceil(TOTAL_PIXELS / 8))
  };

  const view = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointerId: null
  };

  function formatNumber(value) {
    return new Intl.NumberFormat('de-DE').format(value);
  }

  function formatPercent(value) {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2300);
  }

  function isSold(index) {
    return ((state.bits[index >> 3] >> (index & 7)) & 1) === 1;
  }

  function markSold(index) {
    state.bits[index >> 3] |= (1 << (index & 7));
  }

  function fillWhite() {
    offscreenCtx.setTransform(1, 0, 0, 1, 0, 0);
    offscreenCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
    offscreenCtx.fillStyle = '#ffffff';
    offscreenCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
  }

  function revealPixel(index) {
    if (!sourceImageData) return;
    const x = index % GRID_WIDTH;
    const y = Math.floor(index / GRID_WIDTH);
    const srcOffset = index * 4;
    const src = sourceImageData.data;
    const pixel = offscreenCtx.createImageData(1, 1);
    pixel.data[0] = src[srcOffset];
    pixel.data[1] = src[srcOffset + 1];
    pixel.data[2] = src[srcOffset + 2];
    pixel.data[3] = 255;
    offscreenCtx.putImageData(pixel, x, y);
  }

  function rebuildFromState() {
    fillWhite();
    for (let i = 0; i < TOTAL_PIXELS; i += 1) {
      if (isSold(i)) revealPixel(i);
    }
    render();
  }

  function clampOffsets() {
    const rect = viewer.getBoundingClientRect();
    const contentWidth = GRID_WIDTH * view.zoom;
    const contentHeight = GRID_HEIGHT * view.zoom;

    if (contentWidth <= rect.width) {
      view.offsetX = (rect.width - contentWidth) / 2;
    }
    if (contentHeight <= rect.height) {
      view.offsetY = (rect.height - contentHeight) / 2;
    }
  }

  function updateStats() {
    const sold = state.soldCount;
    const free = TOTAL_PIXELS - sold;
    const percent = (sold / TOTAL_PIXELS) * 100;
    const zoomPercent = Math.round(view.zoom * 100);

    soldCounterEl.textContent = `${formatNumber(sold)} / ${formatNumber(TOTAL_PIXELS)} verkauft`;
    progressTextEl.textContent = `${formatPercent(percent)} % sichtbar`;
    zoomTextEl.textContent = `Zoom ${zoomPercent} %`;

    statsSoldEl.textContent = formatNumber(sold);
    statsFreeEl.textContent = formatNumber(free);
    statsPercentEl.textContent = `${formatPercent(percent)} %`;
    statsZoomEl.textContent = `${zoomPercent} %`;
  }

  function render() {
    renderPending = false;
    const rect = viewer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const contentWidth = GRID_WIDTH * view.zoom;
    const contentHeight = GRID_HEIGHT * view.zoom;
    const contentX = view.offsetX;
    const contentY = view.offsetY;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(contentX, contentY, contentWidth, contentHeight);
    ctx.restore();

    ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(contentX, contentY, contentWidth, contentHeight);

    ctx.drawImage(
      offscreenCanvas,
      0,
      0,
      GRID_WIDTH,
      GRID_HEIGHT,
      contentX,
      contentY,
      contentWidth,
      contentHeight
    );
  }

  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    window.requestAnimationFrame(render);
  }

  function fitToView() {
    const rect = viewer.getBoundingClientRect();
    const scaleX = rect.width / GRID_WIDTH;
    const scaleY = rect.height / GRID_HEIGHT;
    view.zoom = Math.min(scaleX, scaleY);
    view.offsetX = (rect.width - GRID_WIDTH * view.zoom) / 2;
    view.offsetY = (rect.height - GRID_HEIGHT * view.zoom) / 2;
    updateStats();
    requestRender();
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = viewer.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const worldX = (localX - view.offsetX) / view.zoom;
    const worldY = (localY - view.offsetY) / view.zoom;

    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
    if (nextZoom === view.zoom) return;

    view.zoom = nextZoom;
    view.offsetX = localX - worldX * view.zoom;
    view.offsetY = localY - worldY * view.zoom;
    clampOffsets();
    updateStats();
    requestRender();
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openBuyModal() {
    openModal('buy-modal');
    window.setTimeout(() => {
      pixelCountInput.focus();
      pixelCountInput.select();
    }, 30);
  }

  function getBase64FromBytes(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function getBytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function getJsonStateObject() {
    return {
      version: 4,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      totalPixels: TOTAL_PIXELS,
      soldCount: state.soldCount,
      bitsBase64: getBase64FromBytes(state.bits),
      updatedAt: new Date().toISOString()
    };
  }

  function saveState() {
    const payload = JSON.stringify(getJsonStateObject());
    localStorage.setItem(STORAGE_KEY, payload);
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.version !== 3 && parsed.version !== 4)) return;
    if (parsed.width !== GRID_WIDTH || parsed.height !== GRID_HEIGHT) return;
    if (typeof parsed.soldCount !== 'number' || typeof parsed.bitsBase64 !== 'string') return;

    const restoredBits = getBytesFromBase64(parsed.bitsBase64);
    if (restoredBits.length !== state.bits.length) return;

    state.bits.set(restoredBits);
    state.soldCount = parsed.soldCount;
  }

  function exportStateAsJsonFile() {
    const json = JSON.stringify(getJsonStateObject(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pixel-canvas-state.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast('JSON wurde exportiert');
  }

  function getRandomUnsoldPixel() {
    if (state.soldCount >= TOTAL_PIXELS) return -1;

    for (let tries = 0; tries < 120; tries += 1) {
      const candidate = Math.floor(Math.random() * TOTAL_PIXELS);
      if (!isSold(candidate)) return candidate;
    }

    for (let i = 0; i < TOTAL_PIXELS; i += 1) {
      if (!isSold(i)) return i;
    }

    return -1;
  }

  function purchasePixels(count) {
    const requested = Number(count);
    if (!Number.isFinite(requested) || requested <= 0) {
      showToast('Bitte eine gültige Anzahl eingeben');
      return;
    }

    const freePixels = TOTAL_PIXELS - state.soldCount;
    if (freePixels <= 0) {
      showToast('Alle Pixel sind bereits verkauft');
      return;
    }

    const toBuy = Math.min(Math.floor(requested), freePixels);
    let changed = 0;

    for (let i = 0; i < toBuy; i += 1) {
      const pixelIndex = getRandomUnsoldPixel();
      if (pixelIndex === -1) break;
      markSold(pixelIndex);
      revealPixel(pixelIndex);
      changed += 1;
    }

    if (changed > 0) {
      state.soldCount += changed;
      saveState();
      updateStats();
      requestRender();
      showToast(`${formatNumber(changed)} Pixel wurden gekauft`);
    }

    if (state.soldCount >= TOTAL_PIXELS) {
      showToast('Alle Pixel sind verkauft. Das Bild ist vollständig sichtbar.');
    }
  }

  function resetState() {
    state.bits.fill(0);
    state.soldCount = 0;
    fillWhite();
    saveState();
    updateStats();
    requestRender();
    showToast('Lokaler Status wurde zurückgesetzt');
  }

  function loadImage() {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        sourceCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
        sourceCtx.drawImage(image, 0, 0, GRID_WIDTH, GRID_HEIGHT);
        sourceImageData = sourceCtx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
        resolve();
      };
      image.onerror = () => {
        reject(new Error(`${IMAGE_FILE} konnte nicht geladen werden.`));
      };
      image.src = IMAGE_FILE;
    });
  }

  function isControlTarget(target) {
    return Boolean(target.closest('[data-ui-control="true"], button, input, .modal, .overlay.open'));
  }

  function startDragging(event) {
    if (event.button !== 0) return;
    if (isControlTarget(event.target)) return;

    view.dragging = true;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    view.pointerId = event.pointerId;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(event.pointerId);
  }

  function duringDragging(event) {
    if (!view.dragging) return;

    const dx = event.clientX - view.lastX;
    const dy = event.clientY - view.lastY;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    view.offsetX += dx;
    view.offsetY += dy;
    clampOffsets();
    requestRender();
  }

  function stopDragging(event) {
    if (!view.dragging) return;
    view.dragging = false;
    canvas.classList.remove('dragging');
    if (event && event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    view.pointerId = null;
  }

  function bindModalEvents() {
    document.querySelectorAll('[data-open-modal]').forEach((button) => {
      button.onclick = () => openModal(button.dataset.openModal);
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.onclick = () => closeModal(button.closest('.overlay'));
    });

    document.querySelectorAll('.overlay').forEach((overlay) => {
      overlay.onclick = (event) => {
        if (event.target === overlay) closeModal(overlay);
      };
    });
  }

  function bindUiEvents() {
    buyButton.onclick = (event) => {
      event.stopPropagation();
      openBuyModal();
    };

    confirmBuyButton.onclick = () => {
      purchasePixels(pixelCountInput.value);
      closeModal(document.getElementById('buy-modal'));
    };

    zoomInButton.onclick = (event) => {
      event.stopPropagation();
      const rect = viewer.getBoundingClientRect();
      zoomAt(ZOOM_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    zoomOutButton.onclick = (event) => {
      event.stopPropagation();
      const rect = viewer.getBoundingClientRect();
      zoomAt(1 / ZOOM_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    fitViewButton.onclick = fitToView;
    exportJsonButton.onclick = exportStateAsJsonFile;
    resetButton.onclick = () => {
      if (window.confirm('Soll der lokale Status wirklich zurückgesetzt werden?')) {
        resetState();
      }
    };

    pixelCountInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        purchasePixels(pixelCountInput.value);
        closeModal(document.getElementById('buy-modal'));
      }
    });

    viewer.addEventListener('wheel', (event) => {
      if (document.querySelector('.overlay.open')) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_FACTOR : (1 / ZOOM_FACTOR);
      zoomAt(factor, event.clientX, event.clientY);
    }, { passive: false });

    canvas.addEventListener('pointerdown', startDragging);
    canvas.addEventListener('pointermove', duringDragging);
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') stopDragging(event);
    });

    window.addEventListener('resize', () => {
      clampOffsets();
      requestRender();
    });
  }

  async function init() {
    try {
      bindModalEvents();
      bindUiEvents();
      loadState();
      fillWhite();
      await loadImage();
      rebuildFromState();
      fitToView();
      updateStats();
      window.pixelCanvasApp = {
        version: 4,
        openBuyModal,
        purchasePixels,
        saveState,
        exportStateAsJsonFile,
        resetState,
        getState: () => getJsonStateObject(),
        getView: () => ({ ...view })
      };
    } catch (error) {
      console.error(error);
      showToast(error && error.message ? error.message : 'Fehler beim Starten der Anwendung');
    }
  }

  init();
})();
