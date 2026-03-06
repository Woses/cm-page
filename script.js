const GRID_WIDTH = 1000;
const GRID_HEIGHT = 1000;
const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;
const ZOOM_STEP = 1.15;
const DB_NAME = 'pixelRevealDemoDB';
const STORE_NAME = 'stateStore';
const STATE_ID = 'main';
const BITSET_BYTES = Math.ceil(TOTAL_PIXELS / 8);

const canvas = document.getElementById('pixel-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const viewer = document.getElementById('viewer');
const toast = document.getElementById('toast');

const soldCounterEl = document.getElementById('sold-counter');
const progressTextEl = document.getElementById('progress-text');
const zoomTextEl = document.getElementById('zoom-text');
const statsSoldEl = document.getElementById('stats-sold');
const statsFreeEl = document.getElementById('stats-free');
const statsVisibleEl = document.getElementById('stats-visible');
const statsStatusEl = document.getElementById('stats-status');
const pixelCountInput = document.getElementById('pixel-count-input');

const revealCanvas = document.createElement('canvas');
revealCanvas.width = GRID_WIDTH;
revealCanvas.height = GRID_HEIGHT;
const revealCtx = revealCanvas.getContext('2d', { alpha: false, willReadFrequently: true });

const sourceCanvas = document.createElement('canvas');
sourceCanvas.width = GRID_WIDTH;
sourceCanvas.height = GRID_HEIGHT;
const sourceCtx = sourceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });

let db = null;
let sourceImageData = null;
let renderQueued = false;
let imageLoaded = false;

const state = {
  soldCount: 0,
  bits: new Uint8Array(BITSET_BYTES)
};

const view = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0
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

function setToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function isSold(index) {
  return ((state.bits[index >> 3] >> (index & 7)) & 1) === 1;
}

function setSold(index) {
  state.bits[index >> 3] |= 1 << (index & 7);
}

function clearAllSold() {
  state.bits = new Uint8Array(BITSET_BYTES);
  state.soldCount = 0;
}

function fillRevealWhite() {
  revealCtx.save();
  revealCtx.setTransform(1, 0, 0, 1, 0, 0);
  revealCtx.fillStyle = '#ffffff';
  revealCtx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
  revealCtx.restore();
}

function revealSinglePixel(index) {
  if (!sourceImageData) {
    return;
  }

  const x = index % GRID_WIDTH;
  const y = Math.floor(index / GRID_WIDTH);
  const srcOffset = index * 4;
  const pixel = sourceImageData.data;
  const rgba = revealCtx.createImageData(1, 1);
  rgba.data[0] = pixel[srcOffset];
  rgba.data[1] = pixel[srcOffset + 1];
  rgba.data[2] = pixel[srcOffset + 2];
  rgba.data[3] = 255;
  revealCtx.putImageData(rgba, x, y);
}

function rebuildRevealCanvas() {
  fillRevealWhite();

  if (!sourceImageData) {
    requestRender();
    return;
  }

  for (let i = 0; i < TOTAL_PIXELS; i += 1) {
    if (isSold(i)) {
      revealSinglePixel(i);
    }
  }

  requestRender();
}

function updateStats() {
  const sold = state.soldCount;
  const free = TOTAL_PIXELS - sold;
  const visiblePercent = (sold / TOTAL_PIXELS) * 100;

  soldCounterEl.textContent = `${formatNumber(sold)} / ${formatNumber(TOTAL_PIXELS)} verkauft`;
  progressTextEl.textContent = `${formatPercent(visiblePercent)} % sichtbar`;
  zoomTextEl.textContent = `Zoom ${Math.round(view.zoom * 100)} %`;

  statsSoldEl.textContent = formatNumber(sold);
  statsFreeEl.textContent = formatNumber(free);
  statsVisibleEl.textContent = `${formatPercent(visiblePercent)} %`;
  statsStatusEl.textContent = imageLoaded ? 'testbild.jpg geladen' : 'testbild.jpg nicht geladen';
}

function requestRender() {
  if (renderQueued) {
    return;
  }

  renderQueued = true;
  requestAnimationFrame(drawViewer);
}

function drawViewer() {
  renderQueued = false;

  const rect = viewer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(rect.width * dpr));
  const targetHeight = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.drawImage(
    revealCanvas,
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

function fitView() {
  const rect = viewer.getBoundingClientRect();
  const zoomX = rect.width / GRID_WIDTH;
  const zoomY = rect.height / GRID_HEIGHT;
  view.zoom = Math.min(zoomX, zoomY);
  view.offsetX = (rect.width - GRID_WIDTH * view.zoom) / 2;
  view.offsetY = (rect.height - GRID_HEIGHT * view.zoom) / 2;
  updateStats();
  requestRender();
}

function clampOffsets() {
  const rect = viewer.getBoundingClientRect();
  const scaledWidth = GRID_WIDTH * view.zoom;
  const scaledHeight = GRID_HEIGHT * view.zoom;

  if (scaledWidth <= rect.width) {
    view.offsetX = (rect.width - scaledWidth) / 2;
  }

  if (scaledHeight <= rect.height) {
    view.offsetY = (rect.height - scaledHeight) / 2;
  }
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
  requestRender();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    return;
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
  if (!modal) {
    return;
  }

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function bindModalEvents() {
  document.querySelectorAll('[data-open-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      openModal(button.dataset.openModal);
    });
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.closest('.modal-backdrop'));
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeModal(backdrop);
      }
    });
  });
}

