'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
app.setName('JaDE');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { LspClient } = require('./lsp-client');
const { FileWatcher } = require('./file-watcher');

let mainWindow;
let lspClient = null;
let fileWatcher = null;
let workspaceFolders = []; // all open project roots
// Convenience getter — first folder, or null
function workspaceRoot() { return workspaceFolders[0] ?? null; }

// ── Workspace state persistence ───────────────────────────────────────────────

function workspaceStatePath() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

function saveWorkspaceState() {
  try {
    fs.writeFileSync(workspaceStatePath(), JSON.stringify({ folders: workspaceFolders }, null, 2), 'utf8');
  } catch (e) {
    console.error('[main] Failed to save workspace state:', e.message);
  }
}

function loadWorkspaceState() {
  try {
    const data = JSON.parse(fs.readFileSync(workspaceStatePath(), 'utf8'));
    return Array.isArray(data.folders) ? data.folders.filter(f => fs.existsSync(f)) : [];
  } catch {
    return [];
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'JaDE — Java Development Environment',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: openFolder,
        },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: openFile,
        },
        { type: 'separator' },
        {
          label: 'Refresh Workspace',
          accelerator: 'CmdOrCtrl+Shift+F5',
          click: refreshWorkspace,
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Workspace / LSP lifecycle ────────────────────────────────────────────────

async function openFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Maven Project Folder',
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return;

  const folder = filePaths[0];
  if (workspaceFolders.includes(folder)) return; // already open

  if (lspClient) {
    // LSP already running — add folder to the existing session
    workspaceFolders.push(folder);
    saveWorkspaceState();
    updateTitle();
    mainWindow.webContents.send('status', { text: `Adding ${path.basename(folder)}…`, busy: true });
    lspClient.addWorkspaceFolder(folder);
    fileWatcher.watch(folder);
    mainWindow.webContents.send('folder-added', folder);
  } else {
    // First folder — cold start
    workspaceFolders.push(folder);
    saveWorkspaceState();
    updateTitle();
    mainWindow.webContents.send('status', { text: 'Starting language server…', busy: true });
    await startLsp();
    mainWindow.webContents.send('folder-added', folder);
  }
}

function updateTitle() {
  const names = workspaceFolders.map(f => path.basename(f)).join(', ');
  mainWindow.setTitle(`JaDE — ${names}`);
}

async function startLsp() {
  lspClient = new LspClient();

  lspClient.on('diagnostics', (params) => {
    mainWindow.webContents.send('lsp-diagnostics', params);
  });

  // Track active progress tokens — clear spinner only when all are done
  const activeTokens = new Map(); // token → title

  lspClient.on('progress', (params) => {
    const token = String(params.token ?? '');
    const value = params.value ?? {};
    if (value.kind === 'begin') {
      activeTokens.set(token, value.title || 'Working…');
    } else if (value.kind === 'report') {
      activeTokens.set(token, value.message || activeTokens.get(token) || 'Working…');
    } else if (value.kind === 'end') {
      activeTokens.delete(token);
    }
    if (activeTokens.size === 0) {
      mainWindow.webContents.send('status', { text: 'Ready', busy: false });
    } else {
      const msg = [...activeTokens.values()].pop();
      mainWindow.webContents.send('status', { text: msg, busy: true });
    }
  });

  let _messageTimer = null;
  lspClient.on('languageStatus', (params) => {
    if (params.type === 'ServiceReady') {
      activeTokens.clear();
      mainWindow.webContents.send('status', { text: 'Ready', busy: false });
    } else if (params.type === 'Error') {
      activeTokens.clear();
      mainWindow.webContents.send('status', { text: `Error: ${params.message}`, busy: false });
    } else if (params.type === 'Message') {
      // One-shot notification (e.g. "Updating workspace folders") — show briefly then clear
      mainWindow.webContents.send('status', { text: params.message || '', busy: true });
      if (_messageTimer) clearTimeout(_messageTimer);
      _messageTimer = setTimeout(() => {
        mainWindow.webContents.send('status', { text: 'Ready', busy: false });
      }, 3000);
    } else if (activeTokens.size === 0) {
      // Starting/ProjectStatus etc — only show if no $/progress is driving status
      mainWindow.webContents.send('status', { text: params.message || '', busy: true });
    }
  });

  lspClient.on('exit', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { text: 'Language server stopped', busy: false });
    }
  });

  // Start jdt.ls; pass all folders so data dir key is stable across sessions
  lspClient.start(workspaceFolders[0], workspaceFolders);

  try {
    await lspClient.initialize(workspaceFolders);
    mainWindow.webContents.send('status', { text: 'Indexing…', busy: true });
  } catch (err) {
    console.error('[main] LSP initialize failed:', err);
    mainWindow.webContents.send('status', { text: 'LSP init failed: ' + err.message, busy: false });
    return;
  }

  fileWatcher = new FileWatcher(lspClient, (busy) => {
    mainWindow.webContents.send('status', { text: busy ? 'Re-indexing…' : '', busy });
  });
  workspaceFolders.forEach(f => fileWatcher.watch(f));
}

