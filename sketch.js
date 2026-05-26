const STORAGE_KEY = "mosaico_p5_settings_v1";
const OUTPUT_WIDTH = 1440;
const OUTPUT_HEIGHT = 1080;
const BUILTIN_TILE_COUNT = 32;
const BUILTIN_TILE_SIZE = 256;
const DEFAULT_SETTINGS = {
  intervalSeconds: 12,
  cols: 28,
  rows: 20,
  fastMode: false,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  prepSeconds: 3,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  cameraReady: false,
  cameraFeed: null,
  canvas: null,
  finalGraphic: null,
  partialGraphic: null,
  tiles: [],
  userTiles: [],
  builtinTiles: [],
  tileLoadTotal: 0,
  tileLoadDone: 0,
  tileLoadLabel: "Tiles padrão",
  autoMode: false,
  autoScheduledAt: 0,
  preparingUntil: 0,
  captureReason: null,
  captureBusy: false,
  buildProgress: 0,
  currentPhase: "Inicializando",
  currentMessage: "Carregando interface",
  lastCaptureLabel: "Nenhuma",
  nextCaptureLabel: "--",
  presentation: false,
};

const ui = {};

function setup() {
  pixelDensity(1);
  textFont("Space Grotesk");
  state.settings = loadSettings();
  bindUi();
  initCamera();
  state.builtinTiles = buildBuiltinTiles();
  rebuildTileSet();
  fitCanvas();
  updateAllUi();
  window.addEventListener("fullscreenchange", syncPresentationState);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("beforeunload", persistSettings);
}

function draw() {
  syncCameraState();
  tickScheduler();
  renderStage();
  updateDynamicUi();
}

function windowResized() {
  fitCanvas();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return {
      intervalSeconds: clampNumber(parsed.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds, 1, 3600),
      cols: clampNumber(parsed.cols, DEFAULT_SETTINGS.cols, 4, 120),
      rows: clampNumber(parsed.rows, DEFAULT_SETTINGS.rows, 4, 120),
      fastMode: Boolean(parsed.fastMode),
      brightness: clampNumber(parsed.brightness, DEFAULT_SETTINGS.brightness, 0.5, 1.5),
      contrast: clampNumber(parsed.contrast, DEFAULT_SETTINGS.contrast, 0.5, 1.8),
      saturation: clampNumber(parsed.saturation, DEFAULT_SETTINGS.saturation, 0, 2.5),
      prepSeconds: clampNumber(parsed.prepSeconds, DEFAULT_SETTINGS.prepSeconds, 0, 10),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    // ignore storage failures
  }
}

