import { app, BrowserWindow, Tray, nativeImage, ipcMain, screen } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

type ActivityState = 'idle' | 'thinking' | 'coding';

interface StatePayload {
  state: ActivityState;
  updated_at: number;
  source: string;
  conversation_id?: string;
}

const STATE_DIR = join(homedir(), '.cursor', 'breathing-light');
const STATE_FILE = join(STATE_DIR, 'state.json');
const PREFERENCES_FILE = join(STATE_DIR, 'preferences.json');
const HTTP_PORT = 39281;
const BASE_WIDTH = 368;
const BASE_HEIGHT = 224;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.0;

interface Preferences {
  scale?: number;
  pinned?: boolean;
}

const COLORS: Record<ActivityState, string> = {
  idle: '#22c55e',
  thinking: '#eab308',
  coding: '#ef4444',
};

let tray: Tray | null = null;
let popup: BrowserWindow | null = null;
let currentState: ActivityState = 'idle';
let popupVisible = false;
let popupPinned = false;
let popupUserPositioned = false;
let uiScale = 1;
let popupFullscreen = false;
let boundsBeforeFullscreen: Electron.Rectangle | null = null;

function clampScale(scale: number): number {
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) * 10) / 10;
}

function popupSizeForScale(scale: number): { width: number; height: number } {
  const s = clampScale(scale);
  return {
    width: Math.round(BASE_WIDTH * s),
    height: Math.round(BASE_HEIGHT * s),
  };
}

async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await readFile(PREFERENCES_FILE, 'utf8');
    return JSON.parse(raw) as Preferences;
  } catch {
    return {};
  }
}

async function savePreferences(partial: Preferences): Promise<void> {
  const current = await loadPreferences();
  await writeFile(PREFERENCES_FILE, JSON.stringify({ ...current, ...partial }, null, 2));
}

function applyPopupScale(scale: number, notifyRenderer = true): number {
  uiScale = clampScale(scale);
  if (popup && !popup.isDestroyed() && !popupFullscreen) {
    const [x, y] = popup.getPosition();
    const size = popupSizeForScale(uiScale);
    popup.setBounds({ x, y, width: size.width, height: size.height });
  }
  if (popup && !popup.isDestroyed() && notifyRenderer) {
    popup.webContents.send('scale-update', uiScale);
  }
  void savePreferences({ scale: uiScale });
  return uiScale;
}

function enterFullscreen(): void {
  if (!popup || popup.isDestroyed()) return;
  boundsBeforeFullscreen = popup.getBounds();
  const display = screen.getDisplayMatching(boundsBeforeFullscreen);
  const area = display.workArea;
  popup.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popupFullscreen = true;
  popup.webContents.send('fullscreen-update', true);
}

function exitFullscreen(): void {
  if (!popup || popup.isDestroyed()) return;
  if (boundsBeforeFullscreen) {
    popup.setBounds(boundsBeforeFullscreen);
    boundsBeforeFullscreen = null;
  } else {
    const size = popupSizeForScale(uiScale);
    popup.setSize(size.width, size.height);
  }
  popup.setAlwaysOnTop(popupPinned, 'floating');
  popupFullscreen = false;
  popup.webContents.send('fullscreen-update', false);
}

function toggleFullscreen(): boolean {
  if (popupFullscreen) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
  return popupFullscreen;
}

function isDev(): boolean {
  return !app.isPackaged;
}

function parseHexColor(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TRAY_DIM_COLORS: Record<ActivityState, string> = {
  idle: '#1a3d24',
  thinking: '#3d3518',
  coding: '#3d1f1f',
};

const TRAY_BULBS: { state: ActivityState; cx: number }[] = [
  { state: 'idle', cx: 11 },
  { state: 'thinking', cx: 22 },
  { state: 'coding', cx: 33 },
];

function setTrayPixel(
  buffer: Buffer,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255
): void {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  buffer[idx] = r;
  buffer[idx + 1] = g;
  buffer[idx + 2] = b;
  buffer[idx + 3] = a;
}

function fillTrayCircle(
  buffer: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setTrayPixel(buffer, width, x, y, r, g, b);
      }
    }
  }
}

function fillTrayRoundedRect(
  buffer: Buffer,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  radius: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inCorner =
        (x < radius && y < radius && (x - radius + 0.5) ** 2 + (y - radius + 0.5) ** 2 > radius ** 2) ||
        (x >= width - radius && y < radius && (x - (width - radius) + 0.5) ** 2 + (y - radius + 0.5) ** 2 > radius ** 2) ||
        (x < radius && y >= height - radius && (x - radius + 0.5) ** 2 + (y - (height - radius) + 0.5) ** 2 > radius ** 2) ||
        (x >= width - radius &&
          y >= height - radius &&
          (x - (width - radius) + 0.5) ** 2 + (y - (height - radius) + 0.5) ** 2 > radius ** 2);
      if (!inCorner) {
        setTrayPixel(buffer, width, x, y, r, g, b);
      }
    }
  }
}

