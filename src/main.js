// ============================================================
// GLOBAL STATE & SHARED UTILITIES
// ============================================================

let activeTool = 'select';
let scale = 1;
let panX = 0;
let panY = 0;
let contextNode = null;
let pendingDeleteName = null;


// ============================================================
// KNOWLEDGE ONTOLOGY
// ============================================================

// --- State ---
let treeData = { name: 'base', x: 0, y: 0, children: [] };
let isPanning = false;
let startX, startY;
let activeTrainingSessionId = null;

// --- Canvas & SVG Setup ---
const canvas = document.querySelector('.tree-canvas');
const world = document.getElementById('tree-world');

const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svgEl.style.position = 'absolute';
svgEl.style.width = '100%';
svgEl.style.height = '100%';
svgEl.style.pointerEvents = 'none';
svgEl.style.zIndex = '1';
world.appendChild(svgEl);

function getCenterX() { return canvas.offsetWidth / 2; }
function getCenterY() { return canvas.offsetHeight / 2; }

function applyTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

// --- Node Creation ---
function createNode(node, isBase) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('node-wrapper');
  wrapper.dataset.name = node.name;
  wrapper.style.position = 'absolute';
  wrapper.style.left = (getCenterX() + node.x) + 'px';
  wrapper.style.top = (getCenterY() + node.y) + 'px';
  wrapper.style.transform = 'translate(-50%, -50%)';
  wrapper.style.zIndex = '2';

  const circle = document.createElement('div');
  circle.classList.add('node-circle');
  if (isBase) {
    circle.style.backgroundColor = '#FF4D00';       // base node: orange
  } else if (node.children.length > 0) {
    circle.style.backgroundColor = '#4D7EFF';       // branch node: blue
  } else {
    circle.style.backgroundColor = '#2DBD6E';       // leaf node: green
  }

  const label = document.createElement('span');
  label.classList.add('node-label');
  label.textContent = node.name;

  wrapper.appendChild(circle);
  wrapper.appendChild(label);
  world.appendChild(wrapper);

  // Node drag (only when pan tool is active)
  let isDraggingNode = false;
  let nodeStartX, nodeStartY;

  wrapper.addEventListener('mousedown', (e) => {
    if (activeTool !== 'pan') return;
    e.stopPropagation();
    isDraggingNode = true;
    nodeStartX = e.clientX;
    nodeStartY = e.clientY;
    wrapper.style.zIndex = '10';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingNode) return;
    const dx = (e.clientX - nodeStartX) / scale;
    const dy = (e.clientY - nodeStartY) / scale;
    nodeStartX = e.clientX;
    nodeStartY = e.clientY;
    wrapper.style.left = (wrapper.offsetLeft + dx) + 'px';
    wrapper.style.top = (wrapper.offsetTop + dy) + 'px';
    updateLines();
  });

  window.addEventListener('mouseup', () => {
    if (!isDraggingNode) return;
    isDraggingNode = false;
    wrapper.style.zIndex = '2';
    savePositions();
  });

  return wrapper;
}

// --- SVG Lines ---
function drawLine(x1, y1, x2, y2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', '#CCCCCC');
  line.setAttribute('stroke-width', '1');
  svgEl.appendChild(line);
}

function updateLines() {
  svgEl.innerHTML = '';
  function drawTreeLines(node, parent) {
    if (parent) {
      const parentEl = world.querySelector(`.node-wrapper[data-name="${parent.name}"]`);
      const nodeEl = world.querySelector(`.node-wrapper[data-name="${node.name}"]`);
      if (parentEl && nodeEl) {
        drawLine(parentEl.offsetLeft, parentEl.offsetTop, nodeEl.offsetLeft, nodeEl.offsetTop);
      }
    }
    node.children.forEach(child => drawTreeLines(child, node));
  }
  drawTreeLines(treeData, null);
}

function renderTree(node, parent, isBase) {
  createNode(node, isBase);
  if (parent) {
    drawLine(
      getCenterX() + parent.x, getCenterY() + parent.y,
      getCenterX() + node.x, getCenterY() + node.y
    );
  }
  node.children.forEach(child => renderTree(child, node, false));
}

// --- Explorer Sidebar ---
function buildExplorer(node, container, depth) {
  const item = document.createElement('div');
  item.classList.add('explorer-item');
  item.dataset.name = node.name;
  item.style.paddingLeft = (12 + depth * 16) + 'px';

  const folderIcon = document.createElement('span');
  folderIcon.style.fontSize = '12px';
  folderIcon.textContent = node.children.length > 0 ? '📁' : '📄';

  const label = document.createElement('span');
  label.classList.add('explorer-label');
  label.textContent = node.name;

  item.appendChild(folderIcon);
  item.appendChild(label);

  if (node.children.length > 0) {
    const chevron = document.createElement('span');
    chevron.classList.add('explorer-chevron');
    chevron.style.fontSize = '12px';
    chevron.textContent = '›';
    item.appendChild(chevron);

    const childContainer = document.createElement('div');
    childContainer.classList.add('explorer-children');
    childContainer.style.display = 'none';

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      item.classList.toggle('open');
      childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
      highlightNode(node.name);
    });

    node.children.forEach(child => buildExplorer(child, childContainer, depth + 1));
    container.appendChild(item);
    container.appendChild(childContainer);
  } else {
    item.addEventListener('click', () => highlightNode(node.name));
    container.appendChild(item);
  }
}

// --- Node Highlight (syncs canvas + explorer) ---
function highlightNode(name) {
  world.querySelectorAll('.node-wrapper').forEach(n => n.classList.remove('selected'));
  document.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));

  const info = document.getElementById('toolbar-node-info');
  const nameEl = document.getElementById('toolbar-node-name');
  const actions = document.querySelector('.toolbar-node-actions');

  world.querySelectorAll('.node-wrapper').forEach(node => {
    if (node.dataset.name === name) {
      node.classList.add('selected');
      info.style.display = 'flex';
      nameEl.textContent = name;
      const nodeData = findNodeByName(treeData, name);
      actions.style.display = (nodeData && nodeData.children.length === 0 && name !== 'base') ? 'flex' : 'none';
    }
  });

  document.querySelectorAll('.explorer-item').forEach(item => {
    if (item.dataset.name === name) item.classList.add('selected');
  });
}

function findNodeByName(node, name) {
  if (node.name === name) return node;
  for (const child of node.children) {
    const result = findNodeByName(child, name);
    if (result) return result;
  }
  return null;
}

function showError(message) {
  const error = document.getElementById('canvas-error');
  error.textContent = message;
  error.style.display = 'block';
  setTimeout(() => { error.style.display = 'none'; }, 3000);
}

function updateCursor() {
  if (activeTool === 'pan') canvas.style.cursor = 'grab';
  else if (activeTool === 'select') canvas.style.cursor = 'default';
  else if (activeTool === 'box select') canvas.style.cursor = 'crosshair';
  else if (activeTool === 'rename') canvas.style.cursor = 'text';
}

// --- Tauri Persistence ---
async function savePositions() {
  const positions = {};
  world.querySelectorAll('.node-wrapper').forEach(node => {
    positions[node.dataset.name] = [node.offsetLeft, node.offsetTop];
  });
  await window.__TAURI__.core.invoke('save_positions', { positions });
}

async function loadPositions() {
  return await window.__TAURI__.core.invoke('load_positions');
}

async function getNodePath(name) {
  const basePath = await window.__TAURI__.core.invoke('get_base_path');
  function findPath(node, target, currentPath) {
    const thisPath = currentPath + '/' + node.name;
    if (node.name === target) return thisPath;
    for (const child of node.children) {
      const result = findPath(child, target, thisPath);
      if (result) return result;
    }
    return null;
  }
  return findPath(treeData, name, basePath.slice(0, basePath.lastIndexOf('/')));
}

async function deleteNode(name) {
  const path = await getNodePath(name);
  if (!path) return;
  try {
    await window.__TAURI__.core.invoke('delete_node', { path });
    document.getElementById('toolbar-node-info').style.display = 'none';
    svgEl.innerHTML = '';
    world.querySelectorAll('.node-wrapper').forEach(n => n.remove());
    const sp = await loadTree();
    renderTree(treeData, null, true);
    if (Object.keys(sp).length > 0) {
      world.querySelectorAll('.node-wrapper').forEach(node => {
        const saved = sp[node.dataset.name];
        if (saved) { node.style.left = saved[0] + 'px'; node.style.top = saved[1] + 'px'; }
      });
      updateLines();
    }
    lucide.createIcons();
    await updateBaseSize();
  } catch (e) {
    showError('Error deleting: ' + e);
  }
}

function showDeleteModal(name) {
  pendingDeleteName = name;
  document.getElementById('modal-node-name').textContent = '"' + name + '"';
  document.getElementById('modal-overlay').classList.add('active');
}

async function loadTree() {
  const raw = await window.__TAURI__.core.invoke('get_tree');
  const savedPositions = await loadPositions();

  function assignPositions(node, depth = 0) {
    const ySpacing = 150;
    const xSpacing = 120;

    if (!node.children || node.children.length === 0) {
      node._width = xSpacing;
    } else {
      let totalWidth = 0;
      node.children.forEach(child => {
        assignPositions(child, depth + 1);
        totalWidth += child._width;
      });
      node._width = Math.max(totalWidth, xSpacing);
    }

    let currentX = -node._width / 2;
    node.children.forEach(child => {
      child.x = currentX + child._width / 2;
      child.y = (depth + 1) * ySpacing;
      currentX += child._width;
    });

    if (depth === 0) { node.x = 0; node.y = 0; }
    return node;
  }

  treeData = assignPositions(raw, 0, 0, 1);
  document.querySelector('.ontology-explorer').innerHTML = '';
  buildExplorer(treeData, document.querySelector('.ontology-explorer'), 0);
  setTimeout(() => lucide.createIcons(), 10);
  return savedPositions;
}

async function updateBaseSize() {
  const bytes = await window.__TAURI__.core.invoke('get_base_size');
  let display;
  if (bytes < 1024) display = bytes + ' B';
  else if (bytes < 1024 * 1024) display = (bytes / 1024).toFixed(1) + ' KB';
  else display = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  document.getElementById('canvas-size-info').textContent = 'base: ' + display;
}

// --- Ontology Init ---
document.querySelector('.ontology-explorer').innerHTML = '';
buildExplorer(treeData, document.querySelector('.ontology-explorer'), 0);
lucide.createIcons();

// --- Toolbar Tool Selection ---
document.querySelectorAll('.toolbar-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTool = btn.getAttribute('title').toLowerCase();
    updateCursor();
  });
});
document.querySelectorAll('.toolbar-btn')[1].classList.add('active');

// --- Canvas Pan ---
canvas.addEventListener('mousedown', (e) => {
  if (activeTool !== 'pan') return;
  isPanning = true;
  canvas.style.cursor = 'grabbing';
  startX = e.clientX;
  startY = e.clientY;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX += e.clientX - startX;
  panY += e.clientY - startY;
  startX = e.clientX;
  startY = e.clientY;
  applyTransform();
});

canvas.addEventListener('mouseup', () => { isPanning = false; updateCursor(); });
canvas.addEventListener('mouseleave', () => { isPanning = false; updateCursor(); });

// --- Canvas Zoom (Ctrl + Scroll) ---
canvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  scale = Math.min(Math.max(scale + (e.deltaY > 0 ? -0.05 : 0.05), 0.2), 3);
  applyTransform();
}, { passive: false });

// --- Reset Zoom (Middle Click + Ctrl) ---
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 && e.ctrlKey) {
    e.preventDefault();
    scale = 1; panX = 0; panY = 0;
    applyTransform();
  }
});

// --- Node Select Tool ---
canvas.addEventListener('click', (e) => {
  if (activeTool !== 'select') return;
  const node = e.target.closest('.node-wrapper');
  const info = document.getElementById('toolbar-node-info');
  const nameEl = document.getElementById('toolbar-node-name');

  world.querySelectorAll('.node-wrapper').forEach(n => n.classList.remove('selected'));
  document.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));

  if (node) {
    node.classList.add('selected');
    const label = node.querySelector('.node-label').textContent;
    nameEl.textContent = label;
    info.style.display = 'flex';

    const nodeData = findNodeByName(treeData, label);
    const actions = document.querySelector('.toolbar-node-actions');

    // Check if it's a leaf node (no children) and not the 'base'
    const isLeafNode = nodeData && nodeData.children.length === 0 && label !== 'base';

    if (isLeafNode) {
      actions.style.display = 'flex';
      info.style.paddingRight = '6px'; // Specific padding for nodes with actions
    } else {
      actions.style.display = 'none';
      info.style.paddingRight = '12px'; // Padding for "folders" or base
    }

    document.querySelectorAll('.explorer-item').forEach(item => {
      if (item.dataset.name === label) item.classList.add('selected');
    });
  } else {
    info.style.display = 'none';
  }
});

// --- Box Select Tool ---
let isSelecting = false;
let selectStartX, selectStartY;
const selectionBox = document.createElement('div');
selectionBox.classList.add('selection-box');
canvas.appendChild(selectionBox);

canvas.addEventListener('mousedown', (e) => {
  if (activeTool !== 'box select') return;
  isSelecting = true;
  const rect = canvas.getBoundingClientRect();
  selectStartX = e.clientX - rect.left;
  selectStartY = e.clientY - rect.top;
  selectionBox.style.left = selectStartX + 'px';
  selectionBox.style.top = selectStartY + 'px';
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  selectionBox.style.display = 'block';
});

canvas.addEventListener('mousemove', (e) => {
  if (!isSelecting) return;
  const rect = canvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  const width = currentX - selectStartX;
  const height = currentY - selectStartY;
  selectionBox.style.left = (width < 0 ? currentX : selectStartX) + 'px';
  selectionBox.style.top = (height < 0 ? currentY : selectStartY) + 'px';
  selectionBox.style.width = Math.abs(width) + 'px';
  selectionBox.style.height = Math.abs(height) + 'px';

  const selRect = selectionBox.getBoundingClientRect();
  world.querySelectorAll('.node-wrapper').forEach(node => {
    const nodeRect = node.getBoundingClientRect();
    const inside = nodeRect.left < selRect.right && nodeRect.right > selRect.left &&
      nodeRect.top < selRect.bottom && nodeRect.bottom > selRect.top;
    node.classList.toggle('selected', inside);
  });
});

canvas.addEventListener('mouseup', () => {
  if (!isSelecting) return;
  isSelecting = false;
  selectionBox.style.display = 'none';

  const selected = world.querySelectorAll('.node-wrapper.selected');
  const info = document.getElementById('toolbar-node-info');
  const nameEl = document.getElementById('toolbar-node-name');
  const actions = document.querySelector('.toolbar-node-actions');

  document.querySelectorAll('.explorer-item').forEach(i => i.classList.remove('selected'));

  if (selected.length > 0) {
    nameEl.textContent = selected.length + ' selected';
    info.style.display = 'flex';
    actions.style.display = 'none';
    selected.forEach(node => {
      const label = node.querySelector('.node-label').textContent;
      document.querySelectorAll('.explorer-item').forEach(item => {
        if (item.dataset.name === label) item.classList.add('selected');
      });
    });
  } else {
    info.style.display = 'none';
  }
});

// --- Rename Tool ---
canvas.addEventListener('click', (e) => {
  if (activeTool !== 'rename') return;
  const node = e.target.closest('.node-wrapper');
  if (!node) return;
  if (node.dataset.name === 'base') { showError('Error #AAAA, base cannot be renamed'); return; }

  const label = node.querySelector('.node-label');
  const oldName = label.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.classList.add('node-rename-input');
  label.replaceWith(input);
  input.focus();
  input.select();

  async function commitRename() {
    const newName = input.value.trim() || oldName;
    const newLabel = document.createElement('span');
    newLabel.classList.add('node-label');
    newLabel.textContent = newName;
    input.replaceWith(newLabel);

    const basePath = await window.__TAURI__.core.invoke('get_base_path');
    function findPath(n, target, currentPath) {
      const thisPath = currentPath + '/' + n.name;
      if (n.name === target) return thisPath;
      for (const child of n.children) {
        const result = findPath(child, target, thisPath);
        if (result) return result;
      }
      return null;
    }

    const oldPath = findPath(treeData, oldName, basePath.slice(0, basePath.lastIndexOf('/')));
    if (oldPath) {
      try {
        await window.__TAURI__.core.invoke('rename_node', { oldPath, newName });
        node.dataset.name = newName;
        document.querySelectorAll('.explorer-item').forEach(item => {
          if (item.dataset.name === oldName) {
            item.dataset.name = newName;
            item.querySelector('.explorer-label').textContent = newName;
          }
        });
      } catch (e) {
        showError('Error renaming: ' + e);
        newLabel.textContent = oldName;
        node.dataset.name = oldName;
      }
    }
  }

  input.addEventListener('blur', commitRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') {
      const newLabel = document.createElement('span');
      newLabel.classList.add('node-label');
      newLabel.textContent = oldName;
      input.replaceWith(newLabel);
    }
  });
});

// --- Context Menu ---
const contextMenu = document.getElementById('context-menu');

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const node = e.target.closest('.node-wrapper');
  if (!node || node.dataset.name === 'base') { contextMenu.style.display = 'none'; return; }

  contextNode = node;
  const nodeData = findNodeByName(treeData, node.dataset.name);
  const isLeaf = nodeData && nodeData.children.length === 0;

  contextMenu.querySelectorAll('.context-item').forEach(item => {
    const text = item.textContent.trim();
    if (text.startsWith('Train') || text.startsWith('Search')) item.style.display = isLeaf ? 'flex' : 'none';
    if (text.startsWith('Delete')) item.style.display = 'flex';
  });

  contextMenu.style.display = 'block';
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
});

document.addEventListener('click', () => { contextMenu.style.display = 'none'; });

document.getElementById('ctx-share-node').addEventListener('click', async () => {
  if (!contextNode) return;
  const name = contextNode.dataset.name;
  try {
    const raw = await window.__TAURI__.core.invoke('get_all_knowledge');
    const all = JSON.parse(raw);
    const node = all.find(k => k.name === name || k.folder === name);
    if (node) {
      navigator.clipboard.writeText(JSON.stringify(node, null, 2));
      showError('Node data copied to clipboard!');
    } else {
      showError('No data found for this node.');
    }
  } catch (e) { showError('Copy failed: ' + e); }
  contextMenu.style.display = 'none';
});

document.getElementById('ctx-reveal-node').addEventListener('click', async () => {
  if (!contextNode) return;
  const path = await getNodePath(contextNode.dataset.name);
  if (path) await window.__TAURI__.core.invoke('reveal_in_explorer', { path });
  contextMenu.style.display = 'none';
});

document.getElementById('ctx-delete-node').addEventListener('click', () => {
  if (!contextNode) return;
  showDeleteModal(contextNode.dataset.name);
  contextMenu.style.display = 'none';
});