function bindUi() {
  ui.cameraStatus = document.getElementById("camera-status");
  ui.tilesStatus = document.getElementById("tiles-status");
  ui.autoStatus = document.getElementById("auto-status");
  ui.stageMeta = document.getElementById("stage-meta");
  ui.cameraFeedState = document.getElementById("camera-feed-state");
  ui.folderName = document.getElementById("folder-name");
  ui.phaseLabel = document.getElementById("phase-label");
  ui.countdownLabel = document.getElementById("countdown-label");
  ui.lastCaptureLabel = document.getElementById("last-capture-label");
  ui.tilesProgressFill = document.getElementById("tiles-progress-fill");
  ui.buildProgressFill = document.getElementById("build-progress-fill");
  ui.tilesProgressLabel = document.getElementById("tiles-progress-label");
  ui.buildProgressLabel = document.getElementById("build-progress-label");
  ui.intervalInput = document.getElementById("interval-input");
  ui.prepInput = document.getElementById("prep-input");
  ui.colsInput = document.getElementById("cols-input");
  ui.rowsInput = document.getElementById("rows-input");
  ui.fastInput = document.getElementById("fast-input");
  ui.brightnessInput = document.getElementById("brightness-input");
  ui.contrastInput = document.getElementById("contrast-input");
  ui.saturationInput = document.getElementById("saturation-input");
  ui.brightnessValue = document.getElementById("brightness-value");
  ui.contrastValue = document.getElementById("contrast-value");
  ui.saturationValue = document.getElementById("saturation-value");
  ui.pickFolderButton = document.getElementById("pick-folder-button");
  ui.folderInput = document.getElementById("tile-folder-input");
  ui.autoToggleButton = document.getElementById("auto-toggle-button");
  ui.captureButton = document.getElementById("capture-button");
  ui.saveButton = document.getElementById("save-button");
  ui.fullscreenButton = document.getElementById("fullscreen-button");

  bindDeferredNumberInput(ui.intervalInput, {
    key: "intervalSeconds",
    fallback: DEFAULT_SETTINGS.intervalSeconds,
    minValue: 1,
    maxValue: 3600,
  });

  bindDeferredNumberInput(ui.prepInput, {
    key: "prepSeconds",
    fallback: DEFAULT_SETTINGS.prepSeconds,
    minValue: 0,
    maxValue: 10,
  });

  bindDeferredNumberInput(ui.colsInput, {
    key: "cols",
    fallback: DEFAULT_SETTINGS.cols,
    minValue: 4,
    maxValue: 120,
  });

  bindDeferredNumberInput(ui.rowsInput, {
    key: "rows",
    fallback: DEFAULT_SETTINGS.rows,
    minValue: 4,
    maxValue: 120,
  });

  ui.fastInput.addEventListener("change", () => {
    state.settings.fastMode = ui.fastInput.checked;
    persistSettings();
    updateAllUi();
  });

  ui.brightnessInput.addEventListener("input", () => {
    state.settings.brightness = clampNumber(ui.brightnessInput.value, DEFAULT_SETTINGS.brightness, 0.5, 1.5);
    persistSettings();
    updateAllUi();
  });

  ui.contrastInput.addEventListener("input", () => {
    state.settings.contrast = clampNumber(ui.contrastInput.value, DEFAULT_SETTINGS.contrast, 0.5, 1.8);
    persistSettings();
    updateAllUi();
  });

  ui.saturationInput.addEventListener("input", () => {
    state.settings.saturation = clampNumber(ui.saturationInput.value, DEFAULT_SETTINGS.saturation, 0, 2.5);
    persistSettings();
    updateAllUi();
  });

  ui.pickFolderButton.addEventListener("click", () => ui.folderInput.click());
  ui.folderInput.addEventListener("change", handleFolderSelection);
  ui.autoToggleButton.addEventListener("click", toggleAutoMode);
  ui.captureButton.addEventListener("click", () => requestCapture("manual"));
  ui.saveButton.addEventListener("click", saveCurrentMosaic);
  ui.fullscreenButton.addEventListener("click", toggleFullscreen);
}

function bindDeferredNumberInput(inputElement, options) {
  const { key, fallback, minValue, maxValue } = options;

  const commit = () => {
    const raw = (inputElement.value || "").trim();
    if (raw.length === 0) {
      inputElement.value = state.settings[key];
      return;
    }
    state.settings[key] = clampNumber(raw, fallback, minValue, maxValue);
    inputElement.value = state.settings[key];
    persistSettings();
    updateAllUi();
  };

  inputElement.addEventListener("input", () => {
    // Keep typing smooth. Limits are applied only when the user confirms input.
  });

  inputElement.addEventListener("blur", commit);
  inputElement.addEventListener("change", commit);
  inputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commit();
      inputElement.blur();
    }
    if (event.key === "Escape") {
      inputElement.value = state.settings[key];
      inputElement.blur();
    }
  });
}

function initCamera() {
  state.cameraFeed = createCapture(
    {
      video: {
        facingMode: "user",
      },
      audio: false,
    },
    () => {
      state.cameraReady = true;
      state.currentPhase = "Câmera ativa";
      state.currentMessage = "Preview pronto";
      updateAllUi();
    }
  );
  state.cameraFeed.parent("camera-slot");
  state.cameraFeed.elt.classList.add("camera-feed");
  state.cameraFeed.elt.setAttribute("playsinline", "true");
  state.cameraFeed.elt.setAttribute("muted", "true");
  state.cameraFeed.size(320, 240);
}

