'use strict';

const chokidar = require('chokidar');
const path = require('path');
const { pathToUri } = require('./lsp-client');

const DEBOUNCE_MS = 500;

/**
 * Watches a workspace root for Java and Maven file changes,
 * debounces them, and fires batched didChangeWatchedFiles notifications.
 */
class FileWatcher {
  constructor(lspClient, onStatusChange) {
    this._lsp = lspClient;
    this._onStatusChange = onStatusChange; // (busy: boolean) => void
    this._pending = new Map(); // uri -> type (1=created,2=changed,3=deleted)
    this._timer = null;
    this._watcher = null;
  }

  watch(workspaceRoot) {
    if (!this._watcher) {
      this._watcher = chokidar.watch([], {
        ignored: [
          /(^|[/\\])\../,
          /node_modules/,
          /\.jade/,
          /target[/\\]/,
        ],
        persistent: false,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200 },
      });

      const handle = (type) => (filePath) => {
        if (!this._isWatched(filePath)) return;
        const uri = pathToUri(filePath);
        this._pending.set(uri, { uri, type });
        this._schedule();
      };

      this._watcher.on('add',    handle(1));
      this._watcher.on('change', handle(2));
      this._watcher.on('unlink', handle(3));
    }

    this._watcher.add(workspaceRoot);
    console.log('[watcher] watching', workspaceRoot);
  }

  _isWatched(filePath) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath);
    return ext === '.java' || base === 'pom.xml';
  }

  _schedule() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), DEBOUNCE_MS);
  }

  _flush() {
    if (this._pending.size === 0) return;

    const changes = Array.from(this._pending.values());
    this._pending.clear();

    const hasPomChange = changes.some(c => c.uri.endsWith('pom.xml'));
    if (hasPomChange) {
      this._onStatusChange(true); // show "Re-indexing..."
      // jdt.ls will emit $/progress events when done; we listen for that in main
    }

    this._lsp.didChangeWatchedFiles(changes);
    console.log(`[watcher] notified jdtls of ${changes.length} change(s)`);
  }

  stop() {
    // Skip close() — it blocks for 30s with many watched dirs. OS cleans up on process exit.
    this._watcher = null;
  }
}

module.exports = { FileWatcher };
