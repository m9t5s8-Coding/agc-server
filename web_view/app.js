/**
 * AGC Explorer - Compiler & IR Viewer UI Client
 * 
 * Workflow:
 * 1. User inputs custom AGC code in the left editor (main.ag).
 * 2. User clicks "Run" (or Ctrl+Enter).
 * 3. The code is sent via HTTP POST to the user's C++ server.
 * 4. The C++ server runs the compiler, produces the output file (out.ir),
 *    and sends the generated content back.
 * 5. The UI displays the generated output file in the right viewer.
 */

// ============================================================================
// 1. CONFIGURATION & C++ SERVER INTEGRATION
// ============================================================================
const defaultServerUrl = (window.location.protocol.startsWith('http') && window.location.host)
  ? `${window.location.origin}/compile`
  : 'http://localhost:8080/compile';

const CONFIG = {
  // Your C++ server URL. Default is http://localhost:8080/compile
  serverUrl: defaultServerUrl,

  // Format to send: 'json' ({ "code": "..." }) or 'raw' (text/plain)
  requestFormat: 'json',

  // Auto-run on typing (off by default so user controls when to Run)
  autoRun: false,
  debounceMs: 500,

  fontSize: 15,
  syncScroll: true
};

// Restore saved settings from localStorage
try {
  const savedCfg = localStorage.getItem('agc_config');
  if (savedCfg) {
    const parsed = JSON.parse(savedCfg);
    if (parsed && typeof parsed === 'object') {
      Object.assign(CONFIG, parsed);
    }
  }
} catch (_) { }

// Initial starter code in the custom input editor
const STARTER_CODE = `func main() -> int {
    let x : int = 10;
    let y : int = 20;
    let result : int = x + y;
    return (result);
}`;

// Sample templates available from the dropdown
const CODE_TEMPLATES = {
  empty: ``,
  hello: `func main() -> int {\n  let msg : string = "Hello, World!";\n  let n : int = 13;\n  write(msg, n);\n  return (0);\n}`,
  conditionals: `func main() -> int {\n  let score : int = 85;\n  let passing : int = 40;\n  let pass_msg : string = "Passed";\n  let fail_msg : string = "Failed";\n\n  if (score > passing) {\n    write(pass_msg, 6);\n    return (1);\n  } else {\n    write(fail_msg, 6);\n    return (0);\n  }\n}`,
  loops: `func main() -> int {\n  let i : int = 0;\n  let sum : int = 0;\n\n  while (i < 10) {\n    sum = sum + i;\n    i = i + 1;\n  }\n\n  return (sum);\n}`,
  functions: `func add(a : int, b : int) -> int {\n  return (a + b);\n}\n\nfunc main() -> int {\n  let x : int = 10;\n  let y : int = 20;\n  let result : int = add(x, y);\n  return (result);\n}`,
  complexExpressions: `func main() -> int {\n  let r : int = 10;\n  let x : int = 20;\n  # r =  (((1 + 2) * (9 - 4)) % 7 << 2) & 255 | (5 > 3 && 1 != 0);\n  let str : string = "Hello World!";\n  if(r > 30){\n    if(r > 40) {\n      read(str, x);\n    }\n    return (x);\n  } else {\n    write(str, x);\n  }\n  r = r + 10;\n  r = 1;\n  while(r < 30) {\n    r = r + 1;\n  }\n  exit(r = 2);\n  return(10 - 2);\n}`,
  argumentParsing: `func main(argc: int, argv: char) -> int {\n  let mitesh: int = 10;\n  var x : int = mitesh;\n  x = 10;\n  let suraj_chor : string = "desh xod!";\n  suraj_chor = "desh_xod";\n  if(x && mitesh) {\n    mitesh = x + 10;\n    if(mitesh) {\n      mitesh = x - 10;\n    }\n  } else {\n    mitesh = x - 10;\n  }\n  while(x == 10) {\n    x = x + 1;\n    suraj_chor = "hello!";\n  }\n\n  let buffer: string = "Suraj";\n  let buffer_len : int = 20;\n  write(buffer, buffer_len);\n  read(buffer,buffer_len);\n  return(mitesh);\n  exit(mitesh);\n}`
};


// Placeholder shown in Output Viewer before the first run or when waiting for server
const WAITING_PLACEHOLDER = `; =====================================================================
; Waiting to run code on your AGC compiler server
; =====================================================================
; 
; 1. Enter or edit your custom AGC code on the left.
; 2. Click the green "Run" button (or press Ctrl + Enter).
; 3. Your compiler server at ${CONFIG.serverUrl} will receive the code,
;    compile it with agc, and return the generated output here.
;
; Example server endpoint:
;   POST ${CONFIG.serverUrl}
;   Payload: { "code": "<your-custom-code>" }
;   Response: generated compilation output
; =====================================================================`;

// ============================================================================
// 2. MONACO LANGUAGE DEFINITIONS
// ============================================================================
function registerLanguages(monaco) {
  // AGC Source Language
  monaco.languages.register({ id: 'agc' });
  monaco.languages.setMonarchTokensProvider('agc', {
    keywords: [
      'func', 'let', 'const', 'if', 'else', 'while', 'for', 'return', 'print', 'input',
      'true', 'false', 'null'
    ],
    typeKeywords: ['int', 'float', 'string', 'bool', 'void', 'char'],
    operators: ['=', '>', '<', '!', '==', '<=', '>=', '!=', '+', '-', '*', '/', '%', '->', ':'],

    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier'
          }
        }],
        [/\b\d+\b/, 'number'],
        [/[{}()\[\]]/, '@brackets'],
        [/->|==|<=|>=|!=|[:+\-*\/%=<>!]/, 'operator'],
        [/[;,.]/, 'delimiter'],
      ]
    }
  });

  // AGC Language Configuration (Brackets, Comments, Auto-closing pairs)
  monaco.languages.setLanguageConfiguration('agc', {
    comments: {
      lineComment: '#'
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"']*$/,
      decreaseIndentPattern: /^.*\}[^}"']*$/
    },
    onEnterRules: [
      {
        beforeText: /^\s*.*\{\s*$/,
        afterText: /^\s*\}.*$/,
        action: { indentAction: monaco.languages.IndentAction.IndentOutdent }
      }
    ]
  });

  // Register document formatting provider for AGC
  monaco.languages.registerDocumentFormattingEditProvider('agc', {
    provideDocumentFormattingEdits(model) {
      const formatted = formatAgcCode(model.getValue());
      return [{
        range: model.getFullModelRange(),
        text: formatted
      }];
    }
  });

  // AGC 3-Address Intermediate Representation (IR) & Output Viewer
  monaco.languages.register({ id: 'agc-ir' });
  monaco.languages.setMonarchTokensProvider('agc-ir', {
    keywords: ['jmp', 'call', 'param', 'return', 'if', 'false', 'true'],

    tokenizer: {
      root: [
        // Error messages and lines (highlighted in vivid proper error red across all themes)
        [/^\[ERROR\].*$/, 'invalid'],
        [/^Error:.*$/, 'invalid'],
        [/^.*\[.*Error.*\].*$/, 'invalid'],
        [/^[a-zA-Z0-9_.\-\/\\]+:\d+(:\d+)?:\s*.*$/, 'invalid'],
        [/\b(error|Error|ERROR|failed|Failed|FAILED)\b/, 'invalid'],
        [/\b[bB]\d+:/, 'type.identifier'],
        [/\b[a-zA-Z_]\w*:/, 'type.identifier'],
        [/;.*$/, 'comment'],
        [/#.*$/, 'comment'],
        [/__sys_\w+|sys_\w+/, 'support.function'],
        [/\bt\d+\b/, 'variable.name'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier'
          }
        }],
        [/\b\d+\b/, 'number'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/=|[+\-*\/]/, 'operator'],
      ]
    }
  });
}

// ============================================================================
// 2.5 THEME MANAGEMENT & VIM MONACO PALETTES
// ============================================================================
let currentTheme = 'catppuccin-mocha';
try {
  const saved = localStorage.getItem('agc-theme');
  if (saved) currentTheme = saved;
} catch (_) { }

