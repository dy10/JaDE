# JaDE — TODOs

## Milestone 1 — Shell & Editor ✅

- [x] **M1-1** Scaffold Electron app with `npm init` / Electron Forge
- [x] **M1-2** Set up project structure (`main/`, `renderer/`, `assets/`)
- [x] **M1-3** Embed Monaco Editor in the renderer process
- [x] **M1-4** Wire up "Open File" menu action (native file dialog → read file → load into Monaco)
- [x] **M1-5** Set Monaco language to `java` for `.java` files
- [x] **M1-6** Basic window chrome: title bar, menu bar (File, View)
- [ ] **M1-7** Verify `.java` file opens and displays with syntax highlighting

---

## Milestone 2 — LSP Bootstrap ✅

- [x] **M2-1** Download eclipse.jdt.ls pre-built release, add launch script
- [x] **M2-2** Spawn jdt.ls as a child process from Electron main via stdio
- [x] **M2-3** Implement JSON-RPC framing (Content-Length headers) over stdio
- [x] **M2-4** Send LSP `initialize` request with workspace root
- [x] **M2-5** Handle `initialized` notification and confirm handshake
- [x] **M2-6** Send `textDocument/didOpen` when a file is opened in Monaco
- [x] **M2-7** Receive `textDocument/publishDiagnostics` and show error/warning markers in Monaco
- [x] **M2-8** Set up `chokidar` file watcher on workspace root (`**/*.java`, `**/pom.xml`)
- [x] **M2-9** Debounce file change events (500ms), batch into `workspace/didChangeWatchedFiles`
- [x] **M2-10** Handle `pom.xml` changes — trigger re-resolution and show "Re-indexing..." status
- [x] **M2-11** Show indexing status indicator in UI while jdt.ls is busy

---

## Milestone 3 — Core Navigation ✅

- [x] **M3-1** Go to Definition (`F3`) — `textDocument/definition`
- [x] **M3-2** Go to Implementation (`Ctrl+T`) — `textDocument/implementation`
- [x] **M3-3** Find Usages / References (`Ctrl+Shift+G`) — `textDocument/references`
- [x] **M3-4** Open referenced file in editor when navigation resolves to a different file
- [x] **M3-5** Highlight the target symbol when navigating to it

---

## Milestone 4 — Source Viewing ✅

- [x] **M4-1** Detect when navigation target is inside a JAR (library class)
- [x] **M4-2** Request sources via jdt.ls `java/classFileContents` (resolves `-sources.jar` from Maven Central)
- [x] **M4-3** Display source in a read-only Monaco editor tab
- [x] **M4-4** CFR decompiler fallback when no sources JAR exists
- [x] **M4-5** Label decompiled tabs clearly (`[decompiled] ClassName.java`)

---

## Milestone 5 — Polish ✅

- [x] **M5-1** File tree sidebar (show project directory structure, collapsible dirs)
- [x] **M5-2** Tab bar (open files, close tabs, active tab highlight)
- [x] **M5-3** Navigation history — back (`Cmd+[`) and forward (`Cmd+]`)
- [x] **M5-4** Open Type dialog (`Cmd+Shift+T`) — fuzzy search across workspace symbols
- [x] **M5-5** Hover documentation (`textDocument/hover`) shown as tooltip in Monaco
- [ ] **M5-6** Code completion — skipped

---

## Milestone 6 — Multi-root Workspace ✅

- [x] **M6-1** Support multiple open folders in a single jdt.ls session (`workspace/didChangeWorkspaceFolders`)
- [x] **M6-2** File tree shows all workspace roots
- [x] **M6-3** Cross-file navigation works across all open folders
- [x] **M6-4** Status bar shows indexing progress for added folders
- [x] **M6-5** `get-workspace-folders` IPC exposes all roots to renderer

---

## Milestone 7 — Workspace Persistence, Refresh & Open Resource ✅

- [x] **M7-1** Persist open folders to `workspace.json` on every change; restore on relaunch (no CLI args needed)
- [x] **M7-2** Per-workspace jdt.ls data dir keyed by sha1 of sorted folder list — same combo always reuses same incremental index
- [x] **M7-3** CLI `--folder` arg overrides and updates saved workspace state
- [x] **M7-4** Manual workspace refresh — File → Refresh Workspace (`Cmd+Shift+F5`): sends `didChangeWatchedFiles` for all `.java` files + `java/buildWorkspace` force rebuild
- [x] **M7-5** Open Resource dialog (`Cmd+Shift+R`) — fuzzy search `.java` filenames across all workspace folders, excludes `target/`
- [x] **M7-6** Global keybindings for Cmd+Shift+R and Cmd+Shift+T work when focus is in file tree (not just editor)
- [x] **M7-7** Dotfile entries in file tree dimmed with `.tree-dotfile` style
- [x] **M7-8** App name set to "JaDE" via `app.setName()` and `productName` in package.json
- [x] **M7-9** Graceful shutdown — guard `mainWindow.isDestroyed()` before sending to renderer on LSP exit
- [x] **M7-10** electron-builder packaging config; SVG icon → icns pipeline; system jdtls (brew) used instead of bundled copy

---

## Milestone 8 — Fixes & UX Improvements ✅

- [x] **M8-1** Fix `npm start` on Node v25 — use `node node_modules/electron/cli.js .` instead of `electron .` (Node v25 broke symlink `require('./')` resolution)
- [x] **M8-2** `--projects-file` CLI arg — load multiple Maven project folders from a text file (one path per line, `#` comments supported); added `dev:projects` npm script
- [x] **M8-3** File tree: root folders start collapsed, expand lazily on first click
- [x] **M8-4** Java import block: register custom `FoldingRangeProvider` so Monaco treats imports as a foldable region; auto-collapse on file open via `editor.foldAllImports`
- [x] **M8-5** Fast app shutdown — fixed 30s exit delay caused by `watcher.close()` blocking and Electron intercepting `process.exit`; solution: destroy LSP stdio streams, skip `watcher.close()`, use `process.kill(process.pid, 'SIGKILL')` in `before-quit`
- [x] **M8-6** Open Resource: wildcard matching with `*` (e.g. `asset*config` matches `AssetMatchingConfig.java`)
- [x] **M8-7** Open Resource: camel-case initials matching (e.g. `AMC` matches `AssetMatchingConfig.java`)
- [x] **M8-8** Open Resource: Cmd+A selects all text in search box (capture-phase listener bypasses Monaco's global handler)
