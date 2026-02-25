'use strict';

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

require(['vs/editor/editor.main'], function () {
  const container  = document.getElementById('editor-container');
  const statusText = document.getElementById('status-text');
  const spinner    = document.getElementById('status-spinner');

  // Current open file path (or class URI)
  let currentFilePath = null;

  // Navigation history: [{ filePath, line, column }]
  const navHistory = [];
  let navIndex = -1;
  const MAX_HISTORY = 100;

  // ── Editor instance ────────────────────────────────────────────────────────
  const editor = monaco.editor.create(container, {
    value: '',
    language: 'java',
    theme: 'vs-dark',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    automaticLayout: true,
  });

  // ── Status bar ─────────────────────────────────────────────────────────────
  window.jade.onStatus(({ text, busy }) => {
    statusText.textContent = text || '';
    spinner.classList.toggle('hidden', !busy);
  });

  // Click status text to copy it to clipboard
  statusText.style.cursor = 'pointer';
  statusText.title = 'Click to copy';
  statusText.addEventListener('click', () => {
    const text = statusText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const prev = statusText.textContent;
      statusText.textContent = '✓ Copied';
      setTimeout(() => { statusText.textContent = prev; }, 1200);
    });
  });

  // ── File open from main process ────────────────────────────────────────────
  window.jade.onFileOpened(({ filePath, content }) => {
    const target = _pendingNavTarget;
    _pendingNavTarget = null;
    loadFile(filePath, content, target?.line, target?.column);
  });

  // ── File tree click ────────────────────────────────────────────────────────
  document.addEventListener('tree-open-file', (e) => {
    window.jade.openFileByPath(e.detail);
  });

  // ── Tab activated (switch to existing model) ───────────────────────────────
  document.addEventListener('tab-activated', (e) => {
    const filePath = e.detail;
    if (!filePath) return;
    if (filePath === currentFilePath) return;

    const uri = filePath.startsWith('jdt://') || filePath.startsWith('jar:')
      ? monaco.Uri.parse(filePath)
      : monaco.Uri.file(filePath);
    const model = monaco.editor.getModel(uri);
    if (model) {
      currentFilePath = filePath;
      editor.setModel(model);
      editor.focus();
      document.dispatchEvent(new CustomEvent('file-activated', { detail: filePath }));
    } else {
      // Model not loaded yet — fetch from main
      window.jade.openFileByPath(filePath);
    }
  });

  // ── Load a regular file ────────────────────────────────────────────────────
  function loadFile(filePath, content, targetLine, targetColumn) {
    currentFilePath = filePath;

    const ext = filePath.split('.').pop().toLowerCase();
    const language = ext === 'java' ? 'java' : 'plaintext';
    const uri = monaco.Uri.file(filePath);

    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(content, language, uri);
    } else {
      model.setValue(content);
    }

    editor.setModel(model);
    editor.updateOptions({ readOnly: false });

    const label = filePath.split('/').pop();
    window.jadeTabs.openTab(filePath, label, false);
    document.dispatchEvent(new CustomEvent('file-activated', { detail: filePath }));

    revealTarget(targetLine, targetColumn);
    editor.focus();
  }

  // ── Load a library class (read-only) ──────────────────────────────────────
  function loadClassSource(uri, source, label, isDecompiled, targetLine, targetColumn) {
    currentFilePath = uri;

    const monacoUri = monaco.Uri.parse(uri);
    let model = monaco.editor.getModel(monacoUri);
    if (!model) {
      model = monaco.editor.createModel(source, 'java', monacoUri);
    }

    editor.setModel(model);
    editor.updateOptions({ readOnly: true });

    window.jadeTabs.openTab(uri, label, true);
    document.dispatchEvent(new CustomEvent('file-activated', { detail: uri }));

    revealTarget(targetLine, targetColumn);
    editor.focus();
  }

  function revealTarget(line, column) {
    if (line === undefined || line === null) return;
    const l = line + 1, c = (column ?? 0) + 1;
    editor.revealLineInCenter(l);
    editor.setPosition({ lineNumber: l, column: c });
    const deco = editor.deltaDecorations([], [{
      range: new monaco.Range(l, 1, l, 1),
      options: { isWholeLine: true, className: 'nav-target-line' },
    }]);
    setTimeout(() => editor.deltaDecorations(deco, []), 1500);
  }

  // One-shot pending nav target for cross-file navigation
  let _pendingNavTarget = null;

  // ── Navigation history ─────────────────────────────────────────────────────
  function pushHistory(filePath, line, column) {
    if (navIndex < navHistory.length - 1) navHistory.splice(navIndex + 1);
    navHistory.push({ filePath, line, column });
    if (navHistory.length > MAX_HISTORY) navHistory.shift();
    navIndex = navHistory.length - 1;
  }

  function navigateTo(filePath, line, column, pushNav = true) {
    if (pushNav && currentFilePath) {
      const pos = editor.getPosition();
      pushHistory(currentFilePath, (pos?.lineNumber ?? 1) - 1, (pos?.column ?? 1) - 1);
    }

    if (filePath === currentFilePath) {
      revealTarget(line, column);
      editor.focus();
    } else {
      _pendingNavTarget = { line, column };
      // Check if model already exists in tab
      const uri = monaco.Uri.file(filePath);
      if (monaco.editor.getModel(uri)) {
        currentFilePath = filePath;
        editor.setModel(monaco.editor.getModel(uri));
        editor.updateOptions({ readOnly: false });
        window.jadeTabs.activateTab(filePath);
        document.dispatchEvent(new CustomEvent('file-activated', { detail: filePath }));
        revealTarget(line, column);
        editor.focus();
        _pendingNavTarget = null;
      } else {
        window.jade.openFileByPath(filePath);
      }
    }
  }

  async function navigateToClassUri(uri, line, column, pushNav = true) {
    if (pushNav && currentFilePath) {
      const pos = editor.getPosition();
      pushHistory(currentFilePath, (pos?.lineNumber ?? 1) - 1, (pos?.column ?? 1) - 1);
    }

    // If already loaded, just switch
    const monacoUri = monaco.Uri.parse(uri);
    if (monaco.editor.getModel(monacoUri)) {
      currentFilePath = uri;
      editor.setModel(monaco.editor.getModel(monacoUri));
      editor.updateOptions({ readOnly: true });
      window.jadeTabs.activateTab(uri);
      revealTarget(line, column);
      editor.focus();
      return;
    }

    const labelMatch = uri.match(/([^/!]+\.class)/);
    const displayLabel = labelMatch ? labelMatch[1].replace('.class', '.java') : 'Library source';

    statusText.textContent = `Loading ${displayLabel}…`;
    spinner.classList.remove('hidden');

    const result = await window.jade.openClassSource({ uri, displayLabel });

    spinner.classList.add('hidden');
    statusText.textContent = result.isDecompiled ? 'Decompiled (no sources JAR)' : 'Ready';

    loadClassSource(uri, result.source, result.label, result.isDecompiled, line, column);
  }

  // ── LSP helpers ────────────────────────────────────────────────────────────
  function uriToPath(uri) { return uri.replace(/^file:\/\//, ''); }

  function isClassUri(uri) {
    return uri.startsWith('jdt://') || uri.startsWith('jar:');
  }

  function locationToTarget(loc) {
    const uri   = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;
    return {
      uri,
      filePath: isClassUri(uri) ? uri : uriToPath(uri),
      isClass:  isClassUri(uri),
      line:     range.start.line,
      column:   range.start.character,
    };
  }

  function showResultsPicker(locations, label) {
    if (locations.length === 0) { statusText.textContent = `No ${label} found`; return; }
    if (locations.length === 1) {
      const t = locationToTarget(locations[0]);
      if (t.isClass) navigateToClassUri(t.uri, t.line, t.column);
      else navigateTo(t.filePath, t.line, t.column);
      return;
    }
    showPickerPanel(locations, label);
  }

  function showPickerPanel(locations, label) {
    removePickerPanel();
    const panel = document.createElement('div');
    panel.id = 'picker-panel';
    panel.innerHTML = `<div class="picker-header">${label} — ${locations.length} results (click to navigate, Esc to close)</div>`;

    locations.forEach(loc => {
      const t = locationToTarget(loc);
      const shortPath = t.isClass
        ? t.uri.replace(/^.*!\//, '')
        : t.filePath.replace(/^.*\/src\//, 'src/');
      const row = document.createElement('div');
      row.className = 'picker-row';
      row.textContent = `${shortPath}  :${t.line + 1}`;
      row.title = t.isClass ? t.uri : t.filePath;
      row.addEventListener('click', () => {
        removePickerPanel();
        if (t.isClass) navigateToClassUri(t.uri, t.line, t.column);
        else navigateTo(t.filePath, t.line, t.column);
      });
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { removePickerPanel(); document.removeEventListener('keydown', esc); }
    });
  }

  function removePickerPanel() { document.getElementById('picker-panel')?.remove(); }

  // ── Hover tooltip (M5-5) ───────────────────────────────────────────────────
  editor.onMouseMove(async (e) => {
    if (!currentFilePath || isClassUri(currentFilePath)) return;
    if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
    // Monaco's built-in hover handles this if we register a hover provider
  });

  // Register hover provider so Monaco shows jdt.ls hover docs natively
  monaco.languages.registerHoverProvider('java', {
    provideHover: async (model, position) => {
      const filePath = model.uri.scheme === 'file' ? model.uri.fsPath : null;
      if (!filePath) return null;
      try {
        const result = await window.jade.lspHover({
          filePath,
          line:      position.lineNumber - 1,
          character: position.column - 1,
        });
        if (!result?.contents) return null;
        const contents = Array.isArray(result.contents)
          ? result.contents
          : [result.contents];
        return {
          contents: contents.map(c => ({
            value: typeof c === 'string' ? c : (c.value ?? ''),
          })),
          range: result.range ? new monaco.Range(
            result.range.start.line + 1, result.range.start.character + 1,
            result.range.end.line + 1,   result.range.end.character + 1,
          ) : undefined,
        };
      } catch { return null; }
    },
  });

  // ── Keybindings ────────────────────────────────────────────────────────────

  // F3 — Go to Definition
  editor.addCommand(monaco.KeyCode.F3, async () => {
    if (!currentFilePath) return;
    const pos = editor.getPosition();
    const result = await window.jade.lspDefinition({
      filePath: currentFilePath, line: pos.lineNumber - 1, character: pos.column - 1,
    });
    if (!result) { statusText.textContent = 'No definition found'; return; }
    showResultsPicker(Array.isArray(result) ? result : [result], 'Definition');
  });

  // Cmd+T — Go to Implementation
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, async () => {
    if (!currentFilePath) return;
    const pos = editor.getPosition();
    const result = await window.jade.lspImplementations({
      filePath: currentFilePath, line: pos.lineNumber - 1, character: pos.column - 1,
    });
    if (!result || (Array.isArray(result) && result.length === 0)) {
      statusText.textContent = 'No implementations found'; return;
    }
    showResultsPicker(Array.isArray(result) ? result : [result], 'Implementations');
  });

  // Cmd+Shift+G — Find Usages
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG, async () => {
    if (!currentFilePath) return;
    const pos = editor.getPosition();
    statusText.textContent = 'Searching references…';
    const result = await window.jade.lspReferences({
      filePath: currentFilePath, line: pos.lineNumber - 1, character: pos.column - 1,
    });
    if (!result || result.length === 0) { statusText.textContent = 'No references found'; return; }
    statusText.textContent = '';
    showResultsPicker(result, 'References');
  });

  // Cmd+[ — Navigate back
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketLeft, () => {
    if (navIndex <= 0) return;
    if (navIndex === navHistory.length - 1 && currentFilePath) {
      const pos = editor.getPosition();
      navHistory.push({ filePath: currentFilePath, line: (pos?.lineNumber ?? 1) - 1, column: (pos?.column ?? 1) - 1 });
    }
    navIndex--;
    const e = navHistory[navIndex];
    if (isClassUri(e.filePath)) navigateToClassUri(e.filePath, e.line, e.column, false);
    else navigateTo(e.filePath, e.line, e.column, false);
  });

  // Cmd+] — Navigate forward
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketRight, () => {
    if (navIndex >= navHistory.length - 1) return;
    navIndex++;
    const e = navHistory[navIndex];
    if (isClassUri(e.filePath)) navigateToClassUri(e.filePath, e.line, e.column, false);
    else navigateTo(e.filePath, e.line, e.column, false);
  });

  // Cmd+Shift+T — Open Type dialog
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyT, openTypeDialog);

  // Cmd+Shift+R — Open Resource dialog
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, openResourceDialog);

  // Global keydown: catch Cmd+Shift+T and Cmd+Shift+R when editor doesn't have focus
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); openResourceDialog(); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); openTypeDialog(); }
  });

  // ── Open Type dialog (M5-4) ────────────────────────────────────────────────
  const overlay   = document.getElementById('open-type-overlay');
  const otInput   = document.getElementById('open-type-input');
  const otResults = document.getElementById('open-type-results');
  let otSelectedIndex = -1;
  let otItems = [];
  let otDebounce = null;

  function openTypeDialog() {
    overlay.classList.remove('hidden');
    otInput.value = '';
    otResults.innerHTML = '';
    otItems = [];
    otSelectedIndex = -1;
    otInput.focus();
  }

  function closeTypeDialog() {
    overlay.classList.add('hidden');
    editor.focus();
  }

  otInput.addEventListener('input', () => {
    clearTimeout(otDebounce);
    const q = otInput.value.trim();
    if (q.length < 1) { otResults.innerHTML = ''; return; }
    otDebounce = setTimeout(() => fetchSymbols(q), 200);
  });

  async function fetchSymbols(query) {
    const symbols = await window.jade.lspWorkspaceSymbols(query);
    otItems = (symbols || []).slice(0, 50);
    otSelectedIndex = otItems.length > 0 ? 0 : -1;
    renderOtResults();
  }

  function renderOtResults() {
    otResults.innerHTML = '';
    otItems.forEach((sym, i) => {
      const row = document.createElement('div');
      row.className = 'ot-row' + (i === otSelectedIndex ? ' selected' : '');
      const loc = sym.location;
      const shortPath = loc?.uri ? uriToPath(loc.uri).replace(/^.*\/src\//, 'src/') : '';
      row.innerHTML = `<span class="ot-name">${sym.name}</span><span class="ot-path">${shortPath}</span>`;
      row.addEventListener('click', () => { otSelectedIndex = i; openSelectedType(); });
      otResults.appendChild(row);
    });
  }

  function openSelectedType() {
    if (otSelectedIndex < 0 || otSelectedIndex >= otItems.length) return;
    const sym = otItems[otSelectedIndex];
    const loc = sym.location;
    if (!loc?.uri) return;
    closeTypeDialog();
    const t = locationToTarget(loc);
    if (t.isClass) navigateToClassUri(t.uri, t.line, t.column);
    else navigateTo(t.filePath, t.line, t.column);
  }

  otInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeTypeDialog(); return; }
    if (e.key === 'Enter') { openSelectedType(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      otSelectedIndex = Math.min(otSelectedIndex + 1, otItems.length - 1);
      renderOtResults();
      otResults.children[otSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      otSelectedIndex = Math.max(otSelectedIndex - 1, 0);
      renderOtResults();
      otResults.children[otSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTypeDialog(); });

  // ── Open Resource dialog (Cmd+Shift+R) ────────────────────────────────────
  const orOverlay   = document.getElementById('open-resource-overlay');
  const orInput     = document.getElementById('open-resource-input');
  const orResults   = document.getElementById('open-resource-results');
  let orSelectedIndex = -1;
  let orItems = []; // { name, path }
  let orAllFiles = []; // full index, rebuilt on open
  let orDebounce = null;

  async function openResourceDialog() {
    orOverlay.classList.remove('hidden');
    orInput.value = '';
    orResults.innerHTML = '';
    orItems = [];
    orSelectedIndex = -1;
    // Rebuild file index from main each time dialog opens
    orAllFiles = await window.jade.getJavaFiles() || [];
    orInput.focus();
  }

  function closeResourceDialog() {
    orOverlay.classList.add('hidden');
    editor.focus();
  }

  orInput.addEventListener('input', () => {
    clearTimeout(orDebounce);
    orDebounce = setTimeout(() => filterResources(orInput.value.trim()), 80);
  });

  function filterResources(query) {
    if (query.length === 0) {
      orItems = orAllFiles.slice(0, 50);
    } else {
      const lower = query.toLowerCase();
      orItems = orAllFiles
        .filter(f => f.name.toLowerCase().includes(lower))
        .slice(0, 50);
    }
    orSelectedIndex = orItems.length > 0 ? 0 : -1;
    renderOrResults();
  }

  function renderOrResults() {
    orResults.innerHTML = '';
    orItems.forEach((file, i) => {
      const row = document.createElement('div');
      row.className = 'ot-row' + (i === orSelectedIndex ? ' selected' : '');
      // Shorten path: show from src/ if possible
      const shortPath = file.path.replace(/^.*\/src\//, 'src/');
      row.innerHTML = `<span class="ot-name">${file.name}</span><span class="ot-path">${shortPath}</span>`;
      row.addEventListener('click', () => { orSelectedIndex = i; openSelectedResource(); });
      orResults.appendChild(row);
    });
  }

  function openSelectedResource() {
    if (orSelectedIndex < 0 || orSelectedIndex >= orItems.length) return;
    const file = orItems[orSelectedIndex];
    closeResourceDialog();
    navigateTo(file.path, undefined, undefined);
  }

  orInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeResourceDialog(); return; }
    if (e.key === 'Enter') { openSelectedResource(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      orSelectedIndex = Math.min(orSelectedIndex + 1, orItems.length - 1);
      renderOrResults();
      orResults.children[orSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      orSelectedIndex = Math.max(orSelectedIndex - 1, 0);
      renderOrResults();
      orResults.children[orSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  });

  orOverlay.addEventListener('click', (e) => { if (e.target === orOverlay) closeResourceDialog(); });

  // ── LSP Diagnostics → Monaco markers ──────────────────────────────────────
  window.jade.onDiagnostics(({ uri, diagnostics }) => {
    const targetUri = uri.replace(/^file:\/\//, '');
    const model = monaco.editor.getModel(monaco.Uri.file(targetUri));
    if (!model) return;
    monaco.editor.setModelMarkers(model, 'jdtls', diagnostics.map(d => ({
      severity:        lspSeverityToMonaco(d.severity),
      startLineNumber: d.range.start.line + 1,
      startColumn:     d.range.start.character + 1,
      endLineNumber:   d.range.end.line + 1,
      endColumn:       d.range.end.character + 1,
      message:         d.message,
      source:          d.source || 'jdtls',
    })));
  });

  function lspSeverityToMonaco(s) {
    switch (s) {
      case 1: return monaco.MarkerSeverity.Error;
      case 2: return monaco.MarkerSeverity.Warning;
      case 3: return monaco.MarkerSeverity.Info;
      default:return monaco.MarkerSeverity.Hint;
    }
  }

  // ── Sidebar resize ─────────────────────────────────────────────────────────
  const sidebar = document.getElementById('sidebar');
  const resizeHandle = document.getElementById('sidebar-resize');
  let resizing = false, resizeStartX = 0, resizeStartW = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartW = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const w = Math.max(120, Math.min(500, resizeStartW + e.clientX - resizeStartX));
    sidebar.style.width = w + 'px';
    editor.layout();
  });
  document.addEventListener('mouseup', () => {
    if (resizing) { resizing = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
  });

  window.addEventListener('resize', () => editor.layout());
});