function applyTheme(themeId) {
  currentTheme = themeId;
  document.documentElement.setAttribute('data-theme', themeId);
  try {
    localStorage.setItem('agc-theme', themeId);
  } catch (_) { }

  const themeLabels = {
    'catppuccin-mocha': 'Catppuccin',
    'tokyo-night': 'Tokyo Night',
    'gruvbox-dark': 'Gruvbox',
    'nord': 'Nord',
    'vs-dark': 'VS Dark'
  };

  const labelElem = document.getElementById('current-theme-label');
  if (labelElem && themeLabels[themeId]) {
    labelElem.textContent = themeLabels[themeId];
  }

  document.querySelectorAll('#theme-menu .theme-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-theme') === themeId);
  });

  if (typeof monaco !== 'undefined' && monaco.editor && monaco.editor.setTheme) {
    monaco.editor.setTheme(themeId);
  }
}

function registerMonacoThemes(monaco) {
  // Catppuccin Mocha (Vim / Neovim)
  monaco.editor.defineTheme('catppuccin-mocha', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'cba6f7', fontStyle: 'italic' },
      { token: 'type', foreground: 'f9e2af' },
      { token: 'type.identifier', foreground: 'f9e2af' },
      { token: 'string', foreground: 'a6e3a1' },
      { token: 'number', foreground: 'fab387' },
      { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
      { token: 'operator', foreground: '89dceb' },
      { token: 'identifier', foreground: 'cdd6f4' },
      { token: 'support.function', foreground: '89b4fa' },
      { token: 'variable.name', foreground: 'f5c2e7' },
      { token: 'invalid', foreground: 'f38ba8', fontStyle: 'bold' },
      { token: 'error', foreground: 'f38ba8', fontStyle: 'bold' }
    ],
    colors: {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#cdd6f4',
      'editorCursor.foreground': '#f5e0dc',
      'editor.lineHighlightBackground': '#26273b',
      'editorLineNumber.foreground': '#6c7086',
      'editorLineNumber.activeForeground': '#cdd6f4',
      'editor.selectionBackground': '#45475a88'
    }
  });

  // Tokyo Night (Vim)
  monaco.editor.defineTheme('tokyo-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'bb9af7', fontStyle: 'italic' },
      { token: 'type', foreground: '2ac3de' },
      { token: 'type.identifier', foreground: '2ac3de' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
      { token: 'operator', foreground: '89ddff' },
      { token: 'identifier', foreground: 'c0caf5' },
      { token: 'support.function', foreground: '7aa2f7' },
      { token: 'variable.name', foreground: 'e0af68' },
      { token: 'invalid', foreground: 'f7768e', fontStyle: 'bold' },
      { token: 'error', foreground: 'f7768e', fontStyle: 'bold' }
    ],
    colors: {
      'editor.background': '#1a1b26',
      'editor.foreground': '#c0caf5',
      'editorCursor.foreground': '#c0caf5',
      'editor.lineHighlightBackground': '#24283b',
      'editorLineNumber.foreground': '#565f89',
      'editorLineNumber.activeForeground': '#c0caf5',
      'editor.selectionBackground': '#283457'
    }
  });

  // Gruvbox Dark (Vim)
  monaco.editor.defineTheme('gruvbox-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'fb4934', fontStyle: 'italic' },
      { token: 'type', foreground: 'fabd2f' },
      { token: 'type.identifier', foreground: 'fabd2f' },
      { token: 'string', foreground: 'b8bb26' },
      { token: 'number', foreground: 'd3869b' },
      { token: 'comment', foreground: '928374', fontStyle: 'italic' },
      { token: 'operator', foreground: 'fe8019' },
      { token: 'identifier', foreground: 'ebdbb2' },
      { token: 'support.function', foreground: '83a598' },
      { token: 'variable.name', foreground: 'b8bb26' },
      { token: 'invalid', foreground: 'fb4934', fontStyle: 'bold' },
      { token: 'error', foreground: 'fb4934', fontStyle: 'bold' }
    ],
    colors: {
      'editor.background': '#282828',
      'editor.foreground': '#ebdbb2',
      'editorCursor.foreground': '#ebdbb2',
      'editor.lineHighlightBackground': '#3c3836',
      'editorLineNumber.foreground': '#7c6f64',
      'editorLineNumber.activeForeground': '#ebdbb2',
      'editor.selectionBackground': '#504945'
    }
  });

  // Nord
  monaco.editor.defineTheme('nord', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '81a1c1', fontStyle: 'italic' },
      { token: 'type', foreground: '8fbcbb' },
      { token: 'type.identifier', foreground: '8fbcbb' },
      { token: 'string', foreground: 'a3be8c' },
      { token: 'number', foreground: 'b48ead' },
      { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
      { token: 'operator', foreground: '88c0d0' },
      { token: 'identifier', foreground: 'd8dee9' },
      { token: 'support.function', foreground: '88c0d0' },
      { token: 'invalid', foreground: 'bf616a', fontStyle: 'bold' },
      { token: 'error', foreground: 'bf616a', fontStyle: 'bold' }
    ],
    colors: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editorCursor.foreground': '#d8dee9',
      'editor.lineHighlightBackground': '#3b4252',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#d8dee9',
      'editor.selectionBackground': '#434c5e'
    }
  });
}

// ============================================================================
// 3. UI STATE & MULTI-FILE TAB HELPERS
// ============================================================================
let editorLeft = null;
let editorRight = null;
let autoRunTimer = null;
let isRunning = false;

let files = [
  {
    id: 'file-1',
    name: 'main.ag',
    content: STARTER_CODE
  }
];
let activeFileId = 'file-1';
const fileModels = new Map();
const localFileHandles = new Map();

// Load saved files and active tab from localStorage
try {
  const savedFiles = localStorage.getItem('agc_files');
  if (savedFiles) {
    const parsed = JSON.parse(savedFiles);
    if (Array.isArray(parsed) && parsed.length > 0) {
      files = parsed.map(f => {
        if (f.name && f.name.endsWith('.agc')) {
          f.name = f.name.replace(/\.agc$/, '.ag');
        }
        return f;
      });
    }
  }
  const savedActiveId = localStorage.getItem('agc_active_file_id');
  if (savedActiveId && files.some(f => f.id === savedActiveId)) {
    activeFileId = savedActiveId;
  } else if (files.length > 0) {
    activeFileId = files[0].id;
  }
} catch (_) { }

let localStorageTimer = null;
function scheduleSaveLocalStorage(immediate = false) {
  if (immediate) {
    if (localStorageTimer) clearTimeout(localStorageTimer);
    saveToLocalStorage();
    return;
  }
  if (localStorageTimer) clearTimeout(localStorageTimer);
  localStorageTimer = setTimeout(() => {
    saveToLocalStorage();
  }, 300);
}

function saveToLocalStorage() {
  try {
    const activeFile = getActiveFile();
    if (editorLeft && editorLeft.getValue && activeFile) {
      activeFile.content = editorLeft.getValue();
    }
    localStorage.setItem('agc_files', JSON.stringify(files));
    localStorage.setItem('agc_active_file_id', activeFileId);
    saveConfigToLocalStorage();
  } catch (err) {
    console.warn('Failed to save to localStorage:', err);
  }
}

function saveConfigToLocalStorage() {
  try {
    localStorage.setItem('agc_config', JSON.stringify({
      serverUrl: CONFIG.serverUrl,
      requestFormat: CONFIG.requestFormat,
      autoRun: CONFIG.autoRun,
      syncScroll: CONFIG.syncScroll,
      fontSize: CONFIG.fontSize
    }));
  } catch (_) { }
}

function getActiveFile() {
  return files.find(f => f.id === activeFileId) || files[0];
}

function getOrCreateFileModel(file) {
  if (typeof monaco === 'undefined' || !monaco.editor) return null;
  if (!fileModels.has(file.id)) {
    const uri = monaco.Uri.parse(`inmemory://workspace/${file.id}/${file.name}`);
    const existing = monaco.editor.getModel(uri);
    const model = existing || monaco.editor.createModel(file.content, 'agc', uri);
    model.onDidChangeContent(() => {
      file.content = model.getValue();
      updateCodeStats();
      scheduleSaveLocalStorage();
      if (CONFIG.autoRun) {
        clearTimeout(autoRunTimer);
        autoRunTimer = setTimeout(() => {
          runCodeOnCppServer();
        }, CONFIG.debounceMs);
      }
    });
    fileModels.set(file.id, model);
  }
  return fileModels.get(file.id);
}