// ── Workspace refresh ─────────────────────────────────────────────────────────

async function refreshWorkspace() {
  if (!lspClient) {
    mainWindow.webContents.send('status', { text: 'No workspace open', busy: false });
    return;
  }
  mainWindow.webContents.send('status', { text: 'Re-indexing…', busy: true });

  // Collect all .java files across workspace folders (exclude target/)
  const changes = [];
  for (const folder of workspaceFolders) {
    collectJavaFiles(folder, changes);
  }

  if (changes.length > 0) {
    lspClient.didChangeWatchedFiles(changes);
  }

  // Also request a full build via jdt.ls proprietary API
  try {
    await lspClient.request('java/buildWorkspace', { forceFullBuild: true });
  } catch (e) {
    console.log('[main] java/buildWorkspace:', e.message);
  }
}

function collectJavaFiles(dir, out, _depth = 0) {
  if (_depth > 20) return;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'target' || name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      collectJavaFiles(full, out, _depth + 1);
    } else if (name.endsWith('.java')) {
      out.push({ uri: 'file://' + full, type: 2 }); // 2 = changed
    }
  }
}

// ── File open ────────────────────────────────────────────────────────────────

async function openFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open File',
    properties: ['openFile'],
    filters: [
      { name: 'Java Files', extensions: ['java'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    defaultPath: workspaceRoot() || undefined,
  });
  if (canceled || filePaths.length === 0) return;

  sendFileToRenderer(filePaths[0]);
}

