# JaDE — Java Development Environment
## Requirements Document

---

## 1. Overview

JaDE is a lightweight, personal Java IDE built for fun by a developer who uses Eclipse. The goal is to replicate the core code-navigation features of Eclipse in a modern, custom shell — without the weight of the full Eclipse platform.

JaDE (Java Development Enviornment) is **not** intended to replace Eclipse or IntelliJ for professional use. It is a learning project and a tailored tool.

---

## 2. Goals

- Open and work with Maven-based Java projects (single and multi-module)
- Navigate code the way Eclipse does: go to definition, go to implementation, find usages
- View source for 3rd party library classes (via Maven sources or decompilation)
- Keep the implementation simple and hackable

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Shell / Desktop app | Electron |
| Code editor widget | Monaco Editor (VS Code's editor, embedded) |
| Language intelligence | eclipse.jdt.ls (Eclipse JDT Language Server) |
| LSP communication | JSON-RPC over stdio (built into Electron main process) |
| Build system support | Maven (via jdt.ls native support) |
| Decompiler (fallback) | Fernflower or CFR (for sources not available on Maven Central) |
| Packaging | Electron Forge or electron-builder |

---

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│                  JaDE (Electron)             │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │        Renderer Process              │   │
│  │  Monaco Editor  │  File Tree  │ UI   │   │
│  └──────────────────────────────────────┘   │
│                    │ IPC                     │
│  ┌──────────────────────────────────────┐   │
│  │          Main Process                │   │
│  │   LSP Client (JSON-RPC over stdio)   │   │
│  └──────────────────────────────────────┘   │
│                    │ stdio                   │
└────────────────────┼────────────────────────┘
                     │
        ┌────────────▼─────────────┐
        │    eclipse.jdt.ls        │
        │  (Java Language Server)  │
        │                          │
        │  - Type indexing         │
        │  - Maven resolution      │
        │  - Source attachment     │
        │  - Reference search      │
        └──────────────────────────┘
                     │
        ┌────────────▼─────────────┐
        │  Maven Projects + ~/.m2  │
        └──────────────────────────┘
```

---

## 5. Core Features

### 5.1 Project Management
- Open a Maven project folder (single or multi-module)
- Display the project file tree in a sidebar
- Automatically detect `pom.xml` and pass workspace root to jdt.ls
- Support adding multiple Maven projects to the same workspace

### 5.2 Code Navigation
These features map directly to Eclipse shortcuts the user knows:

| Feature | Description |
|---|---|
| Go to Definition | Jump to where a class, method, or field is declared (`F3` in Eclipse) |
| Go to Implementation | From interface/abstract method, navigate to concrete implementations (`Ctrl+T` in Eclipse) |
| Find Usages / References | Show all places a method, class, or field is used across all modules (`Ctrl+Shift+G` in Eclipse) |
| Open Type | Quickly open any class by name across the workspace and dependencies |
| Back / Forward navigation | Navigate back and forward through visited locations (like Eclipse's navigation history) |

### 5.3 3rd Party Source Viewing
- When navigating to a class from a library JAR, request sources from jdt.ls
- jdt.ls will resolve `-sources.jar` from Maven Central automatically when available
- Fallback: if no sources JAR exists, run a decompiler (Fernflower/CFR) on the class file and display the result as read-only
- Decompiled sources are clearly marked as such in the editor tab

### 5.4 Editor
- Syntax highlighting (via Monaco's built-in Java support)
- Basic code completion (via LSP `textDocument/completion`)
- Inline error/warning markers (via LSP diagnostics)
- Hover documentation (via LSP `textDocument/hover`)
- Read-only mode for library source files

### 5.5 Search
- Full-text search across all files in the workspace
- Symbol search (classes, methods) via LSP workspace symbols

---

## 6. Non-Goals (Out of Scope)

These will **not** be implemented to keep the project focused:

- Debugging (no DAP integration)
- Running / executing code
- Git integration
- Refactoring (rename, extract method, etc.)
- Code formatting
- Plugin/extension system
- Remote development
- Non-Maven build systems (Gradle, Ant)

---

## 7. Milestones

### Milestone 1 — Shell & Editor
- Electron app boots
- Monaco Editor renders in the window
- Can open and display a `.java` file

### Milestone 2 — LSP Bootstrap
- eclipse.jdt.ls starts as a child process from Electron main
- LSP `initialize` handshake completes for a Maven project folder
- Diagnostics (errors/warnings) appear in the editor
- File watcher (chokidar) monitors workspace for `**/*.java` and `**/pom.xml` changes
- Changes are debounced and sent to jdt.ls as `workspace/didChangeWatchedFiles` notifications
- `pom.xml` changes trigger automatic Maven dependency re-resolution in jdt.ls
- A "Re-indexing..." status indicator is shown while jdt.ls catches up after bulk changes (e.g. git pull)

### Milestone 3 — Core Navigation
- Go to Definition works (`F3`)
- Find Usages works (`Ctrl+Shift+G`)
- Go to Implementation works

### Milestone 4 — Source Viewing
- 3rd party class sources load from Maven sources JARs
- Decompiler fallback works for classes without sources

### Milestone 5 — Polish
- File tree sidebar
- Tab management (open files)
- Navigation history (back/forward)
- Open Type dialog

---

## 8. Prerequisites / Environment

- Node.js + npm (for Electron)
- Java 17+ (to run eclipse.jdt.ls)
- Maven installed and `~/.m2` cache populated
- eclipse.jdt.ls downloaded (pre-built release from GitHub)