function renderTabs() {
  const container = document.getElementById('editor-tabs');
  if (!container) return;
  container.innerHTML = '';

  files.forEach((file) => {
    const tab = document.createElement('div');
    tab.className = `tab ${file.id === activeFileId ? 'active' : ''}`;
    tab.title = `${file.name} (Click name to rename)`;

    const icon = document.createElement('span');
    icon.className = 'file-icon sj-icon';
    icon.textContent = 'AGC';

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = file.name;
    title.title = 'Click to rename file';

    const triggerRename = (e) => {
      e.stopPropagation();
      const currentName = file.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tab-title-input';
      input.value = currentName;
      title.replaceWith(input);
      input.focus();
      input.select();

      let finished = false;
      const finishRename = () => {
        if (finished) return;
        finished = true;
        let val = input.value.trim();
        if (!val) val = currentName;
        if (!val.endsWith('.ag')) val += '.ag';
        file.name = val;
        renderTabs();
        scheduleSaveLocalStorage(true);
      };

      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finishRename();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finished = true;
          renderTabs();
        }
      });
    };

    // Click directly on input file name to rename
    title.addEventListener('click', (e) => {
      e.stopPropagation();
      if (file.id === activeFileId) {
        triggerRename(e);
      } else {
        switchToFile(file.id);
      }
    });

    title.addEventListener('dblclick', triggerRename);

    tab.appendChild(icon);
    tab.appendChild(title);

    if (files.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = `Close ${file.name}`;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFile(file.id);
      });
      tab.appendChild(closeBtn);
    }

    tab.addEventListener('click', () => {
      switchToFile(file.id);
    });

    container.appendChild(tab);
  });
}

function switchToFile(fileId) {
  activeFileId = fileId;
  const file = getActiveFile();
  if (!file) return;

  if (editorLeft) {
    if (editorLeft.setModel) {
      const model = getOrCreateFileModel(file);
      if (model) editorLeft.setModel(model);
    } else if (editorLeft.setValue) {
      editorLeft.setValue(file.content);
    }
    if (editorLeft.focus) editorLeft.focus();
  }

  renderTabs();
  updateCodeStats();
  scheduleSaveLocalStorage();
}

function addNewFile(customName, initialContent) {
  let counter = files.length + 1;
  let name = customName;
  if (!name) {
    while (files.some(f => f.name === `file${counter}.ag`)) {
      counter++;
    }
    name = `file${counter}.ag`;
  }
  if (!name.endsWith('.ag')) name += '.ag';

  const defaultContent = initialContent || `func helper_${counter}() -> int {\n    return ${counter};\n}\n`;
  const newFile = {
    id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    name: name,
    content: defaultContent
  };
  files.push(newFile);
  switchToFile(newFile.id);
  scheduleSaveLocalStorage(true);
  showToast(`Created ${name}`);
}

function closeFile(fileId) {
  if (files.length <= 1) {
    showToast('Cannot close the last remaining file', 'warn');
    return;
  }
  const idx = files.findIndex(f => f.id === fileId);
  if (idx === -1) return;
  const removed = files.splice(idx, 1)[0];
  localFileHandles.delete(fileId);
  if (fileModels.has(fileId)) {
    try { fileModels.get(fileId).dispose(); } catch (_) { }
    fileModels.delete(fileId);
  }
  if (activeFileId === fileId) {
    const nextIdx = Math.max(0, idx - 1);
    switchToFile(files[nextIdx].id);
  } else {
    renderTabs();
  }
  scheduleSaveLocalStorage(true);
  showToast(`Closed ${removed.name}`);
}

// ============================================================================
// 3.1 CODE FORMATTER FOR AGC
// ============================================================================
function formatLineCode(codePart) {
  const strings = [];
  let s = codePart.replace(/"(?:[^"\\]|\\.)*"/g, (m) => {
    strings.push(m);
    return `__AGC_STR_${strings.length - 1}__`;
  });

  // Normalize colons: no space before, one space after
  s = s.replace(/\s*:\s*/g, ': ');
  // Normalize arrows
  s = s.replace(/\s*->\s*/g, ' -> ');
  // Normalize commas
  s = s.replace(/\s*,\s*/g, ', ');
  // Normalize semicolons
  s = s.replace(/\s*;\s*/g, ';');

  // Space before {
  s = s.replace(/([^\s])\{/g, '$1 {');

  // Multi-character operators
  const multiOps = ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>'];
  for (const op of multiOps) {
    const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('\\s*' + escaped + '\\s*', 'g'), ` ${op} `);
  }

  // Single character operators
  s = s.replace(/([^=!<>+\-*/&|^%])=([^=])/g, '$1 = $2');
  s = s.replace(/([\w\)])\+([\w\(])/g, '$1 + $2');
  s = s.replace(/([\w\)])\*([\w\(])/g, '$1 * $2');
  s = s.replace(/([\w\)])\/([\w\(])/g, '$1 / $2');
  s = s.replace(/([\w\)])%([\w\(])/g, '$1 % $2');
  s = s.replace(/([\w\)])-([^\s>])/g, '$1 - $2');
  s = s.replace(/([^<])<([^<=<])/g, '$1 < $2');
  s = s.replace(/([^->])>([^=>])/g, '$1 > $2');

  // Normalize multiple spaces
  s = s.replace(/[ \t]+/g, ' ');

  // Spacing inside and around parentheses
  s = s.replace(/\(\s+/g, '(');
  s = s.replace(/\s+\)/g, ')');
  s = s.replace(/\s+\(/g, '(');
  s = s.replace(/\b(if|while|for|return)\(/g, '$1 (');
  s = s.replace(/\belse\s+if\(/g, 'else if (');

  // Format "} else {" and "} else if (...) {"
  s = s.replace(/\}\s*else\s*\{/g, '} else {');
  s = s.replace(/\}\s*else\s+if\s*\(/g, '} else if (');

  // Restore string literals
  for (let i = 0; i < strings.length; i++) {
    s = s.replace(`__AGC_STR_${i}__`, strings[i]);
  }

  return s.trim();
}

function formatAgcCode(code) {
  if (!code) return '';
  const lines = code.split('\n');
  const formattedLines = [];
  let indentLevel = 0;
  const indentStr = '    '; // 4 spaces indent
  let lastWasEmpty = false;

  for (let rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (!lastWasEmpty && formattedLines.length > 0) {
        formattedLines.push('');
        lastWasEmpty = true;
      }
      continue;
    }
    lastWasEmpty = false;

    // Separate comment if exists outside of string
    let codePart = trimmed;
    let commentPart = '';
    let inString = false;
    let commentIndex = -1;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"' && (i === 0 || trimmed[i - 1] !== '\\')) {
        inString = !inString;
      } else if (ch === '#' && !inString) {
        commentIndex = i;
        break;
      }
    }

    if (commentIndex !== -1) {
      codePart = trimmed.substring(0, commentIndex).trim();
      commentPart = trimmed.substring(commentIndex);
      if (commentPart.startsWith('#') && commentPart.length > 1 && commentPart[1] !== ' ' && commentPart[1] !== '#') {
        commentPart = '# ' + commentPart.substring(1);
      }
    }

    const formattedCode = codePart ? formatLineCode(codePart) : '';

    // Count braces outside of strings
    let openCount = 0;
    let closeCount = 0;
    let inStr = false;
    for (let i = 0; i < codePart.length; i++) {
      const ch = codePart[i];
      if (ch === '"' && (i === 0 || codePart[i - 1] !== '\\')) {
        inStr = !inStr;
      } else if (!inStr) {
        if (ch === '{') openCount++;
        else if (ch === '}') closeCount++;
      }
    }

    // Lines starting with '}' should be unindented for that line
    const startsWithClose = formattedCode.startsWith('}');
    if (startsWithClose) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const currentIndent = indentStr.repeat(indentLevel);
    let finalLine = '';
    if (formattedCode && commentPart) {
      finalLine = currentIndent + formattedCode + '  ' + commentPart;
    } else if (formattedCode) {
      finalLine = currentIndent + formattedCode;
    } else {
      finalLine = currentIndent + commentPart;
    }

    formattedLines.push(finalLine);

    if (startsWithClose) {
      indentLevel = Math.max(0, indentLevel + openCount - (closeCount - 1));
    } else {
      indentLevel = Math.max(0, indentLevel + openCount - closeCount);
    }
  }

  return formattedLines.join('\n');
}

function formatCurrentFile() {
  const activeFile = getActiveFile();
  if (!activeFile) return;

  const currentCode = (editorLeft && editorLeft.getValue) ? editorLeft.getValue() : activeFile.content;
  const formatted = formatAgcCode(currentCode);

  if (formatted === currentCode) {
    showToast('Code is already formatted', 'info');
    return;
  }

  if (editorLeft && editorLeft.executeEdits && editorLeft.getModel) {
    const model = editorLeft.getModel();
    editorLeft.executeEdits('formatDocument', [{
      range: model.getFullModelRange(),
      text: formatted
    }]);
  } else if (editorLeft && editorLeft.setValue) {
    editorLeft.setValue(formatted);
  }

  activeFile.content = formatted;
  updateCodeStats();
  scheduleSaveLocalStorage(true);
  showToast('Code formatted!', 'success');
  logConsole(`[Format] Formatted ${activeFile.name}`, 'dim');
}