function showUsagePopup(name) {
  // Remove existing popup
  const existing = document.getElementById('usage-popup');
  if (existing) existing.remove();

  // Get usage from localStorage
  const usageKey = `node_usage_${name}`;
  const usage = JSON.parse(localStorage.getItem(usageKey) || '{"count":0,"last":null}');

  const popup = document.createElement('div');
  popup.id = 'usage-popup';
  popup.style.cssText = `
    position: fixed;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 14px 18px;
    font-family: monospace;
    font-size: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 9999;
    min-width: 200px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  `;
  popup.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px;color:#333;">${name}</div>
    <div style="color:#666;">Times used: <strong>${usage.count}</strong></div>
    <div style="color:#666;margin-top:4px;">Last used: <strong>${usage.last || 'Never'}</strong></div>
    <button onclick="document.getElementById('usage-popup').remove()"
      style="margin-top:12px;padding:4px 12px;background:#f5f5f5;border:1px solid #ddd;
             border-radius:4px;cursor:pointer;font-size:11px;width:100%;">Close</button>
  `;
  document.body.appendChild(popup);
}

document.getElementById('ctx-usage-node').addEventListener('click', () => {
  if (!contextNode) return;
  showUsagePopup(contextNode.dataset.name);
  contextMenu.style.display = 'none';
});

// --- Delete Modal ---
document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('active');
  pendingDeleteName = null;
});

document.getElementById('modal-confirm').addEventListener('click', async () => {
  document.getElementById('modal-overlay').classList.remove('active');
  if (pendingDeleteName) { await deleteNode(pendingDeleteName); pendingDeleteName = null; }
});

// Toolbar delete button
document.getElementById('toolbar-node-delete').addEventListener('click', () => {
  const name = document.getElementById('toolbar-node-name').textContent;
  if (name) showDeleteModal(name);
});

// --- Keyboard Shortcuts (ontology only) ---
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!document.getElementById('section-knowledge-ontology').classList.contains('active')) return;

  switch (e.key.toLowerCase()) {
    case 'g': setActiveTool('pan'); break;
    case 'v': setActiveTool('select'); break;
    case 'b': setActiveTool('box select'); break;
    case 'r': setActiveTool('rename'); break;
  }

  if (e.key === 'Delete' && e.shiftKey) {
    const selected = world.querySelectorAll('.node-wrapper.selected');
    if (selected.length === 1 && selected[0].dataset.name !== 'base') {
      showDeleteModal(selected[0].dataset.name);
    }
  }
});

function setActiveTool(tool) {
  activeTool = tool;
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('title').toLowerCase() === tool) btn.classList.add('active');
  });
  updateCursor();
}

// --- Left Panel Collapse ---
const leftPanel = document.querySelector('.left-panel');
const footerChevron = document.querySelector('.footer-chevron');
footerChevron.addEventListener('click', () => { leftPanel.classList.toggle('collapsed'); });

// --- Column Resizers (grid table) ---
document.querySelectorAll('.resizer').forEach(resizer => {
  resizer.addEventListener('mousedown', function (e) {
    const cell = e.target.parentElement;
    const colClass = cell.classList[1];
    const startX = e.pageX;
    const startWidth = cell.offsetWidth;

    function onMouseMove(e) {
      const newWidth = startWidth + (e.pageX - startX);
      if (newWidth > 30) {
        document.querySelectorAll(`.${colClass}`).forEach(el => {
          el.style.flex = `0 0 ${newWidth}px`;
        });
      }
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
});


// ============================================================
// INSTRUCTION CONSOLE
// ============================================================

// --- State ---
let sessionMode = null;
let modelActive = false;
let currentFolder = null;
let currentSub = null;
let currentSubCode = null;
let subMessages = [];
let recalledContext = [];

// --- DOM Refs ---
const feedInput = document.getElementById('feed-input');
const feedSendBtn = document.getElementById('feed-send-btn');
const consoleMessages = document.getElementById('console-messages');

const instructionFeed = document.querySelector('.instruction-feed');
const maxHeight = 200;

feedInput.addEventListener('input', function () {
  // 1. Grow the textarea
  this.style.height = 'auto';
  if (this.scrollHeight < maxHeight) {
    this.style.height = this.scrollHeight + 'px';
    this.style.overflowY = 'hidden';
  } else {
    this.style.height = maxHeight + 'px';
    this.style.overflowY = 'auto';
  }

  // 2. Adjust the bottom of the messages section
  // offsetsHeight is the total height of the instruction-feed box
  const newBottom = instructionFeed.offsetHeight + 16 + 12; // 16 is its bottom pos, 12 is gap
  consoleMessages.style.bottom = newBottom + 'px';

  // 3. Keep the latest messages in view
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
});

// --- Sessions State ---
let sessions = [];
let activeSessionId = null;


// --- Send Instruction ---
function sendInstruction() {
  if (cmdPalette.style.display !== 'none' && selectedIndex >= 0) return;

  const text = feedInput.value.trim();
  if (!text) return;
  feedInput.value = '';

  // Auto-create a session on first send if none exists
  if (activeSessionId === null) createSession();

  if (skillCreationMode) {
    handleSkillCreationInput(text);
    return;
  }

  if (workflowCreationMode) {
    handleWorkflowCreationInput(text);
    return;
  }

  if (handleCommand(text)) return;

  if (!modelActive) {
    showErrorMessage('Session not initialized. Use /train --(mode) to begin a training session.');
    return;
  }

  processTrainingInput(text);

  if (!sessionMode) return;

  document.getElementById('console-status-text').textContent = 'Training in progress';
  document.getElementById('console-status-dot').classList.add('active');
}

function showErrorMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  wrapper.innerHTML = `
    <div class="message-bubble">
      <span class="message-label">[Error]</span>
      <div class="message-box error-box">${msg}</div>
    </div>
  `;
  consoleMessages.appendChild(wrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
}

feedSendBtn.addEventListener('click', sendInstruction);
feedInput.addEventListener('keydown', (e) => {
  // Shift + Enter = SEND
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    sendInstruction();
  }

  // Normal Enter = New line
});

// --- Command Palette ---
const cmdPalette = document.getElementById('cmd-palette');
const cmdItems = cmdPalette.querySelectorAll('.cmd-item');
let selectedIndex = -1;

function showPalette(filter) {
  let anyVisible = false;
  cmdItems.forEach(item => {
    const match = item.getAttribute('data-cmd').startsWith(filter);
    item.style.display = match ? 'flex' : 'none';
    if (match) anyVisible = true;
  });
  cmdPalette.style.display = anyVisible ? 'block' : 'none';
  selectedIndex = -1;
}

function hidePalette() {
  cmdPalette.style.display = 'none';
  selectedIndex = -1;
  cmdItems.forEach(i => i.classList.remove('selected'));
}

function selectCmd(cmd) {
  feedInput.value = cmd + ' ';
  hidePalette();
  feedInput.focus();
}

feedInput.addEventListener('input', () => {
  feedInput.value.startsWith('/') ? showPalette(feedInput.value.trim()) : hidePalette();
});

feedInput.addEventListener('keydown', (e) => {
  const visible = [...cmdItems].filter(i => i.style.display !== 'none');
  if (cmdPalette.style.display === 'none' || visible.length === 0) return;

  if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + visible.length) % visible.length; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % visible.length; }
  else if (e.key === 'Enter' && selectedIndex >= 0) { e.preventDefault(); selectCmd(visible[selectedIndex].getAttribute('data-cmd')); return; }
  else if (e.key === 'Escape') { hidePalette(); return; }

  visible.forEach((item, i) => item.classList.toggle('selected', i === selectedIndex));
});

cmdItems.forEach(item => { item.addEventListener('click', () => selectCmd(item.getAttribute('data-cmd'))); });
feedInput.addEventListener('blur', () => setTimeout(hidePalette, 150));

// --- Ollama API Call ---
async function callOllama(prompt, conversationHistory = []) {
  let fullPrompt = conversationHistory.length > 0
    ? conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + `\nUser: ${prompt}\nAssistant:`
    : `User: ${prompt}\nAssistant:`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: (JSON.parse(localStorage.getItem('syntx_settings') || '{}').textModel || 'gemma2:2b'), prompt: fullPrompt, stream: true })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.decode(value).split('\n').filter(Boolean).forEach(line => {
      try { const json = JSON.parse(line); if (json.response) full += json.response; } catch { }
    });
  }
  return full.trim();
}

// --- Conversation History Builder ---
function buildConversationHistory() {
  const session = sessions.find(s => s.id === activeSessionId);
  if (!session || !session.messages) return [];

  const history = [];

  // inject recalled knowledge context at the start
  if (recalledContext.length > 0) {
    const contextSummary = recalledContext.map(rc =>
      `About "${rc.name}": ${rc.facts.join('. ')}${rc.summary ? ` Summary: ${rc.summary}` : ''}`
    ).join('\n\n');
    history.push({ role: 'user', content: `Here is my recalled knowledge context:\n${contextSummary}` });
    history.push({ role: 'assistant', content: 'I have loaded this knowledge into my memory and am ready to continue.' });
  }

  for (const msg of session.messages) {
    if (msg.type === 'user') history.push({ role: 'user', content: typeof msg.content === 'object' ? msg.content.content : msg.content });
    else if (msg.type === 'assistant') history.push({ role: 'assistant', content: msg.content });
  }

  return history;
}

// --- Command Handler ---
function handleCommand(input) {
  const trimmed = input.trim();

  // /train --text -folder_name
  if (trimmed.startsWith('/train --text')) {
    const parts = trimmed.split(' ');
    const folderPart = parts.find(p => p.startsWith('-') && p !== '--text');
    const folderName = folderPart ? folderPart.substring(1) : 'general';

    sessionMode = 'text';
    modelActive = true;
    currentFolder = folderName;
    currentSub = null;
    subMessages = [];

    if (activeSessionId === null) createSession();
    activeTrainingSessionId = activeSessionId;
    setFeedLocked(false);

    window.__TAURI__.core.invoke('create_session_folder', { folderName: currentFolder }).catch(console.error);

    document.getElementById('console-status-text').textContent = 'Training in progress';
    document.getElementById('console-status-dot').classList.add('active');
    sessionList.classList.add('open');
    navSessionChevron.classList.add('open');
    document.getElementById('session-separator').classList.add('open');

    showSystemMessage(`Session started! Theme: <strong>${folderName}</strong> — use /sub [name] to start a sub-session.`);
    return true;
  }

  // /sub sub_name — starts a sub-session under the current folder
  if (trimmed.startsWith('/sub ')) {
    if (!currentFolder) { showErrorMessage('No active session! Start with /train --text -folder_name first.'); return true; }
    const subName = trimmed.substring(5).trim().toLowerCase().replace(/\s+/g, '_');
    currentSub = subName;
    subMessages = [];

    window.__TAURI__.core.invoke('create_subsession', { folderName: currentFolder, subName: currentSub })
      .then(code => { currentSubCode = code; showSystemMessage(`Sub-session started: <strong>${subName}</strong> — Retrieval code: <strong>${code}</strong>`); })
      .catch(console.error);
    return true;
  }

  // /endsub — ends the current sub-session and generates a summary
  if (trimmed === '/endsub') {
    if (!currentSub) { showErrorMessage('No active sub-session!'); return true; }
    endSubSession();
    return true;
  }

  // /recall CODE — loads a past sub-session into context
  if (trimmed.startsWith('/recall ')) {
    const code = trimmed.substring(8).trim().toUpperCase();
    if (!code) { showErrorMessage('Please provide a retrieval code! Example: /recall UN-135'); return true; }
    recallSubSession(code);
    return true;
  }

  // /quit — ends the training session entirely
  if (trimmed === '/quit') {
    if (currentSub) { showErrorMessage('End the sub-session first using /endsub before quitting!'); return true; }
    sessionMode = null;
    modelActive = false;
    currentFolder = null;
    currentSub = null;
    currentSubCode = null;
    subMessages = [];
    recalledContext = [];
    document.getElementById('console-status-text').textContent = 'Training in halt';
    document.getElementById('console-status-dot').classList.remove('active');
    setFeedLocked(false);
    showSystemMessage('Session ended. You can now switch to other sessions.', true);
    saveSessions();
    window.syntxPlaySound();
    return true;
  }

  if (trimmed.startsWith('/skill')) {
    handleSkillCommand(trimmed);
    return true;
  }

  if (trimmed.startsWith('/workflow')) {
    handleWorkflowCommand(trimmed);
    return true;
  }

  return false;
}

// --- System Message UI ---
function showSystemMessage(msg, save = true) {
  const wrapper = document.createElement('div');
  wrapper.className = 'system-block';
  wrapper.innerHTML = `
    <div class="system-bubble">
      <span class="system-label">[System]</span>
      <div class="system-reply" style="display:block;opacity:1;border-color:#4D7EFF;color:#4D7EFF;font-size:12px;font-family:monospace;">${msg}</div>
    </div>
  `;
  consoleMessages.appendChild(wrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
  if (save) saveMessageToSession('system', { msg, color: 'blue' });
}

// --- Sub-session End (generates AI summary) ---
async function endSubSession() {
  showTypingIndicator();
  const factsRaw = await window.__TAURI__.core.invoke('get_facts', { folderName: currentFolder, subName: currentSub });
  const facts = JSON.parse(factsRaw);
  const summary = await callOllama(
    `Summarize everything learned about "${currentSub}" in a clear, concise paragraph.\nFacts learned: ${facts.join('. ')}\nOutput ONLY the summary, nothing else.`, []
  );
  hideTypingIndicator();
  await window.__TAURI__.core.invoke('save_summary', { folderName: currentFolder, subName: currentSub, summary });
  showEndSubMessage(`<strong>Sub-session "${currentSub}" ended!</strong><br><br><strong>Summary:</strong> ${summary}<br><br><span style="color:#2DBD6E;font-size:11px;font-family:monospace;">Retrieval code: ${currentSubCode}</span>`);
  currentSub = null;
  currentSubCode = null;
  subMessages = [];
  await saveSessions();
}

// --- Training Input Processor ---
async function processTrainingInput(instruction) {

  if (skillCreationMode) {
    handleSkillCreationInput(instruction);
    return;
  }

  const isKnowledge = currentSub ? classifyInstruction(instruction) === 'knowledge' : false;

  // User message bubble
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <span class="message-label">[User]</span>
    <button class="msg-action-btn copy-btn" onclick="copyMessage(this)">
      <i data-lucide="copy" style="width:11px;height:11px;"></i>
    </button>
    <button class="msg-action-btn insert-btn ${isKnowledge ? 'inserted' : ''}">
      <i data-lucide="${isKnowledge ? 'database' : 'upload'}" style="width:11px;height:11px;"></i>
    </button>
    <div class="message-box">${instruction}</div>
    ${isKnowledge ? '<div class="message-tag">⬡ Knowledge update</div>' : ''}
  `;

  const insertBtn = bubble.querySelector('.insert-btn');
  insertBtn.dataset.instruction = instruction;
  insertBtn.addEventListener('click', () => manualInsert(insertBtn, insertBtn.dataset.instruction));

  wrapper.appendChild(bubble);
  consoleMessages.appendChild(wrapper);
  lucide.createIcons();
  saveMessageToSession('user', { content: instruction, isKnowledge });

  // Auto-generate session title on first message
  const session = sessions.find(s => s.id === activeSessionId);
  if (session && session.title === 'New Session') {
    const objective = await callOllama(`Generate a very short 3-5 word title for a session about: "${currentFolder}". Output ONLY the title.`, []);
    session.title = objective.trim();
    document.getElementById('console-objective-text').textContent = session.title;
    renderSessions();
    lucide.createIcons();
  }

  showTypingIndicator();

  // Load existing facts for context
  let existingFacts = [];
  if (currentSub) {
    try {
      const factsRaw = await window.__TAURI__.core.invoke('get_facts', { folderName: currentFolder, subName: currentSub });
      existingFacts = JSON.parse(factsRaw);
    } catch (err) { console.error('get_facts error:', err); }
  }

  // Build system prompt based on active state
  const systemPrompt = !currentSub
    ? `You are a curious AI student ready to learn. The session theme is: "${currentFolder}". No sub-session is active yet. Respond naturally but gently remind the user to start a sub-session with /sub [name] to begin training.`
    : `You are a curious AI student currently learning about "${currentSub}" in the subject "${currentFolder}".
What you already know about ${currentSub}:
${existingFacts.length > 0 ? existingFacts.join('\n') : 'Nothing yet — this is the beginning!'}
YOUR RULES:
- If the user teaches you something new → acknowledge it naturally and ask ONE curious follow up question
- If the user is just chatting → reply naturally and stay in character as a student
- If the user talks about a completely different subject → gently say you are currently focused on "${currentSub}"
- NEVER break character. NEVER say you are an AI. Keep replies short — 1 to 3 sentences max`;

  // Auto-insert fact if classified as knowledge
  if (isKnowledge && currentSub) {
    try {
      await window.__TAURI__.core.invoke('insert_fact', { folderName: currentFolder, subName: currentSub, fact: instruction });
    } catch (err) { console.error('insert_fact error:', err); }
  }

  const history = buildConversationHistory();
  const reply = await callOllama(systemPrompt + '\n\nNow respond to: ' + instruction, history);
  hideTypingIndicator();
  showAIReply(reply);
  saveMessageToSession('assistant', reply);
  await saveSessions();
}

