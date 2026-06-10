let problems = [];
let current = null;

const $ = (id) => document.getElementById(id);

async function api(path, options={}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function storageKey(slug) { return `boltz-mini-lc:${slug}`; }

function renderProblemList() {
  const list = $('problemList');
  list.innerHTML = '';
  problems.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'problem' + (current && current.slug === p.slug ? ' active' : '');
    div.innerHTML = `<div class="problem-title">${i + 1}. ${p.title}</div><div class="problem-meta">${p.difficulty} · ${p.pattern}</div>`;
    div.onclick = () => loadProblem(p.slug);
    list.appendChild(div);
  });
}

async function loadProblem(slug) {
  current = await api(`/api/problem/${slug}`);
  const idx = problems.findIndex(p => p.slug === slug) + 1;
  $('counter').textContent = `Custom Boltz Track: Question ${idx} / ${problems.length}`;
  $('title').textContent = current.title;
  $('difficulty').textContent = current.difficulty;
  $('pattern').textContent = current.pattern;
  $('prompt').textContent = current.prompt;
  $('editor').value = localStorage.getItem(storageKey(slug)) || current.starter;
  $('results').textContent = 'Results will appear here.';
  renderProblemList();
  syncEditorUI();
}

function setBusy(isBusy) {
  ['runBtn','submitBtn','resetBtn','saveBtn','undoBtn','redoBtn','commentBtn'].forEach(id => $(id).disabled = isBusy);
}

function formatResults(data) {
  if (data.error) return `ERROR: ${data.error}`;
  let s = `${data.passed === data.total ? '✅' : '❌'} ${data.passed}/${data.total} tests passed\n`;
  s += `Runtime: ${data.runtime_ms} ms\n`;
  s += `Peak memory: ${data.peak_kib} KiB\n`;
  if (data.stdout) s += `\nstdout:\n${data.stdout}\n`;
  s += '\n';
  data.tests.forEach((t, i) => {
    s += `${t.passed ? '✅' : '❌'} Test ${i + 1}: ${t.name}\n`;
    if (!t.passed) {
      if (t.error) s += `   Error: ${t.error}\n`;
      else {
        s += `   Expected: ${JSON.stringify(t.expected)}\n`;
        s += `   Got:      ${JSON.stringify(t.output)}\n`;
      }
    }
  });
  return s;
}