// ============================================================================
// 3.2 COMMENT SHORTCUT FEATURE (SINGLE & MULTI-LINE)
// ============================================================================
function toggleCommentOnEditor() {
  if (!editorLeft) return;

  if (editorLeft.executeEdits && editorLeft.getSelection && editorLeft.getModel) {
    const selection = editorLeft.getSelection();
    const model = editorLeft.getModel();
    if (!selection || !model) return;

    let startLine = selection.startLineNumber;
    let endLine = selection.endLineNumber;

    if (endLine > startLine && selection.endColumn === 1) {
      endLine = endLine - 1;
    }

    let allCommented = true;
    let hasNonEmpty = false;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const lineContent = model.getLineContent(lineNum);
      const trimmed = lineContent.trim();
      if (trimmed.length > 0) {
        hasNonEmpty = true;
        if (!trimmed.startsWith('#')) {
          allCommented = false;
          break;
        }
      }
    }
    if (!hasNonEmpty) allCommented = false;

    const edits = [];
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const lineContent = model.getLineContent(lineNum);
      const trimmed = lineContent.trim();

      if (allCommented) {
        // Uncomment: remove leading '# ' or '#'
        const match = lineContent.match(/^(\s*)#\s?(.*)$/);
        if (match) {
          const newText = match[1] + match[2];
          edits.push({
            range: new monaco.Range(lineNum, 1, lineNum, lineContent.length + 1),
            text: newText
          });
        }
      } else {
        // Comment: insert '# '
        if (trimmed.length > 0 || startLine === endLine) {
          const match = lineContent.match(/^(\s*)(.*)$/);
          const indent = match ? match[1] : '';
          const rest = match ? match[2] : lineContent;
          const newText = indent + '# ' + rest;
          edits.push({
            range: new monaco.Range(lineNum, 1, lineNum, lineContent.length + 1),
            text: newText
          });
        }
      }
    }

    if (edits.length > 0) {
      editorLeft.executeEdits('toggleComment', edits);
      const activeFile = getActiveFile();
      if (activeFile) {
        activeFile.content = editorLeft.getValue();
        scheduleSaveLocalStorage();
      }
    }
  } else if (editorLeft.getValue) {
    toggleCommentFallbackTextarea();
  }
}

function toggleCommentFallbackTextarea() {
  const ta = document.querySelector('#editor-left textarea');
  if (!ta) return;

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;

  const startLineIdx = val.lastIndexOf('\n', start - 1) + 1;
  let endLineIdx = val.indexOf('\n', end);
  if (endLineIdx === -1) endLineIdx = val.length;

  const selectedLinesText = val.substring(startLineIdx, endLineIdx);
  const lines = selectedLinesText.split('\n');

  let allCommented = true;
  let hasNonEmpty = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      hasNonEmpty = true;
      if (!trimmed.startsWith('#')) {
        allCommented = false;
        break;
      }
    }
  }
  if (!hasNonEmpty) allCommented = false;

  const newLines = lines.map(line => {
    if (allCommented) {
      return line.replace(/^(\s*)#\s?/, '$1');
    } else {
      if (line.trim().length > 0 || lines.length === 1) {
        return line.replace(/^(\s*)(.*)$/, '$1# $2');
      }
      return line;
    }
  });

  const replaced = newLines.join('\n');
  ta.value = val.substring(0, startLineIdx) + replaced + val.substring(endLineIdx);
  ta.selectionStart = startLineIdx;
  ta.selectionEnd = startLineIdx + replaced.length;

  const activeFile = getActiveFile();
  if (activeFile) {
    activeFile.content = ta.value;
    scheduleSaveLocalStorage();
  }
  updateCodeStats();
}

// ============================================================================
// 3.3 INTELLIGENT BRACKET CLOSE DETECTION
// ============================================================================
function hasUnmatchedClose(textAfter, openChar, closeChar) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < textAfter.length; i++) {
    const ch = textAfter[i];
    if (ch === '"' && (i === 0 || textAfter[i - 1] !== '\\')) {
      inStr = !inStr;
    } else if (!inStr) {
      if (ch === '#') break; // Comments ignore rest of line
      if (ch === closeChar) {
        if (depth > 0) {
          depth--;
        } else {
          return true; // Found unmatched closing bracket
        }
      } else if (ch === openChar) {
        depth++;
      }
    }
  }
  return false;
}

// ============================================================================
// 3.4 LOCAL FILE ACCESS (SAVE / OPEN / FILE SYSTEM API)
// ============================================================================
async function saveActiveFile(forcePicker = false) {
  const activeFile = getActiveFile();
  if (!activeFile) return;

  if (editorLeft && editorLeft.getValue) {
    activeFile.content = editorLeft.getValue();
  }

  scheduleSaveLocalStorage(true);

  let handle = localFileHandles.get(activeFile.id);

  // If handle already exists and not forcing picker, write directly to that local file!
  if (handle && !forcePicker) {
    try {
      if (handle.queryPermission) {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          const req = await handle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') {
            throw new Error('Permission denied to write to local file');
          }
        }
      }
      const writable = await handle.createWritable();
      await writable.write(activeFile.content);
      await writable.close();
      activeFile.isSaved = true;
      showToast(`Saved to ${handle.name || activeFile.name}!`, 'success');
      logConsole(`[Save] Written directly to disk: ${handle.name || activeFile.name}`, 'success');
      return;
    } catch (err) {
      logConsole(`[Save Warning] Could not write to handle: ${err.message}`, 'warn');
    }
  }

  // If no handle or write failed, try showSaveFilePicker
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: activeFile.name,
        types: [{
          description: 'AGC Source File (*.ag)',
          accept: { 'text/plain': ['.ag', '.agc', '.txt', '.ir'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(activeFile.content);
      await writable.close();

      localFileHandles.set(activeFile.id, handle);
      if (handle.name && handle.name !== activeFile.name) {
        activeFile.name = handle.name;
        renderTabs();
      }
      activeFile.isSaved = true;
      scheduleSaveLocalStorage(true);
      showToast(`Saved to ${handle.name}!`, 'success');
      logConsole(`[Save] File saved locally to disk: ${handle.name}`, 'success');
      return;
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // User cancelled save dialog
      }
      logConsole(`[Save] showSaveFilePicker failed: ${err.message}. Falling back to browser download.`, 'dim');
    }
  }

  // Graceful fallback: download file
  downloadFile(activeFile.name, activeFile.content);
  activeFile.isSaved = true;
  scheduleSaveLocalStorage(true);
}

async function openFileFromDisk() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'AGC Files / Text Files (*.ag, *.agc, *.txt, *.ir, *)',
          accept: {
            'text/plain': ['.ag', '.agc', '.txt', '.ir', '.c', '.cpp', '.*']
          }
        }]
      });
      const fileObj = await handle.getFile();
      const content = await fileObj.text();
      loadOpenedFile(fileObj.name, content, handle);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      logConsole(`[Open] showOpenFilePicker: ${err.message}. Using fallback.`, 'dim');
    }
  }

  // Fallback: file input element
  openFileViaInput();
}

function openFileViaInput() {
  let input = document.getElementById('file-input-fallback');
  if (!input) {
    input = document.createElement('input');
    input.id = 'file-input-fallback';
    input.type = 'file';
    input.accept = '.ag,.agc,.txt,.ir,*/*';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = () => {
    if (input.files && input.files[0]) {
      const fileObj = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        loadOpenedFile(fileObj.name, e.target.result, null);
      };
      reader.readAsText(fileObj);
    }
  };
  input.click();
}