function showAIReply(reply) {
  const replyWrapper = document.createElement('div');
  replyWrapper.className = 'system-block';
  replyWrapper.innerHTML = `
    <div class="system-bubble">
      <span class="system-label">[System]</span>
      <button class="copy-btn" onclick="copyMessage(this)">
        <i data-lucide="copy" style="width:11px;height:11px;"></i>
      </button>
      <div class="system-reply" style="display:block;opacity:1;">${reply}</div>
    </div>
  `;
  consoleMessages.appendChild(replyWrapper);
  renderLatex(replyWrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
  lucide.createIcons();
}

function showEndSubMessage(msg, save = true) {
  const wrapper = document.createElement('div');
  wrapper.className = 'system-block';
  wrapper.innerHTML = `
    <div class="system-bubble">
      <span class="system-label">[System]</span>
      <div class="system-reply" style="display:block;opacity:1;border-color:#2DBD6E;color:#333;font-size:13px;">${msg}</div>
    </div>
  `;
  consoleMessages.appendChild(wrapper);
  renderLatex(wrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
  if (save) saveMessageToSession('system', { msg, color: 'green' });
}

function saveMessageToSession(type, content) {
  const session = sessions.find(s => s.id === activeSessionId);
  if (!session) return;
  if (!session.messages) session.messages = [];
  session.messages.push({ type, content });
}

// --- Typing Indicator ---
function showTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'system-block';
  wrapper.id = 'typing-indicator';
  wrapper.innerHTML = `
    <div class="system-bubble">
      <span class="system-label">[System]</span>
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  consoleMessages.appendChild(wrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

// --- Feed Lock (prevent input when another session is training) ---
function setFeedLocked(locked) {
  const feedInput = document.getElementById('feed-input');
  const feedSendBtn = document.getElementById('feed-send-btn');
  if (locked) {
    feedInput.disabled = true;
    feedInput.placeholder = 'Another session is active...';
    feedInput.style.color = '#aaa';
    feedSendBtn.disabled = true;
    feedSendBtn.style.background = '#ccc';
    feedSendBtn.style.cursor = 'not-allowed';
  } else {
    feedInput.disabled = false;
    feedInput.placeholder = 'Instruction feed';
    feedInput.style.color = '#333';
    feedSendBtn.disabled = false;
    feedSendBtn.style.background = '#FF4D00';
    feedSendBtn.style.cursor = 'pointer';
  }
}

// --- Manual Knowledge Insert ---
async function manualInsert(btn, instruction) {
  if (!currentSub || !currentFolder) { showErrorMessage('No active sub-session to insert into!'); return; }
  try {
    await window.__TAURI__.core.invoke('insert_fact', { folderName: currentFolder, subName: currentSub, fact: instruction });
    btn.classList.add('inserted');
    btn.innerHTML = '<i data-lucide="database" style="width:11px;height:11px;"></i>';
    lucide.createIcons();
    const bubble = btn.closest('.message-bubble');
    if (!bubble.querySelector('.message-tag')) {
      const tag = document.createElement('div');
      tag.className = 'message-tag';
      tag.textContent = '⬡ Knowledge update';
      bubble.appendChild(tag);
    }
  } catch (err) {
    console.error('Manual insert error:', err);
    showErrorMessage('Failed to insert into database!');
  }
}

// --- Instruction Classifier ---
function classifyInstruction(text) {
  const t = text.trim();
  if (t.split(' ').length < 4) return 'casual';
  if (t.endsWith('?')) return 'casual';

  const casualPhrases = ['hi', 'hello', 'hey', 'bye', 'thanks', 'thank you', 'ok', 'okay', 'sure', 'cool', 'great', 'nice', 'wow', 'lol', 'haha', 'yes', 'no', 'can i', 'could i', 'should i', 'what do you', 'how do you', 'i think', 'i feel', 'i want', 'i like', 'i need', 'so what', 'that is', "that's", 'interesting', 'amazing', 'awesome'];
  const lower = t.toLowerCase();
  if (casualPhrases.some(p => lower.startsWith(p))) return 'casual';

  const knowledgeIndicators = [' is ', ' are ', ' was ', ' were ', ' has ', ' have ', ' means ', ' defined ', ' refers ', ' consists ', ' contains ', ' equals ', ' formula ', ' called ', ' known as ', ' discovered ', ' invented ', ' created ', ' located ', ' born ', ' died ', ' founded '];
  if (knowledgeIndicators.some(k => lower.includes(k))) return 'knowledge';

  return 'casual';
}

// --- Sub-session Recall ---
async function recallSubSession(code) {
  showTypingIndicator();
  try {
    const raw = await window.__TAURI__.core.invoke('recall_subsession', { retrievalCode: code });
    const data = JSON.parse(raw);
    hideTypingIndicator();

    recalledContext.push({ name: data.name, folder: data.folder, facts: data.facts, summary: data.summary, code: data.retrieval_code });

    showSystemMessage(`⬡ Recalled sub-session: <strong>${data.name}</strong> [${data.retrieval_code}]<br>${data.facts.length} facts loaded into context.${data.summary ? `<br><strong>Summary:</strong> ${data.summary}` : ''}`, true);

    showTypingIndicator();
    const reply = await callOllama(
      `The teacher has recalled a previous training session about "${data.name}". Facts: ${data.facts.join('. ')}${data.summary ? ` Summary: ${data.summary}` : ''} Acknowledge that you now remember this and are ready to continue.`,
      buildConversationHistory()
    );
    hideTypingIndicator();
    showAIReply(reply);
    saveMessageToSession('assistant', reply);
    await saveSessions();
  } catch (err) {
    hideTypingIndicator();
    showErrorMessage(`Could not recall: ${err}`);
  }
}

// --- Copy Message ---
function copyMessage(btn) {
  const bubble = btn.closest('.message-bubble, .system-bubble');
  const textEl = bubble.querySelector('.message-box, .system-reply');
  navigator.clipboard.writeText(textEl.innerText).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<i data-lucide="check" style="width:11px;height:11px;"></i>';
    lucide.createIcons();
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<i data-lucide="copy" style="width:11px;height:11px;"></i>';
      lucide.createIcons();
    }, 2000);
  });
}

// --- LaTeX Renderer ---
function renderLatex(element) {
  if (typeof renderMathInElement === 'undefined') return;
  renderMathInElement(element, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false
  });
}

// --- Session Management ---
async function saveSessions() {
  try {
    await window.__TAURI__.core.invoke('save_sessions', { sessions: JSON.stringify(sessions) });
  } catch (err) { console.error('Save sessions error:', err); }
}

const navSessionAdd = document.getElementById('nav-session-add');
const navSessionChevron = document.getElementById('nav-session-chevron');
const sessionList = document.getElementById('session-list');

async function createSession() {
  const id = Date.now();
  const session = { id, title: 'New Session', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), starred: false, messages: [] };
  sessions.push(session);
  renderSessions();
  switchSession(id);
  sessionList.classList.add('open');
  navSessionChevron.classList.add('open');
  document.getElementById('session-separator').classList.add('open');
  lucide.createIcons();
  await saveSessions();
}

function renderSessions() {
  sessionList.innerHTML = '';
  sessions.forEach(session => {
    const isViewing = session.id === activeSessionId;
    const isTraining = session.id === activeTrainingSessionId;
    const li = document.createElement('li');
    li.className = 'session-item' + (isViewing ? ' active' : '');
    li.setAttribute('data-id', session.id);
    li.innerHTML = `
      <div class="session-dot ${isTraining ? 'active' : ''}"></div>
      <span class="session-title">${session.title}</span>
      ${session.starred ? '<i data-lucide="star" style="width:10px;height:10px;color:#FF4D00;flex-shrink:0;"></i>' : ''}
      <span class="session-time">${session.time}</span>
    `;
    li.addEventListener('click', () => switchSession(session.id));
    li.addEventListener('contextmenu', (e) => showSessionContextMenu(e, session.id));
    sessionList.appendChild(li);
  });
}

async function switchSession(id) {
  activeSessionId = id;
  consoleMessages.innerHTML = '';
  recalledContext = [];

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');

  const session = sessions.find(s => s.id === id);
  document.getElementById('console-objective-text').textContent = session.title;

  const isActiveSession = session.id === activeTrainingSessionId;
  if (modelActive && !isActiveSession) {
    document.getElementById('console-status-text').textContent = 'Another training in progress';
    document.getElementById('console-status-dot').classList.remove('active');
  } else if (modelActive && isActiveSession) {
    document.getElementById('console-status-text').textContent = 'Training in progress';
    document.getElementById('console-status-dot').classList.add('active');
  } else {
    document.getElementById('console-status-text').textContent = 'Training in halt';
    document.getElementById('console-status-dot').classList.remove('active');
  }

  // Restore messages from session history
  if (session.messages && session.messages.length > 0) {
    for (const msg of session.messages) {
      if (msg.type === 'user') {
        const text = typeof msg.content === 'object' ? msg.content.content : msg.content;
        const isKnowledge = typeof msg.content === 'object' ? msg.content.isKnowledge : false;
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = `
          <span class="message-label">[User]</span>
          <button class="msg-action-btn copy-btn" onclick="copyMessage(this)">
            <i data-lucide="copy" style="width:11px;height:11px;"></i>
          </button>
          <button class="msg-action-btn insert-btn ${isKnowledge ? 'inserted' : ''}">
            <i data-lucide="${isKnowledge ? 'database' : 'upload'}" style="width:11px;height:11px;"></i>
          </button>
          <div class="message-box">${text}</div>
          ${isKnowledge ? '<div class="message-tag">⬡ Knowledge update</div>' : ''}
        `;
        const insertBtn = bubble.querySelector('.insert-btn');
        insertBtn.dataset.instruction = text;
        insertBtn.addEventListener('click', () => manualInsert(insertBtn, insertBtn.dataset.instruction));
        wrapper.appendChild(bubble);
        consoleMessages.appendChild(wrapper);
        lucide.createIcons();

      } else if (msg.type === 'assistant') {
        const replyWrapper = document.createElement('div');
        replyWrapper.className = 'system-block';
        replyWrapper.innerHTML = `
          <div class="system-bubble">
            <span class="system-label">[System]</span>
            <button class="copy-btn" onclick="copyMessage(this)">
              <i data-lucide="copy" style="width:11px;height:11px;"></i>
            </button>
            <div class="system-reply" style="display:block;opacity:1;">${msg.content}</div>
          </div>
        `;
        consoleMessages.appendChild(replyWrapper);
        renderLatex(replyWrapper);

      } else if (msg.type === 'system') {
        const color = msg.content.color === 'blue' ? '#4D7EFF' : '#2DBD6E';
        const textColor = msg.content.color === 'blue' ? '#4D7EFF' : '#333';
        const fontSize = msg.content.color === 'blue' ? '12px' : '13px';
        const fontFamily = msg.content.color === 'blue' ? 'monospace' : 'inherit';
        const wrapper = document.createElement('div');
        wrapper.className = 'system-block';
        wrapper.innerHTML = `
          <div class="system-bubble">
            <span class="system-label">[System]</span>
            <div class="system-reply" style="display:block;opacity:1;border-color:${color};color:${textColor};font-size:${fontSize};font-family:${fontFamily};">${msg.content.msg}</div>
          </div>
        `;
        consoleMessages.appendChild(wrapper);
      }
    }
    consoleMessages.scrollTop = consoleMessages.scrollHeight;
  }

  renderSessions();
  lucide.createIcons();
  await saveSessions();
}

// Chevron toggles session list open/closed
navSessionChevron.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = sessionList.classList.toggle('open');
  navSessionChevron.classList.toggle('open');
  document.getElementById('session-separator').classList.toggle('open');
  const navConsole = document.getElementById('nav-instruction-console');
  if (isOpen) navConsole.classList.remove('active');
  else if ([...document.querySelectorAll('.nav-item.active')].length === 0) navConsole.classList.add('active');
});

navSessionAdd.addEventListener('click', (e) => { e.stopPropagation(); createSession(); });

// --- Session Context Menu ---
const sessionContextMenu = document.getElementById('session-context-menu');
let contextSessionId = null;
let pendingDeleteSessionId = null;

function showSessionContextMenu(e, sessionId) {
  e.preventDefault();
  e.stopPropagation();
  contextSessionId = sessionId;
  sessionContextMenu.style.display = 'block';
  const menuW = sessionContextMenu.offsetWidth;
  const menuH = sessionContextMenu.offsetHeight;
  sessionContextMenu.style.left = (e.clientX + menuW > window.innerWidth ? window.innerWidth - menuW - 8 : e.clientX) + 'px';
  sessionContextMenu.style.top = (e.clientY + menuH > window.innerHeight ? window.innerHeight - menuH - 8 : e.clientY) + 'px';
}

function hideSessionContextMenu() { sessionContextMenu.style.display = 'none'; contextSessionId = null; }
document.addEventListener('click', () => hideSessionContextMenu());
document.addEventListener('contextmenu', () => hideSessionContextMenu());

document.getElementById('ctx-session-rename').addEventListener('click', () => {
  if (contextSessionId === null) return;

  const capturedId = contextSessionId; // ✅ capture it immediately

  const li = sessionList.querySelector(`[data-id="${capturedId}"]`);
  const titleEl = li.querySelector('.session-title');
  const oldTitle = titleEl.textContent;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  titleEl.addEventListener('keydown', function handler(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.contentEditable = 'false';
      titleEl.removeEventListener('keydown', handler);
      const session = sessions.find(s => s.id === capturedId); // ✅ use capturedId
      if (session) {
        session.title = titleEl.textContent.trim() || oldTitle;
        titleEl.textContent = session.title;
        if (activeSessionId === session.id)
          document.getElementById('console-objective-text').textContent = session.title;
        saveSessions();
      }
    } else if (e.key === 'Escape') {
      titleEl.contentEditable = 'false';
      titleEl.textContent = oldTitle;
      titleEl.removeEventListener('keydown', handler);
    }
  });

  titleEl.addEventListener('blur', function handler() {
    titleEl.contentEditable = 'false';
    titleEl.removeEventListener('blur', handler);
    const session = sessions.find(s => s.id === capturedId); // ✅ use capturedId
    if (session) {
      session.title = titleEl.textContent.trim() || oldTitle;
      titleEl.textContent = session.title;
      saveSessions();
    }
  });

  hideSessionContextMenu();
});


document.getElementById('ctx-session-star').addEventListener('click', () => {
  if (contextSessionId === null) return;
  const session = sessions.find(s => s.id === contextSessionId);
  if (session) { session.starred = !session.starred; renderSessions(); lucide.createIcons(); }
  hideSessionContextMenu();
  saveSessions();
});

document.getElementById('ctx-session-share').addEventListener('click', () => hideSessionContextMenu());

document.getElementById('ctx-session-delete').addEventListener('click', () => {
  if (contextSessionId === null) return;
  const session = sessions.find(s => s.id === contextSessionId);
  if (!session) return;
  pendingDeleteSessionId = contextSessionId;
  document.getElementById('session-modal-name').textContent = `"${session.title}"`;
  document.getElementById('session-modal-overlay').style.display = 'flex';
  hideSessionContextMenu();
  saveSessions();
});

document.getElementById('session-modal-cancel').addEventListener('click', () => {
  document.getElementById('session-modal-overlay').style.display = 'none';
  contextSessionId = null;
});

document.getElementById('session-modal-confirm').addEventListener('click', async () => {
  // Only handle if session modal is actually visible
  if (document.getElementById('session-modal-overlay').style.display !== 'flex') return;

  if (pendingSkillDelete) {
    const result = await invokePython('delete_skill', { skill_name: pendingSkillDelete });
    if (result.success) showSkillMessage(`Skill "${pendingSkillDelete}" deleted.`, 'success');
    else showSkillMessage(`Delete failed: ${result.error}`, 'error');
    pendingSkillDelete = null;
    document.getElementById('session-modal-overlay').style.display = 'none';
    return;
  }

  sessions = sessions.filter(s => s.id !== pendingDeleteSessionId);

  if (activeSessionId === pendingDeleteSessionId) {
    activeSessionId = null;
    consoleMessages.innerHTML = '';
    document.getElementById('console-objective-text').textContent = '—';
    document.getElementById('console-status-text').textContent = 'Training in halt';
    document.getElementById('console-status-dot').classList.remove('active');
  }
  renderSessions();
  lucide.createIcons();
  document.getElementById('session-modal-overlay').style.display = 'none';
  pendingDeleteSessionId = null;
  await saveSessions(); // ✅ ADD THIS
});

// --- Feed Context Menu ---
const feedContextMenu = document.getElementById('feed-context-menu');

feedInput.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  feedContextMenu.style.display = 'block';
  lucide.createIcons();
  const menuW = feedContextMenu.offsetWidth;
  const menuH = feedContextMenu.offsetHeight;
  feedContextMenu.style.left = (e.clientX + menuW > window.innerWidth ? window.innerWidth - menuW - 8 : e.clientX) + 'px';
  feedContextMenu.style.top = (e.clientY + menuH > window.innerHeight ? window.innerHeight - menuH - 8 : e.clientY) + 'px';
});

document.addEventListener('click', () => feedContextMenu.style.display = 'none');

document.getElementById('ctx-feed-upload').addEventListener('click', () => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.addEventListener('change', () => { feedInput.value = [...fileInput.files].map(f => f.name).join(', '); });
  fileInput.click();
  feedContextMenu.style.display = 'none';
});

document.getElementById('ctx-feed-voice').addEventListener('click', () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Voice input is not supported in this browser.'); return; }
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.start();
  recognition.onresult = (e) => { feedInput.value = e.results[0][0].transcript; };
  recognition.onerror = (e) => { console.error('Voice input error:', e.error); };
  feedContextMenu.style.display = 'none';
});

document.getElementById('ctx-feed-clear').addEventListener('click', () => {
  feedInput.value = '';
  feedContextMenu.style.display = 'none';
});

// ============================================================
// MODEL SELECTION SYSTEM
// ============================================================

// Available models catalog
const AVAILABLE_MODELS = [
  { name: "gemma2:2b", size: "1.5 GB", type: "text", desc: "Fast, efficient — default recommended" },
  { name: "gemma2:9b", size: "5.5 GB", type: "text", desc: "Smarter — needs 16GB+ RAM" },
  { name: "llama3:8b", size: "4.7 GB", type: "text", desc: "Great reasoning — needs 16GB+ RAM" },
  { name: "mistral:7b", size: "4.1 GB", type: "text", desc: "Fast and smart — good alternative" },
  { name: "qwen2.5:3b", size: "1.9 GB", type: "text", desc: "Lightweight option" },
  { name: "moondream", size: "1.7 GB", type: "vision", desc: "Vision model — for screenshot skills" },
  { name: "llava:7b", size: "4.5 GB", type: "vision", desc: "Better vision — needs 8GB+ VRAM" },
  { name: "llava:13b", size: "8.0 GB", type: "vision", desc: "Best vision — needs 16GB+ VRAM" },
  { name: "phi3:mini", size: "2.3 GB", type: "text", desc: "Microsoft Phi3 — compact and capable" },
  { name: "deepseek-r1:1.5b", size: "1.1 GB", type: "text", desc: "Tiny reasoning model" },
];

let currentTextModel = localStorage.getItem('syntx_text_model') || 'gemma2:2b';
let currentVisionModel = localStorage.getItem('syntx_vision_model') || 'moondream';
let installedModels = [];
let modelTabActive = 'installed';
let modelSearchQuery = '';

// ── Show model popup ──────────────────────────────────────────
async function showModelSelector() {
  const overlay = document.getElementById('model-select-overlay');
  overlay.style.display = 'flex';
  updateModelCurrentLabel();
  await refreshInstalledModels();
  renderModelList();
  if (window.lucide) lucide.createIcons();
}

function hideModelSelector() {
  document.getElementById('model-select-overlay').style.display = 'none';
}

document.getElementById('model-select-close').addEventListener('click', hideModelSelector);

// ── Fetch installed models from Ollama ───────────────────────
async function refreshInstalledModels() {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    const data = await res.json();
    installedModels = (data.models || []).map(m => ({
      name: m.name,
      size: formatBytes(m.size || 0)
    }));
  } catch {
    installedModels = [];
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

// ── Render model list ─────────────────────────────────────────
function renderModelList() {
  const container = document.getElementById('model-list');
  const query = modelSearchQuery.toLowerCase();

  let models = [];

  if (modelTabActive === 'installed') {
    models = installedModels.filter(m =>
      m.name.toLowerCase().includes(query)
    );
  } else {
    // Available to download — show ones NOT installed
    const installedNames = installedModels.map(m => m.name);
    models = AVAILABLE_MODELS.filter(m =>
      !installedNames.includes(m.name) &&
      m.name.toLowerCase().includes(query)
    );
  }

  if (models.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;color:#aaa;font-size:12px;">
        ${modelTabActive === 'installed'
        ? 'No models installed. Switch to "Available to Download".'
        : 'No models match your search.'}
      </div>`;
    return;
  }

  container.innerHTML = '';

  models.forEach(model => {
    const isCurrentText = model.name === currentTextModel;
    const isCurrentVision = model.name === currentVisionModel;
    const isCurrent = isCurrentText || isCurrentVision;
    const catalogEntry = AVAILABLE_MODELS.find(m => m.name === model.name);
    const desc = catalogEntry?.desc || '';
    const type = catalogEntry?.type || 'text';

    const item = document.createElement('div');
    item.className = `model-item${isCurrent ? ' active-model' : ''}`;

    let badge = '';
    if (isCurrentText) badge = '<span style="font-size:9px;background:#FF4D00;color:white;padding:2px 6px;border-radius:10px;margin-left:6px;">TEXT</span>';
    if (isCurrentVision) badge = '<span style="font-size:9px;background:#4D7EFF;color:white;padding:2px 6px;border-radius:10px;margin-left:6px;">VISION</span>';

    let actionBtn = '';
    if (modelTabActive === 'installed') {
      if (isCurrent) {
        actionBtn = `<button class="model-action-btn selected" disabled>✓ Active</button>`;
      } else {
        actionBtn = `
          <div style="display:flex;gap:6px;">
            <button class="model-action-btn select" onclick="selectTextModel('${model.name}')">
              Use for Text
            </button>
            ${type === 'vision' || !type ? `
            <button class="model-action-btn" style="background:#4D7EFF;color:white;border-color:#4D7EFF;"
              onclick="selectVisionModel('${model.name}')">
              Use for Vision
            </button>` : ''}
          </div>`;
      }
    } else {
      actionBtn = `
        <button class="model-action-btn install" onclick="installModel('${model.name}', this)">
          Install
        </button>`;
    }

    item.innerHTML = `
      <div class="model-item-left">
        <div class="model-item-name">${model.name}${badge}</div>
        <div class="model-item-size">${model.size || '—'} ${desc ? '· ' + desc : ''}</div>
      </div>
      ${actionBtn}
    `;

    container.appendChild(item);
  });
}

// ── Select text model ─────────────────────────────────────────
function selectTextModel(name) {
  currentTextModel = name;
  localStorage.setItem('syntx_text_model', name);
  updateAllModelRefs(name, currentVisionModel);
  updateModelCurrentLabel();
  renderModelList();
  showModelToast(`Text model set to ${name}`);
}

// ── Select vision model ───────────────────────────────────────
function selectVisionModel(name) {
  currentVisionModel = name;
  localStorage.setItem('syntx_vision_model', name);
  updateAllModelRefs(currentTextModel, name);
  updateModelCurrentLabel();
  renderModelList();
  showModelToast(`Vision model set to ${name}`);
  updateSettingsModelHint();
}

// ── Update model references in runtime ───────────────────────
function updateAllModelRefs(textModel, visionModel) {
  // Store globally — callOllama and VCE use these
  window.__SYNTX_TEXT_MODEL__ = textModel;
  window.__SYNTX_VISION_MODEL__ = visionModel;
}

// ── Install model via Ollama API ──────────────────────────────
async function installModel(name, btn) {
  btn.className = 'model-action-btn installing';
  btn.textContent = 'Installing...';
  btn.disabled = true;

  const progressWrapper = document.getElementById('model-progress-wrapper');
  const progressBar = document.getElementById('model-progress-bar');
  const progressLabel = document.getElementById('model-progress-label');

  progressWrapper.style.display = 'block';
  progressLabel.textContent = `Downloading ${name}...`;
  progressBar.style.width = '0%';

  try {
    const response = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      decoder.decode(value).split('\n').filter(Boolean).forEach(line => {
        try {
          const json = JSON.parse(line);

          if (json.total && json.completed) {
            const pct = Math.round((json.completed / json.total) * 100);
            progressBar.style.width = pct + '%';
            progressLabel.textContent = `Downloading ${name}... ${pct}%`;
          }

          if (json.status === 'success' || json.status?.includes('success')) {
            progressBar.style.width = '100%';
            progressLabel.textContent = `${name} installed!`;
          }

        } catch { /* skip malformed lines */ }
      });
    }

    // Refresh list
    await refreshInstalledModels();
    renderModelList();
    showModelToast(`${name} installed successfully!`);

  } catch (err) {
    progressLabel.textContent = `Failed: ${err}`;
    btn.className = 'model-action-btn install';
    btn.textContent = 'Retry';
    btn.disabled = false;
  }

  setTimeout(() => {
    progressWrapper.style.display = 'none';
    progressBar.style.width = '0%';
  }, 3000);
}

// ── Update current label ──────────────────────────────────────
function updateModelCurrentLabel() {
  const label = document.getElementById('model-current-label');
  if (label) {
    label.textContent = `Text: ${currentTextModel} · Vision: ${currentVisionModel}`;
  }
}