function sendFileToRenderer(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  mainWindow.webContents.send('file-opened', { filePath, content });

  // Notify LSP that the file is now open in the editor
  if (lspClient) {
    lspClient.didOpen(filePath, content);
  }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('open-file-dialog', openFile);
ipcMain.handle('open-folder-dialog', openFolder);

// Navigation: open a file by absolute path (cross-file go-to results)
ipcMain.handle('open-file-by-path', (_e, filePath) => {
  sendFileToRenderer(filePath);
});

// M5: notify renderer of workspace root (for file tree root)
ipcMain.handle('get-workspace-root', () => workspaceRoot());
ipcMain.handle('get-workspace-folders', () => workspaceFolders);

// M4: Fetch source for a JAR class URI (jdt:// or jar://)
// Returns { source, isDecompiled, label }
ipcMain.handle('open-class-source', async (_e, { uri, displayLabel }) => {
  // 1. Try jdt.ls java/classFileContents first (uses attached sources jar if available)
  if (lspClient) {
    try {
      const source = await lspClient.getClassFileContents(uri);
      if (source && source.trim().length > 0) {
        return { source, isDecompiled: false, label: displayLabel };
      }
    } catch (e) {
      console.log('[M4] classFileContents failed, falling back to CFR:', e.message);
    }
  }

  // 2. Fallback: extract class file from JAR and decompile with CFR
  try {
    const source = await decompileWithCfr(uri);
    return { source, isDecompiled: true, label: `[decompiled] ${displayLabel}` };
  } catch (e) {
    return { source: `// Could not retrieve source\n// ${e.message}`, isDecompiled: true, label: `[no source] ${displayLabel}` };
  }
});

function decompileWithCfr(uri) {
  return new Promise((resolve, reject) => {
    // URI forms:
    //   jar:file:///path/to/lib.jar!/com/example/Foo.class
    //   jdt://contents/rt.jar/java.lang/String.class?...
    const jarMatch = uri.match(/jar:file:\/\/(.*\.jar)!\/(.+\.class)/);
    if (!jarMatch) {
      return reject(new Error('Cannot extract JAR path from URI: ' + uri));
    }
    const jarPath   = jarMatch[1];
    const classPath = jarMatch[2]; // e.g. com/example/Foo.class

    const cfrJar = path.join(__dirname, '..', 'tools', 'cfr.jar');
    execFile('java', ['-jar', cfrJar, '--jarpath', jarPath, classPath.replace('.class', '').replace(/\//g, '.')], (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// M5: file tree — list directory children
ipcMain.handle('fs-list-dir', (_e, dirPath) => {
  try {
    return fs.readdirSync(dirPath).map(name => {
      const full = path.join(dirPath, name);
      const isDir = fs.statSync(full).isDirectory();
      return { name, path: full, isDir };
    }).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch { return []; }
});

// M5: workspace symbol search for Open Type dialog
ipcMain.handle('lsp-workspace-symbols', async (_e, query) => {
  if (!lspClient) return [];
  try {
    return await lspClient.request('workspace/symbol', { query }) ?? [];
  } catch { return []; }
});

// Trigger full workspace re-index
ipcMain.handle('refresh-workspace', async () => {
  await refreshWorkspace();
});

// Return all .java files across workspace folders (for Open Resource dialog)
ipcMain.handle('get-java-files', () => {
  const results = [];
  for (const folder of workspaceFolders) {
    gatherJavaFiles(folder, results);
  }
  return results;
});

function gatherJavaFiles(dir, out, _depth = 0) {
  if (_depth > 20) return;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'target' || name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      gatherJavaFiles(full, out, _depth + 1);
    } else if (name.endsWith('.java')) {
      out.push({ name, path: full });
    }
  }
}

// Renderer asks for LSP features
ipcMain.handle('lsp-definition', async (_e, { filePath, line, character }) => {
  if (!lspClient) return null;
  return lspClient.getDefinition(filePath, line, character);
});

ipcMain.handle('lsp-implementations', async (_e, { filePath, line, character }) => {
  if (!lspClient) return null;
  return lspClient.getImplementations(filePath, line, character);
});

ipcMain.handle('lsp-references', async (_e, { filePath, line, character }) => {
  if (!lspClient) return null;
  return lspClient.getReferences(filePath, line, character);
});

ipcMain.handle('lsp-hover', async (_e, { filePath, line, character }) => {
  if (!lspClient) return null;
  return lspClient.getHover(filePath, line, character);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // CLI: npm start -- --folder /path/to/project --files a.java b.java
  // Electron passes user args after the '--' separator; filter out Electron internals
  const args = process.argv.slice(process.argv.indexOf('--') + 1).filter(a => !a.startsWith('--inspect'));
  const folderIdx = args.indexOf('--folder');
  const filesIdx  = args.indexOf('--files');

  mainWindow.webContents.once('did-finish-load', async () => {
    if (folderIdx !== -1) {
      // CLI --folder overrides saved state
      const folder = path.resolve(args[folderIdx + 1]);
      workspaceFolders.push(folder);
      saveWorkspaceState();
      updateTitle();
      mainWindow.webContents.send('status', { text: 'Starting language server…', busy: true });
      mainWindow.webContents.send('folder-added', folder);
      await startLsp();

      if (filesIdx !== -1) {
        const files = args.slice(filesIdx + 1).map(f => path.resolve(f));
        setTimeout(() => {
          files.forEach(f => {
            if (fs.existsSync(f)) sendFileToRenderer(f);
          });
        }, 500);
      }
    } else {
      // No CLI arg — restore saved workspace
      const saved = loadWorkspaceState();
      if (saved.length > 0) {
        workspaceFolders.push(...saved);
        updateTitle();
        mainWindow.webContents.send('status', { text: 'Restoring workspace…', busy: true });
        // Send folder-added for each folder so file tree populates
        for (const folder of saved) {
          mainWindow.webContents.send('folder-added', folder);
        }
        await startLsp();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (fileWatcher) fileWatcher.stop();
  if (lspClient)   lspClient.stop();
  if (process.platform !== 'darwin') app.quit();
});