function loadOpenedFile(name, content, handle) {
  const activeFile = getActiveFile();
  const isStarterOrEmpty = files.length === 1 &&
    (!activeFile.content.trim() || activeFile.content === STARTER_CODE);

  if (isStarterOrEmpty) {
    activeFile.name = name;
    activeFile.content = content;
    if (handle) localFileHandles.set(activeFile.id, handle);
    if (fileModels.has(activeFile.id)) {
      fileModels.get(activeFile.id).setValue(content);
    }
    if (editorLeft && editorLeft.setValue) {
      editorLeft.setValue(content);
    }
    renderTabs();
    updateCodeStats();
    showToast(`Loaded ${name}`, 'success');
    logConsole(`[Open] Loaded ${name} (${content.length} bytes)`, 'success');
    scheduleSaveLocalStorage(true);
    return;
  }

  // Check if a file with same name already exists
  const existing = files.find(f => f.name === name);
  if (existing) {
    existing.content = content;
    if (handle) localFileHandles.set(existing.id, handle);
    if (fileModels.has(existing.id)) {
      fileModels.get(existing.id).setValue(content);
    }
    switchToFile(existing.id);
    showToast(`Reloaded ${name}`, 'success');
    logConsole(`[Open] Reloaded ${name}`, 'success');
    scheduleSaveLocalStorage(true);
    return;
  }

  // Add new file tab
  const newFile = {
    id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    name: name,
    content: content
  };
  files.push(newFile);
  if (handle) {
    localFileHandles.set(newFile.id, handle);
  }
  switchToFile(newFile.id);
  showToast(`Loaded ${name}`, 'success');
  logConsole(`[Open] Opened ${name} into new tab`, 'success');
  scheduleSaveLocalStorage(true);
}

function getCombinedSourceCode() {
  const activeFile = getActiveFile();
  if (editorLeft && editorLeft.getValue) {
    activeFile.content = editorLeft.getValue();
  }

  if (files.length === 1) {
    return activeFile.content;
  }

  // Put non-main files first, then main file so functions are defined before main
  const otherFiles = [];
  const mainFiles = [];

  files.forEach(f => {
    if (f.name === 'main.ag' || f.name === 'main.agc' || f.content.includes('func main')) {
      mainFiles.push(f);
    } else {
      otherFiles.push(f);
    }
  });

  const ordered = [...otherFiles, ...mainFiles];
  return ordered.map(f => `// ================= [${f.name}] =================\n${f.content.trim()}`).join('\n\n');
}

function logConsole(message, type = 'info') {
  const consoleOutput = document.getElementById('console-output');
  const countPill = document.getElementById('log-count');
  if (!consoleOutput) return;

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleOutput.appendChild(entry);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;

  const totalLogs = consoleOutput.querySelectorAll('.log-entry').length;
  if (countPill) countPill.textContent = `${totalLogs} logs`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

function updateServerStatus(status, text) {
  const pill = document.getElementById('server-status-pill');
  const label = document.getElementById('server-status-text');
  if (!pill || !label) return;

  pill.className = `status-pill status-${status}`;
  label.textContent = text;
}

function updateCodeStats() {
  if (!editorLeft) return;
  const val = editorLeft.getValue();
  const lenElem = document.getElementById('code-length-display');
  if (lenElem) {
    lenElem.textContent = `${val.length} chars`;
  }
}

function updateOutputStats() {
  if (!editorRight) return;
  const lineCount = editorRight.getModel().getLineCount();
  const statsElem = document.getElementById('ir-stats');
  if (statsElem) {
    statsElem.textContent = `${lineCount} lines`;
  }
}

async function checkServerHealth() {
  try {
    const healthUrl = CONFIG.serverUrl.replace(/\/compile\/?$/, '/health');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      updateServerStatus('online', 'Compiler Server: Online');
      logConsole(`Compiler Server reachable at ${healthUrl}`, 'success');
      return true;
    }
  } catch (_) {
    // Keep standby or current status
  }
  return false;
}

// ============================================================================
// 4. RUN CODE ON C++ SERVER
// ============================================================================