// ── Toast ─────────────────────────────────────────────────────
function showModelToast(msg) {
  const toast = document.getElementById('vce-toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll('.model-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    modelTabActive = tab.dataset.tab;
    renderModelList();
  });
});

// ── Search ────────────────────────────────────────────────────
document.getElementById('model-search-input').addEventListener('input', (e) => {
  modelSearchQuery = e.target.value;
  renderModelList();
});

// ── Initialize model refs on load ─────────────────────────────
updateAllModelRefs(currentTextModel, currentVisionModel);

// --- Load Sessions on Start ---
async function loadSessions() {
  try {
    const data = await window.__TAURI__.core.invoke('load_sessions');
    sessions = JSON.parse(data) || [];
    if (sessions.length > 0) {
      sessionList.classList.add('open');
      navSessionChevron.classList.add('open');
      document.getElementById('session-separator').classList.add('open');
    }
    renderSessions();
    lucide.createIcons();
  } catch (err) { console.error('Load sessions error:', err); }
}

// ============================================================
// SKILL SYSTEM — Instruction Console Integration
// ============================================================

// --- Skill Creation State Machine ---
let skillCreationMode = false;

// --- Workflow Creation State ---
let workflowCreationMode = false;
let workflowCreationStep = null;
let workflowCreationData = { name: null, description: null, steps: null };
let workflowConversationHistory = [];

let skillCreationStep = null;   // 'name' | 'description' | 'steps' | 'knowledge' | 'building'
let skillCreationData = {
  name: null,
  description: null,
  knowledge_access: []
};
let skillConversationHistory = [];

// ============================================================
// SKILL COMMAND ROUTER
// ============================================================

async function handleSkillCommand(input) {
  const parts = input.trim().split(' ');
  const sub = parts[1];    // create | list | view | edit | delete | test | run
  const arg = parts.slice(2).join(' ').trim();

  switch (sub) {
    case 'create': startSkillCreation(); break;
    case 'list': await skillList(); break;
    case 'view': await skillView(arg); break;
    case 'edit': await skillEdit(arg); break;
    case 'delete': await skillDelete(arg); break;
    case 'test': await skillTest(arg); break;
    case 'run': await skillRun(arg); break;
    default:
      showSkillMessage(
        `Unknown skill command. Available: create, list, view, edit, delete, test, run`,
        'error'
      );
  }
}

// ============================================================
// /skill create — Conversation Flow
// ============================================================

function startSkillCreation() {
  skillCreationMode = true;
  skillCreationStep = 'name';
  skillCreationData = { name: null, description: null, steps: null, knowledge_access: [] };
  skillConversationHistory = [];

  // Create a new session for this skill creation
  createSession();
  activeTrainingSessionId = activeSessionId;

  // Lock other sessions
  setFeedLocked(false);  // keep feed open for skill input

  // Update status bar
  document.getElementById('console-status-text').textContent = 'Skill creation in progress';
  document.getElementById('console-status-dot').classList.add('active');

  // Update session title
  const session = sessions.find(s => s.id === activeSessionId);
  if (session) {
    session.title = 'New Skill';
    renderSessions();
    lucide.createIcons();
  }

  sessionList.classList.add('open');
  navSessionChevron.classList.add('open');
  document.getElementById('session-separator').classList.add('open');

  showSkillMessage(
    `Skill creation started!<br>What do you want to call this skill?<br>
     <span style="font-size:11px;opacity:0.6;">Use lowercase with underscores. Example: play_music</span>`,
    'system'
  );

  saveSessions();
}

async function handleSkillCreationInput(text) {

  // Track conversation for parser
  skillConversationHistory.push({ role: 'user', content: text });

  // ── Step 1: Name ─────────────────────────────
  if (skillCreationStep === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');

    const exists = await invokePython('skill_exists', { skill_name: name });
    if (exists === true) {
      showSkillMessage(
        `A skill named <strong>${name}</strong> already exists.<br>
       Choose a different name or use <code>/skill delete ${name}</code> first.`,
        'error'
      );
      return;
    }

    skillCreationData.name = name;
    skillCreationStep = 'description';

    // UPDATE session title to skill name
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
      session.title = `skill: ${name}`;
      document.getElementById('console-objective-text').textContent = `skill: ${name}`;
      renderSessions();
      lucide.createIcons();
    }

    showSkillMessage(
      `Got it — skill name: <strong>${name}</strong><br><br>
     Describe what it should do. Be as detailed as you want.`,
      'system'
    );

    saveSessions();
    return;
  }

  // ── Step 2: Description ───────────────────────
  if (skillCreationStep === 'description') {
    skillCreationData.description = text.trim();
    skillConversationHistory.push({
      role: 'assistant',
      content: skillCreationData.description
    });
    skillCreationStep = 'steps';
    showSkillMessage(
      `Got it.<br><br>Now describe the steps — what should this skill do, in order?<br>
   <span style="font-size:11px;opacity:0.7;">A numbered list works best. Example:<br>
   1. Open terminal<br>2. Create project folder<br>3. Run npm install</span>`,
      'system'
    );
    return;
  }

  // ── Step 3: Steps ─────────────────────────────
  if (skillCreationStep === 'steps') {
    skillCreationData.steps = text.trim().replace(/(\d+)\.\s*/g, '\n$1. ').trim();
    skillConversationHistory.push({ role: 'user', content: text.trim() });

    // Check if user used {{variable}} placeholders
    const varsFound = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
    const uniqueVars = [...new Set(varsFound)];

    if (uniqueVars.length > 0) {
      showSkillMessage(
        `Got it!<br><br>I detected these dynamic inputs: ${uniqueVars.map(v => `<code>{{${v}}}</code>`).join(', ')}<br>
        When you run this skill, pass them like:<br>
        <code>/skill run skill_name {"${uniqueVars[0]}": "your value"}</code>`,
        'system'
      );
    } else {
      showSkillMessage(
        `Got it.<br><br>
        <span style="font-size:11px;opacity:0.7;">💡 Tip: You can use <code>{{variable}}</code> in steps to make them dynamic!<br>
        Example: <code>Open browser https://wikipedia.org/wiki/{{topic}}</code></span>`,
        'system'
      );
    }

    skillCreationStep = 'knowledge';
    showSkillMessage(
      `Got it.<br><br>Should this skill access your <strong>knowledge ontology</strong>?<br>
      <span style="font-size:11px;opacity:0.7;">Type a path like <code>personal/music</code>, or type <strong>no</strong> to skip.</span>`,
      'system'
    );
    return;  // ← THIS WAS MISSING!
  }

  // ── Step 4: Knowledge access ──────────────────
  if (skillCreationStep === 'knowledge') {
    const answer = text.trim().toLowerCase();
    if (answer !== 'no' && answer !== 'none' && answer !== 'skip') {
      // Accept comma-separated paths
      skillCreationData.knowledge_access = answer.split(',').map(p => p.trim());
    }
    skillCreationStep = 'building';
    await buildAndSaveSkill();
    return;
  }
}

async function buildAndSaveSkill() {
  console.log('DEBUG steps:', skillCreationData.steps);
  showSkillMessage(`Building skill... analyzing steps...`, 'building');

  try {
    // 1 — Parse conversation into skill JSON
    const parseResult = await invokePython('parse_skill_from_conversation', {
      conversation_history: JSON.stringify(skillConversationHistory),
      skill_name: skillCreationData.name,
      description: skillCreationData.description,
      steps_text: skillCreationData.steps,
      knowledge_access: JSON.stringify(skillCreationData.knowledge_access)
    });
    console.log('DEBUG parseResult:', JSON.stringify(parseResult));

    if (!parseResult.success) {
      _handleSkillErrors(parseResult.errors || [], parseResult.unresolved || []);
      return;
    }

    showSkillMessage(`Parsed! Validating schema...`, 'building');

    // 2 — Validate
    const validation = await invokePython('run_full_validation', {
      skill_json: JSON.stringify(parseResult.skill)
    });

    if (!validation.valid) {
      showSkillMessage(
        `Validation failed:<br>` +
        validation.errors.map(e => `• ${e}`).join('<br>'),
        'error'
      );
      _exitSkillCreation();
      return;
    }

    if (validation.warnings && validation.warnings.length > 0) {
      showSkillMessage(
        `Warnings (non-blocking):<br>` +
        validation.warnings.map(w => `⚠ ${w}`).join('<br>'),
        'warning'
      );
    }

    showSkillMessage(`Validation passed! Running sandbox test...`, 'building');

    // 3 — Test in sandbox
    const testResult = await invokePython('test_skill', {
      skill_json: JSON.stringify(parseResult.skill)
    });

    // Show test report
    showSkillMessage(
      `<pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;">${testResult.summary}</pre>`,
      testResult.passed ? 'success' : 'error'
    );

    if (!testResult.passed) {
      showSkillMessage(
        `Test failed. Fix the issues above and try <code>/skill create</code> again.`,
        'error'
      );
      _exitSkillCreation();
      return;
    }

    // 4 — Save skill
    const saveResult = await invokePython('save_skill', {
      skill_json: JSON.stringify(parseResult.skill)
    });

    if (saveResult.success) {
      showSkillMessage(
        `✓ Skill saved as <strong>${skillCreationData.name}</strong>.<br>
         Use <code>/skill run ${skillCreationData.name}</code> to run it anytime.`,
        'success'
      );
      window.syntxPlaySound();
    } else {
      showSkillMessage(`Failed to save skill: ${saveResult.error}`, 'error');
    }

  } catch (err) {
    showSkillMessage(`Skill creation crashed: ${err}`, 'error');
  }

  _exitSkillCreation();
}

function _handleSkillErrors(errors, unresolved) {
  let msg = '';
  if (errors.length > 0) {
    msg += `Could not build skill:<br>` + errors.map(e => `• ${e}`).join('<br>');
  }
  if (unresolved.length > 0) {
    msg += `<br><br>Steps I couldn't map to actions:<br>` +
      unresolved.map(u => `• Step ${u.step_id}: <em>${u.raw}</em> — ${u.reason}`).join('<br>');
    msg += `<br><br>Rephrase those steps using clearer action words and try again.`;
  }
  showSkillMessage(msg, 'error');
  _exitSkillCreation();
}

function _exitSkillCreation() {
  skillCreationMode = false;
  skillCreationStep = null;
  skillCreationData = { name: null, description: null, knowledge_access: [] };
  skillConversationHistory = [];

  // Reset status bar
  document.getElementById('console-status-text').textContent = 'Training in halt';
  document.getElementById('console-status-dot').classList.remove('active');

  // Unlock sessions
  activeTrainingSessionId = null;
  renderSessions();
  lucide.createIcons();
  saveSessions();
}

// ============================================================
// /skill list
// ============================================================

async function skillList() {
  const result = await invokePython('get_skill_list', {});
  if (!result || result.length === 0) {
    showSkillMessage(`No skills found. Use <code>/skill create</code> to build one.`, 'system');
    return;
  }

  const rows = result.map(s =>
    `<tr>
      <td style="padding:4px 12px 4px 0;font-weight:600;">${s.skill_name}</td>
      <td style="padding:4px 12px 4px 0;opacity:0.6;font-size:11px;">${s._source}</td>
      <td style="padding:4px 0;opacity:0.8;">${s.description || '—'}</td>
    </tr>`
  ).join('');

  showSkillMessage(
    `<strong>${result.length} skill(s) loaded:</strong><br><br>
     <table style="font-size:12px;font-family:monospace;border-collapse:collapse;">${rows}</table>`,
    'system'
  );
}

// ============================================================
// /skill view (name)
// ============================================================

async function skillView(name) {
  if (!name) { showSkillMessage(`Usage: /skill view skill_name`, 'error'); return; }

  const skill = await invokePython('load_skill', { skill_name: name });
  if (!skill) { showSkillMessage(`Skill <strong>${name}</strong> not found.`, 'error'); return; }

  // Pretty print — hide internal fields
  const clean = { ...skill };
  delete clean._source;
  delete clean._filepath;

  showSkillMessage(
    `<strong>${name}</strong><br><br>
     <pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;max-height:320px;overflow-y:auto;">${JSON.stringify(clean, null, 2)}</pre>`,
    'system'
  );
}

// ============================================================
// /skill edit (name)
// ============================================================

async function skillEdit(name) {
  if (!name) { showSkillMessage(`Usage: /skill edit skill_name`, 'error'); return; }

  const skill = await invokePython('load_skill', { skill_name: name });
  if (!skill) { showSkillMessage(`Skill <strong>${name}</strong> not found.`, 'error'); return; }

  if (skill._source === 'built_in') {
    showSkillMessage(`Cannot edit built-in skills. Clone it first (coming soon).`, 'error');
    return;
  }

  // Re-enter creation flow pre-filled with existing skill data
  skillCreationMode = true;
  skillCreationStep = 'description';
  skillCreationData = {
    name: skill.skill_name,
    description: skill.description,
    knowledge_access: skill.requires?.knowledge_access || []
  };
  skillConversationHistory = [
    { role: 'user', content: skill.skill_name },
    { role: 'assistant', content: skill.description }
  ];

  showSkillMessage(
    `Editing <strong>${name}</strong>.<br><br>Describe the updated behaviour. What should it do now?`,
    'system'
  );
}

// ============================================================
// /skill delete (name)
// ============================================================

async function skillDelete(name) {
  if (!name) { showSkillMessage(`Usage: /skill delete skill_name`, 'error'); return; }

  // Reuse your existing modal pattern
  pendingSkillDelete = name;
  document.getElementById('session-modal-name').textContent = `skill "${name}"`;
  document.getElementById('session-modal-overlay').style.display = 'flex';
}

// Wire delete confirm button (add this alongside your existing modal confirm)
let pendingSkillDelete = null;

// Add inside your existing session-modal-confirm listener:
/*
  if (pendingSkillDelete) {
    const result = await invokePython('delete_skill', { skill_name: pendingSkillDelete });
    if (result.success) showSkillMessage(`Skill "${pendingSkillDelete}" deleted.`, 'success');
    else showSkillMessage(`Delete failed: ${result.error}`, 'error');
    pendingSkillDelete = null;
    return;
  }
*/

// ============================================================
// /skill test (name)
// ============================================================

async function skillTest(name) {
  if (!name) { showSkillMessage(`Usage: /skill test skill_name`, 'error'); return; }

  const skill = await invokePython('load_skill', { skill_name: name });
  if (!skill) { showSkillMessage(`Skill <strong>${name}</strong> not found.`, 'error'); return; }

  showSkillMessage(`Running sandbox test for <strong>${name}</strong>...`, 'building');

  const result = await invokePython('test_skill', { skill_json: JSON.stringify(skill) });

  showSkillMessage(
    `<pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;">${result.summary}</pre>`,
    result.passed ? 'success' : 'error'
  );
}

// ============================================================
// /skill run (name) (inputs as JSON)
// ============================================================

async function skillRun(arg) {
  const spaceIdx = arg.indexOf(' ');
  const name = spaceIdx === -1 ? arg : arg.substring(0, spaceIdx).trim();
  const inputStr = spaceIdx === -1 ? '{}' : arg.substring(spaceIdx + 1).trim();

  if (!name) { showSkillMessage(`Usage: /skill run skill_name {"input":"value"}`, 'error'); return; }

  let inputs = {};
  try { inputs = JSON.parse(inputStr); } catch {
    showSkillMessage(`Invalid inputs JSON. Example: /skill run play_music {"app_name":"spotify"}`, 'error');
    return;
  }

  const skill = await invokePython('load_skill', { skill_name: name });
  if (!skill) { showSkillMessage(`Skill <strong>${name}</strong> not found.`, 'error'); return; }

  // Warn about missing required inputs
  if (skill.inputs && skill.inputs.length > 0) {
    const missing = skill.inputs
      .filter(i => i.required && !inputs[i.name])
      .map(i => i.name);
    if (missing.length > 0) {
      showSkillMessage(
        `Missing required inputs: ${missing.map(m => `<code>${m}</code>`).join(', ')}<br>
        Example: <code>/skill run ${name} {"${missing[0]}": "your value"}</code>`,
        'error'
      );
      return;
    }
  }

  showSkillMessage(`Running <strong>${name}</strong>...`, 'building');

  const result = await invokePython('execute_skill', {
    skill_json: JSON.stringify(skill),
    user_inputs: JSON.stringify(inputs),
    model: JSON.parse(localStorage.getItem('syntx_settings') || '{}').textModel || 'gemma2:2b'
  });

  showSkillMessage(
    result.success
      ? `✓ Skill completed.<br><span style="font-size:11px;opacity:0.7;">${result.message}</span>`
      : `✗ Skill failed: ${result.message}`,
    result.success ? 'success' : 'error'
  );
}

// ============================================================
// Skill Message UI — matches your existing console style
// ============================================================

function showSkillMessage(html, type = 'system') {
  const colors = {
    system: { border: '#4D7EFF', text: '#4D7EFF' },
    success: { border: '#2DBD6E', text: '#333' },
    error: { border: '#FF4D4D', text: '#FF4D4D' },
    warning: { border: '#FF9900', text: '#FF9900' },
    building: { border: '#888', text: '#888' }
  };
  const c = colors[type] || colors.system;

  const wrapper = document.createElement('div');
  wrapper.className = 'system-block';
  wrapper.innerHTML = `
    <div class="system-bubble">
      <span class="system-label">[Skill]</span>
      <div class="system-reply" style="display:block;opacity:1;border-color:${c.border};color:${c.text};font-size:12px;font-family:monospace;">
        ${html}
      </div>
    </div>
  `;
  consoleMessages.appendChild(wrapper);
  consoleMessages.scrollTop = consoleMessages.scrollHeight;
  saveMessageToSession('system', { msg: html, color: type });
}

// ============================================================
// Python Bridge — calls Tauri which calls Python
// invokePython('function_name', { arg: value })
// ============================================================

async function invokePython(fn, args) {
  try {
    const raw = await window.__TAURI__.core.invoke('run_python_skill', {
      function: fn,
      args: JSON.stringify(args)
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error(`invokePython(${fn}) error:`, err);
    showSkillMessage(`Python bridge error: ${err}`, 'error');
    return null;
  }
}

// Show model selector on first launch
async function initApp() {
  await loadSessions();
  await loadVceSessions();

  // Check if model has been configured
  const hasModel = localStorage.getItem('syntx_text_model');
  if (!hasModel) {
    // First launch — show model selector
    setTimeout(() => showModelSelector(), 500);
  }
}

initApp();


// ============================================================
// VALIDATION CHAT ENVIRONMENT (VCE)
// ============================================================

// --- State ---
let vceSessions = [];
let vceActiveSessionId = null;
let vceIsGenerating = false;
let vceMediaRecorder;
let vceAudioChunks = [];
let vceIsListening = false;
let vceContextSessionId = null;
let vceModalSessionId = null;
const vceGeneratingSessions = {};

// --- DOM Refs ---
const vceSendBtn = document.getElementById('vce-send-btn');
const vceSpeakBtn = document.querySelector('.vce-speak-btn');
const vceInput = document.getElementById('vce-input');
const vceSidebar = document.getElementById('vce-sidebar');
const vceExitBtn = document.getElementById('vce-exit-btn');
const vceSidebarSearchBtn = document.getElementById('vce-sidebar-search-btn');
const vceSidebarSearch = document.getElementById('vce-sidebar-search');
const vceSidebarSearchInput = document.getElementById('vce-sidebar-search-input');
const vceHistoryCtxMenu = document.getElementById('vce-history-context-menu');
const vceRenameOverlay = document.getElementById('vce-rename-overlay');
const vceDeleteOverlay = document.getElementById('vce-delete-overlay');

// --- Thinking Animation Assets ---
const thinkingPhrases = ['Thinking...', 'Thinking more...', 'Almost there...', 'Digging deeper...', 'Processing...', 'Analyzing...'];
const logoFrames = ['</>', '<>/', '/<>', '/><', '></', '>/<', '</>'];

// --- Session Create / Switch ---
function vceCreateSession() {
  const id = Date.now();
  vceSessions.push({ id, title: 'New Environment', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), messages: [] });
  vceActiveSessionId = id;
  document.getElementById('vce-messages').innerHTML = '';
  vceRenderHistory();
  saveVceSessions();
}

function vceSwitchSession(id) {
  _allKnowledgeCache = null;
  vceActiveSessionId = id;
  const messages = document.getElementById('vce-messages');
  messages.innerHTML = '';

  const session = vceSessions.find(s => s.id === id);
  if (!session) return;

  vceUpdateHeaderTitle(session.title);

  // Restore messages without animations
  if (session.messages && session.messages.length > 0) {
    for (const msg of session.messages) {
      if (msg.type === 'user') {
        vceAppendUser(msg.content, (t) => vceSendMessage(t));
        const wrappers = messages.querySelectorAll('.vce-user-wrapper');
        const last = wrappers[wrappers.length - 1];
        if (last) {
          const bubble = last.querySelector('.vce-user-msg');
          if (bubble) { bubble.style.opacity = '1'; bubble.style.transform = 'none'; bubble.style.filter = 'none'; bubble.style.animation = 'none'; }
        }
      } else if (msg.type === 'assistant') {
        const block = document.createElement('div');
        block.className = 'vce-ai-block';
        const logo = document.createElement('div');
        logo.className = 'vce-ai-logo';
        logo.textContent = '</>';
        const content = document.createElement('div');
        content.className = 'vce-ai-content';

        msg.content.split('\n').filter(l => l.trim().length > 0).forEach(line => {
          const lineEl = document.createElement('div');
          lineEl.className = 'vce-ai-line';
          lineEl.innerHTML = parseMarkdown(line);
          lineEl.style.cssText = 'opacity:1;transform:none;filter:none;animation:none;';
          content.appendChild(lineEl);
        });

        // Copy button
        const aiActions = document.createElement('div');
        aiActions.className = 'vce-msg-actions';
        aiActions.style.marginTop = '6px';
        const aiCopyBtn = document.createElement('button');
        aiCopyBtn.className = 'vce-action-btn';
        aiCopyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`;
        aiCopyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(msg.content);
          aiCopyBtn.classList.add('copied');
          aiCopyBtn.innerHTML = `<i data-lucide="check" style="width:11px;height:11px;"></i> Copied`;
          lucide.createIcons();
          setTimeout(() => { aiCopyBtn.classList.remove('copied'); aiCopyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`; lucide.createIcons(); }, 2000);
        });
        aiActions.appendChild(aiCopyBtn);
        content.appendChild(aiActions);
        block.appendChild(logo);
        block.appendChild(content);
        messages.appendChild(block);
        renderLatex(block);
      }
    }
  }

  // Re-attach if still generating
  if (vceGeneratingSessions[id]) {
    messages.appendChild(vceGeneratingSessions[id].block);
    messages.scrollTop = messages.scrollHeight;
  }

  vceRenderHistory();
  saveVceSessions();
  lucide.createIcons();
}

