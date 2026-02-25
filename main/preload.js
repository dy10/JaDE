'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jade', {
  // File / folder actions
  onFileOpened:    (cb) => ipcRenderer.on('file-opened',    (_e, data) => cb(data)),
  openFileDialog:  ()   => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog:()   => ipcRenderer.invoke('open-folder-dialog'),

  // Status bar updates from main
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),

  // LSP diagnostics
  onDiagnostics: (cb) => ipcRenderer.on('lsp-diagnostics', (_e, data) => cb(data)),

  // Navigation: open a file by path from main process
  openFileByPath: (filePath) => ipcRenderer.invoke('open-file-by-path', filePath),

  // M5: file tree + Open Type
  fsListDir:            (dir)   => ipcRenderer.invoke('fs-list-dir', dir),
  getWorkspaceRoot:     ()      => ipcRenderer.invoke('get-workspace-root'),
  getWorkspaceFolders:  ()      => ipcRenderer.invoke('get-workspace-folders'),
  lspWorkspaceSymbols:  (query) => ipcRenderer.invoke('lsp-workspace-symbols', query),
  onFolderAdded:        (cb)    => ipcRenderer.on('folder-added', (_e, folder) => cb(folder)),

  // Workspace operations
  refreshWorkspace: ()  => ipcRenderer.invoke('refresh-workspace'),
  getJavaFiles:     ()  => ipcRenderer.invoke('get-java-files'),

  // M4: fetch source for a JAR/JDT class URI
  openClassSource: (args) => ipcRenderer.invoke('open-class-source', args),

  // LSP requests (renderer → main → jdtls)
  lspDefinition:      (args) => ipcRenderer.invoke('lsp-definition',      args),
  lspImplementations: (args) => ipcRenderer.invoke('lsp-implementations', args),
  lspReferences:      (args) => ipcRenderer.invoke('lsp-references',      args),
  lspHover:           (args) => ipcRenderer.invoke('lsp-hover',           args),
});
