const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const fs = require('node:fs');
const { publishBatch, normalizeBaseUrl, validateUserToken } = require('./api-client.cjs');
const { randomUUID } = require('node:crypto');
const { ENVIRONMENTS } = require('./domain.js');

let mainWindow;
let session = null;
let batchRunning = false;
const registeredFiles = new Map();

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Origen IPC no autorizado.');
  if (event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Solo el documento principal puede usar IPC.');
}

function isAllowedIvooxExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && ['www.ivoox.net', 'www.ivoox.com'].includes(url.hostname)
      && ['/', '/_ra_2830059_1.html'].includes(url.pathname);
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#101b2c',
    title: 'Vaughanator',
    icon: path.join(__dirname, 'app-icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedIvooxExternalUrl(url)) shell.openExternal(url).catch((error) => console.error('No se pudo abrir el enlace de iVoox:', error));
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let isAppDocument = false;
    try {
      isAppDocument = path.resolve(fileURLToPath(url)) === path.resolve(__dirname, 'index.html');
    } catch {}
    if (isAppDocument) return;
    event.preventDefault();
    if (isAllowedIvooxExternalUrl(url)) shell.openExternal(url).catch((error) => console.error('No se pudo abrir el enlace de iVoox:', error));
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('El proceso de interfaz de Vaughanator terminó:', details);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`No se pudo cargar ${url} (${code}): ${description}`);
  });
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    session = null;
    batchRunning = false;
    registeredFiles.clear();
    mainWindow = null;
  });
}

ipcMain.handle('session:set', async (event, input) => {
  assertTrustedSender(event);
  if (!input || typeof input !== 'object') throw new Error('Faltan los datos de sesión.');
  const jwt = String(input.jwt || '').trim();
  if (!jwt) throw new Error('Introduce el JWT.');
  const environment = ENVIRONMENTS.find((item) => item.id === String(input.environment || ''));
  if (!environment) throw new Error('Selecciona un entorno válido.');
  const candidateSession = {
    jwt,
    environmentId: environment.id,
    environmentName: environment.name,
    apiBaseUrl: normalizeBaseUrl(environment.apiBaseUrl, 'API base URL'),
    podcastBaseUrl: normalizeBaseUrl(environment.podcastBaseUrl, 'Podcast base URL'),
  };
  await validateUserToken({
    ...candidateSession,
    onRequestLog: (entry) => mainWindow?.webContents.send('api:request-log', entry),
  });
  session = candidateSession;
  return { ok: true, environmentName: environment.name };
});

ipcMain.handle('session:clear', (event) => {
  assertTrustedSender(event);
  session = null;
  return { ok: true };
});

ipcMain.handle('files:inspect', (event, entries) => {
  assertTrustedSender(event);
  if (!Array.isArray(entries)) throw new Error('La selección de archivos no es válida.');
  return entries.map((entry) => {
    const filePath = String(entry.path || '');
    if (!filePath || !fs.existsSync(filePath)) return { name: String(entry.name || ''), fileId: '', size: 0, error: 'Archivo no disponible.' };
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { name: String(entry.name || ''), fileId: '', size: 0, error: 'La selección no es un archivo.' };
    const fileId = randomUUID();
    registeredFiles.set(fileId, filePath);
    return {
      name: path.basename(filePath),
      fileId,
      size: stat.size,
      mimeType: 'audio/mpeg',
    };
  });
});

ipcMain.handle('batch:publish', async (event, input) => {
  assertTrustedSender(event);
  if (!session) throw new Error('La sesión ha terminado. Vuelve a introducir el JWT.');
  if (batchRunning) throw new Error('Ya hay un lote en curso.');
  if (!input || !Array.isArray(input.items) || input.items.length === 0) throw new Error('El lote no contiene audios.');
  batchRunning = true;
  try {
    return await publishBatch({
      items: input.items,
      concurrency: input.concurrency,
      session,
      resolveFile: (item) => {
        const filePath = registeredFiles.get(String(item.fileId || ''));
        if (!filePath) throw new Error('La referencia del archivo caducó. Vuelve a añadirlo al lote.');
        const actualName = path.basename(filePath);
        if (actualName !== item.name) throw new Error('El nombre del archivo cambió después de la preview.');
        return { path: filePath, name: actualName, mimeType: 'audio/mpeg' };
      },
      onStage: (item, stage) => mainWindow?.webContents.send('batch:stage', { id: item.id, stage }),
      onResult: (result) => mainWindow?.webContents.send('batch:item-result', result),
      onRequestLog: (item, entry) => mainWindow?.webContents.send('api:request-log', {
        ...entry,
        fileName: item.name,
        programName: item.programName,
      }),
    });
  } finally {
    batchRunning = false;
  }
});

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('before-quit', () => {
  session = null;
});
app.on('window-all-closed', () => {
  session = null;
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('app:ready', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) mainWindow.webContents.send('session:status', { active: Boolean(session) });
});