function buildBuiltinTiles() {
  const palette = [];
  for (let index = 0; index < BUILTIN_TILE_COUNT; index += 1) {
    const tile = createGraphics(BUILTIN_TILE_SIZE, BUILTIN_TILE_SIZE);
    tile.pixelDensity(1);
    const hue = map(index, 0, BUILTIN_TILE_COUNT - 1, 8, 348);
    const saturation = 52 + ((index % 4) * 8);
    const lightness = 28 + ((index % 6) * 6);
    tile.background(hslToRgb(hue, saturation, lightness));
    tile.noStroke();
    tile.fill(255, 255, 255, 16);
    tile.rect(0, 0, BUILTIN_TILE_SIZE, BUILTIN_TILE_SIZE);
    tile.fill(0, 0, 0, 22);
    tile.rect(0, 0, BUILTIN_TILE_SIZE, BUILTIN_TILE_SIZE / 2);
    tile.stroke(255, 255, 255, 18);
    tile.strokeWeight(2);
    tile.line(0, 0, BUILTIN_TILE_SIZE, BUILTIN_TILE_SIZE);
    tile.line(BUILTIN_TILE_SIZE, 0, 0, BUILTIN_TILE_SIZE);
    tile.noStroke();
    tile.fill(255, 255, 255, 22);
    tile.circle(BUILTIN_TILE_SIZE * 0.72, BUILTIN_TILE_SIZE * 0.28, BUILTIN_TILE_SIZE * 0.16);

    const avg = readAverageColor(tile);
    palette.push({
      id: `builtin-${index}`,
      name: `builtin-${index}`,
      image: tile,
      avg,
      luma: colorLuma(avg),
      source: "builtin",
    });
  }
  return palette;
}

function rebuildTileSet() {
  state.tiles = [...state.userTiles, ...state.builtinTiles];
  state.tiles.sort((left, right) => left.luma - right.luma);
  state.tileLoadDone = state.userTiles.length || state.builtinTiles.length;
  state.tileLoadTotal = state.userTiles.length || state.builtinTiles.length || 1;
  state.tileLoadLabel = state.userTiles.length ? `${state.userTiles.length} tiles da pasta` : "Tiles padrão";
  updateAllUi();
}

function handleFolderSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }
  loadTilesFromFiles(files);
  event.target.value = "";
}

async function loadTilesFromFiles(files) {
  const imageFiles = files
    .filter((file) => isProbablyImage(file))
    .map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "pt-BR", { sensitivity: "base" }));

  if (!imageFiles.length) {
    state.tileLoadLabel = "Nenhuma imagem encontrada";
    updateAllUi();
    return;
  }

  state.currentPhase = "Carregando tiles";
  state.currentMessage = "Lendo pasta e subpastas selecionadas";
  state.tileLoadTotal = imageFiles.length;
  state.tileLoadDone = 0;
  state.userTiles = [];
  updateAllUi();

  const loaded = [];
  await Promise.all(
    imageFiles.map(async ({ file, relativePath }) => {
      const tile = await loadTileFile(file, relativePath);
      state.tileLoadDone += 1;
      if (tile) {
        loaded.push(tile);
      }
      updateAllUi();
    })
  );

  state.userTiles = loaded;
  state.tileLoadLabel = loaded.length ? `${loaded.length} tiles carregados` : "Falha ao carregar tiles";
  state.currentPhase = loaded.length ? "Tiles prontos" : "Pronto";
  state.currentMessage = loaded.length ? "Tiles e subpastas disponíveis para mosaico" : "Mantendo tiles padrão";
  rebuildTileSet();
  persistSettings();
}