/** 经典横排三灯：绿 | 黄 | 红，当前状态高亮 */
function createTrayIcon(state: ActivityState): Electron.NativeImage {
  const width = 44;
  const height = 28;
  const buffer = Buffer.alloc(width * height * 4);

  fillTrayRoundedRect(buffer, width, height, 38, 38, 42, 5);

  const cy = height / 2;
  const bulbRadius = 5.5;

  for (const bulb of TRAY_BULBS) {
    const hex = bulb.state === state ? COLORS[bulb.state] : TRAY_DIM_COLORS[bulb.state];
    const [r, g, b] = parseHexColor(hex);
    fillTrayCircle(buffer, width, height, bulb.cx, cy, bulbRadius, r, g, b);
  }

  const img = nativeImage.createFromBuffer(buffer, {
    width,
    height,
    scaleFactor: 2,
  });
  img.setTemplateImage(false);
  return img;
}

function broadcastState(payload: StatePayload): void {
  currentState = payload.state;
  tray?.setImage(createTrayIcon(currentState));
  const tipMap: Record<ActivityState, string> = {
    idle: '空闲',
    thinking: '思考中',
    coding: '写代码',
  };
  tray?.setToolTip(`Cursor 呼吸灯：${tipMap[currentState]}`);

  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('state-update', payload);
  }
}

async function loadPersistedState(): Promise<StatePayload | null> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw) as StatePayload;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function startHttpServer(): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          state: currentState,
          updated_at: Date.now(),
          source: 'menubar',
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/state') {
      try {
        const body = await readBody(req);
        const payload = JSON.parse(body) as StatePayload;
        broadcastState(payload);
        res.writeHead(200);
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end('{"error":"invalid payload"}');
      }
      return;
    }

    res.writeHead(404);
    res.end('{"error":"not found"}');
  });

  server.listen(HTTP_PORT, '127.0.0.1');
}

function getTrayBounds(): Electron.Rectangle {
  if (!tray) return { x: 0, y: 0, width: 0, height: 0 };
  return tray.getBounds();
}

function positionPopup(): void {
  if (!popup || popup.isDestroyed()) return;

  const trayBounds = getTrayBounds();
  const { width, height } = popupSizeForScale(uiScale);
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = Math.round(trayBounds.y - height - 4);

  popup.setPosition(
    Math.max(display.workArea.x, Math.min(x, display.workArea.x + display.workArea.width - width)),
    Math.max(display.workArea.y, y)
  );
}

function hidePopup(): void {
  if (popup && !popup.isDestroyed()) {
    popup.hide();
    popupVisible = false;
  }
}

function showPopup(): void {
  if (!popup || popup.isDestroyed()) return;
  if (!popupUserPositioned) {
    positionPopup();
  }
  popup.show();
  popup.focus();
  popupVisible = true;
}

function createPopup(): void {
  const size = popupSizeForScale(uiScale);
  popup = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popup.on('moved', () => {
    popupUserPositioned = true;
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev() && rendererUrl) {
    popup.loadURL(rendererUrl);
  } else {
    popup.loadFile(join(__dirname, '../renderer/index.html'));
  }

  popup.webContents.on('did-finish-load', () => {
    popup?.webContents.send('state-update', {
      state: currentState,
      updated_at: Date.now(),
      source: 'menubar-init',
    });
    popup?.webContents.send('pin-update', popupPinned);
    popup?.webContents.send('scale-update', uiScale);
    popup?.webContents.send('fullscreen-update', popupFullscreen);
  });

  positionPopup();
  popup.show();
  popupVisible = true;
}

function togglePopup(): void {
  if (popup && !popup.isDestroyed()) {
    if (popupVisible) {
      if (!popupPinned) {
        hidePopup();
      } else {
        popup.focus();
      }
    } else {
      showPopup();
    }
    return;
  }

  createPopup();
}

app.whenReady().then(async () => {
  await mkdir(STATE_DIR, { recursive: true });

  const persisted = await loadPersistedState();
  if (persisted) {
    currentState = persisted.state;
  }

  const prefs = await loadPreferences();
  if (prefs.scale !== undefined) {
    uiScale = clampScale(prefs.scale);
  }
  if (prefs.pinned !== undefined) {
    popupPinned = prefs.pinned;
  }

  startHttpServer();

  tray = new Tray(createTrayIcon(currentState));
  tray.setToolTip(`Cursor: ${currentState}`);
  tray.on('click', togglePopup);

  ipcMain.handle('get-state', () => ({
    state: currentState,
    updated_at: Date.now(),
    source: 'menubar',
  }));

  ipcMain.handle('get-pinned', () => popupPinned);

  ipcMain.handle('set-pinned', (_event, pinned: boolean) => {
    popupPinned = pinned;
    popup?.setAlwaysOnTop(pinned, 'floating');
    popup?.webContents.send('pin-update', popupPinned);
    void savePreferences({ pinned: popupPinned });
    return popupPinned;
  });

  ipcMain.handle('get-scale', () => uiScale);

  ipcMain.handle('set-scale', (_event, scale: number) => applyPopupScale(scale));

  ipcMain.handle('get-fullscreen', () => popupFullscreen);

  ipcMain.handle('toggle-fullscreen', () => toggleFullscreen());

  ipcMain.handle('hide-popup', () => {
    if (popupFullscreen) {
      exitFullscreen();
    }
    hidePopup();
  });

  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  console.log(
    `[breathing-light] 已启动 — 状态: ${currentState}，菜单栏右上角找圆点图标，HTTP :${HTTP_PORT}`
  );
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
