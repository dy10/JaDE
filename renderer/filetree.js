'use strict';

// File tree — renders into #file-tree, notifies editor via custom event

const IGNORED = new Set(['.git', '.jade', 'target', 'node_modules', '.DS_Store', '.classpath', '.project', '.settings']);

const treeEl = document.getElementById('file-tree');

// Map of dirPath → expanded state
const expanded = new Map();

async function addFolderToTree(folderPath) {
  // Root label row
  const rootRow = document.createElement('div');
  rootRow.className = 'tree-item tree-root';
  rootRow.style.paddingLeft = '4px';
  rootRow.dataset.path = folderPath;
  rootRow.dataset.isDir = 'true';
  rootRow.innerHTML = `<span class="tree-icon">▶</span><span class="tree-label" title="${folderPath}">${folderPath.split('/').pop()}</span>`;
  treeEl.appendChild(rootRow);

  const childContainer = document.createElement('div');
  childContainer.style.display = 'none';
  treeEl.appendChild(childContainer);
  expanded.set(folderPath, false);

  rootRow.addEventListener('click', async (e) => {
    e.stopPropagation();
    const open = expanded.get(folderPath);
    expanded.set(folderPath, !open);
    if (!open && childContainer.childElementCount === 0) {
      await renderDir(folderPath, childContainer, 1, true);
    }
    childContainer.style.display = open ? 'none' : 'block';
    rootRow.querySelector('.tree-icon').textContent = open ? '▶' : '▼';
  });
}

async function renderDir(dirPath, container, depth, isRoot) {
  const entries = await window.jade.fsListDir(dirPath);
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;

    const item = document.createElement('div');
    item.className = 'tree-item' + (entry.name.startsWith('.') ? ' tree-dotfile' : '');
    item.style.paddingLeft = `${8 + depth * 14}px`;
    item.dataset.path = entry.path;
    item.dataset.isDir = entry.isDir;

    const icon = document.createElement('span');
    icon.className = 'tree-icon';

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = entry.name;
    label.title = entry.path;

    item.appendChild(icon);
    item.appendChild(label);
    container.appendChild(item);

    if (entry.isDir) {
      icon.textContent = '▶';
      const childContainer = document.createElement('div');
      childContainer.style.display = 'none';
      container.appendChild(childContainer);

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const open = expanded.get(entry.path);
        if (open) {
          expanded.set(entry.path, false);
          childContainer.style.display = 'none';
          icon.textContent = '▶';
        } else {
          expanded.set(entry.path, true);
          icon.textContent = '▼';
          if (childContainer.childElementCount === 0) {
            await renderDir(entry.path, childContainer, depth + 1, false);
          }
          childContainer.style.display = 'block';
        }
      });
    } else {
      icon.textContent = entry.name.endsWith('.java') ? '☕' : '·';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('tree-open-file', { detail: entry.path }));
        // Highlight active item
        document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });
    }
  }
}

// Mark active item when a file is opened from any source
document.addEventListener('file-activated', (e) => {
  document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
  const match = treeEl.querySelector(`[data-path="${CSS.escape(e.detail)}"]`);
  if (match) match.classList.add('active');
});

// Sole entry point: main fires folder-added for every folder (CLI + interactive)
window.jade.onFolderAdded((folder) => {
  addFolderToTree(folder);
});
