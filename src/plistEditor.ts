import * as vscode from 'vscode';
import * as plist from 'plist';
import * as bplistParser from 'bplist-parser';
import bplistCreator = require('bplist-creator');

type PlistFormat = 'xml' | 'binary';

type PlistNode =
	| { kind: 'dict'; entries: PlistEntry[] }
	| { kind: 'array'; items: PlistNode[] }
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: number }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'date'; value: string }
	| { kind: 'data'; value: string };

interface PlistEntry {
	key: string;
	value: PlistNode;
}

interface PlistDocumentState {
	format: PlistFormat;
	root: PlistNode;
}

type WebviewMessage =
	| { type: 'ready' }
  | { type: 'requestComplexTypeEdits' }
	| { type: 'edit'; state: PlistDocumentState };

export class PlistEditorProvider implements vscode.CustomEditorProvider<PlistCustomDocument> {
	public static readonly viewType = 'plist-editor.plistEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new PlistEditorProvider(context);
		return vscode.window.registerCustomEditorProvider(PlistEditorProvider.viewType, provider, {
			webviewOptions: {
				retainContextWhenHidden: true,
			},
			supportsMultipleEditorsPerDocument: true,
		});
	}

	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<PlistCustomDocument>>();

	public readonly onDidChangeCustomDocument = this.changeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	public async openCustomDocument(uri: vscode.Uri): Promise<PlistCustomDocument> {
		const data = await vscode.workspace.fs.readFile(uri);
		return new PlistCustomDocument(uri, readPlistState(data));
	}

	public async resolveCustomEditor(document: PlistCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
		this.panels.set(document.uri.toString(), webviewPanel);

		webviewPanel.onDidDispose(() => {
			this.panels.delete(document.uri.toString());
		});

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.getState());

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (message.type === 'ready') {
				await this.postState(document);
				return;
			}

      if (message.type === 'requestComplexTypeEdits') {
        const choice = await vscode.window.showWarningMessage(
          'Changing the type of dictionaries, arrays, or the root can destroy nested data. Enable complex type editing anyway?',
          { modal: true },
          'Enable'
        );
        await webviewPanel.webview.postMessage({
          type: 'setComplexTypeEdits',
          enabled: choice === 'Enable',
        });
        return;
      }

      if (message.type !== 'edit') {
        return;
      }

			const previousState = document.getState();
			document.setState(message.state);
			this.changeEmitter.fire({
				document,
				undo: async () => {
					document.setState(previousState);
					await this.postState(document);
				},
				redo: async () => {
					document.setState(message.state);
					await this.postState(document);
				},
			});
		});
	}

	public saveCustomDocument(document: PlistCustomDocument): Thenable<void> {
		return this.writeDocument(document.uri, document.getState());
	}

	public saveCustomDocumentAs(document: PlistCustomDocument, destination: vscode.Uri): Thenable<void> {
		return this.writeDocument(destination, document.getState());
	}

	public revertCustomDocument(document: PlistCustomDocument): Thenable<void> {
		return (async () => {
			const data = await vscode.workspace.fs.readFile(document.uri);
			document.setState(readPlistState(data));
			await this.postState(document);
		})();
	}

	public backupCustomDocument(document: PlistCustomDocument): Thenable<vscode.CustomDocumentBackup> {
		return (async () => {
			const storageRoot = this.context.storageUri ?? this.context.globalStorageUri;
			const backupFolder = vscode.Uri.joinPath(storageRoot, 'plist-backups');
			await vscode.workspace.fs.createDirectory(backupFolder);
			const backupUri = vscode.Uri.joinPath(backupFolder, `${Date.now()}-${Math.random().toString(16).slice(2)}.plist`);
			await this.writeDocument(backupUri, document.getState());
			return {
				id: backupUri.toString(),
				delete: async () => {
					await vscode.workspace.fs.delete(backupUri, { useTrash: false });
				},
			};
		})();
	}

	private async postState(document: PlistCustomDocument): Promise<void> {
		const panel = this.panels.get(document.uri.toString());
		if (panel) {
			await panel.webview.postMessage({ type: 'state', state: document.getState() });
		}
	}

	private async writeDocument(uri: vscode.Uri, state: PlistDocumentState): Promise<void> {
		const output = serializePlistState(state);
		await vscode.workspace.fs.writeFile(uri, output);
	}

	private getHtmlForWebview(webview: vscode.Webview, state: PlistDocumentState): string {
		const nonce = getNonce();
		const initialState = escapeHtmlJson(state);
		const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'plist-editor.css'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plist Editor</title>
  <link rel="stylesheet" href="${stylesheetUri}">
</head>
<body>
  <header>
    <div class="title">
      <h1>Plist Editor</h1>
      <p>Tree-structured editing with type-aware rows and nested containers.</p>
    </div>
    <div class="toolbar">
      <span class="pill" id="format-pill"></span>
      <label class="risk-toggle" for="allow-complex-types">
        <input type="checkbox" id="allow-complex-types">
        <span>Allow complex type edits</span>
      </label>
      <button id="add-root">Add Root Child</button>
      <button id="expand-all">Expand All</button>
      <button id="collapse-all">Collapse All</button>
    </div>
  </header>
  <main>
    <div class="plist" id="root"></div>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const initialState = ${initialState};
    let state = initialState;
    let collapsedPaths = new Set();

    const root = document.getElementById('root');
    const formatPill = document.getElementById('format-pill');
    const allowComplexTypesToggle = document.getElementById('allow-complex-types');
    const addRootButton = document.getElementById('add-root');
    const expandAllButton = document.getElementById('expand-all');
    const collapseAllButton = document.getElementById('collapse-all');
    let draggedPath = null;
    let dropHint = null;
    let selectedPath = null;
    let allowComplexTypeEdits = false;
    let layoutUpdateQueued = false;
    let keyWidthMode = 'auto';
    let typeWidthMode = 'auto';
    let keyWidth = 180;
    let typeWidth = 72;
    let resizeState = null;
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');

    function pathKey(path) {
      return path.join('.');
    }

    function cloneNode(node) {
      if (node.kind === 'dict') {
        return { kind: 'dict', entries: node.entries.map((entry) => ({ key: entry.key, value: cloneNode(entry.value) })) };
      }
      if (node.kind === 'array') {
        return { kind: 'array', items: node.items.map(cloneNode) };
      }
      return { ...node };
    }

    function defaultNode(kind) {
      switch (kind) {
        case 'dict': return { kind: 'dict', entries: [] };
        case 'array': return { kind: 'array', items: [] };
        case 'number': return { kind: 'number', value: 0 };
        case 'boolean': return { kind: 'boolean', value: false };
        case 'date': return { kind: 'date', value: new Date().toISOString() };
        case 'data': return { kind: 'data', value: '' };
        default: return { kind: 'string', value: '' };
      }
    }

    function getNode(path) {
      let node = state.root;
      for (const index of path) {
        if (!node || (node.kind !== 'dict' && node.kind !== 'array')) {
          return null;
        }
        node = node.kind === 'dict' ? node.entries[index]?.value : node.items[index];
      }
      return node ?? null;
    }

    function getParentContainer(path) {
      if (!path.length) {
        return null;
      }
      const parent = getNode(path.slice(0, -1));
      return parent && (parent.kind === 'dict' || parent.kind === 'array') ? parent : null;
    }

    function setNode(path, updater) {
      if (!path.length) {
        state.root = updater(state.root);
        return;
      }
      const parent = getParentContainer(path);
      if (!parent) {
        return;
      }
      const index = path[path.length - 1];
      if (parent.kind === 'dict') {
        parent.entries[index].value = updater(parent.entries[index].value);
      } else {
        parent.items[index] = updater(parent.items[index]);
      }
    }

    function removeNode(path) {
      const parent = getParentContainer(path);
      if (!parent) {
        return;
      }
      const index = path[path.length - 1];
      if (parent.kind === 'dict') {
        parent.entries.splice(index, 1);
      } else {
        parent.items.splice(index, 1);
      }
      collapsedPaths.delete(pathKey(path));
    }

    function moveNode(path, delta) {
      const parent = getParentContainer(path);
      if (!parent) {
        return;
      }
      const index = path[path.length - 1];
      const nextIndex = index + delta;
      if (parent.kind === 'dict') {
        if (nextIndex < 0 || nextIndex >= parent.entries.length) {
          return;
        }
        const [entry] = parent.entries.splice(index, 1);
        parent.entries.splice(nextIndex, 0, entry);
      } else {
        if (nextIndex < 0 || nextIndex >= parent.items.length) {
          return;
        }
        const [item] = parent.items.splice(index, 1);
        parent.items.splice(nextIndex, 0, item);
      }
    }

    function moveNodeToIndex(path, targetIndex) {
      const parent = getParentContainer(path);
      if (!parent) {
        return;
      }

      const index = path[path.length - 1];
      if (index === targetIndex) {
        return;
      }

      if (parent.kind === 'dict') {
        if (targetIndex < 0 || targetIndex >= parent.entries.length) {
          return;
        }
        const [entry] = parent.entries.splice(index, 1);
        const insertionIndex = targetIndex > index ? targetIndex - 1 : targetIndex;
        parent.entries.splice(insertionIndex, 0, entry);
      } else {
        if (targetIndex < 0 || targetIndex >= parent.items.length) {
          return;
        }
        const [item] = parent.items.splice(index, 1);
        const insertionIndex = targetIndex > index ? targetIndex - 1 : targetIndex;
        parent.items.splice(insertionIndex, 0, item);
      }
    }

    function isCollapsed(path) {
      return collapsedPaths.has(pathKey(path));
    }

    function toggleCollapsed(path) {
      const key = pathKey(path);
      if (collapsedPaths.has(key)) {
        collapsedPaths.delete(key);
      } else {
        collapsedPaths.add(key);
      }
    }

    function collectContainerPaths(node, path) {
      const result = [path];
      if (node.kind === 'dict') {
        node.entries.forEach((entry, index) => {
          result.push(...collectContainerPaths(entry.value, path.concat(index)));
        });
      } else if (node.kind === 'array') {
        node.items.forEach((item, index) => {
          result.push(...collectContainerPaths(item, path.concat(index)));
        });
      }
      return result;
    }

    function sync() {
      vscode.postMessage({ type: 'edit', state });
      scheduleLayoutUpdate();
    }

    function scheduleLayoutUpdate() {
      if (layoutUpdateQueued) {
        return;
      }

      layoutUpdateQueued = true;
      requestAnimationFrame(() => {
        layoutUpdateQueued = false;
        applyColumnWidths();
      });
    }

    function selectPath(path) {
      selectedPath = path.slice();
      refreshSelectedRow();
    }

    allowComplexTypesToggle.addEventListener('change', () => {
      if (allowComplexTypesToggle.checked) {
        allowComplexTypesToggle.checked = false;
        allowComplexTypesToggle.disabled = true;
        vscode.postMessage({ type: 'requestComplexTypeEdits' });
        return;
      }

      allowComplexTypeEdits = false;
      render();
    });

    function refreshSelectedRow() {
      const rows = root.querySelectorAll('.row[data-path]');
      for (const row of rows) {
        const element = row;
        element.classList.toggle('selected', Boolean(selectedPath) && element.dataset.path === pathKey(selectedPath));
      }
    }

    function measureTextWidth(text) {
      if (!measureContext) {
        return text.length * 7;
      }

      const styles = getComputedStyle(document.body);
      measureContext.font = styles.font;
      return measureContext.measureText(text).width;
    }

    function autoSizeTextarea(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }

    function walkPlist(node, callback) {
      callback(node);
      if (node.kind === 'dict') {
        node.entries.forEach((entry) => walkPlist(entry.value, callback));
      } else if (node.kind === 'array') {
        node.items.forEach((item) => walkPlist(item, callback));
      }
    }

    function computeAutoColumnWidths() {
      let widestKey = measureTextWidth('Key');
      let widestType = measureTextWidth('Type');

      walkPlist(state.root, (node) => {
        if (node.kind === 'dict') {
          node.entries.forEach((entry) => {
            widestKey = Math.max(widestKey, measureTextWidth(entry.key || ''));
          });
        }

        if (node.kind !== 'dict' && node.kind !== 'array') {
          widestType = Math.max(widestType, measureTextWidth(node.kind));
        }
      });

      return {
        key: Math.max(120, Math.min(320, Math.ceil(widestKey + 22))),
        type: Math.max(72, Math.min(120, Math.ceil(widestType + 18))),
      };
    }

    function applyColumnWidths() {
      const autoWidths = computeAutoColumnWidths();
      if (keyWidthMode === 'auto') {
        keyWidth = autoWidths.key;
      }
      if (typeWidthMode === 'auto') {
        typeWidth = autoWidths.type;
      }

      root.style.setProperty('--key-col', keyWidth + 'px');
      root.style.setProperty('--type-col', typeWidth + 'px');
    }

    function startColumnResize(column, event) {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = column === 'key' ? keyWidth : typeWidth;

      resizeState = { column, startX, startWidth };
      if (column === 'key') {
        keyWidthMode = 'manual';
      } else {
        typeWidthMode = 'manual';
      }

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - resizeState.startX;
        const nextWidth = Math.max(column === 'key' ? 120 : 60, Math.min(column === 'key' ? 420 : 160, resizeState.startWidth + delta));
        if (column === 'key') {
          keyWidth = nextWidth;
        } else {
          typeWidth = nextWidth;
        }
        applyColumnWidths();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        resizeState = null;
        scheduleLayoutUpdate();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    }

    function makeGlyphAction(symbol, title, handler, extraClass = '') {
      const action = document.createElement('span');
      action.className = ('action-icon ' + extraClass).trim();
      action.textContent = symbol;
      action.title = title;
      action.setAttribute('role', 'button');
      action.setAttribute('tabindex', '0');
      action.setAttribute('aria-label', title);
      action.dataset.noRowSelect = 'true';
      action.onclick = handler;
      action.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handler();
        }
      };
      return action;
    }

    function renderNode(node, path, label, isRoot = false) {
      const wrapper = document.createElement('div');

      const row = document.createElement('div');
      row.className = 'row' + (node.kind === 'dict' || node.kind === 'array' ? ' container' : '');
      row.dataset.path = pathKey(path);
      if (selectedPath && pathKey(selectedPath) === pathKey(path)) {
        row.classList.add('selected');
      }
      const controlCell = document.createElement('div');
      controlCell.className = 'tree-control';

      if (!isRoot) {
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.title = 'Drag to reorder';
        controlCell.appendChild(dragHandle);
      }

      if (!isRoot && (node.kind === 'dict' || node.kind === 'array')) {
        const branchToggle = document.createElement('span');
        branchToggle.className = 'branch-toggle';
        branchToggle.textContent = isCollapsed(path) ? '▸' : '▾';
        branchToggle.title = isCollapsed(path) ? 'Expand branch' : 'Collapse branch';
        branchToggle.setAttribute('role', 'button');
        branchToggle.setAttribute('tabindex', '0');
        branchToggle.setAttribute('aria-label', branchToggle.title);
        branchToggle.dataset.noRowSelect = 'true';
        branchToggle.onpointerdown = (event) => {
          event.preventDefault();
        };
        branchToggle.onclick = () => {
          toggleCollapsed(path);
          render();
        };
        branchToggle.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleCollapsed(path);
            render();
          }
        };
        controlCell.appendChild(branchToggle);
      }

      row.draggable = !isRoot;
      row.classList.add('indent-' + Math.min(path.length, 5));

      row.ondragstart = (event) => {
        if (isRoot) {
          event.preventDefault();
          return;
        }
        draggedPath = path.slice();
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', pathKey(path));
      };

      row.ondragend = () => {
        draggedPath = null;
        dropHint = null;
        render();
      };

      row.onpointerdown = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        if (target.closest('[data-no-row-select="true"], input, select, textarea, button')) {
          return;
        }

        selectPath(path);
      };

      row.ondragover = (event) => {
        if (!draggedPath || draggedPath.length !== path.length) {
          return;
        }
        const parentPath = path.slice(0, -1);
        if (pathKey(draggedPath.slice(0, -1)) !== pathKey(parentPath)) {
          return;
        }
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        dropHint = { path: path.slice(), position: before ? 'before' : 'after' };
        row.dataset.dropZone = before ? 'before' : 'after';
      };

      row.ondrop = (event) => {
        if (!draggedPath || draggedPath.length !== path.length) {
          return;
        }
        const parentPath = path.slice(0, -1);
        if (pathKey(draggedPath.slice(0, -1)) !== pathKey(parentPath)) {
          return;
        }
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        const targetIndex = path[path.length - 1] + (before ? 0 : 1);
        moveNodeToIndex(draggedPath, targetIndex);
        draggedPath = null;
        dropHint = null;
        render();
        sync();
      };

      const labelCell = document.createElement('div');
      labelCell.className = 'entry-label cell key-cell';
      labelCell.style.minWidth = '0';
      const parent = getParentContainer(path);
      if (!isRoot && parent && parent.kind === 'array') {
        const indexBadge = document.createElement('span');
        indexBadge.className = 'index-badge';
        indexBadge.textContent = label;
        labelCell.appendChild(indexBadge);
      }

      if (!isRoot && parent && parent.kind === 'dict') {
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'cell-fill';
        keyInput.value = label;
        keyInput.placeholder = 'Key';
        keyInput.dataset.noRowSelect = 'true';
        keyInput.style.minWidth = '0';
        keyInput.style.flex = '1 1 0';
        keyInput.oninput = (event) => {
          const parent = getParentContainer(path);
          if (parent && parent.kind === 'dict') {
            parent.entries[path[path.length - 1]].key = event.target.value;
            sync();
          }
        };
        labelCell.appendChild(keyInput);
      }

      const typeCell = document.createElement('select');
      typeCell.className = 'field-type cell type-cell';
      typeCell.dataset.noRowSelect = 'true';
      typeCell.style.minWidth = '0';
      typeCell.style.width = '100%';
      const canEditComplexType = allowComplexTypeEdits || (node.kind !== 'dict' && node.kind !== 'array');
      typeCell.disabled = !canEditComplexType;
      typeCell.title = canEditComplexType ? '' : 'Enable complex type editing to change dictionaries, arrays, or the root';
      for (const kind of ['string', 'number', 'boolean', 'date', 'data', 'dict', 'array']) {
        const option = document.createElement('option');
        option.value = kind;
        option.textContent = kind;
        option.selected = node.kind === kind;
        typeCell.appendChild(option);
      }

      const valueCell = document.createElement('div');
      valueCell.className = 'value-cell field-value cell';
      valueCell.style.minWidth = '0';
      valueCell.style.width = '100%';
      typeCell.onchange = () => {
        setNode(path, () => defaultNode(typeCell.value));
        render();
        sync();
      };

      if (node.kind === 'string') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-fill';
        input.value = node.value;
        input.dataset.noRowSelect = 'true';
        input.oninput = (event) => {
          node.value = event.target.value;
          sync();
        };
        valueCell.appendChild(input);
      } else if (node.kind === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'cell-fill';
        input.value = String(node.value);
        input.dataset.noRowSelect = 'true';
        input.oninput = (event) => {
          const parsed = Number(event.target.value);
          node.value = Number.isFinite(parsed) ? parsed : 0;
          sync();
        };
        valueCell.appendChild(input);
      } else if (node.kind === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'cell-fill';
        input.checked = node.value;
        input.dataset.noRowSelect = 'true';
        input.onchange = (event) => {
          node.value = event.target.checked;
          sync();
        };
        valueCell.appendChild(input);
      } else if (node.kind === 'date') {
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'cell-fill';
        input.value = new Date(node.value).toISOString().slice(0, 16);
        input.dataset.noRowSelect = 'true';
        input.oninput = (event) => {
          const next = new Date(event.target.value);
          node.value = next.toISOString();
          sync();
        };
        valueCell.appendChild(input);
      } else if (node.kind === 'data') {
        const input = document.createElement('textarea');
        input.className = 'cell-fill';
        input.value = node.value;
        input.placeholder = 'Base64 data';
        input.rows = 1;
        input.wrap = 'off';
        input.dataset.noRowSelect = 'true';
        autoSizeTextarea(input);
        input.oninput = (event) => {
          node.value = event.target.value;
          autoSizeTextarea(input);
          sync();
        };
        valueCell.appendChild(input);
      } else {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = node.kind === 'dict'
          ? node.entries.length + ' keys'
          : node.items.length + ' items';
        valueCell.appendChild(meta);
      }

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.style.flexWrap = 'nowrap';
      actions.style.marginLeft = '0';

      if (node.kind === 'dict' || node.kind === 'array') {
        const addButton = makeGlyphAction('＋', node.kind === 'dict' ? 'Add Property' : 'Add Item', () => {
          if (node.kind === 'dict') {
            node.entries.push({ key: 'New Item', value: defaultNode('string') });
          } else {
            node.items.push(defaultNode('string'));
          }
          render();
          sync();
        });
        actions.appendChild(addButton);
      }

      if (!isRoot) {
        const duplicateButton = makeGlyphAction('⧉', 'Duplicate', () => {
          const parent = getParentContainer(path);
          if (!parent) {
            return;
          }
          const index = path[path.length - 1];
          if (parent.kind === 'dict') {
            const entry = parent.entries[index];
            parent.entries.splice(index + 1, 0, { key: entry.key + ' Copy', value: cloneNode(entry.value) });
          } else {
            parent.items.splice(index + 1, 0, cloneNode(parent.items[index]));
          }
          render();
          sync();
        });
        actions.appendChild(duplicateButton);

        const deleteButton = makeGlyphAction('×', 'Delete', () => {
          removeNode(path);
          render();
          sync();
        }, 'danger');
        actions.appendChild(deleteButton);
      }

      row.appendChild(labelCell);
      row.appendChild(typeCell);
      row.appendChild(valueCell);
      row.appendChild(actions);
      row.insertBefore(controlCell, labelCell);
      wrapper.appendChild(row);

      if ((node.kind === 'dict' || node.kind === 'array') && !isCollapsed(path)) {
        const children = document.createElement('div');
        children.className = 'children';
        const childList = document.createElement('div');
        childList.className = 'child-list';

        if (node.kind === 'dict') {
          node.entries.forEach((entry, index) => {
            childList.appendChild(renderNode(entry.value, path.concat(index), entry.key));
          });
        } else {
          node.items.forEach((item, index) => {
            childList.appendChild(renderNode(item, path.concat(index), String(index)));
          });
        }

        children.appendChild(childList);
        wrapper.appendChild(children);
      }

      if (dropHint && pathKey(dropHint.path) === pathKey(path)) {
        row.dataset.dropZone = dropHint.position;
      }

      return wrapper;
    }

    function render(options = { preserveScroll: true }) {
      const previousScrollTop = options.preserveScroll ? root.scrollTop : 0;
      const previousScrollLeft = options.preserveScroll ? root.scrollLeft : 0;

      root.replaceChildren();
      formatPill.textContent = state.format === 'binary' ? 'Binary plist' : 'XML plist';

      const headerRow = document.createElement('div');
      headerRow.className = 'table-header';

      const headerSpacer = document.createElement('div');
      headerSpacer.className = 'header-spacer';
      headerRow.appendChild(headerSpacer);

      const keyHeader = document.createElement('div');
      keyHeader.className = 'header-cell key-header';
      keyHeader.textContent = 'Key';
      const keyResize = document.createElement('span');
      keyResize.className = 'header-resize';
      keyResize.title = 'Resize key column';
      keyResize.onpointerdown = (event) => startColumnResize('key', event);
      keyResize.ondblclick = () => {
        keyWidthMode = 'auto';
        applyColumnWidths();
      };
      keyHeader.appendChild(keyResize);
      headerRow.appendChild(keyHeader);

      const typeHeader = document.createElement('div');
      typeHeader.className = 'header-cell type-header';
      typeHeader.textContent = 'Type';
      const typeResize = document.createElement('span');
      typeResize.className = 'header-resize';
      typeResize.title = 'Resize type column';
      typeResize.onpointerdown = (event) => startColumnResize('type', event);
      typeResize.ondblclick = () => {
        typeWidthMode = 'auto';
        applyColumnWidths();
      };
      typeHeader.appendChild(typeResize);
      headerRow.appendChild(typeHeader);

      const valueHeader = document.createElement('div');
      valueHeader.className = 'header-cell';
      valueHeader.textContent = 'Value';
      headerRow.appendChild(valueHeader);

      const actionsHeader = document.createElement('div');
      actionsHeader.className = 'header-cell';
      headerRow.appendChild(actionsHeader);

      root.appendChild(headerRow);
      allowComplexTypesToggle.checked = allowComplexTypeEdits;

      const tree = renderNode(state.root, [], 'Root', true);
      root.appendChild(tree);
      applyColumnWidths();

      if (options.preserveScroll) {
        requestAnimationFrame(() => {
          root.scrollTop = previousScrollTop;
          root.scrollLeft = previousScrollLeft;
        });
      }

      addRootButton.onclick = () => {
        if (state.root.kind === 'dict') {
          state.root.entries.push({ key: 'New Item', value: defaultNode('string') });
        } else if (state.root.kind === 'array') {
          state.root.items.push(defaultNode('string'));
        }
        render();
        sync();
      };

      expandAllButton.onclick = () => {
        collapsedPaths = new Set();
        render();
        sync();
      };

      collapseAllButton.onclick = () => {
        collapsedPaths = new Set(collectContainerPaths(state.root, []).map(pathKey));
        render();
      };
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'setComplexTypeEdits') {
        allowComplexTypesToggle.disabled = false;
        allowComplexTypesToggle.checked = message.enabled;
        allowComplexTypeEdits = message.enabled;
        render();
        return;
      }

      if (message.type === 'state') {
        state = message.state;
        render();
      }
    });

    render();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;

	}
}