function bindViewerEvents() {
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    const rect = viewer.getBoundingClientRect();
    zoomAt(ZOOM_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    const rect = viewer.getBoundingClientRect();
    zoomAt(1 / ZOOM_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  document.getElementById('fit-view-btn').addEventListener('click', fitView);
  document.getElementById('buy-button').addEventListener('click', () => openModal('buy-modal'));

  document.getElementById('confirm-buy-btn').addEventListener('click', async () => {
    const amount = Number(pixelCountInput.value);
    await simulatePurchase(amount);
    closeModal(document.getElementById('buy-modal'));
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    const confirmed = window.confirm('Soll die Demo wirklich zurückgesetzt werden?');
    if (!confirmed) {
      return;
    }

    clearAllSold();
    rebuildRevealCanvas();
    updateStats();
    await saveState();
    setToast('Demo zurückgesetzt');
  });

  viewer.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(factor, event.clientX, event.clientY);
  }, { passive: false });

  viewer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    view.dragging = true;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    canvas.classList.add('dragging');
    viewer.setPointerCapture(event.pointerId);
  });

  viewer.addEventListener('pointermove', (event) => {
    if (!view.dragging) {
      return;
    }

    const dx = event.clientX - view.lastX;
    const dy = event.clientY - view.lastY;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    view.offsetX += dx;
    view.offsetY += dy;
    clampOffsets();
    requestRender();
  });

  const endDrag = (event) => {
    if (!view.dragging) {
      return;
    }

    view.dragging = false;
    canvas.classList.remove('dragging');

    if (event && typeof event.pointerId === 'number' && viewer.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }
  };

  viewer.addEventListener('pointerup', endDrag);
  viewer.addEventListener('pointercancel', endDrag);
  viewer.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') {
      endDrag(event);
    }
  });

  window.addEventListener('resize', () => {
    clampOffsets();
    requestRender();
  });
}

function getRandomUnsoldPixel() {
  if (state.soldCount >= TOTAL_PIXELS) {
    return -1;
  }

  for (let tries = 0; tries < 120; tries += 1) {
    const index = Math.floor(Math.random() * TOTAL_PIXELS);
    if (!isSold(index)) {
      return index;
    }
  }

  for (let index = 0; index < TOTAL_PIXELS; index += 1) {
    if (!isSold(index)) {
      return index;
    }
  }

  return -1;
}

async function simulatePurchase(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    setToast('Bitte eine gültige Pixelanzahl eingeben');
    return;
  }

  const freePixels = TOTAL_PIXELS - state.soldCount;
  if (freePixels <= 0) {
    setToast('Alle Pixel sind bereits verkauft');
    return;
  }

  const purchaseCount = Math.min(Math.floor(amount), freePixels);
  let changed = 0;

  for (let i = 0; i < purchaseCount; i += 1) {
    const pixelIndex = getRandomUnsoldPixel();
    if (pixelIndex === -1) {
      break;
    }

    setSold(pixelIndex);
    revealSinglePixel(pixelIndex);
    changed += 1;
  }

  if (changed > 0) {
    state.soldCount += changed;
    updateStats();
    requestRender();
    await saveState();
    setToast(`${formatNumber(changed)} Pixel gekauft`);
  }

  if (state.soldCount >= TOTAL_PIXELS) {
    setToast('Alle Pixel sind verkauft. Das Bild ist vollständig sichtbar.');
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  if (!db) {
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const record = await requestToPromise(store.get(STATE_ID));

  if (!record) {
    return;
  }

  if (typeof record.soldCount === 'number') {
    state.soldCount = record.soldCount;
  }

  if (record.bits) {
    state.bits = new Uint8Array(record.bits);
  }
}

async function saveState() {
  if (!db) {
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await requestToPromise(store.put({
    id: STATE_ID,
    soldCount: state.soldCount,
    bits: state.bits.buffer.slice(0)
  }));
}

async function loadImage() {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      sourceCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
      sourceCtx.drawImage(image, 0, 0, GRID_WIDTH, GRID_HEIGHT);
      sourceImageData = sourceCtx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
      imageLoaded = true;
      resolve();
    };

    image.onerror = () => {
      imageLoaded = false;
      reject(new Error('testbild.jpg konnte nicht geladen werden. Bitte Datei und Pfad prüfen.'));
    };

    image.src = 'testbild.jpg';
  });
}

async function init() {
  fillRevealWhite();
  updateStats();
  bindModalEvents();
  bindViewerEvents();
  fitView();

  try {
    db = await openDb();
    await loadState();
  } catch (error) {
    console.error(error);
    setToast('IndexedDB konnte nicht geöffnet werden');
  }

  try {
    await loadImage();
  } catch (error) {
    console.error(error);
    setToast(error.message);
  }

  rebuildRevealCanvas();
  updateStats();
  requestRender();
}

init();