// --- Append User Message ---
function vceAppendUser(text, onRetry) {
  const messages = document.getElementById('vce-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'vce-user-wrapper';

  const bubble = document.createElement('div');
  bubble.className = 'vce-user-msg';
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  const actions = document.createElement('div');
  actions.className = 'vce-msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'vce-action-btn';
  copyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text);
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<i data-lucide="check" style="width:11px;height:11px;"></i> Copied`;
    setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`; lucide.createIcons(); }, 2000);
  });

  const retryBtn = document.createElement('button');
  retryBtn.className = 'vce-action-btn';
  retryBtn.innerHTML = `<i data-lucide="rotate-ccw" style="width:11px;height:11px;"></i> Retry`;
  retryBtn.addEventListener('click', () => { if (onRetry) onRetry(text); });

  actions.appendChild(copyBtn);
  actions.appendChild(retryBtn);
  wrapper.appendChild(actions);
  messages.appendChild(wrapper);
  lucide.createIcons();
  messages.scrollTop = messages.scrollHeight;
  return wrapper;
}

// --- Generating State ---
function vceSetGenerating(val) {
  vceIsGenerating = val;
  const sendBtn = document.getElementById('vce-send-btn');
  if (val) {
    sendBtn.classList.add('visible', 'loading');
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<i data-lucide="loader" style="width:13px;height:13px;"></i>`;
  } else {
    sendBtn.classList.remove('loading');
    sendBtn.disabled = false;
    if (!document.getElementById('vce-input').value.trim()) {
      sendBtn.classList.remove('visible');
      document.querySelector('.vce-speak-btn').classList.remove('compact');
    }
    sendBtn.innerHTML = `<i data-lucide="arrow-up" style="width:13px;height:13px;"></i>`;
  }
  lucide.createIcons();
}

function parseVCEResponse(text) {
  const elements = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Code block ────────────────────────────
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim() || 'code';
      let code = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      i++; // skip closing ```

      const block = document.createElement('div');
      block.className = 'vce-code-block';
      block.innerHTML = `
                <div class="vce-code-header">
                    <span>${lang}</span>
                    <button class="vce-code-copy" onclick="navigator.clipboard.writeText(this.closest('.vce-code-block').querySelector('pre').innerText)">Copy</button>
                </div>
                <pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
            `;
      elements.push(block);
      continue;
    }

    // ── Numbered list item ────────────────────
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      const item = document.createElement('div');
      item.className = 'vce-list-item';
      item.innerHTML = `
                <span class="vce-list-num">${numMatch[1]}.</span>
                <span>${parseMarkdown(numMatch[2])}</span>
            `;
      elements.push(item);
      i++;
      continue;
    }

    // ── Bullet point ──────────────────────────
    const bulletMatch = line.match(/^[-•*]\s+(.+)/);
    if (bulletMatch) {
      const item = document.createElement('div');
      item.className = 'vce-bullet-item';
      item.innerHTML = `
                <span class="vce-bullet">•</span>
                <span>${parseMarkdown(bulletMatch[1])}</span>
            `;
      elements.push(item);
      i++;
      continue;
    }

    // ── Heading ───────────────────────────────
    const headMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headMatch) {
      const h = document.createElement('div');
      h.className = 'vce-heading';
      h.textContent = headMatch[1];
      elements.push(h);
      i++;
      continue;
    }

    // ── Empty line → spacer ───────────────────
    if (!line.trim()) {
      const spacer = document.createElement('div');
      spacer.style.height = '6px';
      elements.push(spacer);
      i++;
      continue;
    }

    // ── Regular text ──────────────────────────
    const p = document.createElement('div');
    p.className = 'vce-ai-line';
    p.innerHTML = parseMarkdown(line);
    elements.push(p);
    i++;
  }

  return elements;
}

// --- Stream AI Reply ---
async function vceAppendAI(prompt, history, targetSessionId) {
  const isCurrentSession = () => targetSessionId === vceActiveSessionId;
  const messages = document.getElementById('vce-messages');

  const block = document.createElement('div');
  block.className = 'vce-ai-block';
  const logo = document.createElement('div');
  logo.className = 'vce-ai-logo';
  logo.textContent = '</>';
  const content = document.createElement('div');
  content.className = 'vce-ai-content';
  const header = document.createElement('div');
  header.className = 'vce-ai-header';
  const thinkingEl = document.createElement('span');
  thinkingEl.className = 'vce-thinking-text';
  thinkingEl.textContent = 'Thinking...';
  header.appendChild(thinkingEl);
  content.appendChild(header);
  block.appendChild(logo);
  block.appendChild(content);

  if (isCurrentSession()) { messages.appendChild(block); messages.scrollTop = messages.scrollHeight; }

  // Thinking animations
  let logoFrame = 0, phraseIndex = 0;
  const logoInterval = setInterval(() => { logoFrame = (logoFrame + 1) % logoFrames.length; logo.textContent = logoFrames[logoFrame]; }, 300);
  const phraseInterval = setInterval(() => { phraseIndex = (phraseIndex + 1) % thinkingPhrases.length; thinkingEl.textContent = thinkingPhrases[phraseIndex]; }, 1800);

  vceGeneratingSessions[targetSessionId] = { block, logo, content, logoInterval, phraseInterval };

  let fullText = '';
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: (JSON.parse(localStorage.getItem('syntx_settings') || '{}').textModel || 'gemma2:2b'), prompt: await buildVCEPrompt(prompt, history), stream: true })
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.decode(value).split('\n').filter(Boolean).forEach(line => {
        try { const json = JSON.parse(line); if (json.response) fullText += json.response; } catch { }
      });
    }
  } catch { fullText = 'Something went wrong. Please try again.'; }

  clearInterval(logoInterval);
  clearInterval(phraseInterval);
  logo.textContent = '</>';
  header.remove();
  delete vceGeneratingSessions[targetSessionId];

  // Save to session
  const targetSession = vceSessions.find(s => s.id === targetSessionId);
  if (targetSession) { targetSession.messages.push({ type: 'assistant', content: fullText }); await saveVceSessions(); }

  // Stream lines with delay
  // Parse full response into structured blocks
  const blocks = parseVCEResponse(fullText);

  for (let i = 0; i < blocks.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 60));
    content.appendChild(blocks[i]);
    if (isCurrentSession()) messages.scrollTop = messages.scrollHeight;
  }

  // Copy button
  const aiActions = document.createElement('div');
  aiActions.className = 'vce-msg-actions';
  aiActions.style.marginTop = '6px';
  const aiCopyBtn = document.createElement('button');
  aiCopyBtn.className = 'vce-action-btn';
  aiCopyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`;
  aiCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(fullText);
    aiCopyBtn.classList.add('copied');
    aiCopyBtn.innerHTML = `<i data-lucide="check" style="width:11px;height:11px;"></i> Copied`;
    lucide.createIcons();
    setTimeout(() => { aiCopyBtn.classList.remove('copied'); aiCopyBtn.innerHTML = `<i data-lucide="copy" style="width:11px;height:11px;"></i> Copy`; lucide.createIcons(); }, 2000);
  });
  aiActions.appendChild(aiCopyBtn);
  content.appendChild(aiActions);
  renderLatex(block);

  if (isCurrentSession()) { lucide.createIcons(); messages.scrollTop = messages.scrollHeight; }
  return fullText;
}

// --- VCE Prompt Builder (injects trained knowledge) ---
let _allKnowledgeCache = null;

function filterRelevantKnowledge(allKnowledge, prompt, history) {
  if (!allKnowledge || allKnowledge.length === 0) return '';

  // Extract keywords from prompt + last 3 history messages
  const recentHistory = history.slice(-3).map(m => m.content).join(' ');
  const fullContext = (prompt + ' ' + recentHistory).toLowerCase();
  const keywords = fullContext
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .filter(w => w.length > 3)
    .filter(w => !['what', 'when', 'where', 'which', 'that', 'this',
      'with', 'from', 'have', 'will', 'your', 'about',
      'tell', 'give', 'make', 'some', 'just', 'like'].includes(w));

  // Parse all knowledge entries
  const entries = [];
  try {
    const parsed = JSON.parse(allKnowledge);
    parsed.forEach(kb => {
      entries.push({
        folder: kb.folder,
        name: kb.name,
        summary: kb.summary || '',
        facts: kb.facts || [],
        score: 0
      });
    });
  } catch {
    // Already a string — return as is if small enough
    if (allKnowledge.length < 2000) return allKnowledge;
    return '';
  }

  // Score each entry by keyword matches
  entries.forEach(entry => {
    const entryText = (entry.folder + ' ' + entry.name + ' ' +
      entry.summary + ' ' + entry.facts.join(' ')).toLowerCase();
    keywords.forEach(kw => {
      if (entryText.includes(kw)) entry.score += 1;
    });
    // Boost if folder or name directly matches
    if (keywords.some(kw => entry.name.toLowerCase().includes(kw))) entry.score += 3;
    if (keywords.some(kw => entry.folder.toLowerCase().includes(kw))) entry.score += 2;
  });

  // Sort by relevance score
  entries.sort((a, b) => b.score - a.score);

  // Take top 5 most relevant entries only
  const topEntries = entries.filter(e => e.score > 0).slice(0, 5);

  if (topEntries.length === 0) return ''; // no relevant knowledge

  // Build context string
  let context = '=== RELEVANT KNOWLEDGE ===\n\n';
  topEntries.forEach(entry => {
    context += `[${entry.folder} / ${entry.name}]\n`;
    if (entry.summary) context += `Summary: ${entry.summary}\n`;
    if (entry.facts.length > 0) {
      context += `Facts:\n`;
      entry.facts.slice(0, 10).forEach((fact, i) => {
        context += `  ${i + 1}. ${fact}\n`;
      });
    }
    context += '\n';
  });

  return context;
}

async function buildVCEPrompt(prompt, history) {
  if (_allKnowledgeCache === null) {
    _allKnowledgeCache = await loadAllKnowledge();
  }
  const knowledge = _allKnowledgeCache;

  const system = `You are a helpful, confident AI assistant built on Syntx Labs.
${knowledge ? `You have been trained with the following knowledge. Use it to answer questions accurately:\n\n${knowledge}` : ''}
Give clear, accurate responses. If the answer is in your knowledge base, use it confidently. If you don't know something, say so directly. Avoid speculation.`;

  let full = system + '\n\n';
  if (history.length > 0) {
    full += history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    full += `\nUser: ${prompt}\nAssistant:`;
  } else {
    full += `User: ${prompt}\nAssistant:`;
  }
  return full;
}

// --- Send Message ---
async function vceSendMessage(retryText = null) {
  if (vceIsGenerating) return;
  const input = document.getElementById('vce-input');
  const text = retryText || input.value.trim();
  if (!text) return;

  if (!retryText) { input.value = ''; input.style.height = 'auto'; }
  if (vceActiveSessionId === null) vceCreateSession();

  const sessionId = vceActiveSessionId;
  const session = vceSessions.find(s => s.id === sessionId);

  // On retry: strip the last user message and AI reply
  if (retryText && session) {
    const lastUserIdx = [...session.messages].reverse().findIndex(m => m.type === 'user');
    if (lastUserIdx !== -1) session.messages.splice(session.messages.length - 1 - lastUserIdx);
    const messages = document.getElementById('vce-messages');
    messages.querySelectorAll('.vce-ai-block').forEach((el, i, arr) => { if (i === arr.length - 1) el.remove(); });
    messages.querySelectorAll('.vce-user-wrapper').forEach((el, i, arr) => { if (i === arr.length - 1) el.remove(); });
  }

  const history = session ? session.messages.map(m => ({ role: m.type, content: m.content })) : [];
  const isFirstMessage = session && session.messages.length === 0;

  vceAppendUser(text, (t) => vceSendMessage(t));
  if (session) { session.messages.push({ type: 'user', content: text }); await saveVceSessions(); }

  // Workflow trigger
  const workflowMatch = text.match(/using (?:the )?(\w+) workflow/i) ||
    text.match(/using (?:the )?workflow (\w+)/i) ||
    text.match(/run (?:the )?(\w+) workflow/i) ||
    text.match(/with (?:the )?workflow (\w+)/i) ||
    text.match(/workflow[:\s]+(\w+)/i);

  if (workflowMatch) {
    const workflowName = workflowMatch[1];
    await vceRunWorkflow(workflowName, text);
    return;
  }

  // Skill trigger
  const skillMatch = text.match(/using (?:the )?(?:skill )?(\w+) skill/i) ||
    text.match(/using (?:the )?(\w+) skill/i) ||
    text.match(/run (?:skill )?(\w+)/i) ||
    text.match(/use (?:the )?(\w+) skill/i) ||
    text.match(/using the skill (\w+)/i) ||
    text.match(/with (?:the )?skill (\w+)/i) ||
    text.match(/skill[:\s]+(\w+)/i);

  if (skillMatch) {
    const skillName = skillMatch[1];
    await vceRunSkill(skillName, text);
    return;
  }

  // Auto-generate title on first message
  if (isFirstMessage && session) {
    vceGenerateTitle(text).then(title => { session.title = title; vceRenderHistory(); saveVceSessions(); });
  }

  vceSetGenerating(true);
  await vceAppendAI(text, history, sessionId);
  vceSetGenerating(false);
  vceRenderHistory();
}
async function vceRunSkill(skillName, originalMessage) {
  // Check skill exists
  const skill = await invokePython('load_skill', { skill_name: skillName });
  if (!skill) {
    vceAppendAI(`I couldn't find a skill called "${skillName}". Use /skill list in the Instruction Console to see available skills.`, [], vceActiveSessionId);
    return;
  }

  // Extract inputs from the message using AI
  let inputs = {};
  if (skill.inputs && skill.inputs.length > 0) {
    // Try to extract input values from the message
    for (const inp of skill.inputs) {
      // Simple extraction — look for the value near the input name
      const pattern = new RegExp(`(\\w+)\\s+${inp.name}|${inp.name}[:\\s]+(\\w+)`, 'i');
      const match = originalMessage.match(pattern);
      if (match) {
        inputs[inp.name] = match[1] || match[2];
      } else {
        // Extract topic — remove skill reference and common filler words
        const filler = ['give', 'me', 'facts', 'about', 'write', 'create', 'make',
          'using', 'the', 'skill', 'a', 'an', 'for', 'on', 'get',
          'find', 'look', 'up', 'some', 'please', 'can', 'you'];
        const cleaned = originalMessage
          .replace(/using (?:the )?\w+ skill/i, '')
          .replace(/run (?:skill )?\w+/i, '')
          .replace(/use (?:the )?\w+ skill/i, '')
          .trim();
        const words = cleaned.split(' ')
          .map(w => w.replace(/[^a-zA-Z0-9_]/g, ''))
          .filter(w => w.length > 1 && !filler.includes(w.toLowerCase()));
        inputs[inp.name] = words.join('_') || 'default';
      }
    }
  }

  // Show skill running message
  const messages = document.getElementById('vce-messages');
  showTypingIndicator();

  // Run the skill
  const result = await invokePython('execute_skill', {
    skill_json: JSON.stringify(skill),
    user_inputs: JSON.stringify(inputs)
  });

  // Show result
  const resultBlock = document.createElement('div');
  resultBlock.className = 'vce-ai-block';
  const logo = document.createElement('div');
  logo.className = 'vce-ai-logo';
  logo.textContent = '</>';
  const content = document.createElement('div');
  content.className = 'vce-ai-content';

  if (result.success) {
    // Parse and render the result message cleanly
    const blocks = parseVCEResponse(result.message || 'Done.');
    blocks.forEach(b => content.appendChild(b));
  } else {
    const errEl = document.createElement('div');
    errEl.className = 'vce-ai-line';
    errEl.style.color = '#FF4D4D';
    errEl.textContent = `Something went wrong: ${result.message}`;
    content.appendChild(errEl);
  }

  resultBlock.appendChild(logo);
  resultBlock.appendChild(content);
  messages.appendChild(resultBlock);
  messages.scrollTop = messages.scrollHeight;
  lucide.createIcons();

  // Save to session
  const session = vceSessions.find(s => s.id === vceActiveSessionId);
  if (session) {
    session.messages.push({
      type: 'assistant',
      content: `Ran skill: ${skillName}\n${result.success ? '✓' : '✗'} ${result.message || ''}`
    });
    await saveVceSessions();
  }
}

function vceAskUser(question) {
  return new Promise((resolve) => {
    const messages = document.getElementById('vce-messages');

    // Show question bubble
    const askBlock = document.createElement('div');
    askBlock.className = 'vce-ai-block';
    askBlock.innerHTML = `
      <div class="vce-ai-logo"></></div>
      <div class="vce-ai-content">
        <div class="vce-ai-line">${question}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input type="text" id="vce-ask-input" placeholder="Type your answer..."
            style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;
                   font-size:12px;font-family:monospace;outline:none;" />
          <button id="vce-ask-submit"
            style="padding:6px 14px;background:#FF4D00;color:white;border:none;
                   border-radius:4px;cursor:pointer;font-size:12px;">OK</button>
        </div>
      </div>
    `;
    messages.appendChild(askBlock);
    messages.scrollTop = messages.scrollHeight;

    const input = document.getElementById('vce-ask-input');
    const submit = document.getElementById('vce-ask-submit');

    input.focus();

    function confirm() {
      const val = input.value.trim();
      // Replace input with plain text
      const answerEl = document.createElement('div');
      answerEl.className = 'vce-ai-line';
      answerEl.style.cssText = 'opacity:0.7;font-size:11px;margin-top:4px;';
      answerEl.textContent = `→ ${val}`;
      askBlock.querySelector('.vce-ai-content').appendChild(answerEl);
      // Remove input box
      askBlock.querySelector('div[style*="display:flex"]').remove();
      resolve(val || null);
    }

    submit.addEventListener('click', confirm);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') { resolve(null); askBlock.remove(); }
    });
  });
}