class PlistCustomDocument implements vscode.CustomDocument {
	constructor(public readonly uri: vscode.Uri, private state: PlistDocumentState) {}

	public getState(): PlistDocumentState {
		return this.state;
	}

	public setState(state: PlistDocumentState): void {
		this.state = state;
	}

	public dispose(): void {}
}

function readPlistState(data: Uint8Array): PlistDocumentState {
	const buffer = Buffer.from(data);
	if (buffer.subarray(0, 8).toString('utf8') === 'bplist00') {
		const parsed = bplistParser.parseBuffer(buffer)[0];
		return { format: 'binary', root: nativeValueToNode(parsed) };
	}

  const parsed = plist.parse(buffer.toString('utf8'));
	return { format: 'xml', root: nativeValueToNode(parsed) };
}

function serializePlistState(state: PlistDocumentState): Uint8Array {
	const native = nodeToNativeValue(state.root);
	if (state.format === 'binary') {
    return Buffer.from(bplistCreator(native as any[] | Record<any, any>));
	}

	return Buffer.from(plist.build(native), 'utf8');
}

function nativeValueToNode(value: unknown): PlistNode {
	if (value instanceof Date) {
		return { kind: 'date', value: value.toISOString() };
	}

	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		return { kind: 'data', value: Buffer.from(value).toString('base64') };
	}

	if (Array.isArray(value)) {
		return { kind: 'array', items: value.map((item) => nativeValueToNode(item)) };
	}

	if (value && typeof value === 'object') {
		return {
			kind: 'dict',
			entries: Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
				key,
				value: nativeValueToNode(child),
			})),
		};
	}

	switch (typeof value) {
		case 'number':
			return { kind: 'number', value };
		case 'boolean':
			return { kind: 'boolean', value };
		default:
      return { kind: 'string', value: value === null || value === undefined ? '' : String(value) };
	}
}

function nodeToNativeValue(node: PlistNode): unknown {
	switch (node.kind) {
		case 'dict':
			return Object.fromEntries(node.entries.map((entry) => [entry.key, nodeToNativeValue(entry.value)]));
		case 'array':
			return node.items.map((item) => nodeToNativeValue(item));
		case 'number':
			return node.value;
		case 'boolean':
			return node.value;
		case 'date':
			return new Date(node.value);
		case 'data':
			return Buffer.from(node.value, 'base64');
		default:
			return node.value;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function escapeHtmlJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