async function loadTileFile(file, relativePath) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageAsync(url);
    const maxSide = BUILTIN_TILE_SIZE * 2;
    if (image.width > maxSide || image.height > maxSide) {
      image.resize(maxSide, 0);
      if (image.height > maxSide) {
        image.resize(0, maxSide);
      }
    }
    const avg = readAverageColor(image);
    return {
      id: `${relativePath}-${file.size}-${file.lastModified}`,
      name: file.name,
      relativePath,
      image,
      avg,
      luma: colorLuma(avg),
      source: "user",
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageAsync(url) {
  return new Promise((resolve, reject) => {
    loadImage(
      url,
      (image) => resolve(image),
      () => reject(new Error("Falha ao ler imagem"))
    );
  });
}

function isProbablyImage(file) {
  if (file.type && file.type.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || "");
}

function toggleAutoMode() {
  state.autoMode = !state.autoMode;
  if (state.autoMode) {
    scheduleNextAutoCapture(state.settings.intervalSeconds * 1000);
    state.currentPhase = "Ciclo automático";
    state.currentMessage = "Aguardando intervalo";
  } else {
    state.autoScheduledAt = 0;
    if (!state.captureBusy) {
      state.currentPhase = "Pronto";
      state.currentMessage = "Aguardando ação";
    }
  }
  updateAllUi();
}

function scheduleNextAutoCapture(delayMs) {
  state.autoScheduledAt = millis() + delayMs;
}

async function requestCapture(reason) {
  if (state.captureBusy) {
    return;
  }
  state.captureReason = reason;
  const prepSeconds = Math.max(0, Number(state.settings.prepSeconds) || 0);
  if (prepSeconds > 0) {
    beginPreparedCapture(reason);
    return;
  }
  await performCapture(reason);
}

function beginPreparedCapture(reason) {
  const prepSeconds = Math.max(0, Number(state.settings.prepSeconds) || 0);
  state.captureReason = reason;
  state.preparingUntil = millis() + prepSeconds * 1000;
  state.currentPhase = reason === "manual" ? "Preparando captura" : "Preparando ciclo";
  state.currentMessage = `${prepSeconds.toFixed(0)}s para capturar`;
  updateAllUi();
}

async function performCapture(reason) {
  if (state.captureBusy) {
    return;
  }
  if (!state.cameraFeed) {
    state.currentPhase = "Sem câmera";
    state.currentMessage = "Não foi possível capturar";
    updateAllUi();
    return;
  }

  state.captureBusy = true;
  state.buildProgress = 0;
  state.currentPhase = reason === "auto" ? "Capturando automaticamente" : "Capturando agora";
  state.currentMessage = "Congelando frame";
  updateAllUi();

  try {
    const capture = makeCaptureFrame();
    const result = await buildMosaic(capture);
    state.finalGraphic = result;
    state.partialGraphic = result;
    state.lastCaptureLabel = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    state.currentPhase = "Mosaico pronto";
    state.currentMessage = "Nova imagem gerada";
  } catch (error) {
    console.error(error);
    state.currentPhase = "Fallback aplicado";
    state.currentMessage = "A captura concluiu com degradação graciosa";
  } finally {
    state.captureBusy = false;
    state.preparingUntil = 0;
    state.captureReason = null;
    state.buildProgress = 1;
    if (state.autoMode) {
      scheduleNextAutoCapture(state.settings.intervalSeconds * 1000);
      state.currentPhase = "Ciclo automático";
      state.currentMessage = "Aguardando próxima captura";
    }
    updateAllUi();
  }
}

function makeCaptureFrame() {
  const captureWidth = state.settings.fastMode ? 280 : 360;
  const ratio = cameraAspectRatio();
  const captureHeight = Math.max(180, Math.round(captureWidth * ratio));
  const frame = createGraphics(captureWidth, captureHeight);
  frame.pixelDensity(1);
  frame.background(0);
  frame.image(state.cameraFeed, 0, 0, captureWidth, captureHeight);
  return frame;
}

async function buildMosaic(captureFrame) {
  const width = OUTPUT_WIDTH;
  const height = OUTPUT_HEIGHT;
  const cols = clampNumber(state.settings.cols, DEFAULT_SETTINGS.cols, 4, 120);
  const rows = clampNumber(state.settings.rows, DEFAULT_SETTINGS.rows, 4, 120);
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const mosaicBackground = createGraphics(width, height);
  const finalGraphic = createGraphics(width, height);
  mosaicBackground.pixelDensity(1);
  finalGraphic.pixelDensity(1);
  const sourceFrame = resizeCaptureForOutput(captureFrame, width, height);
  sourceFrame.loadPixels();

  const totalCells = cols * rows;
  let processedCells = 0;
  let recentTiles = [];
  const yieldEvery = state.settings.fastMode ? 24 : 8;

  mosaicBackground.background(0);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const average = sampleCellAverage(sourceFrame, col, row, cols, rows, width, height);
      const tile = pickBestTile(average, recentTiles, row, col);
      const x = Math.round(col * cellWidth);
      const y = Math.round(row * cellHeight);
      mosaicBackground.image(tile.image, x, y, Math.ceil(cellWidth) + 1, Math.ceil(cellHeight) + 1);
      recentTiles = updateRecentTiles(recentTiles, tile.id);
      processedCells += 1;
      state.buildProgress = processedCells / totalCells;
      state.partialGraphic = mosaicBackground;
      state.currentMessage = `Montando mosaico ${Math.round(state.buildProgress * 100)}%`;
      if (processedCells % yieldEvery === 0) {
        updateAllUi();
        await nextFrame();
      }
    }
  }

  finalGraphic.image(mosaicBackground, 0, 0);
  return finalGraphic;
}