function highlightErrorInEditor(errorMsg) {
  if (!editorLeft || typeof monaco === 'undefined') return;
  const match = errorMsg.match(/([a-zA-Z0-9_.\-\/\\]+\.(ag|agc|sj)):(\d+)(?::(\d+))?:?\s*(.*)/i);
  if (match) {
    const errorFile = match[1].split('/').pop().split('\\').pop();
    const line = parseInt(match[3], 10);
    const col = match[4] ? parseInt(match[4], 10) : 1;
    const msg = (match[5] || 'Compilation error').replace(/^["']|["']$/g, '');

    const active = getActiveFile();
    if (active && (active.name === errorFile || files.length === 1)) {
      monaco.editor.setModelMarkers(editorLeft.getModel(), 'agc', [{
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: 1000,
        message: msg,
        severity: monaco.MarkerSeverity.Error
      }]);
    }
  }
}

function clearEditorErrors() {
  if (editorLeft && typeof monaco !== 'undefined') {
    monaco.editor.setModelMarkers(editorLeft.getModel(), 'agc', []);
  }
}

/**
 * Takes the currently active file from the editor, sends it to the C++ server
 * via HTTP POST, and displays the generated output in the right editor.
 * Only the active (open) file is compiled — not the combined multi-file source.
 */
async function runCodeOnCppServer() {
  if (isRunning || !editorLeft || !editorRight) return;

  const activeFile = getActiveFile();
  // Always capture the latest editor content into the active file
  if (editorLeft && editorLeft.getValue) {
    activeFile.content = editorLeft.getValue();
  }

  // Run ONLY the currently open (active) file — not combined multi-file output
  const sourceCode = activeFile.content;
  const btnRun = document.getElementById('btn-run');
  const btnRunText = btnRun.querySelector('.btn-text');
  const durationText = document.getElementById('duration-text');
  const compileBadge = document.getElementById('compile-duration');
  const bottomBar = document.querySelector('.bottom-bar');

  if (!sourceCode.trim()) {
    showToast('Input is empty. Enter some AGC code first!', 'error');
    return;
  }

  isRunning = true;
  btnRun.classList.add('running');
  if (btnRunText) btnRunText.textContent = 'Running...';
  if (durationText) durationText.textContent = 'Sending to compiler server...';

  const startTime = performance.now();
  logConsole(`Compiling [${activeFile.name}] (${sourceCode.length} chars) via ${CONFIG.serverUrl}...`, 'dim');

  try {
    // Build request payload — send only the active (open) file
    let headers = {};
    let bodyData = null;

    if (CONFIG.requestFormat === 'json') {
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      };
      bodyData = JSON.stringify({
        code: sourceCode,
        filename: activeFile.name,
        // Send only the active file (not all files)
        files: [{ name: activeFile.name, content: sourceCode }]
      });
    } else {
      headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Accept': 'text/plain, */*'
      };
      bodyData = sourceCode;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

    const response = await fetch(CONFIG.serverUrl, {
      method: 'POST',
      headers: headers,
      body: bodyData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const json = await response.json();

        // Explicitly check status: true or false
        if (json.status === true) {
          // Status TRUE: show compiled output in the viewer
          clearEditorErrors();
          const outputContent = json.output || json.ir || '';
          editorRight.setValue(outputContent);
          updateOutputStats();
          if (compileBadge) compileBadge.classList.remove('error');
          if (bottomBar) bottomBar.classList.remove('error-mode');
          if (durationText) durationText.textContent = `Generated in ${elapsed}s`;
          updateServerStatus('online', 'Compiler Server: Online');
          logConsole(`[AGC] Compilation succeeded (${elapsed}s, ${outputContent.length} bytes)`, 'success');
          showToast(`Compiled successfully in ${elapsed}s!`, 'success');
        } else {
          // Status FALSE: format and display error in vivid proper red
          const rawError = (json.error || json.output || 'Unknown compilation error').trim();
          editorRight.setValue(`[ERROR] AGC Compilation Failed:\n${'='.repeat(68)}\n\n${rawError}\n\n${'='.repeat(68)}`);
          updateOutputStats();
          if (compileBadge) compileBadge.classList.add('error');
          if (bottomBar) bottomBar.classList.add('error-mode');
          if (durationText) durationText.textContent = `Compilation Error (${elapsed}s)`;
          updateServerStatus('online', 'Compiler Server: Online');
          logConsole(`[AGC Error] ${rawError}`, 'error');
          showToast(`Compilation error: check output viewer`, 'error');
          highlightErrorInEditor(rawError);
        }

        if (json.stderr) {
          logConsole(`[Stderr] ${json.stderr}`, 'warn');
        }
      } else {
        // Raw text response
        clearEditorErrors();
        const outputContent = await response.text();
        editorRight.setValue(outputContent);
        updateOutputStats();
        if (compileBadge) compileBadge.classList.remove('error');
        if (bottomBar) bottomBar.classList.remove('error-mode');
        if (durationText) durationText.textContent = `Generated in ${elapsed}s`;
        updateServerStatus('online', 'Compiler Server: Online');
        logConsole(`Output received (${elapsed}s, ${outputContent.length} bytes)`, 'success');
        showToast(`Output generated in ${elapsed}s!`, 'success');
      }

    } else {
      let errorText = '';
      try {
        const errJson = await response.json();
        errorText = errJson.error || errJson.output || JSON.stringify(errJson);
      } catch (_) {
        errorText = await response.text();
      }
      if (compileBadge) compileBadge.classList.add('error');
      if (bottomBar) bottomBar.classList.add('error-mode');
      editorRight.setValue(`[ERROR] Server Error (HTTP ${response.status}):\n${'='.repeat(68)}\n\n${errorText || response.statusText}\n\n${'='.repeat(68)}`);
      updateOutputStats();
      if (durationText) durationText.textContent = `Error (${elapsed}s)`;
      logConsole(`Compiler error (HTTP ${response.status}): ${errorText}`, 'error');
      showToast(`Server error`, 'error');
      return;
    }

  } catch (err) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
    updateServerStatus('error', 'Compiler Server: Failed');
    if (compileBadge) compileBadge.classList.add('error');
    if (bottomBar) bottomBar.classList.add('error-mode');
    if (durationText) durationText.textContent = `Error (${elapsed}s)`;

    logConsole(`Connection failed: ${err.message}`, 'error');
    logConsole(`Please verify your compiler server is listening on ${CONFIG.serverUrl} and has CORS enabled`, 'dim');

    // Show diagnostic in proper error red format
    editorRight.setValue(`[ERROR] Could Not Connect to Compiler Server:\n${'='.repeat(68)}\n\nEndpoint: ${CONFIG.serverUrl}\nDetails: ${err.message}\n\nTroubleshooting:\n1. Make sure your AGC compiler server is started and listening on port 8080\n2. Ensure your server sends CORS headers:\n     Access-Control-Allow-Origin: *\n3. Once your server is running, click "Run" again!\n\n${'='.repeat(68)}`);

    showToast(`Failed to reach compiler server at ${CONFIG.serverUrl}`, 'error');
    updateOutputStats();

  } finally {
    isRunning = false;
    btnRun.classList.remove('running');
    if (btnRunText) btnRunText.textContent = 'Run';
  }
}

// ============================================================================
// 5. RESIZABLE SPLIT PANES
// ============================================================================
function initSplitter() {
  const splitter = document.getElementById('splitter');
  const paneLeft = document.getElementById('pane-left');
  const paneRight = document.getElementById('pane-right');
  const workspace = document.getElementById('workspace');

  let isDragging = false;

  splitter.addEventListener('mousedown', () => {
    isDragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const offsetLeft = e.clientX - workspaceRect.left;
    const totalWidth = workspaceRect.width;

    const minWidth = 220;
    const clampedOffset = Math.max(minWidth, Math.min(totalWidth - minWidth, offsetLeft));

    const leftPercentage = (clampedOffset / totalWidth) * 100;
    paneLeft.style.flex = `0 0 ${leftPercentage}%`;
    paneRight.style.flex = `0 0 ${100 - leftPercentage}%`;

    if (editorLeft) editorLeft.layout();
    if (editorRight) editorRight.layout();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (editorLeft) editorLeft.layout();
      if (editorRight) editorRight.layout();
      try {
        const leftPct = parseFloat(paneLeft.style.flex.replace('0 0 ', '').replace('%', ''));
        if (!isNaN(leftPct)) localStorage.setItem('agc_splitter_pos', leftPct);
      } catch (_) { }
    }
  });

  splitter.addEventListener('dblclick', () => {
    paneLeft.style.flex = '1';
    paneRight.style.flex = '1';
    try { localStorage.removeItem('agc_splitter_pos'); } catch (_) { }
    if (editorLeft) editorLeft.layout();
    if (editorRight) editorRight.layout();
    showToast('Reset split panes to 50/50');
  });

  window.addEventListener('resize', () => {
    if (editorLeft) editorLeft.layout();
    if (editorRight) editorRight.layout();
  });
}

// ============================================================================
// 6. MONACO BOOTSTRAP
// ============================================================================
function initMonaco() {
  if (typeof require === 'undefined') {
    initFallbackTextareas();
    return;
  }

  require.config({
    paths: {
      vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
    }
  });

  window.MonacoEnvironment = {
    getWorkerUrl: function () {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
      `)}`;
    }
  };

  require(['vs/editor/editor.main'], function () {
    registerLanguages(monaco);
    registerMonacoThemes(monaco);

    const commonOptions = {
      theme: currentTheme,
      fontSize: CONFIG.fontSize,
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: 1.7,
      fontLigatures: true,
      automaticLayout: true,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      tabSize: 4,
      insertSpaces: true,
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoClosingDelete: 'always',
      autoClosingOvertype: 'always',
      autoSurround: 'languageDefined',
      matchBrackets: 'always',
      bracketPairColorization: { enabled: true },
      formatOnPaste: true,
      minimap: { enabled: true, maxColumn: 40, renderCharacters: false }
    };

    // Left Editor: Custom Code Input (Editable)
    const activeFile = getActiveFile();
    const initialModel = getOrCreateFileModel(activeFile);

    editorLeft = monaco.editor.create(document.getElementById('editor-left'), {
      ...commonOptions,
      model: initialModel,
      readOnly: false
    });

    // Right Editor: Output File Viewer (out.ir) - Select and View Only, No Edit
    editorRight = monaco.editor.create(document.getElementById('editor-right'), {
      ...commonOptions,
      value: WAITING_PLACEHOLDER,
      language: 'agc-ir',
      readOnly: true,              // View & select only, no editing
      domReadOnly: true,           // Disables keyboard inputs
      cursorStyle: 'line',         // Standard selectable text cursor
      contextmenu: true            // Allows right-click to select all and copy
    });

    applyTheme(currentTheme);
    renderTabs();

    // Intelligent bracket insertion & overtyping
    editorLeft.onKeyDown((e) => {
      const bracketPairs = {
        '(': ')',
        '{': '}',
        '[': ']'
      };
      const closeToOpen = {
        ')': '(',
        '}': '{',
        ']': '['
      };

      const key = e.browserEvent ? e.browserEvent.key : null;
      if (!key) return;

      // When opening bracket is inserted
      if (bracketPairs[key]) {
        const selection = editorLeft.getSelection();
        if (selection && selection.isEmpty()) {
          const pos = selection.getPosition();
          const model = editorLeft.getModel();
          const line = model.getLineContent(pos.lineNumber);
          const textAfter = line.substring(pos.column - 1);
          const openChar = key;
          const closeChar = bracketPairs[key];

          const hasClose = hasUnmatchedClose(textAfter, openChar, closeChar);

          e.preventDefault();
          e.stopPropagation();

          if (hasClose) {
            // Equivalent close is ALREADY there: insert ONLY the open bracket
            editorLeft.executeEdits('autoClose', [{
              range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
              text: openChar
            }]);
            editorLeft.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
          } else {
            // Equivalent close is NOT there: insert both open and close brackets
            editorLeft.executeEdits('autoClose', [{
              range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
              text: openChar + closeChar
            }]);
            editorLeft.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
          }
          return;
        }
      }

      // When closing bracket is typed and it's already there right after cursor: step over
      if (closeToOpen[key]) {
        const selection = editorLeft.getSelection();
        if (selection && selection.isEmpty()) {
          const pos = selection.getPosition();
          const model = editorLeft.getModel();
          const line = model.getLineContent(pos.lineNumber);
          if (line[pos.column - 1] === key) {
            e.preventDefault();
            e.stopPropagation();
            editorLeft.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
            return;
          }
        }
      }
    });

    // Monaco Actions (Save, Open, Comment, Format)
    editorLeft.addAction({
      id: 'save-active-file-cmd',
      label: 'Save File to Disk',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        saveActiveFile();
      }
    });

    editorLeft.addAction({
      id: 'open-file-disk-cmd',
      label: 'Open File from Disk',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
      run: () => {
        openFileFromDisk();
      }
    });

    editorLeft.addAction({
      id: 'toggle-line-comment-cmd',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: () => {
        toggleCommentOnEditor();
      }
    });

    editorLeft.addAction({
      id: 'format-agc-code-cmd',
      label: 'Format AGC Document',
      keybindings: [
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI
      ],
      run: () => {
        formatCurrentFile();
      }
    });

    // Update cursor position and length live
    editorLeft.onDidChangeCursorPosition((e) => {
      const posDisplay = document.getElementById('cursor-pos');
      if (posDisplay) {
        posDisplay.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
      }
    });

    editorLeft.onDidChangeModelContent(() => {
      updateCodeStats();
      scheduleSaveLocalStorage();
      if (!CONFIG.autoRun) return;
      clearTimeout(autoRunTimer);
      autoRunTimer = setTimeout(() => {
        runCodeOnCppServer();
      }, CONFIG.debounceMs);
    });

    // Synchronize scrolling
    let isSyncing = false;
    editorLeft.onDidScrollChange((e) => {
      if (!CONFIG.syncScroll || isSyncing) return;
      isSyncing = true;
      editorRight.setScrollTop(e.scrollTop);
      isSyncing = false;
    });

    editorRight.onDidScrollChange((e) => {
      if (!CONFIG.syncScroll || isSyncing) return;
      isSyncing = true;
      editorLeft.setScrollTop(e.scrollTop);
      isSyncing = false;
    });

    updateCodeStats();
    updateOutputStats();
    logConsole('Monaco Editor ready. Enter AGC code on the left and click "Run" to test with your compiler server.', 'success');
  });
}

function initFallbackTextareas() {
  logConsole('Using lightweight textarea fallback.', 'warn');
  const leftContainer = document.getElementById('editor-left');
  const rightContainer = document.getElementById('editor-right');

  const taLeft = document.createElement('textarea');
  taLeft.style.cssText = 'width:100%;height:100%;background:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:12px;border:none;resize:none;outline:none;font-size:13px;line-height:1.5;';
  const activeFile = getActiveFile();
  taLeft.value = activeFile ? activeFile.content : STARTER_CODE;
  leftContainer.appendChild(taLeft);

  const taRight = document.createElement('textarea');
  taRight.style.cssText = 'width:100%;height:100%;background:#1e1e1e;color:#ce9178;font-family:monospace;padding:12px;border:none;resize:none;outline:none;font-size:13px;line-height:1.5;cursor:text;user-select:text;';
  taRight.value = WAITING_PLACEHOLDER;
  taRight.readOnly = true; // Select and view only
  rightContainer.appendChild(taRight);

  editorLeft = {
    getValue: () => taLeft.value,
    setValue: (v) => {
      taLeft.value = v;
      const f = getActiveFile();
      if (f) f.content = v;
      updateCodeStats();
      scheduleSaveLocalStorage();
    },
    layout: () => { }
  };
  editorRight = {
    getValue: () => taRight.value,
    setValue: (v) => { taRight.value = v; updateOutputStats(); },
    layout: () => { },
    getModel: () => ({ getLineCount: () => taRight.value.split('\n').length })
  };

  renderTabs();

  // Auto-close brackets for textarea fallback
  taLeft.addEventListener('keydown', (e) => {
    const bracketPairs = { '(': ')', '{': '}', '[': ']' };
    if (bracketPairs[e.key]) {
      const start = taLeft.selectionStart;
      const end = taLeft.selectionEnd;
      if (start === end) {
        const val = taLeft.value;
        const textAfter = val.substring(start).split('\n')[0];
        const openChar = e.key;
        const closeChar = bracketPairs[openChar];
        const hasClose = hasUnmatchedClose(textAfter, openChar, closeChar);

        e.preventDefault();
        if (hasClose) {
          taLeft.value = val.substring(0, start) + openChar + val.substring(end);
          taLeft.selectionStart = taLeft.selectionEnd = start + 1;
        } else {
          taLeft.value = val.substring(0, start) + openChar + closeChar + val.substring(end);
          taLeft.selectionStart = taLeft.selectionEnd = start + 1;
        }
        const f = getActiveFile();
        if (f) f.content = taLeft.value;
        updateCodeStats();
        scheduleSaveLocalStorage();
        return;
      }
    }
    if ([')', '}', ']'].includes(e.key)) {
      const start = taLeft.selectionStart;
      if (taLeft.selectionStart === taLeft.selectionEnd && taLeft.value[start] === e.key) {
        e.preventDefault();
        taLeft.selectionStart = taLeft.selectionEnd = start + 1;
        return;
      }
    }
  });

  taLeft.addEventListener('input', () => {
    const f = getActiveFile();
    if (f) f.content = taLeft.value;
    updateCodeStats();
    scheduleSaveLocalStorage();
    if (CONFIG.autoRun) runCodeOnCppServer();
  });
}

// ============================================================================
// 7. EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
  // Dropdown click-to-toggle & outside click handling
  document.querySelectorAll('.dropdown-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = btn.closest('.dropdown');
      const wasOpen = parent.classList.contains('open');
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) {
        parent.classList.add('open');
      }
    });
  });

  // Clicking outside closes open dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });

  // Prevent dropdowns from closing when clicking inside settings popup controls
  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.setting-item') || e.target.closest('.setting-item-row')) {
        e.stopPropagation();
      }
    });
  });

  // Add file tab button (+)
  const btnAddTab = document.getElementById('btn-add-tab');
  if (btnAddTab) {
    btnAddTab.addEventListener('click', () => {
      addNewFile();
    });
  }

  // RUN BUTTON
  const btnRun = document.getElementById('btn-run');
  btnRun.addEventListener('click', () => {
    runCodeOnCppServer();
  });

  // Keyboard shortcuts (Run, Save, Open, Comment, Format)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCodeOnCppServer();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveActiveFile();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      openFileFromDisk();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      toggleCommentOnEditor();
    }
    if ((e.shiftKey && e.altKey && (e.key === 'f' || e.key === 'F')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I'))) {
      e.preventDefault();
      formatCurrentFile();
    }
  });

  // Toolbar action buttons
  const btnSaveSrc = document.getElementById('btn-save-src');
  if (btnSaveSrc) {
    btnSaveSrc.addEventListener('click', () => {
      saveActiveFile();
    });
  }

  const btnOpenSrc = document.getElementById('btn-open-src');
  if (btnOpenSrc) {
    btnOpenSrc.addEventListener('click', () => {
      openFileFromDisk();
    });
  }

  const btnFormatSrc = document.getElementById('btn-format-src');
  if (btnFormatSrc) {
    btnFormatSrc.addEventListener('click', () => {
      formatCurrentFile();
    });
  }

  const btnCommentSrc = document.getElementById('btn-comment-src');
  if (btnCommentSrc) {
    btnCommentSrc.addEventListener('click', () => {
      toggleCommentOnEditor();
    });
  }

  // Clear button: empties active file editor
  const btnClear = document.getElementById('btn-clear');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const activeFile = getActiveFile();
      activeFile.content = '';
      if (editorLeft) {
        if (editorLeft.setValue) editorLeft.setValue('');
        if (editorLeft.focus) editorLeft.focus();
        scheduleSaveLocalStorage(true);
        showToast(`Cleared ${activeFile.name}!`);
      }
    });
  }

  // Server URL settings input
  const serverInput = document.getElementById('server-url-input');
  const endpointDisplay = document.getElementById('status-endpoint-display');
  if (serverInput) {
    serverInput.value = CONFIG.serverUrl;
    serverInput.addEventListener('change', (e) => {
      CONFIG.serverUrl = e.target.value.trim();
      const endpointVal = endpointDisplay ? endpointDisplay.querySelector('.endpoint-val') : null;
      if (endpointVal) endpointVal.textContent = CONFIG.serverUrl;
      saveConfigToLocalStorage();
      showToast(`Compiler server endpoint set to ${CONFIG.serverUrl}`);
      checkServerHealth();
    });
  }
  if (endpointDisplay) {
    const endpointVal = endpointDisplay.querySelector('.endpoint-val');
    if (endpointVal) endpointVal.textContent = CONFIG.serverUrl;
  }

  // Request format select (JSON vs raw text)
  const formatSelect = document.getElementById('request-format-select');
  if (formatSelect) {
    formatSelect.value = CONFIG.requestFormat;
    formatSelect.addEventListener('change', (e) => {
      CONFIG.requestFormat = e.target.value;
      saveConfigToLocalStorage();
      showToast(`Request format set to: ${CONFIG.requestFormat}`);
    });
  }

  // Click endpoint in bottom bar to quickly change URL
  if (endpointDisplay) {
    endpointDisplay.addEventListener('click', () => {
      const newUrl = prompt('Enter compiler server endpoint URL:', CONFIG.serverUrl);
      if (newUrl && newUrl.trim()) {
        CONFIG.serverUrl = newUrl.trim();
        if (serverInput) serverInput.value = CONFIG.serverUrl;
        const endpointVal = endpointDisplay.querySelector('.endpoint-val');
        if (endpointVal) endpointVal.textContent = CONFIG.serverUrl;
        saveConfigToLocalStorage();
        showToast(`Compiler server endpoint set to ${CONFIG.serverUrl}`);
      }
    });
  }

  // Auto-run toggle
  const autoRunToggle = document.getElementById('auto-run-toggle');
  if (autoRunToggle) {
    autoRunToggle.checked = CONFIG.autoRun;
    autoRunToggle.addEventListener('change', (e) => {
      CONFIG.autoRun = e.target.checked;
      saveConfigToLocalStorage();
      showToast(CONFIG.autoRun ? 'Auto-run enabled on typing' : 'Auto-run disabled');
    });
  }

  // Sync scroll toggle
  const syncToggle = document.getElementById('sync-scroll-toggle');
  if (syncToggle) {
    syncToggle.checked = CONFIG.syncScroll;
    syncToggle.addEventListener('change', (e) => {
      CONFIG.syncScroll = e.target.checked;
      saveConfigToLocalStorage();
    });
  }

  // Status pill click to trigger run / test
  const serverPill = document.getElementById('server-status-pill');
  if (serverPill) {
    serverPill.addEventListener('click', () => {
      runCodeOnCppServer();
    });
  }

  // Theme selector dropdown
  document.querySelectorAll('#theme-menu [data-theme]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const themeId = link.getAttribute('data-theme');
      applyTheme(themeId);
      showToast(`Theme: ${link.textContent.trim()}`);
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    });
  });

  // Code samples dropdown
  document.querySelectorAll('[data-template]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const templateKey = link.getAttribute('data-template');
      if (CODE_TEMPLATES.hasOwnProperty(templateKey)) {
        const activeFile = getActiveFile();
        activeFile.content = CODE_TEMPLATES[templateKey];
        if (editorLeft && editorLeft.setValue) {
          editorLeft.setValue(activeFile.content);
        }
        scheduleSaveLocalStorage(true);
        showToast(`Loaded sample: ${link.textContent.trim()}`);
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });
  });

  // Copy buttons
  document.getElementById('btn-copy-src').addEventListener('click', () => {
    if (!editorLeft) return;
    navigator.clipboard.writeText(editorLeft.getValue()).then(() => {
      showToast('Copied active code!', 'success');
    });
  });

  document.getElementById('btn-copy-ir').addEventListener('click', () => {
    if (!editorRight) return;
    navigator.clipboard.writeText(editorRight.getValue()).then(() => {
      showToast('Copied output!', 'success');
    });
  });

  // Download buttons
  document.getElementById('btn-download-src').addEventListener('click', () => {
    const activeFile = getActiveFile();
    const content = (editorLeft && editorLeft.getValue) ? editorLeft.getValue() : activeFile.content;
    downloadFile(activeFile.name, content);
  });

  document.getElementById('btn-download-ir').addEventListener('click', () => {
    if (!editorRight) return;
    downloadFile('output.ir', editorRight.getValue());
  });

  // Font size buttons
  const changeFontSize = (delta) => {
    CONFIG.fontSize = Math.min(24, Math.max(10, CONFIG.fontSize + delta));
    saveConfigToLocalStorage();
    if (editorLeft && editorLeft.updateOptions) editorLeft.updateOptions({ fontSize: CONFIG.fontSize });
    if (editorRight && editorRight.updateOptions) editorRight.updateOptions({ fontSize: CONFIG.fontSize });
  };

  document.getElementById('btn-font-dec-left').addEventListener('click', () => changeFontSize(-1));
  document.getElementById('btn-font-inc-left').addEventListener('click', () => changeFontSize(1));
  document.getElementById('btn-font-dec-right').addEventListener('click', () => changeFontSize(-1));
  document.getElementById('btn-font-inc-right').addEventListener('click', () => changeFontSize(1));

  // Console Drawer toggling & drag resizing
  const drawer = document.getElementById('console-drawer');
  const drawerResizer = document.getElementById('drawer-resizer');
  const drawerToggle = document.getElementById('drawer-toggle');
  const toggleConsoleBtn = document.getElementById('toggle-console-btn');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  let isDraggingDrawer = false;
  let startDragY = 0;
  let startDrawerHeight = 180;
  let savedDrawerHeight = 180;

  if (drawerResizer && drawer) {
    drawerResizer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      isDraggingDrawer = true;
      drawerResizer.classList.add('dragging');
      startDragY = e.clientY;

      const currentHeight = drawer.offsetHeight;
      startDrawerHeight = currentHeight > 38 ? currentHeight : savedDrawerHeight;

      drawer.classList.remove('closed');
      drawer.style.height = `${startDrawerHeight}px`;
      drawer.style.transition = 'none';
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingDrawer) return;
      const delta = startDragY - e.clientY;
      const newHeight = Math.max(32, Math.min(window.innerHeight - 120, startDrawerHeight + delta));
      if (newHeight <= 38) {
        drawer.classList.add('closed');
        drawer.style.height = '';
      } else {
        drawer.classList.remove('closed');
        drawer.style.height = `${newHeight}px`;
        savedDrawerHeight = newHeight;
      }
      if (editorLeft && editorLeft.layout) editorLeft.layout();
      if (editorRight && editorRight.layout) editorRight.layout();
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingDrawer) {
        isDraggingDrawer = false;
        drawerResizer.classList.remove('dragging');
        drawer.style.transition = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (editorLeft && editorLeft.layout) editorLeft.layout();
        if (editorRight && editorRight.layout) editorRight.layout();
        try {
          localStorage.setItem('agc_drawer_state', JSON.stringify({
            closed: drawer.classList.contains('closed'),
            height: savedDrawerHeight
          }));
        } catch (_) { }
      }
    });
  }

  const toggleDrawer = () => {
    if (drawer.classList.contains('closed')) {
      drawer.classList.remove('closed');
      drawer.style.height = `${savedDrawerHeight}px`;
    } else {
      savedDrawerHeight = drawer.offsetHeight || savedDrawerHeight;
      drawer.classList.add('closed');
      drawer.style.height = '';
    }
    try {
      localStorage.setItem('agc_drawer_state', JSON.stringify({
        closed: drawer.classList.contains('closed'),
        height: savedDrawerHeight
      }));
    } catch (_) { }
    setTimeout(() => {
      if (editorLeft && editorLeft.layout) editorLeft.layout();
      if (editorRight && editorRight.layout) editorRight.layout();
    }, 200);
  };

  if (drawerToggle) drawerToggle.addEventListener('click', (e) => {
    if (e.target.closest('.drawer-resizer')) return;
    if (e.target.closest('#btn-clear-logs')) return;
    if (e.target.closest('#btn-collapse-toggle')) {
      toggleDrawer();
      return;
    }
    toggleDrawer();
  });
  if (toggleConsoleBtn) toggleConsoleBtn.addEventListener('click', toggleDrawer);

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', (e) => {
      e.stopPropagation();
      const output = document.getElementById('console-output');
      if (output) output.innerHTML = '';
      const count = document.getElementById('log-count');
      if (count) count.textContent = '0 messages';
    });
  }

  // Ensure state is saved when unloading page
  window.addEventListener('beforeunload', () => {
    saveToLocalStorage();
  });
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`, 'success');
}

// ============================================================================
// 8. ON DOM READY
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Restore Splitter position if saved
  try {
    const savedSplitter = localStorage.getItem('agc_splitter_pos');
    if (savedSplitter) {
      const leftPct = parseFloat(savedSplitter);
      if (!isNaN(leftPct) && leftPct > 10 && leftPct < 90) {
        const paneLeft = document.getElementById('pane-left');
        const paneRight = document.getElementById('pane-right');
        if (paneLeft && paneRight) {
          paneLeft.style.flex = `0 0 ${leftPct}%`;
          paneRight.style.flex = `0 0 ${100 - leftPct}%`;
        }
      }
    }
  } catch (_) { }

  // Restore Drawer state if saved
  try {
    const savedDrawer = localStorage.getItem('agc_drawer_state');
    if (savedDrawer) {
      const dState = JSON.parse(savedDrawer);
      const drawer = document.getElementById('console-drawer');
      if (drawer && dState) {
        if (dState.height && dState.height > 32) {
          savedDrawerHeight = dState.height;
        }
        if (dState.closed === false) {
          drawer.classList.remove('closed');
          drawer.style.height = `${dState.height || 180}px`;
        } else {
          drawer.classList.add('closed');
          drawer.style.height = '';
        }
      }
    }
  } catch (_) { }

  applyTheme(currentTheme);
  initSplitter();
  setupEventListeners();
  initMonaco();
  checkServerHealth();
});
