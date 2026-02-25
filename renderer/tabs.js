'use strict';

// Tab bar — manages open tabs, notifies editor via custom events

const tabbarEl = document.getElementById('tabbar');

// tabs: Map of filePath → { label, isReadOnly }
const tabs = new Map();
let activeTab = null;

function openTab(filePath, label, isReadOnly = false) {
  if (tabs.has(filePath)) {
    activateTab(filePath);
    return;
  }

  tabs.set(filePath, { label, isReadOnly });
  renderTab(filePath, label, isReadOnly);
  activateTab(filePath);
}

function renderTab(filePath, label, isReadOnly) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.path = filePath;
  tab.title = filePath;

  const labelEl = document.createElement('span');
  labelEl.className = 'tab-label';
  labelEl.textContent = label;

  const closeEl = document.createElement('span');
  closeEl.className = 'tab-close';
  closeEl.textContent = '×';
  closeEl.title = 'Close';

  tab.appendChild(labelEl);
  tab.appendChild(closeEl);
  tabbarEl.appendChild(tab);

  tab.addEventListener('click', (e) => {
    if (e.target === closeEl) return;
    activateTab(filePath);
  });

  closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(filePath);
  });
}

function activateTab(filePath) {
  if (activeTab === filePath) return;
  activeTab = filePath;

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const tab = tabbarEl.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
  if (tab) {
    tab.classList.add('active');
    tab.scrollIntoView({ inline: 'nearest' });
  }

  document.dispatchEvent(new CustomEvent('tab-activated', { detail: filePath }));
}

function closeTab(filePath) {
  tabs.delete(filePath);
  const tab = tabbarEl.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
  if (tab) tab.remove();

  if (activeTab === filePath) {
    activeTab = null;
    // Activate the last remaining tab if any
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    } else {
      document.dispatchEvent(new CustomEvent('tab-activated', { detail: null }));
    }
  }
}

// Expose to editor.js
window.jadeTabs = { openTab, activateTab, closeTab, getActiveTab: () => activeTab };