function sampleCellAverage(captureFrame, col, row, cols, rows) {
  const startX = Math.floor((col * captureFrame.width) / cols);
  const endX = Math.ceil(((col + 1) * captureFrame.width) / cols);
  const startY = Math.floor((row * captureFrame.height) / rows);
  const endY = Math.ceil(((row + 1) * captureFrame.height) / rows);
  const pixels = captureFrame.pixels;
  const step = state.settings.fastMode ? 2 : 1;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  let fallbackRed = 0;
  let fallbackGreen = 0;
  let fallbackBlue = 0;
  let fallbackCount = 0;

  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const index = (y * captureFrame.width + x) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      fallbackRed += r;
      fallbackGreen += g;
      fallbackBlue += b;
      fallbackCount += 1;
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
  }

  if (count === 0) {
    return {
      r: fallbackRed / Math.max(fallbackCount, 1),
      g: fallbackGreen / Math.max(fallbackCount, 1),
      b: fallbackBlue / Math.max(fallbackCount, 1),
    };
  }

  return {
    r: red / count,
    g: green / count,
    b: blue / count,
  };
}

function resizeCaptureForOutput(captureFrame, targetWidth, targetHeight) {
  const resized = createGraphics(targetWidth, targetHeight);
  resized.pixelDensity(1);
  resized.image(captureFrame, 0, 0, targetWidth, targetHeight);
  return resized;
}

