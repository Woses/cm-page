(() => {
  'use strict';

  const GRID_WIDTH = 1000;
  const GRID_HEIGHT = 1000;
  const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;
  const STORAGE_KEY = 'pixelCanvasStateJsonV2';
  const BITSET_SIZE = Math.ceil(TOTAL_PIXELS / 8);
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 40;
  const ZOOM_FACTOR = 1.15;

  const state = {
    soldCount: 0,
    bits: new Uint8Array(BITSET_SIZE)
  };

  const view = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  };

  let sourceImageData = null;
  let renderScheduled = false;
  let appReady = false;
  let toastTimer = null;

  let canvas;
  let ctx;
  let viewer;
  let buyButton;
  let confirmBuyButton;
  let pixelCountInput;
  let toastElement;
  let soldCounterElement;
  let progressTextElement;
  let zoomTextElement;
  let statsSoldElement;
  let statsFreeElement;
  let statsPercentElement;
  let statsStorageElement;

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = GRID_WIDTH;
  offscreenCanvas.height = GRID_HEIGHT;
  const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = GRID_WIDTH;
  sourceCanvas.height = GRID_HEIGHT;
  const sourceCtx = sourceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });

  function byId(id) {
    return document.getElementById(id);
  }

  function bindElements() {
    canvas = byId('pixel-canvas');
    viewer = byId('viewer');
    buyButton = byId('buy-button');
    confirmBuyButton = byId('confirm-buy-button');
    pixelCountInput = byId('pixel-count-input');
    toastElement = byId('toast');
    soldCounterElement = byId('sold-counter');
    progressTextElement = byId('progress-text');
    zoomTextElement = byId('zoom-text');
    statsSoldElement = byId('stats-sold');
    statsFreeElement = byId('stats-free');
    statsPercentElement = byId('stats-percent');
    statsStorageElement = byId('stats-storage');

    if (!canvas || !viewer || !buyButton || !confirmBuyButton || !pixelCountInput) {
      throw new Error('Wichtige DOM Elemente fehlen. Bitte index.html vollständig hochladen.');
    }

    ctx = canvas.getContext('2d', { alpha: false });
    offscreenCtx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;
  }

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
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElement.classList.remove('show');
    }, 2200);
  }

  function openModal(id) {
    const modal = byId(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function fillWhiteCanvas() {
    offscreenCtx.setTransform(1, 0, 0, 1, 0, 0);
    offscreenCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
    offscreenCtx.fillStyle = '#ffffff';
    offscreenCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
  }

  function isSold(index) {
    return ((state.bits[index >> 3] >> (index & 7)) & 1) === 1;
  }

  function markSold(index) {
    state.bits[index >> 3] |= 1 << (index & 7);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function serializeState() {
    return JSON.stringify({
      version: 2,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      soldCount: state.soldCount,
      bitsetBase64: bytesToBase64(state.bits)
    });
  }

  function saveState() {
    const json = serializeState();
    localStorage.setItem(STORAGE_KEY, json);
    return json;
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveState();
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed.width !== GRID_WIDTH || parsed.height !== GRID_HEIGHT) {
        throw new Error('Falsche Canvas Größe im Speicher');
      }
      const bytes = base64ToBytes(parsed.bitsetBase64 || '');
      if (bytes.length !== BITSET_SIZE) {
        throw new Error('Falsche Bitset Länge');
      }

      state.bits.set(bytes);
      state.soldCount = Math.max(0, Math.min(TOTAL_PIXELS, Math.floor(parsed.soldCount || 0)));
    } catch (error) {
      console.warn('Lokaler Status war ungültig und wurde zurückgesetzt.', error);
      state.bits.fill(0);
      state.soldCount = 0;
      saveState();
    }
  }

  function exportStateAsJsonFile() {
    const json = serializeState();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `pixel-status-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('JSON wurde exportiert');
  }

  function revealPixel(index) {
    if (!sourceImageData) return;
    const x = index % GRID_WIDTH;
    const y = Math.floor(index / GRID_WIDTH);
    const offset = index * 4;
    const src = sourceImageData.data;
    offscreenCtx.fillStyle = `rgb(${src[offset]}, ${src[offset + 1]}, ${src[offset + 2]})`;
    offscreenCtx.fillRect(x, y, 1, 1);
  }

  function rebuildCanvasFromState() {
    fillWhiteCanvas();
    if (!sourceImageData || state.soldCount === 0) {
      scheduleRender();
      return;
    }

    for (let index = 0; index < TOTAL_PIXELS; index++) {
      if (isSold(index)) revealPixel(index);
    }
    scheduleRender();
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
    const raw = localStorage.getItem(STORAGE_KEY) || serializeState();
    const estimatedKb = `${(new Blob([raw]).size / 1024).toFixed(1)} KB`;

    soldCounterElement.textContent = `${formatNumber(sold)} / ${formatNumber(TOTAL_PIXELS)} verkauft`;
    progressTextElement.textContent = `${formatPercent(percent)} % sichtbar`;
    zoomTextElement.textContent = `Zoom ${Math.round(view.zoom * 100)} %`;
    statsSoldElement.textContent = formatNumber(sold);
    statsFreeElement.textContent = formatNumber(free);
    statsPercentElement.textContent = `${formatPercent(percent)} %`;
    statsStorageElement.textContent = estimatedKb;
  }

  function fitToView() {
    const rect = viewer.getBoundingClientRect();
    const zoomX = rect.width / GRID_WIDTH;
    const zoomY = rect.height / GRID_HEIGHT;
    view.zoom = Math.min(zoomX, zoomY);
    view.offsetX = (rect.width - GRID_WIDTH * view.zoom) / 2;
    view.offsetY = (rect.height - GRID_HEIGHT * view.zoom) / 2;
    updateStats();
    scheduleRender();
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = viewer.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const worldX = (localX - view.offsetX) / view.zoom;
    const worldY = (localY - view.offsetY) / view.zoom;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));

    view.zoom = nextZoom;
    view.offsetX = localX - worldX * view.zoom;
    view.offsetY = localY - worldY * view.zoom;
    clampOffsets();
    updateStats();
    scheduleRender();
  }

  function draw() {
    renderScheduled = false;
    const rect = viewer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      offscreenCanvas,
      0,
      0,
      GRID_WIDTH,
      GRID_HEIGHT,
      view.offsetX,
      view.offsetY,
      GRID_WIDTH * view.zoom,
      GRID_HEIGHT * view.zoom
    );
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(draw);
  }

  function getRandomUnsoldIndex() {
    if (state.soldCount >= TOTAL_PIXELS) return -1;

    for (let tries = 0; tries < 200; tries++) {
      const candidate = Math.floor(Math.random() * TOTAL_PIXELS);
      if (!isSold(candidate)) return candidate;
    }

    for (let index = 0; index < TOTAL_PIXELS; index++) {
      if (!isSold(index)) return index;
    }

    return -1;
  }

  function purchasePixels(count) {
    if (!appReady) {
      showToast('Bild wird noch geladen');
      return;
    }

    const requested = Number(count);
    if (!Number.isFinite(requested) || requested < 1) {
      showToast('Bitte eine gültige Anzahl eingeben');
      return;
    }

    const available = TOTAL_PIXELS - state.soldCount;
    if (available <= 0) {
      showToast('Alle Pixel sind bereits verkauft');
      return;
    }

    const amount = Math.min(available, Math.floor(requested));
    let changed = 0;

    for (let i = 0; i < amount; i++) {
      const index = getRandomUnsoldIndex();
      if (index === -1) break;
      markSold(index);
      revealPixel(index);
      changed += 1;
    }

    if (changed > 0) {
      state.soldCount += changed;
      saveState();
      updateStats();
      scheduleRender();
      showToast(`${formatNumber(changed)} Pixel gekauft`);
    }

    if (state.soldCount >= TOTAL_PIXELS) {
      showToast('Alle Pixel sind verkauft. Das Bild ist komplett sichtbar.');
    }
  }

  function resetState() {
    state.soldCount = 0;
    state.bits.fill(0);
    fillWhiteCanvas();
    saveState();
    updateStats();
    scheduleRender();
    showToast('Lokaler Status wurde zurückgesetzt');
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
    buyButton.onclick = () => {
      openModal('buy-modal');
      pixelCountInput.focus();
      pixelCountInput.select();
    };

    confirmBuyButton.onclick = () => {
      purchasePixels(pixelCountInput.value);
      closeModal(byId('buy-modal'));
    };

    byId('zoom-in-button').onclick = () => {
      const rect = viewer.getBoundingClientRect();
      zoomAt(ZOOM_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    byId('zoom-out-button').onclick = () => {
      const rect = viewer.getBoundingClientRect();
      zoomAt(1 / ZOOM_FACTOR, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    byId('fit-view-button').onclick = fitToView;
    byId('export-json-button').onclick = exportStateAsJsonFile;
    byId('reset-button').onclick = () => {
      if (window.confirm('Soll der lokale Status wirklich zurückgesetzt werden?')) {
        resetState();
      }
    };

    viewer.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      zoomAt(factor, event.clientX, event.clientY);
    }, { passive: false });

    viewer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      view.dragging = true;
      view.lastX = event.clientX;
      view.lastY = event.clientY;
      canvas.classList.add('dragging');
      viewer.setPointerCapture(event.pointerId);
    });

    viewer.addEventListener('pointermove', (event) => {
      if (!view.dragging) return;
      view.offsetX += event.clientX - view.lastX;
      view.offsetY += event.clientY - view.lastY;
      view.lastX = event.clientX;
      view.lastY = event.clientY;
      clampOffsets();
      scheduleRender();
    });

    const stopDragging = (event) => {
      if (!view.dragging) return;
      view.dragging = false;
      canvas.classList.remove('dragging');
      if (event && typeof event.pointerId === 'number' && viewer.hasPointerCapture(event.pointerId)) {
        viewer.releasePointerCapture(event.pointerId);
      }
    };

    viewer.addEventListener('pointerup', stopDragging);
    viewer.addEventListener('pointercancel', stopDragging);
    window.addEventListener('resize', () => {
      clampOffsets();
      scheduleRender();
    });
  }

  function loadSourceImage() {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        sourceCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
        sourceCtx.drawImage(image, 0, 0, GRID_WIDTH, GRID_HEIGHT);
        sourceImageData = sourceCtx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
        rebuildCanvasFromState();
        appReady = true;
        resolve();
      };
      image.onerror = () => {
        console.warn('testbild.jpg konnte nicht geladen werden. Die Oberfläche bleibt trotzdem funktionsfähig.');
        appReady = true;
        rebuildCanvasFromState();
        showToast('testbild.jpg konnte nicht geladen werden');
        resolve();
      };
      image.src = 'testbild.jpg';
    });
  }

  async function init() {
    bindElements();
    fillWhiteCanvas();
    bindModalEvents();
    bindUiEvents();
    loadState();
    fitToView();
    updateStats();
    rebuildCanvasFromState();
    await loadSourceImage();
    updateStats();
    scheduleRender();

    window.pixelCanvasApp = {
      version: 2,
      openBuyModal: () => openModal('buy-modal'),
      purchasePixels,
      saveState,
      exportStateAsJsonFile,
      resetState,
      getState: () => ({ soldCount: state.soldCount, storageKey: STORAGE_KEY })
    };

    console.log('Pixel Canvas App v2 bereit');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
