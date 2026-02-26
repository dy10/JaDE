'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * LSP client that communicates with eclipse.jdt.ls over stdio using
 * the Language Server Protocol JSON-RPC framing (Content-Length headers).
 */
class LspClient extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._buffer = Buffer.alloc(0);
    this._pendingRequests = new Map(); // id -> { resolve, reject }
    this._nextId = 1;
    this._initialized = false;
  }

  // allFolders: string[] of all workspace folders (for stable data dir key)
  start(workspaceRoot, allFolders) {
    const jdtlsDir = this._findJdtlsDir();
    const launcherJar = this._findLauncherJar(jdtlsDir);
    const configDir = this._pickConfigDir(jdtlsDir);
    // Data dir must be OUTSIDE the workspace root — jdt.ls rejects overlap.
    // Key by sha1 of sorted folder list so same combo always maps to same dir.
    const { app } = require('electron');
    const folders = (allFolders && allFolders.length > 0) ? allFolders : [workspaceRoot];
    const hash = crypto.createHash('sha1')
      .update([...folders].sort().join('\0'))
      .digest('hex')
      .slice(0, 8);
    const workspaceName = `${hash}-${path.basename(workspaceRoot)}`;
    const dataDir = path.join(app.getPath('userData'), 'jdtls-workspaces', workspaceName);

    fs.mkdirSync(dataDir, { recursive: true });

    const javaArgs = [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=ALL',
      '-Xmx1G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', launcherJar,
      '-configuration', configDir,
      '-data', dataDir,
    ];

    // Use java from JAVA_HOME or PATH
    const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';

    this._proc = spawn(javaBin, javaArgs, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
    });

    this._proc.stdout.on('data', (chunk) => this._onData(chunk));
    this._proc.stderr.on('data', (data) => {
      // jdt.ls writes startup info to stderr — only log real errors
      const msg = data.toString();
      if (msg.includes('ERROR') || msg.includes('Exception')) {
        console.error('[jdtls stderr]', msg.trim());
      }
    });
    this._proc.on('exit', (code) => {
      console.log('[jdtls] exited with code', code);
      this.emit('exit', code);
    });

    console.log('[lsp] jdt.ls started, pid', this._proc.pid);
  }

  async initialize(folders) {
    // folders: string[] of absolute paths
    const wsFolders = folders.map(f => ({ uri: pathToUri(f), name: path.basename(f) }));
    const result = await this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'JaDE', version: '0.1.0' },
      rootUri: wsFolders[0].uri,
      workspaceFolders: wsFolders,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: true, didSave: true },
          publishDiagnostics: { relatedInformation: true },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          implementation: { dynamicRegistration: true },
          hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
          completion: { dynamicRegistration: true },
        },
        workspace: {
          didChangeWatchedFiles: { dynamicRegistration: true },
          workspaceFolders: true,
        },
      },
      initializationOptions: {
        bundles: [],
        workspaceFolders: folders.map(pathToUri),
        settings: { java: { autobuild: { enabled: true } } },
      },
    });

    this.notify('initialized', {});
    this._initialized = true;
    console.log('[lsp] initialized with', folders.length, 'folder(s)');
    return result;
  }

  // Add a new workspace folder to a running jdt.ls instance
  addWorkspaceFolder(folderPath) {
    this.notify('workspace/didChangeWorkspaceFolders', {
      event: {
        added:   [{ uri: pathToUri(folderPath), name: path.basename(folderPath) }],
        removed: [],
      },
    });
  }

  // --- textDocument notifications ---

  didOpen(filePath, content) {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToUri(filePath),
        languageId: 'java',
        version: 1,
        text: content,
      },
    });
  }

  didChange(filePath, content, version) {
    this.notify('textDocument/didChange', {
      textDocument: { uri: pathToUri(filePath), version },
      contentChanges: [{ text: content }],
    });
  }

  // --- workspace notifications ---

  didChangeWatchedFiles(changes) {
    // changes: [{ uri, type }]  type: 1=created, 2=changed, 3=deleted
    this.notify('workspace/didChangeWatchedFiles', { changes });
  }

  // --- LSP requests ---

  async getDefinition(filePath, line, character) {
    return this.request('textDocument/definition', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
    });
  }

  async getImplementations(filePath, line, character) {
    return this.request('textDocument/implementation', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
    });
  }

  async getReferences(filePath, line, character) {
    return this.request('textDocument/references', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: false },
    });
  }

  async getHover(filePath, line, character) {
    return this.request('textDocument/hover', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
    });
  }

  // jdt.ls proprietary: fetch source/bytecode for a class file URI (jar:// or jdt://)
  async getClassFileContents(uri) {
    return this.request('java/classFileContents', { uri });
  }

  // --- Low-level JSON-RPC ---

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pendingRequests.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _send(message) {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
    this._proc.stdin.write(header + body);
  }

  _onData(chunk) {
    if (!this._proc) return; // already stopped
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._processBuffer();
  }

  _processBuffer() {
    while (true) {
      // Find header/body separator
      const sep = this._buffer.indexOf('\r\n\r\n');
      if (sep === -1) break;

      const header = this._buffer.slice(0, sep).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const bodyStart = sep + 4;

      if (this._buffer.length < bodyStart + contentLength) break; // not enough data yet

      const body = this._buffer.slice(bodyStart, bodyStart + contentLength).toString('utf8');
      this._buffer = this._buffer.slice(bodyStart + contentLength);

      try {
        this._handleMessage(JSON.parse(body));
      } catch (e) {
        console.error('[lsp] failed to parse message:', e);
      }
    }
  }

  _handleMessage(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params);
      return;
    }

    if (msg.method === '$/progress') {
      this.emit('progress', msg.params);
      return;
    }

    if (msg.method === 'language/status') {
      this.emit('languageStatus', msg.params);
      return;
    }

    if (msg.method && msg.id !== undefined) {
      // Server-to-client request (e.g. client/registerCapability)
      this.emit('serverRequest', msg);
      // Auto-acknowledge registration requests
      this._send({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }

    if (msg.method) {
      // Notification from server
      this.emit('notification', msg);
      return;
    }

    // Response to our request
    const pending = this._pendingRequests.get(msg.id);
    if (pending) {
      this._pendingRequests.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  stop() {
    if (!this._proc) return;
    const proc = this._proc;
    this._proc = null;

    // Reject all pending requests immediately
    for (const { reject } of this._pendingRequests.values()) {
      reject(new Error('LSP client stopped'));
    }
    this._pendingRequests.clear();

    const pid = proc.pid;

    // Stop all I/O immediately so no more data events fire
    try { proc.stdout.destroy(); } catch {}
    try { proc.stderr.destroy(); } catch {}
    try { proc.stdin.destroy(); } catch {}

    // SIGKILL the JVM — no graceful shutdown, it's too slow with many projects
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }

  _findJdtlsDir() {
    // 1. Bundled jdtls (dev mode fallback)
    const bundled = path.join(__dirname, '..', 'jdtls');
    if (fs.existsSync(path.join(bundled, 'plugins'))) return bundled;

    // 2. Homebrew — resolve symlink from /opt/homebrew/bin/jdtls or /usr/local/bin/jdtls
    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      const wrapper = path.join(prefix, 'bin', 'jdtls');
      if (fs.existsSync(wrapper)) {
        // The brew wrapper script lives next to a share/jdtls directory
        const share = path.join(prefix, 'share', 'jdtls');
        if (fs.existsSync(path.join(share, 'plugins'))) return share;

        // Alternatively resolve through Cellar symlink
        const cellar = path.join(prefix, 'Cellar', 'jdtls');
        if (fs.existsSync(cellar)) {
          const versions = fs.readdirSync(cellar).sort().reverse();
          for (const v of versions) {
            const candidate = path.join(cellar, v, 'libexec');
            if (fs.existsSync(path.join(candidate, 'plugins'))) return candidate;
          }
        }
      }
    }

    throw new Error(
      'jdtls not found. Install with: brew install jdtls\n' +
      'Or place jdtls in the "jdtls/" directory next to this app.'
    );
  }

  _findLauncherJar(jdtlsDir) {
    const pluginsDir = path.join(jdtlsDir, 'plugins');
    const files = fs.readdirSync(pluginsDir);
    const jar = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!jar) throw new Error('Could not find equinox launcher JAR in ' + pluginsDir);
    return path.join(pluginsDir, jar);
  }

  _pickConfigDir(jdtlsDir) {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'darwin') {
      return path.join(jdtlsDir, arch === 'arm64' ? 'config_mac_arm' : 'config_mac');
    }
    if (platform === 'linux') {
      return path.join(jdtlsDir, arch === 'arm64' ? 'config_linux_arm' : 'config_linux');
    }
    return path.join(jdtlsDir, 'config_win');
  }
}

function pathToUri(filePath) {
  return 'file://' + filePath.replace(/\\/g, '/');
}

module.exports = { LspClient, pathToUri };