async function run(mode) {
  if (!current) return;
  const code = $('editor').value;
  localStorage.setItem(storageKey(current.slug), code);
  $('results').textContent = mode === 'run' ? 'Running examples...' : 'Submitting all tests...';
  setBusy(true);
  try {
    const data = await api(mode === 'run' ? '/api/run' : '/api/submit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({slug: current.slug, code})
    });
    $('results').textContent = formatResults(data);
  } catch (e) {
    $('results').textContent = `ERROR: ${e.message}`;
  } finally {
    setBusy(false);
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally from global import in is lambda nonlocal not or pass raise return try with yield'.split(' '));
const CONTROL = new Set('for if while elif else try except finally with async await'.split(' '));
const BUILTINS = new Set('abs all any bool dict enumerate filter float int len list map max min print range reversed round set sorted str sum tuple zip open isinstance type super defaultdict Counter deque heapq heappush heappop'.split(' '));

function span(cls, text) { return `<span class="${cls}">${escapeHtml(text)}</span>`; }
function isIdentStart(ch) { return /[A-Za-z_]/.test(ch); }
function isIdent(ch) { return /[A-Za-z0-9_]/.test(ch); }

function tokenizeLine(line) {
  let out = '';
  let i = 0;
  let expectFunctionName = false;
  let expectClassName = false;

  while (i < line.length) {
    const ch = line[i];

    if (ch === '#') {
      out += span('tok-comment', line.slice(i));
      break;
    }

    if (ch === '@' && (i === 0 || /\s/.test(line[i - 1]))) {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_\.]/.test(line[j])) j++;
      out += span('tok-decorator', line.slice(i, j));
      i = j;
      continue;
    }

    const maybePrefix = line.slice(i).match(/^([rRuUbBfF]{0,2})('''|\"\"\"|'|\")/);
    if (maybePrefix) {
      const prefix = maybePrefix[1];
      const quote = maybePrefix[2];
      let j = i + prefix.length + quote.length;
      let escaped = false;
      while (j < line.length) {
        if (!escaped && line.startsWith(quote, j)) { j += quote.length; break; }
        escaped = !escaped && line[j] === '\\';
        if (line[j] !== '\\') escaped = false;
        j++;
      }
      const cls = /f/i.test(prefix) ? 'tok-fstring' : 'tok-string';
      out += span(cls, line.slice(i, j));
      i = j;
      continue;
    }

    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < line.length && /[0-9_\.]/.test(line[j])) j++;
      out += span('tok-number', line.slice(i, j));
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < line.length && isIdent(line[j])) j++;
      const word = line.slice(i, j);
      if (expectFunctionName) {
        out += span('tok-function', word);
        expectFunctionName = false;
      } else if (expectClassName) {
        out += span('tok-class', word);
        expectClassName = false;
      } else if (word === 'def') {
        out += span('tok-keyword', word);
        expectFunctionName = true;
      } else if (word === 'class') {
        out += span('tok-keyword', word);
        expectClassName = true;
      } else if (CONTROL.has(word)) {
        out += span('tok-control', word);
      } else if (KEYWORDS.has(word)) {
        out += span('tok-keyword', word);
      } else if (word === 'self' || word === 'cls') {
        out += span('tok-self', word);
      } else if (BUILTINS.has(word)) {
        out += span('tok-builtin', word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    if ('()[]{}'.includes(ch)) { out += span('tok-bracket', ch); i++; continue; }
    if (':,'.includes(ch)) { out += span('tok-colon', ch); i++; continue; }
    if ('+-*/%=<>!&|^~'.includes(ch)) {
      let j = i + 1;
      while (j < line.length && '+-*/%=<>!&|^~'.includes(line[j])) j++;
      out += span('tok-operator', line.slice(i, j));
      i = j;
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }
  return out || ' ';
}

function getCursorLine() {
  const editor = $('editor');
  return editor.value.slice(0, editor.selectionStart || 0).split('\n').length;
}

function highlightPython(code) {
  const cursorLine = getCursorLine();
  return code.split('\n').map((line, idx) => {
    const html = tokenizeLine(line);
    return idx + 1 === cursorLine ? `<span class="current-line">${html}</span>` : html;
  }).join('\n');
}

function detectLanguage(code) {
  const lower = code.toLowerCase();
  if (/\b(def|class|import|from|self|elif|none|true|false|for|while)\b/.test(lower)) return 'Python';
  if (/\b(function|const|let|var|console\.log|=>)\b/.test(lower)) return 'JavaScript-ish';
  return 'Plain text';
}

function updateCursorBadge() {
  const editor = $('editor');
  const pos = editor.selectionStart || 0;
  const before = editor.value.slice(0, pos);
  const lines = before.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  $('cursorBadge').textContent = `Ln ${line}, Col ${col}`;
}

function updateLineNumbers() {
  const lines = $('editor').value.split('\n').length;
  $('lineNumbers').textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n') + '\n';
}

function syncEditorUI() {
  const editor = $('editor');
  $('highlight').innerHTML = highlightPython(editor.value);
  $('languageBadge').textContent = detectLanguage(editor.value);
  updateLineNumbers();
  updateCursorBadge();
  syncScroll();
}

function syncScroll() {
  const editor = $('editor');
  $('highlight').scrollTop = editor.scrollTop;
  $('highlight').scrollLeft = editor.scrollLeft;
  $('lineNumbers').scrollTop = editor.scrollTop;
}

function insertText(text) {
  const editor = $('editor');
  editor.focus();
  if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
    document.execCommand('insertText', false, text);
  } else {
    const start = editor.selectionStart, end = editor.selectionEnd;
    editor.setRangeText(text, start, end, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

function selectedLineRange() {
  const editor = $('editor');
  const value = editor.value;
  let start = editor.selectionStart;
  let end = editor.selectionEnd;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  return {lineStart, lineEnd};
}

function toggleComment() {
  const editor = $('editor');
  const {lineStart, lineEnd} = selectedLineRange();
  const block = editor.value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  const allCommented = nonEmpty.length > 0 && nonEmpty.every(l => /^\s*#/.test(l));
  const next = lines.map(l => {
    if (!l.trim()) return l;
    if (allCommented) return l.replace(/^(\s*)# ?/, '$1');
    return l.replace(/^(\s*)/, '$1# ');
  }).join('\n');
  editor.setRangeText(next, lineStart, lineEnd, 'select');
  editor.dispatchEvent(new Event('input'));
}

function currentIndent(line) {
  const m = line.match(/^\s*/);
  return m ? m[0] : '';
}

function handleEditorKeydown(e) {
  const editor = e.target;
  if ((e.metaKey || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    toggleComment();
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (editor.selectionStart !== editor.selectionEnd) {
      const {lineStart, lineEnd} = selectedLineRange();
      const block = editor.value.slice(lineStart, lineEnd);
      const lines = block.split('\n');
      const next = e.shiftKey
        ? lines.map(l => l.startsWith('    ') ? l.slice(4) : l.replace(/^\t/, '')).join('\n')
        : lines.map(l => '    ' + l).join('\n');
      editor.setRangeText(next, lineStart, lineEnd, 'select');
      editor.dispatchEvent(new Event('input'));
    } else {
      insertText('    ');
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    let indent = currentIndent(line);
    if (/:\s*(#.*)?$/.test(line.trimEnd())) indent += '    ';
    if (/^\s*(return|pass|break|continue|raise)\b/.test(line)) indent = indent.slice(0, Math.max(0, indent.length - 4));
    insertText('\n' + indent);
    return;
  }

  const pairs = {'(': ')', '[': ']', '{': '}', '"': '"', "'": "'"};
  if (pairs[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const start = editor.selectionStart, end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const text = e.key + selected + pairs[e.key];
    editor.setRangeText(text, start, end, 'end');
    editor.selectionStart = editor.selectionEnd = start + 1 + selected.length;
    editor.dispatchEvent(new Event('input'));
    return;
  }

  if (e.key === ')' || e.key === ']' || e.key === '}') {
    if (editor.value[editor.selectionStart] === e.key) {
      e.preventDefault();
      editor.selectionStart = editor.selectionEnd = editor.selectionStart + 1;
      syncEditorUI();
    }
  }
}

$('runBtn').onclick = () => run('run');
$('submitBtn').onclick = () => run('submit');
$('resetBtn').onclick = () => {
  if (!current) return;
  $('editor').value = current.starter;
  localStorage.setItem(storageKey(current.slug), current.starter);
  syncEditorUI();
};
$('saveBtn').onclick = async () => {
  if (!current) return;
  try {
    const code = $('editor').value;
    localStorage.setItem(storageKey(current.slug), code);
    await api('/api/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({slug: current.slug, code})
    });
    $('results').textContent = `Saved to submissions/${current.slug}.py`;
  } catch (e) {
    $('results').textContent = `ERROR: ${e.message}`;
  }
};
$('undoBtn').onclick = () => { $('editor').focus(); document.execCommand('undo'); syncEditorUI(); };
$('redoBtn').onclick = () => { $('editor').focus(); document.execCommand('redo'); syncEditorUI(); };
$('commentBtn').onclick = () => toggleComment();

$('editor').addEventListener('keydown', handleEditorKeydown);
$('editor').addEventListener('input', () => {
  if (current) localStorage.setItem(storageKey(current.slug), $('editor').value);
  syncEditorUI();
});
$('editor').addEventListener('scroll', syncScroll);
$('editor').addEventListener('click', syncEditorUI);
$('editor').addEventListener('keyup', syncEditorUI);
$('editor').addEventListener('select', updateCursorBadge);

(async function init() {
  problems = await api('/api/problems');
  await loadProblem(problems[0].slug);
})();