function pickBestTile(targetColor, recentTiles, row, col) {
  let bestTile = state.tiles[0] || state.builtinTiles[0];
  let bestScore = Number.POSITIVE_INFINITY;
  const targetLuma = colorLuma(targetColor);
  const leftNeighbor = recentTiles[recentTiles.length - 1];
  const upNeighbor = recentTiles[recentTiles.length - Math.max(1, Math.min(recentTiles.length, 8))];

  for (const tile of state.tiles) {
    const lumaDiff = Math.abs(tile.luma - targetLuma);
    const dr = tile.avg.r - targetColor.r;
    const dg = tile.avg.g - targetColor.g;
    const db = tile.avg.b - targetColor.b;
    let score = dr * dr * 0.42 + dg * dg * 0.42 + db * db * 0.16 + lumaDiff * lumaDiff * 0.7;

    if (tile.id === leftNeighbor) {
      score += 1200;
    }
    if (tile.id === upNeighbor) {
      score += 650;
    }
    if (recentTiles.includes(tile.id)) {
      score += 180;
    }

    if (score < bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return bestTile;
}

function updateRecentTiles(recentTiles, tileId) {
  const updated = [...recentTiles, tileId];
  if (updated.length > 8) {
    updated.shift();
  }
  return updated;
}

function renderStage() {
  if (state.finalGraphic) {
    background(8, 15, 20);
    drawScaledGraphic(state.partialGraphic || state.finalGraphic);
  } else if (state.partialGraphic) {
    background(0);
    drawScaledGraphic(state.partialGraphic);
  } else {
    background(245);
    drawIdleScene();
  }

  if (state.preparingUntil > 0) {
    drawPreparationOverlay();
  }

  if (state.captureBusy && state.buildProgress > 0 && state.buildProgress < 1) {
    drawBuildOverlay();
  }

  if (state.presentation && !state.finalGraphic) {
    drawPresentationHint();
  }
}

function drawScaledGraphic(graphic) {
  const fit = fitRect(graphic.width, graphic.height, width, height);
  image(graphic, fit.x, fit.y, fit.w, fit.h);
}

function drawIdleScene() {
  noStroke();
  fill(18, 24, 32);
  rect(0, 0, width, height);

  const panelFit = fitRect(1120, 720, width * 0.78, height * 0.78);
  const x = (width - panelFit.w) / 2;
  const y = (height - panelFit.h) / 2;
  fill(255, 255, 255, 8);
  rect(x, y, panelFit.w, panelFit.h, 24);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(Math.max(22, min(width, height) * 0.034));
  text("Aguardando mosaico", width / 2, height / 2 - 30);
  fill(180, 190, 200);
  textSize(Math.max(14, min(width, height) * 0.022));
  text("Carregue tiles e pressione Capture Now para gerar a primeira imagem.", width / 2, height / 2 + 10);
  text("No fullscreen, use Enter ou Espaço para iniciar a captura.", width / 2, height / 2 + 36);
}

function drawPreparationOverlay() {
  const remaining = Math.max(0, state.preparingUntil - millis());
  const seconds = Math.ceil(remaining / 1000);
  if (remaining <= 0 && !state.captureBusy) {
    state.preparingUntil = 0;
    performCapture(state.captureReason || "manual");
    return;
  }

  push();
  noStroke();
  fill(0, 0, 0, 120);
  rect(0, 0, width, height);
  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(Math.max(44, min(width, height) * 0.12));
  text(seconds.toString(), width / 2, height / 2 - 14);
  textSize(Math.max(16, min(width, height) * 0.03));
  text("Preparando captura", width / 2, height / 2 + 42);
  textStyle(NORMAL);
  pop();
}

function drawBuildOverlay() {
  push();
  noStroke();
  fill(0, 0, 0, 86);
  rect(16, height - 78, 240, 52, 16);
  fill(255);
  textAlign(LEFT, CENTER);
  textSize(14);
  text(`Montagem ${Math.round(state.buildProgress * 100)}%`, 30, height - 52);
  pop();
}

function drawPresentationHint() {
  push();
  noStroke();
  fill(0, 0, 0, 92);
  rect(width - 280, 20, 260, 72, 18);
  fill(255);
  textAlign(LEFT, TOP);
  textSize(13);
  text("Fullscreen ativo", width - 256, 38);
  fill(190, 200, 210);
  text("Enter ou Espaço dispara uma nova captura.", width - 256, 60, 214, 24);
  pop();
}

function drawIdleOverlayHint() {
  if (state.finalGraphic || state.partialGraphic) {
    return;
  }
}

function drawBuildStatus() {
  // kept intentionally empty; build progress is shown in the overlay and status card
}

function handleGlobalKeydown(event) {
  if (!state.presentation) {
    return;
  }
  const target = event.target;
  const isTypingField = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if (isTypingField) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    requestCapture("manual");
  }
  if (event.key === "Escape" && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  const shell = document.getElementById("app-shell");
  if (shell && shell.requestFullscreen) {
    shell.requestFullscreen().catch(() => {});
  }
}

function syncPresentationState() {
  state.presentation = Boolean(document.fullscreenElement);
  document.body.classList.toggle("presentation", state.presentation);
  fitCanvas();
  updateAllUi();
}

function syncCameraState() {
  if (!state.cameraFeed || !state.cameraFeed.elt) {
    return;
  }
  const ready = state.cameraFeed.elt.readyState >= 2;
  if (ready !== state.cameraReady) {
    state.cameraReady = ready;
    updateAllUi();
  }
}

function updateDynamicUi() {
  if (state.preparingUntil > 0) {
    const remaining = Math.max(0, state.preparingUntil - millis());
    ui.countdownLabel.textContent = `${Math.ceil(remaining / 1000)}s`;
    ui.stageMeta.textContent = state.currentPhase;
    return;
  }

  if (state.autoMode && !state.captureBusy) {
    const remaining = Math.max(0, state.autoScheduledAt - millis());
    ui.countdownLabel.textContent = `${formatCountdown(remaining)}`;
  } else if (state.captureBusy) {
    ui.countdownLabel.textContent = "Processando";
  } else {
    ui.countdownLabel.textContent = "--";
  }
}

function tickScheduler() {
  if (state.captureBusy || state.preparingUntil > 0) {
    return;
  }

  if (state.autoMode) {
    if (!state.autoScheduledAt) {
      scheduleNextAutoCapture(state.settings.intervalSeconds * 1000);
    }
    if (millis() >= state.autoScheduledAt) {
      if (Number(state.settings.prepSeconds) > 0) {
        beginPreparedCapture("auto");
      } else {
        requestCapture("auto");
      }
      state.autoScheduledAt = 0;
    }
  }
}

function updateAllUi() {
  ui.cameraStatus.textContent = state.cameraReady ? "Câmera ativa" : "Câmera iniciando";
  ui.tilesStatus.textContent = `${state.tileLoadLabel}`;
  ui.autoStatus.textContent = state.autoMode ? "Ciclo ativo" : "Ciclo parado";
  ui.stageMeta.textContent = state.currentPhase;
  ui.cameraFeedState.textContent = state.cameraReady ? "Sinal ok" : "Sem frame";
  ui.folderName.textContent = state.userTiles.length ? `${state.userTiles.length} tiles da pasta` : "Tiles padrão";
  ui.phaseLabel.textContent = state.currentPhase;
  ui.lastCaptureLabel.textContent = state.lastCaptureLabel;
  ui.tilesProgressFill.style.width = `${Math.round((state.tileLoadTotal ? state.tileLoadDone / state.tileLoadTotal : 1) * 100)}%`;
  ui.buildProgressFill.style.width = `${Math.round(state.buildProgress * 100)}%`;
  ui.tilesProgressLabel.textContent = `${Math.round((state.tileLoadTotal ? state.tileLoadDone / state.tileLoadTotal : 1) * 100)}%`;
  ui.buildProgressLabel.textContent = `${Math.round(state.buildProgress * 100)}%`;
  ui.autoToggleButton.textContent = state.autoMode ? "Parar ciclo" : "Iniciar ciclo";
  ui.brightnessValue.textContent = Number(state.settings.brightness).toFixed(2);
  ui.contrastValue.textContent = Number(state.settings.contrast).toFixed(2);
  ui.saturationValue.textContent = Number(state.settings.saturation).toFixed(2);

  setInputValueWhenIdle(ui.intervalInput, state.settings.intervalSeconds);
  setInputValueWhenIdle(ui.prepInput, state.settings.prepSeconds);
  setInputValueWhenIdle(ui.colsInput, state.settings.cols);
  setInputValueWhenIdle(ui.rowsInput, state.settings.rows);
  ui.fastInput.checked = state.settings.fastMode;
  ui.brightnessInput.value = state.settings.brightness;
  ui.contrastInput.value = state.settings.contrast;
  ui.saturationInput.value = state.settings.saturation;

  ui.countdownLabel.textContent = state.captureBusy ? "Processando" : ui.countdownLabel.textContent;
  ui.saveButton.disabled = !state.finalGraphic;
  ui.saveButton.style.opacity = state.finalGraphic ? "1" : "0.65";
  updateFilterStyles();
}

function setInputValueWhenIdle(inputElement, value) {
  if (!inputElement || document.activeElement === inputElement) {
    return;
  }
  inputElement.value = value;
}

function fitCanvas() {
  const slot = document.getElementById("canvas-slot");
  if (!slot) {
    return;
  }
  const rect = slot.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.floor(rect.width));
  const nextHeight = Math.max(280, Math.floor(rect.height || rect.width * 0.62));
  if (!state.canvas) {
    state.canvas = createCanvas(nextWidth, nextHeight);
    state.canvas.parent("canvas-slot");
    state.canvas.elt.id = "stage-canvas";
  } else {
    resizeCanvas(nextWidth, nextHeight);
  }
}

function saveCurrentMosaic() {
  if (!state.finalGraphic) {
    state.currentPhase = "Nada para salvar";
    state.currentMessage = "Capture um mosaico primeiro";
    updateAllUi();
    return;
  }
  const filename = `mosaico_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  saveCanvas(state.finalGraphic.canvas, filename, "png");
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function cameraAspectRatio() {
  if (state.cameraFeed && state.cameraFeed.elt && state.cameraFeed.elt.videoWidth && state.cameraFeed.elt.videoHeight) {
    return state.cameraFeed.elt.videoHeight / state.cameraFeed.elt.videoWidth;
  }
  return 0.75;
}

function clampNumber(value, fallback, minValue, maxValue) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.min(maxValue, Math.max(minValue, numeric));
}

function fitRect(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const widthValue = Math.max(1, Math.floor(sourceWidth * scale));
  const heightValue = Math.max(1, Math.floor(sourceHeight * scale));
  return {
    x: Math.floor((maxWidth - widthValue) / 2),
    y: Math.floor((maxHeight - heightValue) / 2),
    w: widthValue,
    h: heightValue,
  };
}

function formatRgbColor(color) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

function readAverageColor(graphic) {
  graphic.loadPixels();
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const pixels = graphic.pixels;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) {
      continue;
    }
    red += pixels[index];
    green += pixels[index + 1];
    blue += pixels[index + 2];
    count += 1;
  }
  if (count === 0) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: red / count,
    g: green / count,
    b: blue / count,
  };
}

function colorLuma(colorValue) {
  return colorValue.r * 0.299 + colorValue.g * 0.587 + colorValue.b * 0.114;
}

function updateUiThemeFilter() {
  // Placeholder for future display-only filters if needed.
}

function updateCameraPreviewLabel() {
  // Kept for future small status animations without changing the core flow.
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return color(Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4)));
}

function colorToBackgroundColor(colorValue) {
  return color(Math.round(colorValue.r), Math.round(colorValue.g), Math.round(colorValue.b));
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function applyToneFilterString() {
  const brightness = Number(state.settings.brightness).toFixed(2);
  const contrast = Number(state.settings.contrast).toFixed(2);
  const saturation = Number(state.settings.saturation).toFixed(2);
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
}

function updateCanvasFilter() {
  if (state.canvas && state.canvas.elt) {
    state.canvas.elt.style.filter = applyToneFilterString();
  }
}

function updateCameraFilter() {
  if (state.cameraFeed && state.cameraFeed.elt) {
    state.cameraFeed.elt.style.filter = applyToneFilterString();
  }
}

function updateFilterStyles() {
  updateCanvasFilter();
  updateCameraFilter();
}

function syncStatus() {
  updateFilterStyles();
  updateAllUi();
}

function drawPresentationBorder() {
  // This app relies on the canvas and layout CSS rather than extra border drawing.
}

function drawGridOverlay() {
  // Reserved for future diagnostics.
}

function drawCapturePulse() {
  // Reserved for future diagnostics.
}

function updateTileMetrics() {
  // Reserved for future tile statistics if needed later.
}

function drawFooterHint() {
  // Reserved for future footer information.
}

function drawDebugInfo() {
  // Reserved for future debug panels.
}

function drawCompositionInfo() {
  // Reserved for future composition labels.
}

function drawStageShadow() {
  // Reserved for future rendering accents.
}

function drawEdgeGlow() {
  // Reserved for future rendering accents.
}

function drawBackdropNoise() {
  // Reserved for future rendering accents.
}

function drawEmptyFallback() {
  // Reserved for future rendering accents.
}

function drawNoise() {
  // Reserved for future rendering accents.
}

function drawEmptyState() {
  // Reserved for future rendering accents.
}

function drawCaption() {
  // Reserved for future rendering accents.
}

function drawExtra() {
  // Reserved for future rendering accents.
}