async function vceRunWorkflow(workflowName, originalMessage) {
  const workflow = await invokePython('load_workflow', { workflow_name: workflowName });
  if (!workflow) {
    const block = document.createElement('div');
    block.className = 'vce-ai-block';
    block.innerHTML = `<div class="vce-ai-logo"></></div>
      <div class="vce-ai-content">
        <div class="vce-ai-line" style="color:#FF4D4D;">
          Workflow "${workflowName}" not found. Use /workflow list to see available workflows.
        </div>
      </div>`;
    document.getElementById('vce-messages').appendChild(block);
    return;
  }

  // Extract inputs — ask user if missing
  let inputs = {};
  if (workflow.inputs && workflow.inputs.length > 0) {
    const filler = ['give', 'me', 'run', 'using', 'the', 'workflow',
      'a', 'an', 'for', 'on', 'get', 'find', 'please'];
    const cleaned = originalMessage
      .replace(/using (?:the )?\w+ workflow/i, '')
      .replace(/run (?:the )?\w+ workflow/i, '')
      .trim();
    const words = cleaned.split(' ')
      .map(w => w.replace(/[^a-zA-Z0-9_]/g, ''))
      .filter(w => w.length > 1 && !filler.includes(w.toLowerCase()));

    for (const inp of workflow.inputs) {
      // Try to extract from message first
      let val = words.length > 0 ? words.join('_') : null;

      // If not found — ask user via VCE input
      if (!val || val === 'default') {
        val = await vceAskUser(`What is the value for <strong>${inp.name}</strong>?`);
        if (!val && inp.required) {
          const errBlock = document.createElement('div');
          errBlock.className = 'vce-ai-block';
          errBlock.innerHTML = `
            <div class="vce-ai-logo"></></div>
            <div class="vce-ai-content">
              <div class="vce-ai-line" style="color:#FF4D4D;">
                Input "${inp.name}" is required. Workflow cancelled.
              </div>
            </div>`;
          document.getElementById('vce-messages').appendChild(errBlock);
          return;
        }
      }
      inputs[inp.name] = val || '';
    }
  }

  const messages = document.getElementById('vce-messages');
  showTypingIndicator();

  const result = await invokePython('execute_workflow', {
    workflow_json: JSON.stringify(workflow),
    user_inputs: JSON.stringify(inputs)
  });

  hideTypingIndicator();

  const resultBlock = document.createElement('div');
  resultBlock.className = 'vce-ai-block';
  const logo = document.createElement('div');
  logo.className = 'vce-ai-logo';
  logo.textContent = '</>';
  const content = document.createElement('div');
  content.className = 'vce-ai-content';

  if (result && result.success) {
    const blocks = parseVCEResponse(result.message || 'Workflow completed.');
    blocks.forEach(b => content.appendChild(b));
  } else {
    const errEl = document.createElement('div');
    errEl.className = 'vce-ai-line';
    errEl.style.color = '#FF4D4D';
    errEl.textContent = `Workflow failed: ${result ? result.message : 'Unknown error'}`;
    content.appendChild(errEl);
  }

  // Show step summary
  if (result && result.steps_run && result.steps_run.length > 0) {
    const summary = document.createElement('div');
    summary.className = 'vce-ai-line';
    summary.style.cssText = 'opacity:0.5;font-size:10px;margin-top:6px;font-family:monospace;';
    summary.textContent = result.steps_run
      .map(s => `${s.status === 'ok' ? '✓' : '✗'} Step ${s.step_id}`)
      .join(' → ');
    content.appendChild(summary);
  }

  resultBlock.appendChild(logo);
  resultBlock.appendChild(content);
  messages.appendChild(resultBlock);
  messages.scrollTop = messages.scrollHeight;
  lucide.createIcons();

  // Save to session
  const session = vceSessions.find(s => s.id === vceActiveSessionId);
  if (session) {
    session.messages.push({
      type: 'assistant',
      content: `Ran workflow: ${workflowName}\n${result ? (result.success ? '✓' : '✗') + ' ' + result.message : ''}`
    });
    await saveVceSessions();
  }
}

document.getElementById('vce-send-btn').addEventListener('click', () => vceSendMessage());
document.getElementById('vce-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); vceSendMessage(); }
});

// --- Input Auto-grow & Button Toggle ---
vceInput.addEventListener('input', () => {
  vceInput.style.height = 'auto';
  vceInput.style.height = Math.min(vceInput.scrollHeight, 240) + 'px';
  const hasText = vceInput.value.trim().length > 0;
  vceSendBtn.classList.toggle('visible', hasText);
  vceSpeakBtn.classList.toggle('compact', hasText);
});

document.querySelector('.vce-speak-btn').addEventListener('click', (e) => { e.preventDefault(); toggleVCESpeak(); });

// --- Markdown Parser ---
function parseMarkdown(text) {
  // Escape HTML first to prevent rendering
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code class="vce-inline-code">$1</code>');

  return text;
}

// --- Sidebar Show/Hide ---
function showVCESidebar() {
  leftPanel.classList.add('hidden');
  vceSidebar.style.display = 'flex';
  requestAnimationFrame(() => { requestAnimationFrame(() => { vceSidebar.classList.add('visible'); lucide.createIcons(); }); });
}

function hideVCESidebar() {
  vceSidebar.classList.remove('visible');
  vceSidebar.style.display = 'none';
  leftPanel.classList.remove('hidden');
}

vceSidebarSearchBtn.addEventListener('click', () => {
  vceSidebarSearch.classList.toggle('open');
  if (vceSidebarSearch.classList.contains('open')) vceSidebarSearchInput.focus();
});

vceSidebarSearchInput.addEventListener('input', () => {
  const q = vceSidebarSearchInput.value.toLowerCase();
  document.querySelectorAll('.vce-history-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

document.getElementById('vce-sidebar-new-btn').addEventListener('click', () => {
  vceCreateSession();
  document.getElementById('vce-messages').innerHTML = '';
  lucide.createIcons();
});

vceExitBtn.addEventListener('click', () => {
  hideVCESidebar();
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => { if (i.textContent.trim() === 'Instruction Console') i.classList.add('active'); });
});

// --- History List ---
function vceRenderHistory() {
  const list = document.getElementById('vce-sidebar-history');
  list.innerHTML = '';
  vceSessions.slice().reverse().forEach(session => {
    const li = document.createElement('li');
    li.className = 'vce-history-item' + (session.id === vceActiveSessionId ? ' active' : '') + (session.starred ? ' starred' : '');
    li.textContent = session.title;
    li.addEventListener('click', () => vceSwitchSession(session.id));
    li.addEventListener('contextmenu', (e) => vceShowContextMenu(e, session.id));
    list.appendChild(li);
  });
}

// Auto-generate a short session title from the first message
async function vceGenerateTitle(prompt) {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: (JSON.parse(localStorage.getItem('syntx_settings') || '{}').textModel || 'gemma2:2b'), prompt: `Generate a very short 3-5 word title with proper blank spaces for a chat that starts with this message: "${prompt}". Reply with ONLY the title, no quotes, no punctuation, no explanation.`, stream: false })
    });
    const data = await response.json();
    return data.response.trim();
  } catch { return 'New Environment'; }
}

function selectTextModel(name) {
  currentTextModel = name;
  localStorage.setItem('syntx_text_model', name);
  // Save to a flag file so Python can read it
  window.__TAURI__.core.invoke('save_model_preference', {
    text_model: name,
    vision_model: currentVisionModel
  }).catch(console.error);
  updateAllModelRefs(name, currentVisionModel);
  updateModelCurrentLabel();
  renderModelList();
  updateSettingsModelHint();
  showModelToast(`Text model set to ${name}`);
}

function vceUpdateHeaderTitle(title) {
  const header = document.getElementById('vce-chat-header');
  if (header) header.textContent = title || 'New Environment';
}

// --- Load All Trained Knowledge (for VCE context) ---
async function loadAllKnowledge() {
  try {
    const raw = await window.__TAURI__.core.invoke('get_all_knowledge');
    const knowledge = JSON.parse(raw);
    if (!knowledge || knowledge.length === 0) return '';
    let context = '=== TRAINED KNOWLEDGE BASE ===\n\n';
    knowledge.forEach(kb => {
      context += `[${kb.folder} / ${kb.name}]\n`;
      if (kb.summary) context += `Summary: ${kb.summary}\n`;
      if (kb.facts && kb.facts.length > 0) { context += `Facts:\n`; kb.facts.forEach((fact, i) => { context += `  ${i + 1}. ${fact}\n`; }); }
      context += '\n';
    });
    return context;
  } catch (err) { console.error('Knowledge load error:', err); return ''; }
}

// --- VCE Session Persistence ---
async function saveVceSessions() {
  try { await window.__TAURI__.core.invoke('save_vce_sessions', { sessions: JSON.stringify(vceSessions) }); }
  catch (err) { console.error('Save VCE sessions error:', err); }
}

async function loadVceSessions() {
  try {
    const data = await window.__TAURI__.core.invoke('load_vce_sessions');
    vceSessions = JSON.parse(data) || [];
    vceActiveSessionId = null;
    vceRenderHistory();
    lucide.createIcons();
  } catch (err) { console.error('Load VCE sessions error:', err); }
}

// --- VCE Context Menu ---
function vceShowContextMenu(e, sessionId) {
  e.preventDefault();
  e.stopPropagation();
  vceContextSessionId = sessionId;
  vceHistoryCtxMenu.style.display = 'block';
  vceHistoryCtxMenu.style.left = e.clientX + 'px';
  vceHistoryCtxMenu.style.top = e.clientY + 'px';
  const session = vceSessions.find(s => s.id === sessionId);
  document.getElementById('ctx-vce-star').textContent = session && session.starred ? 'Unstar' : 'Star';
}

function vceHideContextMenu() { vceHistoryCtxMenu.style.display = 'none'; vceContextSessionId = null; }
document.addEventListener('click', () => { vceHistoryCtxMenu.style.display = 'none'; vceContextSessionId = null; });
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#vce-history-context-menu')) vceHideContextMenu(); });

document.getElementById('ctx-vce-rename').addEventListener('click', (e) => {
  e.stopPropagation();
  vceModalSessionId = vceContextSessionId;
  const session = vceSessions.find(s => s.id === vceModalSessionId);
  if (!session) return;
  document.getElementById('vce-rename-input').value = session.title;
  vceRenameOverlay.classList.add('active');
  setTimeout(() => document.getElementById('vce-rename-input').focus(), 100);
  vceHideContextMenu();
});

document.getElementById('vce-rename-cancel').addEventListener('click', () => vceRenameOverlay.classList.remove('active'));

document.getElementById('vce-rename-confirm').addEventListener('click', () => {
  const session = vceSessions.find(s => s.id === vceModalSessionId);
  if (!session) return;
  const newName = document.getElementById('vce-rename-input').value.trim();
  if (newName) { session.title = newName; vceRenderHistory(); saveVceSessions(); }
  vceRenameOverlay.classList.remove('active');
  vceModalSessionId = null;
});

document.getElementById('vce-rename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('vce-rename-confirm').click();
  if (e.key === 'Escape') vceRenameOverlay.classList.remove('active');
});

document.getElementById('ctx-vce-star').addEventListener('click', (e) => {
  e.stopPropagation();
  const session = vceSessions.find(s => s.id === vceContextSessionId);
  if (!session) return;
  session.starred = !session.starred;
  vceRenderHistory();
  saveVceSessions();
  vceHideContextMenu();
});

document.getElementById('ctx-vce-delete').addEventListener('click', (e) => {
  e.stopPropagation();
  vceModalSessionId = vceContextSessionId;
  const session = vceSessions.find(s => s.id === vceModalSessionId);
  if (!session) return;
  document.getElementById('vce-delete-name').textContent = session.title;
  vceDeleteOverlay.classList.add('active');
  vceHideContextMenu();
});

document.getElementById('vce-delete-cancel').addEventListener('click', () => vceDeleteOverlay.classList.remove('active'));

document.getElementById('vce-delete-confirm').addEventListener('click', () => {
  vceSessions = vceSessions.filter(s => s.id !== vceModalSessionId);
  if (vceActiveSessionId === vceModalSessionId) { vceActiveSessionId = null; document.getElementById('vce-messages').innerHTML = ''; }
  vceRenderHistory();
  saveVceSessions();
  vceDeleteOverlay.classList.remove('active');
  vceModalSessionId = null;
});

// --- VCE Add Menu ---


// --- VCE Toast ---
function vceShowToast(msg) {
  const toast = document.getElementById('vce-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- VCE Add Menu Options (most are placeholders) ---
document.querySelectorAll('.vce-add-option').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const option = btn.dataset.option;
    vceCloseAddMenu();
    if (option === 'files' || option === 'screenshot') { vceShowToast('⚠️ This feature requires a Vision Language Model'); return; }
    if (option === 'web-search') { vceShowToast('🔍 Web Search — coming soon!'); return; }
    if (option === 'workflows') { vceShowToast('⚡ Workflows — coming soon!'); return; }
    if (option === 'skills') { vceShowToast('🛠️ Skills — coming soon!'); return; }
    if (option === 'summarize') { vceShowToast('📝 Summarize — coming soon!'); return; }
  });
});

function vceCloseAddMenu() { vceAddMenuOpen = false; vceAddMenu.classList.remove('open'); vceAddBtn.classList.remove('open'); }

// --- Voice Input ---
async function toggleVCESpeak() {
  const vceInput = document.getElementById('vce-input');
  const speakBtn = document.querySelector('.vce-speak-btn');
  if (vceIsListening) {
    vceMediaRecorder.stop();
    vceIsListening = false;
    speakBtn.style.color = '';
    vceInput.placeholder = "Message VCE...";
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vceMediaRecorder = new MediaRecorder(stream);
      vceAudioChunks = [];
      vceMediaRecorder.ondataavailable = (e) => vceAudioChunks.push(e.data);
      vceMediaRecorder.onstop = () => stream.getTracks().forEach(track => track.stop());
      vceMediaRecorder.start();
      vceIsListening = true;
      speakBtn.style.color = '#FF4D00';
      vceInput.placeholder = "Listening...";
    } catch (err) { console.error("Mic Error:", err); alert("Microphone access denied! Check Linux System Settings -> Privacy."); }
  }
}

loadVceSessions();


// ============================================================
// SKILL CONSTELLATION
// ============================================================


// --- Skill Constellation State ---
let scSkills = [];
let scSelectedSkill = null;

async function loadSkillConstellation() {
  const result = await invokePython('get_skill_list', {});
  scSkills = result || [];
  renderSkillGrid();
  await loadWorkflowsForSkills();
  if (scSkills.length > 0) renderSkillGraph(scSkills[0]);
}

function renderSkillGrid() {
  const body = document.getElementById('skills-body');
  body.innerHTML = '';

  if (scSkills.length === 0) {
    body.innerHTML = `<div class="grid-row" style="opacity:0.4;padding:16px;">No skills found. Create one with /skill create</div>`;
    return;
  }

  scSkills.forEach((skill, idx) => {
    const row = document.createElement('div');
    row.className = 'grid-row selectable';
    row.dataset.skillName = skill.skill_name;
    row.innerHTML = `
      <div class="cell col-src" style="flex: 0 0 60px;">
        <span># ${String(idx + 1).padStart(3, '0')}</span>
      </div>
      <div class="cell col-name" style="flex: 0 0 150px;">
        <span>${skill.skill_name}</span>
      </div>
      <div class="cell col-mem" style="flex: 0 0 100px;">
      <span>${skill.filesize < 1024 ?
        skill.filesize + ' B' :
        (skill.filesize / 1024).toFixed(1) + ' KB'}</span>
      </div>
      <div class="cell col-source" style="flex: 0 0 140px;">
        <span>${skill.skill_name}.json</span>
      </div>
      <div class="cell col-ontology" style="flex: 0 0 180px;">
        <span>${skill.knowledge_access && skill.knowledge_access.length > 0 ? skill.knowledge_access.join(', ') : '—'}</span>
      </div>
      <div class="cell col-executed" style="flex: 0 0 150px;">
      <span>${skill.last_executed !== '—' ?
        new Date(skill.last_executed).toLocaleString() : '—'}</span>
      </div>
      <div class="cell col-desc" style="flex: 1 1 auto;">
        <span>${skill.description || '—'}</span>
      </div>
      <div class="cell col-workflows" style="flex: 0 0 150px;" data-skill="${skill.skill_name}">
        <span class="workflow-tags" data-skill="${skill.skill_name}">—</span>
      </div>
    `;

    // Click → show graph
    row.addEventListener('click', async () => {
      document.querySelectorAll('.grid-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const full = await invokePython('load_skill', { skill_name: skill.skill_name });
      if (full) renderSkillGraph(full);
    });

    // Right click → context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      scShowContextMenu(e, skill.skill_name);
    });

    body.appendChild(row);
  });
}

document.getElementById('sc-sort-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('sc-sort-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('click', () => {
  const menu = document.getElementById('sc-sort-menu');
  if (menu) menu.style.display = 'none';
});

function sortSkills(by) {
  if (by === 'src') {
    scSkills.sort((a, b) => (a._source || '').localeCompare(b._source || ''));
  } else if (by === 'last_executed') {
    scSkills.sort((a, b) => {
      if (a.last_executed === '—') return 1;
      if (b.last_executed === '—') return -1;
      return new Date(b.last_executed) - new Date(a.last_executed);
    });
  } else if (by === 'filesize') {
    scSkills.sort((a, b) => (b.filesize || 0) - (a.filesize || 0));
  }
  renderSkillGrid();
  loadWorkflowsForSkills();
  document.getElementById('sc-sort-menu').style.display = 'none';
}

document.getElementById('sc-new-btn').addEventListener('click', () => {
  // Switch to instruction console and start skill creation
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('nav-instruction-console').classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  // Trigger skill creation
  feedInput.value = '/skill create';
  sendInstruction();
});

async function loadWorkflowsForSkills() {
  const workflows = await invokePython('get_workflow_list', {});
  if (!workflows) return;

  // Load full workflow data to check which skills they use
  const skillWorkflowMap = {};

  for (const w of workflows) {
    const full = await invokePython('load_workflow', { workflow_name: w.workflow_name });
    if (!full) continue;
    for (const step of full.steps || []) {
      if (step.type === 'skill' && step.skill_name) {
        if (!skillWorkflowMap[step.skill_name]) {
          skillWorkflowMap[step.skill_name] = [];
        }
        skillWorkflowMap[step.skill_name].push(w.workflow_name);
      }
    }
  }

  // Update UI
  document.querySelectorAll('.workflow-tags').forEach(el => {
    const skillName = el.dataset.skill;
    const wfs = skillWorkflowMap[skillName] || [];
    if (wfs.length === 0) {
      el.innerHTML = '—';
    } else if (wfs.length === 1) {
      el.innerHTML = `<span class="workflow-text">${wfs[0]}</span>`;
    } else {
      el.innerHTML = `
        <span class="workflow-text">${wfs[0]}</span>
        <span class="plus-tag" style="cursor:pointer;" 
              onclick="showWorkflowPopup(event, ${JSON.stringify(wfs)})">
          +${wfs.length - 1}
        </span>`;
    }
  });
}

function showWorkflowPopup(e, workflows) {
  e.stopPropagation();
  const existing = document.getElementById('wf-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'wf-popup';
  popup.style.cssText = `
    position: fixed;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 10px 14px;
    font-family: monospace;
    font-size: 11px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 9999;
    left: ${e.clientX}px;
    top: ${e.clientY}px;
    min-width: 160px;
  `;
  popup.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;color:#333;">Used in workflows:</div>
    ${workflows.map(w => `<div style="padding:2px 0;color:#4D7EFF;">• ${w}</div>`).join('')}
  `;
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 10);
}

function renderSkillGraph(skill) {
  scSelectedSkill = skill;
  const svg = document.getElementById('constellation-svg');
  svg.innerHTML = '';

  const steps = skill.steps || [];
  const knowledge = (skill.requires && skill.requires.knowledge_access) ?
    skill.requires.knowledge_access.filter(k => k && k.length > 0) : [];
  const hasKnowledge = knowledge.length > 0;

  const cx = 340, cy = 150; // center

  // Draw step pentagons around the center
  const stepCount = steps.length;
  const radius = 110;

  // Draw edges first
  steps.forEach((step, i) => {
    const angle = (i * 2 * Math.PI / stepCount) - Math.PI / 2;
    const sx = cx + radius * Math.cos(angle);
    const sy = cy + radius * Math.sin(angle);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', sx);
    line.setAttribute('y2', sy);
    line.setAttribute('stroke', '#ccc');
    line.setAttribute('stroke-width', '1.2');
    svg.appendChild(line);
  });

  // Draw knowledge circles if connected
  if (hasKnowledge) {
    knowledge.forEach((k, i) => {
      const angle = (i * 2 * Math.PI / knowledge.length) + Math.PI / 4;
      const kr = 160;
      const kx = cx + kr * Math.cos(angle);
      const ky = cy + kr * Math.sin(angle);

      // Edge from center to knowledge
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', kx);
      line.setAttribute('y2', ky);
      line.setAttribute('stroke', '#4D7EFF44');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4,3');
      svg.appendChild(line);

      // Circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', kx);
      circle.setAttribute('cy', ky);
      circle.setAttribute('r', '13');
      circle.setAttribute('fill', '#4D7EFF');
      svg.appendChild(circle);

      // Label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', kx);
      text.setAttribute('y', ky + 26);
      text.setAttribute('font-size', '9');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('fill', '#888');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = k.split('/').pop();
      svg.appendChild(text);
    });
  }

  // Draw step pentagons
  steps.forEach((step, i) => {
    const angle = (i * 2 * Math.PI / stepCount) - Math.PI / 2;
    const sx = cx + radius * Math.cos(angle);
    const sy = cy + radius * Math.sin(angle);
    const rotation = Math.round(angle * 180 / Math.PI);

    const color = step.type === 'ai' ? '#2DBD6E' :
      step.type === 'condition' ? '#FF9900' : '#6B4EAA';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${sx},${sy}) rotate(${rotation})`);

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0,-16 15.2,-4.9 9.4,12.9 -9.4,12.9 -15.2,-4.9');
    poly.setAttribute('fill', color);
    g.appendChild(poly);
    svg.appendChild(g);

    // Step label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', sx);
    label.setAttribute('y', sy + 28);
    label.setAttribute('font-size', '9');
    label.setAttribute('font-family', 'monospace');
    label.setAttribute('fill', '#888');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = `#${step.step_id} ${step.type}`;
    svg.appendChild(label);
  });

  // Draw central pentagon (skill name)
  const centerG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  centerG.setAttribute('transform', `translate(${cx},${cy})`);

  const centerPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  centerPoly.setAttribute('points', '0,-22 20.9,-6.8 12.9,17.8 -12.9,17.8 -20.9,-6.8');
  centerPoly.setAttribute('fill', '#E8632A');
  centerG.appendChild(centerPoly);
  svg.appendChild(centerG);

  // Skill name label
  const nameLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  nameLabel.setAttribute('x', cx);
  nameLabel.setAttribute('y', cy + 38);
  nameLabel.setAttribute('font-size', '11');
  nameLabel.setAttribute('font-family', 'monospace');
  nameLabel.setAttribute('fill', '#333');
  nameLabel.setAttribute('text-anchor', 'middle');
  nameLabel.setAttribute('font-weight', '600');
  nameLabel.textContent = skill.skill_name;
  svg.appendChild(nameLabel);
}

// --- Skill Constellation Context Menu ---
let scContextSkillName = null;
const scContextMenu = document.createElement('div');
scContextMenu.className = 'context-menu';
scContextMenu.id = 'sc-context-menu';
scContextMenu.style.display = 'none';
scContextMenu.innerHTML = `
  <div class="context-item" id="sc-ctx-run">Run skill</div>
  <div class="context-item" id="sc-ctx-test">Test in sandbox</div>
  <div class="context-item" id="sc-ctx-view">View JSON</div>
  <div class="context-separator"></div>
  <div class="context-item context-danger" id="sc-ctx-delete">Delete skill</div>
`;
document.body.appendChild(scContextMenu);

function scShowContextMenu(e, skillName) {
  scContextSkillName = skillName;
  scContextMenu.style.display = 'block';
  scContextMenu.style.left = e.clientX + 'px';
  scContextMenu.style.top = e.clientY + 'px';
}

document.addEventListener('click', () => { scContextMenu.style.display = 'none'; });

document.getElementById('sc-ctx-run').addEventListener('click', () => {
  if (!scContextSkillName) return;
  // Switch to instruction console and run
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  showSkillMessage(`Running <strong>${scContextSkillName}</strong>...`, 'building');
  invokePython('load_skill', { skill_name: scContextSkillName }).then(skill => {
    if (!skill) return;
    invokePython('execute_skill', {
      skill_json: JSON.stringify(skill),
      user_inputs: JSON.stringify({})
    }).then(result => {
      showSkillMessage(
        result.success ? `✓ ${result.message}` : `✗ ${result.message}`,
        result.success ? 'success' : 'error'
      );
    });
  });
});

document.getElementById('sc-ctx-test').addEventListener('click', async () => {
  if (!scContextSkillName) return;
  const skill = await invokePython('load_skill', { skill_name: scContextSkillName });
  if (!skill) return;
  const result = await invokePython('test_skill', { skill_json: JSON.stringify(skill) });
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  showSkillMessage(
    `<pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;">${result.summary}</pre>`,
    result.passed ? 'success' : 'error'
  );
});

document.getElementById('sc-ctx-view').addEventListener('click', async () => {
  if (!scContextSkillName) return;
  const skill = await invokePython('load_skill', { skill_name: scContextSkillName });
  if (!skill) return;
  const clean = { ...skill };
  delete clean._source;
  delete clean._filepath;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  showSkillMessage(
    `<strong>${scContextSkillName}</strong><br><br>
     <pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;max-height:320px;overflow-y:auto;">${JSON.stringify(clean, null, 2)}</pre>`,
    'system'
  );
});

document.getElementById('sc-ctx-delete').addEventListener('click', () => {
  if (!scContextSkillName) return;
  pendingSkillDelete = scContextSkillName;
  document.getElementById('session-modal-name').textContent = `skill "${scContextSkillName}"`;
  document.getElementById('session-modal-overlay').style.display = 'flex';
});

// --- Internal Panel Resizer (grid table vs node graph) ---
const scDivider = document.getElementById('sc-divider');
const scGridPanel = document.getElementById('sc-grid-panel');
const scPanels = document.querySelector('.sc-panels');

scDivider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  scDivider.classList.add('dragging');
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';

  const onMouseMove = (e) => {
    const panelsRect = scPanels.getBoundingClientRect();
    let newHeight = e.clientY - panelsRect.top;
    newHeight = Math.max(40, Math.min(newHeight, panelsRect.height - 40 - 6));
    scGridPanel.style.height = newHeight + 'px';
  };

  const onMouseUp = () => {
    scDivider.classList.remove('dragging');
    document.body.style.cursor = 'default';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});


// ============================================================
// WORKFLOW SYSTEM
// ============================================================

async function handleWorkflowCommand(input) {
  const parts = input.trim().split(' ');
  const sub = parts[1];
  const arg = parts.slice(2).join(' ').trim();

  switch (sub) {
    case 'create': startWorkflowCreation(); break;
    case 'list': await workflowList(); break;
    case 'view': await workflowView(arg); break;
    case 'run': await workflowRun(arg); break;
    case 'delete': await workflowDelete(arg); break;
    default:
      showSkillMessage(
        `Unknown workflow command. Available: create, list, view, run, delete`,
        'error'
      );
  }
}

// ── /workflow create ──────────────────────────────────────────

function startWorkflowCreation() {
  workflowCreationMode = true;
  workflowCreationStep = 'name';
  workflowCreationData = { name: null, description: null, steps: null };
  workflowConversationHistory = [];

  createSession();
  activeTrainingSessionId = activeSessionId;

  document.getElementById('console-status-text').textContent = 'Workflow creation in progress';
  document.getElementById('console-status-dot').classList.add('active');

  const session = sessions.find(s => s.id === activeSessionId);
  if (session) {
    session.title = 'New Workflow';
    renderSessions();
    lucide.createIcons();
  }

  showSkillMessage(
    `Workflow creation started!<br>What do you want to call this workflow?<br>
     <span style="font-size:11px;opacity:0.6;">Use lowercase with underscores. Example: morning_routine</span>`,
    'system'
  );
}

async function handleWorkflowCreationInput(text) {
  workflowConversationHistory.push({ role: 'user', content: text });

  // ── Step 1: Name ──────────────────────────────
  if (workflowCreationStep === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    const exists = await invokePython('workflow_exists', { workflow_name: name });
    if (exists === true) {
      showSkillMessage(`A workflow named <strong>${name}</strong> already exists.`, 'error');
      return;
    }
    workflowCreationData.name = name;
    workflowCreationStep = 'description';
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
      session.title = `workflow: ${name}`;
      document.getElementById('console-objective-text').textContent = `workflow: ${name}`;
      renderSessions();
      lucide.createIcons();
    }
    showSkillMessage(
      `Got it — workflow name: <strong>${name}</strong><br><br>Describe what this workflow does.`,
      'system'
    );
    return;
  }

  // ── Step 2: Description ───────────────────────
  if (workflowCreationStep === 'description') {
    workflowCreationData.description = text.trim();
    workflowCreationStep = 'steps';
    showSkillMessage(
      `Got it.<br><br>Now describe the steps. Use this format:<br>
      <span style="font-size:11px;opacity:0.7;">
      1. run skill_name with input={{variable}}<br>
      2. if step_1_success go to 3 else go to 4<br>
      3. run another_skill with input={{variable}}<br>
      4. wait 5 seconds
      </span>`,
      'system'
    );
    return;
  }

  // ── Step 3: Steps ─────────────────────────────
  if (workflowCreationStep === 'steps') {
    workflowCreationData.steps = text.trim().replace(/(\d+)\.\s*/g, '\n$1. ').trim();
    workflowConversationHistory.push({ role: 'user', content: text.trim() });
    workflowCreationStep = 'building';
    await buildAndSaveWorkflow();
    return;
  }
}

async function buildAndSaveWorkflow() {
  showSkillMessage(`Building workflow... analyzing steps...`, 'building');

  try {
    const parseResult = await invokePython('parse_workflow_from_conversation', {
      conversation_history: JSON.stringify(workflowConversationHistory),
      workflow_name: workflowCreationData.name,
      description: workflowCreationData.description,
      steps_text: workflowCreationData.steps
    });

    if (!parseResult.success) {
      showSkillMessage(`Could not build workflow: ${parseResult.errors?.join('<br>')}`, 'error');
      _exitWorkflowCreation();
      return;
    }

    if (parseResult.unresolved && parseResult.unresolved.length > 0) {
      showSkillMessage(
        `Steps I couldn't map:<br>` +
        parseResult.unresolved.map(u => `• Step ${u.step_id}: ${u.reason}`).join('<br>') +
        `<br><br>Make sure those skills exist first!`,
        'error'
      );
      _exitWorkflowCreation();
      return;
    }

    showSkillMessage(`Parsed! Saving workflow...`, 'building');

    const saveResult = await invokePython('save_workflow', {
      workflow_json: JSON.stringify(parseResult.workflow)
    });

    if (saveResult.success) {
      showSkillMessage(
        `✓ Workflow saved as <strong>${workflowCreationData.name}</strong>.<br>
         Use <code>/workflow run ${workflowCreationData.name}</code> to run it!`,
        'success'
      );
      window.syntxPlaySound();
    } else {
      showSkillMessage(`Failed to save workflow: ${saveResult.error}`, 'error');
    }

  } catch (err) {
    showSkillMessage(`Workflow creation crashed: ${err}`, 'error');
  }

  _exitWorkflowCreation();
}

function _exitWorkflowCreation() {
  workflowCreationMode = false;
  workflowCreationStep = null;
  workflowCreationData = { name: null, description: null, steps: null };
  workflowConversationHistory = [];
  document.getElementById('console-status-text').textContent = 'Training in halt';
  document.getElementById('console-status-dot').classList.remove('active');
  activeTrainingSessionId = null;
  renderSessions();
  lucide.createIcons();
  saveSessions();
}

// ── /workflow list ────────────────────────────────────────────

async function workflowList() {
  const result = await invokePython('get_workflow_list', {});
  if (!result || result.length === 0) {
    showSkillMessage(`No workflows found. Use <code>/workflow create</code> to build one.`, 'system');
    return;
  }
  const rows = result.map(w =>
    `<tr>
      <td style="padding:4px 12px 4px 0;font-weight:600;">${w.workflow_name}</td>
      <td style="padding:4px 12px 4px 0;opacity:0.6;font-size:11px;">${w.steps_count} steps</td>
      <td style="padding:4px 0;opacity:0.8;">${w.description || '—'}</td>
    </tr>`
  ).join('');
  showSkillMessage(
    `<strong>${result.length} workflow(s):</strong><br><br>
     <table style="font-size:12px;font-family:monospace;border-collapse:collapse;">${rows}</table>`,
    'system'
  );
}

// ── /workflow view ────────────────────────────────────────────

async function workflowView(name) {
  if (!name) { showSkillMessage(`Usage: /workflow view workflow_name`, 'error'); return; }
  const workflow = await invokePython('load_workflow', { workflow_name: name });
  if (!workflow) { showSkillMessage(`Workflow <strong>${name}</strong> not found.`, 'error'); return; }
  const clean = { ...workflow };
  delete clean._filepath;
  showSkillMessage(
    `<strong>${name}</strong><br><br>
     <pre style="font-size:11px;font-family:monospace;white-space:pre-wrap;max-height:320px;overflow-y:auto;">${JSON.stringify(clean, null, 2)}</pre>`,
    'system'
  );
}

// ── /workflow run ─────────────────────────────────────────────

async function workflowRun(arg) {
  const spaceIdx = arg.indexOf(' ');
  const name = spaceIdx === -1 ? arg : arg.substring(0, spaceIdx).trim();
  const inputStr = spaceIdx === -1 ? '{}' : arg.substring(spaceIdx + 1).trim();

  if (!name) { showSkillMessage(`Usage: /workflow run workflow_name {"input":"value"}`, 'error'); return; }

  let inputs = {};
  try { inputs = JSON.parse(inputStr); } catch {
    showSkillMessage(`Invalid inputs JSON.`, 'error'); return;
  }

  const workflow = await invokePython('load_workflow', { workflow_name: name });
  if (!workflow) { showSkillMessage(`Workflow <strong>${name}</strong> not found.`, 'error'); return; }

  // Check missing inputs
  if (workflow.inputs && workflow.inputs.length > 0) {
    const missing = workflow.inputs
      .filter(i => i.required && !inputs[i.name])
      .map(i => i.name);
    if (missing.length > 0) {
      showSkillMessage(
        `Missing required inputs: ${missing.map(m => `<code>${m}</code>`).join(', ')}<br>
        Example: <code>/workflow run ${name} {"${missing[0]}": "your value"}</code>`,
        'error'
      );
      return;
    }
  }

  showSkillMessage(`Running workflow <strong>${name}</strong>...`, 'building');

  const result = await invokePython('execute_workflow', {
    workflow_json: JSON.stringify(workflow),
    user_inputs: JSON.stringify(inputs)
  });

  // Show step-by-step results
  if (result && result.steps_run) {
    const stepSummary = result.steps_run.map(s =>
      `${s.status === 'ok' ? '✓' : '✗'} Step ${s.step_id} — ${s.status}${s.error ? ': ' + s.error : ''}`
    ).join('<br>');
    showSkillMessage(
      `<strong>Steps:</strong><br>${stepSummary}`,
      'system'
    );
  }

  showSkillMessage(
    result.success
      ? `✓ Workflow completed.<br><span style="font-size:11px;opacity:0.7;">${result.message}</span>`
      : `✗ Workflow failed: ${result.message}`,
    result.success ? 'success' : 'error'
  );
}

// ── /workflow delete ──────────────────────────────────────────

async function workflowDelete(name) {
  if (!name) { showSkillMessage(`Usage: /workflow delete workflow_name`, 'error'); return; }
  const result = await invokePython('delete_workflow', { workflow_name: name });
  if (result.success) showSkillMessage(`Workflow "${name}" deleted.`, 'success');
  else showSkillMessage(`Delete failed: ${result.error}`, 'error');
}

// ============================================================
// WORKFLOW ORCHESTRATOR FRONTEND
// ============================================================

const wfBackBtn = document.getElementById('wf-back-btn');
const wfGrid = document.getElementById('wf-view-grid');
const wfDetails = document.getElementById('wf-view-details');
const wfTitle = document.getElementById('workflow-section-title');

let currentWfTool = 'hand';
let wfIsDragging = false;
let wfActiveNode = null;
let wfOffset = { x: 0, y: 0 };
let wfConnections = [];
let wfCurrentWorkflow = null;

// ── Load and render workflow grid ─────────────────────────────

async function loadWorkflowGrid() {
  const workflows = await invokePython('get_workflow_list', {});
  const container = document.querySelector('.workflow-grid-container');
  const statusBar = document.querySelector('.workflow-status-bar .total-count');

  container.innerHTML = '';

  if (!workflows || workflows.length === 0) {
    container.innerHTML = `
      <div style="opacity:0.4;padding:24px;font-family:monospace;font-size:12px;">
        No workflows yet. Use <strong>/workflow create</strong> in the Instruction Console.
      </div>`;
    if (statusBar) statusBar.textContent = 'Total Workflows : 0';
    return;
  }

  workflows.forEach(w => {
    const card = document.createElement('div');
    card.className = 'workflow-card';
    card.dataset.workflowName = w.workflow_name;
    card.innerHTML = `
      <div class="card-main">
        <div class="card-icon-wrapper">
          <div style="width:32px;height:32px;background:#FF4D00;border-radius:6px;
                      display:flex;align-items:center;justify-content:center;
                      color:white;font-size:14px;font-family:monospace;">W</div>
        </div>
        <i data-lucide="chevron-right" class="card-chevron"></i>
      </div>
      <div class="card-footer">
        <span class="card-tag">[${w.workflow_name}]</span>
        <span class="card-count">${w.steps_count}</span>
      </div>
    `;

    card.addEventListener('click', () => openWorkflowDetail(w.workflow_name));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      wfShowContextMenu(e, w.workflow_name);
    });

    container.appendChild(card);
  });

  if (statusBar) statusBar.textContent = `Total Workflows : ${workflows.length}`;
  lucide.createIcons();
}

// ── Open workflow detail view ─────────────────────────────────

async function openWorkflowDetail(workflowName) {
  const workflow = await invokePython('load_workflow', { workflow_name: workflowName });
  if (!workflow) return;

  wfCurrentWorkflow = workflow;
  wfGrid.classList.remove('active');
  wfDetails.classList.add('active');
  wfBackBtn.style.display = 'block';
  wfTitle.textContent = `Workflows / ${workflowName}`;

  renderWorkflowNodes(workflow);
  lucide.createIcons();
}

// ── Go back to grid ───────────────────────────────────────────

wfBackBtn.addEventListener('click', () => {
  wfDetails.classList.remove('active');
  wfGrid.classList.add('active');
  wfBackBtn.style.display = 'none';
  wfTitle.textContent = 'Workflows';
  wfCurrentWorkflow = null;
});

// ── Render workflow nodes ─────────────────────────────────────

function renderWorkflowNodes(workflow) {
  const world = document.getElementById('node-world');
  const svg = document.getElementById('node-svg');

  // Clear existing nodes (keep SVG)
  world.querySelectorAll('.workflow-node').forEach(n => n.remove());
  svg.innerHTML = '';
  wfConnections = [];

  const steps = workflow.steps || [];
  const startX = 80;
  const startY = 80;
  const xGap = 260;
  const yOffset = 60;

  const nodeEls = [];

  steps.forEach((step, idx) => {
    const x = startX + (idx * xGap);
    const y = startY + (idx % 2 === 0 ? 0 : yOffset);

    const node = createWorkflowNode(step, x, y);
    world.appendChild(node);
    nodeEls.push(node);

    // Connect to previous step
    if (idx > 0) {
      wfConnections.push({ from: idx - 1, to: idx });
    }

    // Condition step — add branch connections
    if (step.type === 'condition') {
      const ifTrueIdx = steps.findIndex(s => s.step_id === step.if_true);
      const ifFalseIdx = steps.findIndex(s => s.step_id === step.if_false);
      if (ifTrueIdx >= 0) wfConnections.push({ from: idx, to: ifTrueIdx, label: 'true', color: '#2DBD6E' });
      if (ifFalseIdx >= 0) wfConnections.push({ from: idx, to: ifFalseIdx, label: 'false', color: '#FF4D4D' });
    }
  });

  // Draw lines after nodes are in DOM
  setTimeout(() => updateWfLines(nodeEls), 50);
}

// ── Create a single workflow node ─────────────────────────────

function createWorkflowNode(step, x, y) {
  const node = document.createElement('div');
  node.className = 'workflow-node';
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  node.dataset.stepId = step.step_id;

  // Color by type
  const colors = {
    skill: '#FF4D00',
    condition: '#FF9900',
    ai: '#2DBD6E',
    wait: '#4D7EFF'
  };
  const color = colors[step.type] || '#888';

  // Build content rows based on step type
  let rows = '';
  if (step.type === 'skill') {
    rows = `
      <div class="node-row">-- Skill: ${step.skill_name}</div>
      ${Object.entries(step.inputs || {}).map(([k, v]) =>
      `<div class="node-row">-- ${k}: ${v}</div>`
    ).join('')}
    `;
  } else if (step.type === 'condition') {
    rows = `
      <div class="node-row">-- If: ${step.condition}</div>
      <div class="node-row" style="color:#2DBD6E;">-- True → Step ${step.if_true}</div>
      <div class="node-row" style="color:#FF4D4D;">-- False → Step ${step.if_false}</div>
    `;
  } else if (step.type === 'ai') {
    const shortPrompt = (step.prompt || '').substring(0, 40) + '...';
    rows = `<div class="node-row editable-comment">// ${shortPrompt}</div>`;
  } else if (step.type === 'wait') {
    rows = `<div class="node-row">-- Seconds: ${step.seconds}</div>`;
  }

  node.innerHTML = `
    <div class="node-label" style="background:${color};color:white;font-size:10px;padding:4px 6px;">
      [Step ${step.step_id}] ${step.type.toUpperCase()}
    </div>
    <div class="node-content">${rows}</div>
    ${step.type !== 'condition' ? '<div class="node-port port-left"></div>' : ''}
    <div class="node-port port-right"></div>
  `;

  return node;
}

// ── Draw lines between nodes ──────────────────────────────────

function updateWfLines(nodeEls) {
  const svg = document.getElementById('node-svg');
  const world = document.getElementById('node-world');
  svg.innerHTML = '';

  if (!nodeEls) {
    nodeEls = [...document.querySelectorAll('.workflow-node')];
  }

  wfConnections.forEach(conn => {
    const startNode = nodeEls[conn.from];
    const endNode = nodeEls[conn.to];
    if (!startNode || !endNode) return;

    const startPort = startNode.querySelector('.port-right');
    const endPort = endNode.querySelector('.port-left') || endNode.querySelector('.port-right');
    if (!startPort || !endPort) return;

    const worldRect = world.getBoundingClientRect();
    const s = startPort.getBoundingClientRect();
    const e = endPort.getBoundingClientRect();

    const x1 = s.left - worldRect.left + 5;
    const y1 = s.top - worldRect.top + 5;
    const x2 = e.left - worldRect.left + 5;
    const y2 = e.top - worldRect.top + 5;

    // Bezier curve for smooth lines
    const cx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('stroke', conn.color || '#333');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);

    // Label for condition branches
    if (conn.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', cx);
      text.setAttribute('y', (y1 + y2) / 2 - 4);
      text.setAttribute('font-size', '9');
      text.setAttribute('fill', conn.color || '#333');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = conn.label;
      svg.appendChild(text);
    }
  });
}

// ── Node dragging ─────────────────────────────────────────────

document.getElementById('tool-hand').addEventListener('click', () => wfSetTool('hand'));
document.getElementById('tool-pointer').addEventListener('click', () => wfSetTool('pointer'));

function wfSetTool(tool) {
  currentWfTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tool-${tool}`).classList.add('active');
  document.getElementById('node-canvas').style.cursor = tool === 'hand' ? 'grab' : 'default';
}

document.addEventListener('mousedown', (e) => {
  if (currentWfTool !== 'hand') return;
  const node = e.target.closest('.workflow-node');
  if (node) {
    wfIsDragging = true;
    wfActiveNode = node;
    const rect = node.getBoundingClientRect();
    wfOffset.x = e.clientX - rect.left;
    wfOffset.y = e.clientY - rect.top;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!wfIsDragging || !wfActiveNode) return;
  const canvas = document.getElementById('node-canvas');
  const rect = canvas.getBoundingClientRect();
  wfActiveNode.style.left = (e.clientX - rect.left - wfOffset.x) + 'px';
  wfActiveNode.style.top = (e.clientY - rect.top - wfOffset.y) + 'px';
  updateWfLines(null);
});

document.addEventListener('mouseup', () => {
  wfIsDragging = false;
  wfActiveNode = null;
});

// ── Run button in detail view ─────────────────────────────────

document.querySelector('.run-btn').addEventListener('click', async () => {
  if (!wfCurrentWorkflow) return;
  const name = wfCurrentWorkflow.workflow_name;

  // Check if inputs needed
  const inputs = wfCurrentWorkflow.inputs || [];
  if (inputs.length > 0) {
    const vals = {};
    for (const inp of inputs) {
      const val = prompt(`Enter value for "${inp.name}":`);
      if (!val && inp.required) {
        alert(`Input "${inp.name}" is required!`);
        return;
      }
      vals[inp.name] = val || '';
    }
    // Switch to instruction console and run
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-instruction-console').classList.add('active');
    showSkillMessage(`Running workflow <strong>${name}</strong>...`, 'building');
    const result = await invokePython('execute_workflow', {
      workflow_json: JSON.stringify(wfCurrentWorkflow),
      user_inputs: JSON.stringify(vals)
    });
    showSkillMessage(
      result.success ? `✓ ${result.message}` : `✗ ${result.message}`,
      result.success ? 'success' : 'error'
    );
  } else {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-instruction-console').classList.add('active');
    showSkillMessage(`Running workflow <strong>${name}</strong>...`, 'building');
    const result = await invokePython('execute_workflow', {
      workflow_json: JSON.stringify(wfCurrentWorkflow),
      user_inputs: JSON.stringify({})
    });
    showSkillMessage(
      result.success ? `✓ ${result.message}` : `✗ ${result.message}`,
      result.success ? 'success' : 'error'
    );
  }
});

// ── Delete button in detail view ──────────────────────────────

document.querySelector('.delete-btn').addEventListener('click', async () => {
  if (!wfCurrentWorkflow) return;
  const name = wfCurrentWorkflow.workflow_name;
  if (!confirm(`Delete workflow "${name}"?`)) return;
  const result = await invokePython('delete_workflow', { workflow_name: name });
  if (result.success) {
    wfBackBtn.click();
    loadWorkflowGrid();
  }
});

// ── Context menu for workflow cards ──────────────────────────

const wfContextMenu = document.createElement('div');
wfContextMenu.className = 'context-menu';
wfContextMenu.style.display = 'none';
wfContextMenu.innerHTML = `
  <div class="context-item" id="wf-ctx-run">Run</div>
  <div class="context-item" id="wf-ctx-view">View JSON</div>
  <div class="context-separator"></div>
  <div class="context-item context-danger" id="wf-ctx-delete">Delete</div>
`;
document.body.appendChild(wfContextMenu);

let wfContextName = null;

function wfShowContextMenu(e, name) {
  wfContextName = name;
  wfContextMenu.style.display = 'block';
  wfContextMenu.style.left = e.clientX + 'px';
  wfContextMenu.style.top = e.clientY + 'px';
}

document.addEventListener('click', () => { wfContextMenu.style.display = 'none'; });

document.getElementById('wf-ctx-run').addEventListener('click', () => {
  if (!wfContextName) return;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('nav-instruction-console').classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-instruction-console').classList.add('active');
  // Trigger run
  feedInput.value = `/workflow run ${wfContextName}`;
  sendInstruction();
});

document.getElementById('wf-ctx-view').addEventListener('click', async () => {
  if (!wfContextName) return;
  await workflowView(wfContextName);
});

document.getElementById('wf-ctx-delete').addEventListener('click', async () => {
  if (!wfContextName) return;
  const result = await invokePython('delete_workflow', { workflow_name: wfContextName });
  if (result.success) {
    showSkillMessage(`Workflow "${wfContextName}" deleted.`, 'success');
    loadWorkflowGrid();
  }
});

// ============================================================
// NAVIGATION
// ============================================================

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const label = item.textContent.trim();

    if (label === 'Knowledge Ontology') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-knowledge-ontology').classList.add('active');
      setTimeout(async () => {
        svgEl.innerHTML = '';
        world.querySelectorAll('.node-wrapper').forEach(n => n.remove());
        const sp = await loadTree();
        renderTree(treeData, null, true);
        if (Object.keys(sp).length > 0) {
          world.querySelectorAll('.node-wrapper').forEach(node => {
            const saved = sp[node.dataset.name];
            if (saved) { node.style.left = saved[0] + 'px'; node.style.top = saved[1] + 'px'; }
          });
          updateLines();
        }
        lucide.createIcons();
        await updateBaseSize();
      }, 10);

    } else if (label === 'Instruction Console') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-instruction-console').classList.add('active');
      consoleMessages.innerHTML = '';
      document.getElementById('console-objective-text').textContent = '—';
      document.getElementById('console-status-text').textContent = 'Training in halt';
      document.getElementById('console-status-dot').classList.remove('active');
      activeSessionId = null;
      renderSessions(); // ✅ re-renders list with no active session highlighted
      lucide.createIcons(); // ✅ keeps icons intact after re-render
    } else if (label === 'Validation Chat Environment') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-validation-core').classList.add('active');
      showVCESidebar();

    } else if (label === 'Skill Constellation') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-skill-constellation').classList.add('active');
      loadSkillConstellation();
    } else if (label === 'Workflow Orchestrator') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-workflow-orchestrator').classList.add('active');

      // Reset to grid view
      wfGrid.classList.add('active');
      wfDetails.classList.remove('active');
      wfBackBtn.style.display = 'none';
      wfTitle.textContent = 'Workflows';
      loadWorkflowGrid();
    } else if (label === 'Settings') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-settings').classList.add('active');
    } else if (label === 'Get Help') {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-help').classList.add('active');
    }
  });
});

// --- Default Section on Load ---
window.addEventListener('DOMContentLoaded', () => {
  // Load saved default section
  let defaultSection = 'section-instruction-console';
  try {
    const saved = JSON.parse(localStorage.getItem('syntx_settings') || '{}');
    if (saved.defaultSection) defaultSection = saved.defaultSection;
  } catch { }

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  // Map section id to nav label
  const sectionNavMap = {
    'section-instruction-console': 'Instruction Console',
    'section-knowledge-ontology': 'Knowledge Ontology',
    'section-validation-core': 'Validation Chat Environment',
    'section-skill-constellation': 'Skill Constellation',
    'section-workflow-orchestrator': 'Workflow Orchestrator',
    'section-settings': 'Settings'
  };

  document.getElementById(defaultSection)?.classList.add('active');

  // Highlight the matching nav item
  document.querySelectorAll('.nav-item').forEach(i => {
    if (i.textContent.trim() === sectionNavMap[defaultSection]) {
      i.classList.add('active');
    }
  });

  // Special cases that need extra setup
  if (defaultSection === 'section-knowledge-ontology') {
    setTimeout(async () => {
      svgEl.innerHTML = '';
      world.querySelectorAll('.node-wrapper').forEach(n => n.remove());
      const sp = await loadTree();
      renderTree(treeData, null, true);
      lucide.createIcons();
      await updateBaseSize();
    }, 10);
  } else if (defaultSection === 'section-validation-core') {
    showVCESidebar();
  } else if (defaultSection === 'section-skill-constellation') {
    loadSkillConstellation();
  } else if (defaultSection === 'section-workflow-orchestrator') {
    wfGrid.classList.add('active');
    wfDetails.classList.remove('active');
    loadWorkflowGrid();
  } else if (defaultSection === 'section-instruction-console') {
    document.getElementById('nav-instruction-console').classList.add('active');
  }
});

// ============================================================
// SETTINGS SYSTEM
// ============================================================
(function () {

  const KEY = 'syntx_settings';

  const DEFAULTS = {
    theme: 'light',
    fontSize: 'medium',
    fontFamily: 'serif',
    collapseSidebar: false,
    defaultSkillView: 'grid',
    defaultWorkflowView: 'grid',
    soundEnabled: false,
    reduceMotion: false,
  };

  // ── Load & Save ───────────────────────────────────────────
  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { return Object.assign({}, DEFAULTS); }
  }

  function save(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  // ── Apply to DOM ──────────────────────────────────────────
  function apply(s) {
    // Theme
    const resolved = s.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : s.theme;
    document.documentElement.setAttribute('data-theme', resolved);

    // Font size
    const sizeMap = { small: '12px', medium: '14px', large: '16px' };
    document.documentElement.style.setProperty('--ui-font-size', sizeMap[s.fontSize] || '14px');

    // Font family
    const familyMap = {
      serif: "'Roboto Slab', serif",
      mono: "'Courier New', monospace"
    };
    document.documentElement.style.setProperty('--ui-font-family', familyMap[s.fontFamily] || "'Roboto Slab', serif");

    // Reduce motion
    document.documentElement.classList.toggle('reduce-motion', !!s.reduceMotion);

    // Collapse sidebar
    if (s.collapseSidebar) {
      document.querySelector('.left-panel')?.classList.add('collapsed');
    }
  }

  // ── Sync UI to current settings ───────────────────────────
  function syncUI(s) {
    // Theme buttons — clear ALL first, then set ONE
    document.querySelectorAll('#theme-group .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === s.theme);
    });

    // Font size buttons
    document.querySelectorAll('#fontsize-group .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === s.fontSize);
    });

    // Font family buttons
    document.querySelectorAll('#fontfamily-group .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === s.fontFamily);
    });

    const togStartup = document.getElementById('tog-startup');
    if (togStartup) togStartup.checked = s.showOnStartup !== false;
    const modelInput = document.getElementById('model-text-input');
    const modelVisionInput = document.getElementById('model-vision-input');
    if (modelInput) modelInput.value = s.textModel || 'gemma2:2b';
    if (modelVisionInput) modelVisionInput.value = s.visionModel || 'moondream';

    // Toggles
    const togSidebar = document.getElementById('tog-sidebar');
    const togSound = document.getElementById('tog-sound');
    const togMotion = document.getElementById('tog-motion');
    if (togSidebar) togSidebar.checked = !!s.collapseSidebar;
    if (togSound) togSound.checked = !!s.soundEnabled;
    if (togMotion) togMotion.checked = !!s.reduceMotion;

    // Selects
    const selDefault = document.getElementById('sel-default-section');
    if (selDefault) selDefault.value = s.defaultSection || 'section-instruction-console';
  }

  // ── Wire up all controls (called once) ───────────────────
  let wired = false;
  function wire(s) {
    if (wired) return;
    wired = true;

    // Theme buttons
    document.querySelectorAll('#theme-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        s.theme = btn.dataset.val;
        save(s);
        apply(s);
        syncUI(s);
      });
    });

    // Font size buttons
    document.querySelectorAll('#fontsize-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        s.fontSize = btn.dataset.val;
        save(s);
        apply(s);
        syncUI(s);
      });
    });

    // Font family buttons
    document.querySelectorAll('#fontfamily-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        s.fontFamily = btn.dataset.val;
        save(s);
        apply(s);
        syncUI(s);
      });
    });

    // Toggles
    document.getElementById('tog-sidebar')?.addEventListener('change', e => {
      s.collapseSidebar = e.target.checked;
      save(s);
    });

    document.getElementById('tog-sound')?.addEventListener('change', e => {
      s.soundEnabled = e.target.checked;
      save(s);
    });

    document.getElementById('tog-motion')?.addEventListener('change', e => {
      s.reduceMotion = e.target.checked;
      save(s);
      apply(s);
    });

    // Selects
    document.getElementById('sel-default-section')?.addEventListener('change', e => {
      s.defaultSection = e.target.value;
      save(s);
    });

    // Clear cache
    document.getElementById('btn-clear')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-clear');
      try { await window.__TAURI__.core.invoke('save_positions', { positions: {} }); } catch { }
      localStorage.removeItem(KEY);
      Object.assign(s, DEFAULTS);
      apply(s);
      syncUI(s);
      btn.textContent = 'Cleared!';
      btn.style.color = '#2DBD6E';
      btn.style.borderColor = '#2DBD6E';
      setTimeout(() => {
        btn.textContent = 'Clear Cache';
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 2000);
    });

    // Export
    document.getElementById('btn-export')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-export');
      btn.textContent = 'Exporting...';
      btn.disabled = true;
      try {
        await window.__TAURI__.core.invoke('export_all_as_zip');
        btn.textContent = 'Exported!';
        btn.style.color = '#2DBD6E';
        btn.style.borderColor = '#2DBD6E';
      } catch (err) {
        console.error('Export error:', err);
        btn.textContent = 'Failed';
        btn.style.color = '#FF4D00';
        btn.style.borderColor = '#FF4D00';
      }
      setTimeout(() => {
        btn.textContent = 'Export';
        btn.disabled = false;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 2500);
    });
    // Model selection
    const modelInput = document.getElementById('model-text-input');
    const modelVisionInput = document.getElementById('model-vision-input');
    const modelSaveBtn = document.getElementById('btn-save-models');

    if (modelSaveBtn) {
      // Load saved models on open
      if (modelInput) modelInput.value = s.textModel || 'gemma2:2b';
      if (modelVisionInput) modelVisionInput.value = s.visionModel || 'moondream';

      modelSaveBtn.addEventListener('click', () => {
        s.textModel = modelInput?.value.trim() || 'gemma2:2b';
        s.visionModel = modelVisionInput?.value.trim() || 'moondream';
        save(s);
        modelSaveBtn.textContent = 'Saved!';
        modelSaveBtn.style.color = '#2DBD6E';
        setTimeout(() => {
          modelSaveBtn.textContent = 'Save Models';
          modelSaveBtn.style.color = '';
        }, 2000);
      });
    }
  }

  // Show on startup toggle
  const togStartup = document.getElementById('tog-startup');
  if (togStartup) {
    togStartup.checked = s.showOnStartup !== false; // default true
    togStartup.addEventListener('change', e => {
      s.showOnStartup = e.target.checked;
      save(s);
    });
  }

  // ── Sound helper (used by /quit, skill, workflow) ─────────
  window.syntxPlaySound = function () {
    const s = load();
    if (!s.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch { }
  };

  // ── Boot ─────────────────────────────────────────────────
  const settings = load();
  apply(settings);

  // Open settings → sync UI and wire once
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.textContent.trim() === 'Settings') {
        setTimeout(() => { syncUI(settings); wire(settings); }, 20);
      }
    });
  });

  // OS theme change (for system mode)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') apply(settings);
  });

})();

// ============================================================
// PANEL MORE MENU (⋯ button → Delete System)
// ============================================================
(function () {
  const moreBtn = document.getElementById('panel-more-btn');
  const moreMenu = document.getElementById('panel-more-menu');
  const overlay = document.getElementById('delete-system-overlay');
  const cancelBtn = document.getElementById('delete-system-cancel');
  const confirmBtn = document.getElementById('delete-system-confirm');

  if (!moreBtn) return;

  // Toggle menu
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', () => moreMenu.classList.remove('open'));

  // Open confirmation
  document.getElementById('panel-delete-all').addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.remove('open');
    overlay.classList.add('active');
  });

  cancelBtn.addEventListener('click', () => overlay.classList.remove('active'));

  confirmBtn.addEventListener('click', async () => {
    overlay.classList.remove('active');
    confirmBtn.textContent = 'Deleting...';
    confirmBtn.disabled = true;

    try {
      // 1. Delete entire base knowledge folder contents
      await window.__TAURI__.core.invoke('delete_all_knowledge');
    } catch (e) { console.error('delete_all_knowledge:', e); }

    try {
      // 2. Wipe all skills
      await window.__TAURI__.core.invoke('delete_all_skills');
    } catch (e) { console.error('delete_all_skills:', e); }

    try {
      // 3. Wipe all workflows
      await window.__TAURI__.core.invoke('delete_all_workflows');
    } catch (e) { console.error('delete_all_workflows:', e); }

    try {
      // 4. Wipe sessions
      await window.__TAURI__.core.invoke('save_sessions', { sessions: '[]' });
      await window.__TAURI__.core.invoke('save_vce_sessions', { sessions: '[]' });
    } catch (e) { console.error('wipe sessions:', e); }

    try {
      // 5. Wipe positions
      await window.__TAURI__.core.invoke('save_positions', { positions: {} });
    } catch (e) { console.error('wipe positions:', e); }

    // 6. Clear localStorage
    localStorage.clear();

    // 7. Reset UI
    sessions = [];
    vceSessions = [];
    consoleMessages.innerHTML = '';
    document.getElementById('console-objective-text').textContent = '—';
    document.getElementById('console-status-text').textContent = 'Training in halt';
    document.getElementById('console-status-dot').classList.remove('active');
    activeSessionId = null;
    activeTrainingSessionId = null;
    renderSessions();

    // 8. Reload the app
    localStorage.removeItem('syntx_text_model');
    localStorage.removeItem('syntx_vision_model');
    location.reload();
  });
})();

document.getElementById('btn-change-model').addEventListener('click', () => {
  showModelSelector();
});

// Update settings hint when model changes
function updateSettingsModelHint() {
  const hint = document.getElementById('settings-model-hint');
  if (hint) hint.textContent = `Text: ${currentTextModel} · Vision: ${currentVisionModel}`;
}