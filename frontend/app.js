const ROLE_NAMES = {
  editor_in_chief:      '主编',
  writer:               '作家',
  critic:               '批评家',
  consistency_officer:  '一致性委员',
  polisher:             '润色师',
};

const MODE_NAMES = {
  outline:         '大纲',
  draft:           '初稿',
  review:          '审稿',
  check:           '校对',
  revise:          '修订',
  polish:          '润色',
  finalize:        '终审',
  chapter_summary: '章节摘要',
};

const DECISION_TYPE_NAMES = {
  character_fate:   '角色命运',
  plot_pivot:       '情节转折',
  world_extension:  '世界观扩展',
  internal_dispute: '委员会争议',
  character_evolution: '角色演化',
};

const REVERSIBILITY_NAMES = {
  low:    '不可逆',
  medium: '可修正',
  high:   '可撤销',
};

const PROGRESS_STEPS = [
  { key: 'outline',          label: '大纲' },
  { key: 'draft',            label: '初稿' },
  { key: 'review',           label: '审稿' },
  { key: 'check',            label: '校对' },
  { key: 'review_decision',  label: '审阅' },
  { key: 'revise',           label: '修订' },
  { key: 'polish',           label: '润色' },
  { key: 'finalize',         label: '终审' },
  { key: 'summary',          label: '摘要' },
];

// ── 错误消息人话化 ────────────────────────────────────────────────────────────

const ERROR_PATTERNS = [
  { re: /json.*(?:parse|pars)/i,          friendly: 'AI 输出格式异常，请重试', },
  { re: /API key.*未配置/i,               friendly: '请先在设置中配置 API Key', },
  { re: /API key/i,                        friendly: '请先在设置中配置 API Key', },
  { re: /rate limit|too many/i,            friendly: 'API 调用过于频繁，请稍后再试', },
  { re: /timeout/i,                        friendly: 'API 响应超时，请检查网络或稍后重试', },
  { re: /401|unauthorized|unauth/i,        friendly: 'API Key 无效或已过期，请检查设置', },
  { re: /402|insufficient/i,               friendly: 'API 额度不足，请检查账户余额', },
  { re: /429/i,                            friendly: 'API 调用过于频繁，请稍后再试', },
  { re: /500|internal server error/i,      friendly: 'AI 服务端异常，请稍后重试', },
  { re: /connection|connect.*refuse/i,     friendly: '无法连接到服务器，请确认后端正在运行', },
  { re: /network|fetch|request.*fail/i,    friendly: '网络请求失败，请检查网络连接', },
  { re: /WebSocket/i,                      friendly: '与服务器的连接已断开，请刷新页面重试', },
];

function friendlyError(msg) {
  if (!msg) return { friendly: '未知错误', detail: null };
  for (const p of ERROR_PATTERNS) {
    if (p.re.test(msg)) {
      return { friendly: p.friendly, detail: msg !== p.friendly ? msg : null };
    }
  }
  return { friendly: msg, detail: null };
}

function renderErrorHtml(msg) {
  const { friendly, detail } = friendlyError(msg);
  let html = `<span style="color:#c06060">${escHtml(friendly)}</span>`;
  if (detail) {
    html += `<button class="error-detail-toggle" onclick="this.nextElementSibling.classList.toggle('hidden')">详情</button>`;
    html += `<div class="error-detail hidden">${escHtml(detail)}</div>`;
  }
  return html;
}

// ── Tab 切换 ───────────────────────────────────────────────────────────────────

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.sidebar-nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
  updateShortcutsHint();
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitTrim(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

// ── 项目管理 ───────────────────────────────────────────────────────────────────

let currentProject = '';
let _projectList = [];

// ── 状态更新 ──────────────────────────────────────────────────────────────────

function updateStatus(status, context) {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  const ctx = document.getElementById('status-context');
  const icons = { ready: '🟢', running: '🟡', error: '🔴' };
  const labels = { ready: '就绪', running: '运行中', error: '错误' };
  indicator.textContent = icons[status] || '🟢';
  text.textContent = labels[status] || status;
  ctx.textContent = context || '';
}

// ── 模式切换 (Phase 3) ────────────────────────────────────────────────────────

function setEditorMode(mode) {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  layout.classList.remove('mode-creation', 'mode-debate');
  layout.classList.add(`mode-${mode}`);
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  localStorage.setItem('editorMode', mode);
  // Brief fade animation
  layout.classList.remove('mode-switching');
  void layout.offsetWidth;
  layout.classList.add('mode-switching');
}

function initModeToggle() {
  const saved = localStorage.getItem('editorMode') || 'creation';
  // Apply saved mode without animation on first load
  const layout = document.querySelector('.layout');
  if (!layout) return;
  layout.classList.remove('mode-creation', 'mode-debate');
  layout.classList.add(`mode-${saved}`);
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === saved));

  // Click handlers (with animation)
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setEditorMode(btn.dataset.mode));
  });
  // Instruction bar toggle in creation mode
  const instrBar = document.getElementById('instruction-bar');
  const instrHandle = document.getElementById('instruction-bar-handle');
  if (instrHandle && instrBar) {
    instrHandle.addEventListener('click', (e) => {
      // Don't toggle if clicking the next-round-btn
      if (e.target.closest('#next-round-btn')) return;
      instrBar.classList.toggle('collapsed');
    });
  }
}

// ── 正文渲染 (Phase 3) ────────────────────────────────────────────────────────

function setSceneText(text, roundNum, rewriteCount) {
  const container = document.getElementById('scene-text');
  container.innerHTML = '';
  if (!text) {
    container.innerHTML = '<p class="placeholder">成品将在这里显示。</p>';
    updateSceneMeta(null);
    return;
  }
  const paragraphs = text.split(/\n\s*\n/).filter(b => b.trim());
  paragraphs.forEach(pText => {
    const p = document.createElement('p');
    p.textContent = pText;
    container.appendChild(p);
  });
  updateSceneMeta(roundNum || 0, text.length, rewriteCount || 0);
  // Update header title
  const title = document.getElementById('scene-text-title');
  if (roundNum) {
    title.textContent = `第${roundNum}轮 · ${paragraphs.length}段`;
  } else {
    title.textContent = '';
  }
}

function updateSceneMeta(roundNum, charCount, rewriteCount) {
  const meta = document.getElementById('scene-text-meta');
  if (roundNum == null || roundNum === 0) {
    meta.classList.add('hidden');
    return;
  }
  meta.classList.remove('hidden');
  meta.textContent = `第${roundNum}轮 · 字数${charCount} · 状态待审 · 修改${rewriteCount || 0}处`;
}

function getSceneTextPlain() {
  const container = document.getElementById('scene-text');
  const ps = container.querySelectorAll('p:not(.placeholder)');
  return Array.from(ps).map(p => p.textContent).join('\n\n');
}

function addCharacterRow(container, data = {}) {
  const row = document.createElement('div');
  row.className = 'character-row';
  row.innerHTML = `
    <button class="remove-char" title="删除">×</button>
    <input class="char-name"  type="text" placeholder="姓名"             value="${escHtml(data.name        || '')}">
    <input class="char-role"  type="text" placeholder="身份（主角/配角）" value="${escHtml(data.role        || '')}">
    <input class="char-desc"  type="text" placeholder="角色描述"          value="${escHtml(data.description || '')}">
    <input class="char-voice" type="text" placeholder="说话语气"          value="${escHtml(data.voice       || '')}">
  `;
  row.querySelector('.remove-char').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectCharacters(container) {
  return Array.from(container.querySelectorAll('.character-row')).map(row => ({
    name: row.querySelector('.char-name').value.trim(),
    role: row.querySelector('.char-role').value.trim(),
    description: row.querySelector('.char-desc').value.trim(),
    voice: row.querySelector('.char-voice').value.trim(),
  })).filter(c => c.name);
}

async function loadProjectList() {
  const select = document.getElementById('project-select');
  const sidebarList = document.getElementById('sidebar-project-list');

  // Show skeleton while loading
  showSkeleton(sidebarList, 3, 'card');

  try {
    const res = await fetch('/api/projects');
    const list = await res.json();
    select.innerHTML = '<option value="">— 请选择项目 —</option>';
    list.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.slug;
      opt.textContent = `${p.name}（${p.round_count}轮）`;
      select.appendChild(opt);
    });
    populateSidebarProjects(list);
    _projectList = list;

    // Empty state
    if (!list.length) {
      showEmptyState(sidebarList, '📚', '暂无项目', '创建你的第一个项目开始写作', '+ 新建项目', () => {
        document.getElementById('new-project-btn')?.click();
      });
    }

    return list;
  } catch {
    return [];
  }
}

async function selectProject(slug) {
  currentProject = slug;
  document.getElementById('se-project-name').textContent = slug;
  document.getElementById('topbar-project').textContent = `📖 ${slug}`;

  // 更新轮次徽章
  const projInfo = _projectList.find(p => p.slug === slug);
  if (projInfo && projInfo.round_count > 0) {
    document.getElementById('round-badge').textContent = `${projInfo.round_count}轮`;
    document.getElementById('round-badge').classList.remove('hidden');
  } else {
    document.getElementById('round-badge').classList.add('hidden');
  }

  updateStatus('ready', `项目：${slug}`);

  // 侧栏高亮当前项目
  document.querySelectorAll('.sidebar-project-item').forEach(el => {
    el.classList.toggle('active', el.dataset.slug === slug);
  });
  // 加载最新一轮成品到右侧成品区
  const sceneText = document.getElementById('scene-text');
  const nextBtn = document.getElementById('next-round-btn');
  sceneText.innerHTML = '<p class="placeholder">加载中…</p>';
  nextBtn.classList.add('hidden');
  try {
    const outRes = await fetch(`/api/projects/${slug}/output`);
    const { content: mdContent } = await outRes.json();
    const sections = mdContent.split(/(?=^# 第)/m).filter(s => s.trim());
    if (sections.length > 0) {
      const last = sections[sections.length - 1];
      const lines = last.split('\n');
      // 跳过标题行，找到正文（第一个空行后到 --- 前）
      const bodyLines = [];
      let inBody = false;
      for (const line of lines.slice(1)) {
        if (!inBody && line.trim() === '') { inBody = true; continue; }
        if (inBody) {
          if (line.startsWith('---')) break;
          bodyLines.push(line);
        }
      }
      const body = bodyLines.join('\n').trim();
      if (body) {
        const roundNum = projInfo?.round_count || 0;
        setSceneText(body, roundNum, 0);
        nextBtn.dataset.sceneText = body;
      } else {
        setSceneText('');
      }
    } else {
      setSceneText('');
    }
  } catch {
    setSceneText('');
  }

  // Load settings editor
  try {
    const [worldRes, charsRes] = await Promise.all([
      fetch(`/api/projects/${slug}/world`),
      fetch(`/api/projects/${slug}/characters`),
    ]);
    const world = await worldRes.json();
    const chars = await charsRes.json();

    document.getElementById('se-title').value = world.title || '';
    document.getElementById('se-genre').value = world.genre || '';
    document.getElementById('se-world-view').value = world.world_view || '';
    document.getElementById('se-style-tone').value = world.style?.tone || '';
    document.getElementById('se-style-pace').value = world.style?.pace || '';
    document.getElementById('se-style-pov').value = world.style?.pov || '';
    document.getElementById('se-forbidden').value = (world.constraints?.forbidden_themes || []).join(', ');

    const charList = document.getElementById('se-characters-list');
    charList.innerHTML = '';
    (chars.characters || []).forEach(c => addCharacterRow(charList, c));

    document.getElementById('settings-no-project').classList.add('hidden');
    document.getElementById('settings-editor').classList.remove('hidden');

    // Update history tab + 上轮摘要
    loadHistory(slug);
    loadPrevSummary(slug);
  } catch (e) {
    console.error('加载项目设定失败', e);
  }
}

async function loadPrevSummary(slug) {
  const preview = document.getElementById('prev-summary-preview');
  const textEl = preview.querySelector('.prev-summary-text');
  try {
    const res = await fetch(`/api/projects/${slug}/memory`);
    const mem = await res.json();
    const summaries = mem.summaries || [];
    if (summaries.length > 0) {
      textEl.textContent = summaries[summaries.length - 1];
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }
  } catch {
    preview.classList.add('hidden');
  }
}

async function createNewProject(data) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ── 设定 Tab：保存 ────────────────────────────────────────────────────────────

async function saveSettingsTab() {
  const slug = currentProject;
  if (!slug) return;

  const world = {
    title: document.getElementById('se-title').value.trim(),
    genre: document.getElementById('se-genre').value.trim(),
    world_view: document.getElementById('se-world-view').value.trim(),
    style: {
      tone: document.getElementById('se-style-tone').value.trim(),
      pace: document.getElementById('se-style-pace').value.trim(),
      pov: document.getElementById('se-style-pov').value.trim(),
    },
    constraints: {
      forbidden_themes: splitTrim(document.getElementById('se-forbidden').value),
      forbidden_devices: [],
    },
  };
  const chars = {
    characters: collectCharacters(document.getElementById('se-characters-list')),
  };

  try {
    await Promise.all([
      fetch(`/api/projects/${slug}/world`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(world),
      }),
      fetch(`/api/projects/${slug}/characters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chars),
      }),
    ]);
    const msg = document.getElementById('se-msg');
    msg.textContent = '已保存';
    setTimeout(() => { msg.textContent = ''; }, 2000);
    // Refresh project list and re-select current project
    const savedSlug = slug;
    loadProjectList().then(() => {
      const sel = document.getElementById('project-select');
      if (sel.value !== savedSlug) {
        sel.value = savedSlug;
      }
    });
  } catch (e) {
    document.getElementById('se-msg').textContent = '保存失败：' + e.message;
  }
}

// ── 创作 Tab：表单收集 ────────────────────────────────────────────────────────

function collectFormData() {
  return {
    project_name: currentProject,
    brief: {
      scene_brief:          document.getElementById('scene-brief').value.trim(),
      target_length:        parseInt(document.getElementById('target-length').value, 10),
      special_instruction:  document.getElementById('special-instruction').value.trim(),
      prev_summary:         document.getElementById('prev-summary').value.trim(),
      last_paragraph:       document.getElementById('last-paragraph').value.trim(),
    },
  };
}

// ── 格式化辩论卡片展示 ──────────────────────────────────────────────────────────

function formatStepOutput(role, mode, output) {
  let obj;
  try { obj = JSON.parse(output); } catch { return escHtml(output); }

  const h = escHtml;
  const parts = [];

  if (role === 'editor_in_chief' && mode === 'outline') {
    parts.push('<div class="formatted-step">');
    parts.push(`<div class="fs-row"><span class="fs-label">场景核心</span><span class="fs-value">${h(obj.scene_summary || '')}</span></div>`);
    parts.push(`<div class="fs-row"><span class="fs-label">基调</span><span class="fs-value">${h(obj.tone || '')}</span></div>`);
    if (obj.beats) {
      parts.push('<div class="fs-section">节拍</div>');
      obj.beats.forEach(b => {
        parts.push(`<div class="fs-beat"><span class="fs-beat-num">${h(b.id)}.</span> ${h(b.description || '')} <span class="fs-beat-purpose">（${h(b.purpose || '')}）</span></div>`);
      });
    }
    if (obj.notes_for_writer) parts.push(`<div class="fs-row"><span class="fs-label">作家提醒</span><span class="fs-value">${h(obj.notes_for_writer)}</span></div>`);
    parts.push('</div>');
    return parts.join('\n');
  }

  if (role === 'critic' && mode === 'review') {
    parts.push('<div class="formatted-step">');
    const vc = obj.verdict === 'needs_revision' ? 'fs-verdict-bad' : 'fs-verdict-good';
    parts.push(`<div class="fs-row"><span class="fs-label">判定</span><span class="${vc}">${obj.verdict === 'needs_revision' ? '需要修订' : '通过'}</span></div>`);
    parts.push(`<div class="fs-row"><span class="fs-label">总评</span><span class="fs-value">${h(obj.summary || '')}</span></div>`);
    if (obj.highlights && obj.highlights.length) {
      parts.push('<div class="fs-section">亮点</div>');
      obj.highlights.forEach(hl => parts.push(`<div class="fs-item fs-highlight">⭐ ${h(hl.location || '')} — ${h(hl.reason || '')}</div>`));
    }
    if (obj.issues && obj.issues.length) {
      parts.push('<div class="fs-section">问题</div>');
      const sm = { critical: '严重', major: '重要', minor: '轻微' };
      obj.issues.forEach(issue => parts.push(`<div class="fs-item fs-issue-${issue.severity || 'minor'}">[${sm[issue.severity] || issue.severity}] ${h(issue.problem || '')}<br><span class="fs-location">位置：${h(issue.location || '')}</span></div>`));
    }
    parts.push('</div>');
    return parts.join('\n');
  }

  if (role === 'consistency_officer' && mode === 'check') {
    parts.push('<div class="formatted-step">');
    const vc = obj.verdict === 'violations_found' ? 'fs-verdict-bad' : 'fs-verdict-good';
    parts.push(`<div class="fs-row"><span class="fs-label">判定</span><span class="${vc}">${obj.verdict === 'violations_found' ? '发现矛盾' : '一致'}</span></div>`);
    parts.push(`<div class="fs-row"><span class="fs-label">总评</span><span class="fs-value">${h(obj.summary || '')}</span></div>`);
    if (obj.violations && obj.violations.length) {
      parts.push('<div class="fs-section">矛盾</div>');
      const sm = { critical: '严重', major: '重要', minor: '轻微' };
      obj.violations.forEach(v => parts.push(`<div class="fs-item fs-issue-${v.severity || 'minor'}">[${sm[v.severity] || v.severity}] ${h(v.violation || '')}<br><span class="fs-location">违反：${h(v.reference || '')}</span></div>`));
    }
    parts.push('</div>');
    return parts.join('\n');
  }

  if (role === 'editor_in_chief' && mode === 'review') {
    parts.push('<div class="formatted-step">');
    const dm = { approve_draft: '通过初稿', request_revision: '要求修订' };
    const dc = obj.decision === 'request_revision' ? 'fs-verdict-bad' : 'fs-verdict-good';
    parts.push(`<div class="fs-row"><span class="fs-label">决策</span><span class="${dc}">${dm[obj.decision] || obj.decision}</span></div>`);
    parts.push(`<div class="fs-row"><span class="fs-label">理由</span><span class="fs-value">${h(obj.rationale || '')}</span></div>`);
    if (obj.revision_instructions) parts.push(`<div class="fs-row"><span class="fs-label">修订指令</span><span class="fs-value">${h(obj.revision_instructions)}</span></div>`);
    parts.push('</div>');
    return parts.join('\n');
  }

  if (role === 'editor_in_chief' && (mode === 'finalize' || mode === 'chapter_summary')) {
    if (obj.major_decisions && obj.major_decisions.length) {
      parts.push('<div class="formatted-step">');
      parts.push('<div class="fs-section">重大决策</div>');
      const tm = { character_fate: '角色命运', plot_pivot: '情节转折', world_extension: '世界观扩展', internal_dispute: '委员会争议' };
      obj.major_decisions.forEach(d => parts.push(`<div class="fs-item"><strong>[${tm[d.type] || d.type}]</strong> ${h(d.description || '')}<br><span class="fs-location">可逆性：${h(d.reversibility || 'N/A')}</span></div>`));
      parts.push('</div>');
      return parts.join('\n');
    }
    return '<div class="formatted-step"><em>本轮无重大决策。</em></div>';
  }

  return escHtml(output);
}

// ── 辩论卡片 (Phase 4) ───────────────────────────────────────────────────────

function createDebateCard(entry) {
  const card = document.createElement('div');
  card.className = 'debate-card';
  card.dataset.role = entry.role;
  card.dataset.mode = entry.mode;
  card.dataset.startTime = Date.now();

  const roleName = ROLE_NAMES[entry.role] || entry.role;
  const modeName = MODE_NAMES[entry.mode] || entry.mode;
  const bodyHtml = formatStepOutput(entry.role, entry.mode, entry.output);
  const preview = getCardPreview(entry);

  card.innerHTML = `
    <div class="debate-card-header">
      <span class="dc-status dc-status-done">✓</span>
      <span class="dc-role">${escHtml(roleName)}</span>
      <span class="dc-mode">${escHtml(modeName)}</span>
      <span class="dc-time">0s</span>
      <span class="dc-summary">${escHtml(preview)}</span>
      <span class="dc-expand-icon">▶</span>
    </div>
    <div class="debate-card-body">${bodyHtml}</div>
  `;

  card.querySelector('.debate-card-header').addEventListener('click', () => {
    card.classList.toggle('expanded');
  });

  return card;
}

function appendDebateCard(entry) {
  const container = document.getElementById('debate-log');
  const card = createDebateCard(entry);
  container.appendChild(card);
  container.scrollTop = container.scrollHeight;

  // Mirror to PiP if active
  if (isPipActive()) {
    const pipLog = document.getElementById('pip-debate-log');
    const pipCard = createDebateCard(entry);
    pipLog.appendChild(pipCard);
    pipLog.scrollTop = pipLog.scrollHeight;
  }
}

function getCardPreview(entry) {
  try {
    const obj = JSON.parse(entry.output);
    if (obj.summary) return obj.summary.slice(0, 60) + (obj.summary.length > 60 ? '…' : '');
    if (obj.scene_summary) return obj.scene_summary.slice(0, 60) + (obj.scene_summary.length > 60 ? '…' : '');
    if (obj.rationale) return obj.rationale.slice(0, 60) + (obj.rationale.length > 60 ? '…' : '');
  } catch { /* plain text */ }
  const text = entry.output || '';
  return text.slice(0, 60) + (text.length > 60 ? '…' : '');
}

// ── 卡片计时器 ────────────────────────────────────────────────────────────────

let _runStartTime = null;
let _runTimerInterval = null;

function startRunTimer() {
  _runStartTime = Date.now();
  if (_runTimerInterval) clearInterval(_runTimerInterval);
  _runTimerInterval = setInterval(() => {
    if (!_runStartTime) return;
    const elapsed = Math.floor((Date.now() - _runStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    const el = document.getElementById('ring-total-time');
    if (el) el.innerHTML = `<strong>${min > 0 ? `${min}m` : ''}${sec}s</strong>`;

    // Update individual card timers
    document.querySelectorAll('.debate-card').forEach(card => {
      const ts = card.dataset.startTime;
      if (ts) {
        const cardElapsed = Math.floor((Date.now() - parseInt(ts)) / 1000);
        const timeEl = card.querySelector('.dc-time');
        if (timeEl) {
          const m = Math.floor(cardElapsed / 60);
          const s = cardElapsed % 60;
          timeEl.textContent = m > 0 ? `${m}m${s}s` : `${s}s`;
        }
      }
    });
  }, 1000);
}

function stopRunTimer() {
  if (_runTimerInterval) {
    clearInterval(_runTimerInterval);
    _runTimerInterval = null;
  }
  _runStartTime = null;
}

// ── 画中画 (Phase 4) ─────────────────────────────────────────────────────────

function initPip() {
  const pinBtn = document.getElementById('pip-pin-btn');
  const unpinBtn = document.getElementById('pip-unpin');
  const minimizeBtn = document.getElementById('pip-minimize');
  const pipIcon = document.getElementById('pip-icon');

  if (pinBtn) pinBtn.addEventListener('click', pinDebate);
  if (unpinBtn) unpinBtn.addEventListener('click', unpinDebate);
  if (minimizeBtn) minimizeBtn.addEventListener('click', togglePipMinimize);
  if (pipIcon) pipIcon.addEventListener('click', restoreFromMinimized);

  // Restore saved state
  const savedPip = localStorage.getItem('pipActive');
  if (savedPip === 'true') {
    document.getElementById('pip-overlay').classList.remove('hidden');
    if (pinBtn) pinBtn.classList.add('active');
  }

  // Restore saved position
  const savedPos = localStorage.getItem('pipPosition');
  if (savedPos) {
    try {
      const pos = JSON.parse(savedPos);
      const overlay = document.getElementById('pip-overlay');
      if (pos.left) overlay.style.left = pos.left;
      if (pos.top) overlay.style.top = pos.top;
      if (pos.bottom) overlay.style.bottom = pos.bottom;
      if (pos.right) overlay.style.right = pos.right;
    } catch { /* ignore */ }
  }

  makePipDraggable();
}

function isPipActive() {
  const overlay = document.getElementById('pip-overlay');
  return overlay && !overlay.classList.contains('hidden') && !overlay.classList.contains('minimized');
}

function pinDebate() {
  const overlay = document.getElementById('pip-overlay');
  overlay.classList.remove('hidden', 'minimized');
  document.getElementById('pip-icon').classList.add('hidden');
  document.getElementById('pip-pin-btn').classList.add('active');
  localStorage.setItem('pipActive', 'true');
  syncPipContent();
}

function unpinDebate() {
  document.getElementById('pip-overlay').classList.add('hidden');
  document.getElementById('pip-icon').classList.add('hidden');
  document.getElementById('pip-pin-btn').classList.remove('active');
  localStorage.setItem('pipActive', 'false');
}

function togglePipMinimize() {
  const overlay = document.getElementById('pip-overlay');
  const icon = document.getElementById('pip-icon');
  if (overlay.classList.contains('minimized')) {
    overlay.classList.remove('minimized');
    icon.classList.add('hidden');
  } else {
    overlay.classList.add('minimized');
    icon.classList.remove('hidden');
  }
}

function restoreFromMinimized() {
  document.getElementById('pip-overlay').classList.remove('minimized');
  document.getElementById('pip-icon').classList.add('hidden');
}

function syncPipContent() {
  const pipLog = document.getElementById('pip-debate-log');
  pipLog.innerHTML = '';
  document.querySelectorAll('#debate-log .debate-card').forEach(card => {
    const entry = {
      role: card.dataset.role,
      mode: card.dataset.mode || '',
      output: card.querySelector('.debate-card-body')?.textContent || '',
    };
    const pipCard = createDebateCard(entry);
    pipLog.appendChild(pipCard);
  });
}

function makePipDraggable() {
  const el = document.getElementById('pip-overlay');
  const header = el.querySelector('.pip-header');
  if (!header) return;

  let isDragging = false;
  let startX, startY, origX, origY;

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const rect = el.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origX = rect.left;
    origY = rect.top;
    el.style.left = origX + 'px';
    el.style.top = origY + 'px';
    el.style.bottom = 'auto';
    el.style.right = 'auto';

    const onMove = (ev) => {
      if (!isDragging) return;
      el.style.left = (origX + ev.clientX - startX) + 'px';
      el.style.top = (origY + ev.clientY - startY) + 'px';
    };
    const onUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('pipPosition', JSON.stringify({
        left: el.style.left, top: el.style.top,
        bottom: el.style.bottom, right: el.style.right,
      }));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── 渲染重大决策 ──────────────────────────────────────────────────────────────

function renderDecisions(decisions) {
  const container = document.getElementById('decisions');
  container.innerHTML = '';

  if (!decisions.length) {
    container.innerHTML = '<p class="placeholder" style="padding:8px 0">本轮无重大决策。</p>';
    return;
  }

  decisions.forEach(d => {
    const card = document.createElement('div');
    card.className = 'decision-card';

    if (d.type === 'character_evolution') {
      card.innerHTML = `
        <div class="decision-type">角色演化</div>
        <div class="decision-desc">${escHtml(d.description)}</div>
        <div class="decision-evi" style="font-size:11px;color:#999;margin-top:4px;">证据：${escHtml(d.evidence)}</div>
        <button class="adopt-evolution-btn" style="margin-top:8px;background:#2d5a3a;border:none;border-radius:4px;color:#fff;font-size:11px;font-weight:600;padding:4px 12px;cursor:pointer;">采纳</button>
      `;
      const btn = card.querySelector('.adopt-evolution-btn');
      btn.dataset.character = d.character;
      btn.dataset.trait = d.new_trait;
      btn.dataset.evidence = d.evidence;
      btn.dataset.category = d.category || 'personality';
      btn.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = '采纳中…';
        try {
          const res = await fetch(`/api/projects/${currentProject}/adopt_evolution`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: b.dataset.character,
              new_trait: b.dataset.trait,
              evidence: b.dataset.evidence,
              category: b.dataset.category,
            }),
          });
          const data = await res.json();
          if (data.ok) {
            b.textContent = '已采纳 ✓';
            b.style.background = '#2d5080';
          } else {
            b.textContent = '采纳失败';
            b.disabled = false;
          }
        } catch {
          b.textContent = '网络错误';
          b.disabled = false;
        }
      });
    } else {
      const typeName = DECISION_TYPE_NAMES[d.type] || d.type;
      const revName  = REVERSIBILITY_NAMES[d.reversibility] || d.reversibility;
      card.innerHTML = `
        <div class="decision-type">${escHtml(typeName)}</div>
        <div class="decision-desc">${escHtml(d.description)}</div>
        <div class="decision-rev">可逆性：${escHtml(revName)}</div>
      `;
    }

    container.appendChild(card);
  });
}

// ── 环形进度条 (Phase 4) ──────────────────────────────────────────────────────

const RING_CIRCUMFERENCE = 2 * Math.PI * 42; // ≈ 263.89

function buildRingProgress() {
  const fill = document.getElementById('ring-fill');
  if (!fill) return;
  fill.style.strokeDasharray = RING_CIRCUMFERENCE;
  fill.style.strokeDashoffset = RING_CIRCUMFERENCE;
  document.getElementById('ring-round').textContent = '';
  document.getElementById('ring-pct').textContent = '0%';
  document.getElementById('ring-steps').textContent = '0/' + PROGRESS_STEPS.length;
  document.getElementById('ring-member').textContent = '—';
  document.getElementById('ring-total-time').innerHTML = '';
  document.getElementById('progress-ring').classList.remove('hidden');
}

function updateRingProgress(completedCount, total, currentRole) {
  const fill = document.getElementById('ring-fill');
  if (!fill) return;
  const progress = total > 0 ? completedCount / total : 0;
  const offset = RING_CIRCUMFERENCE * (1 - Math.min(progress, 1));
  fill.style.strokeDashoffset = offset;

  document.getElementById('ring-pct').textContent = Math.round(progress * 100) + '%';
  document.getElementById('ring-steps').textContent = `${completedCount}/${total}`;

  const roleName = ROLE_NAMES[currentRole] || currentRole || '';
  document.getElementById('ring-member').innerHTML = roleName
    ? `<strong>${escHtml(roleName)}</strong>` : '—';
}

// ── 主流程（WebSocket）────────────────────────────────────────────────────────

function runDecision() {
  if (!currentProject) {
    alert('请先选择项目');
    return;
  }

  const btn       = document.getElementById('run-btn');
  const debateLog = document.getElementById('debate-log');
  const sceneText = document.getElementById('scene-text');
  const decisions = document.getElementById('decisions');
  const usageEl   = document.getElementById('usage-display');

  btn.disabled    = true;
  btn.textContent = '创作中…';
  updateStatus('running', '创作中…');
  debateLog.innerHTML = '<p class="loading-msg">委员会正在开会，请稍候…</p>';
  setSceneText('');
  decisions.innerHTML   = '';
  usageEl.classList.add('hidden');

  // 初始化环形进度 + 计时器
  buildRingProgress();
  _progressStep = -1;
  startRunTimer();

  // 步骤 key → 进度索引 映射
  const STEP_KEY_MAP = {
    'outline': 0, 'draft': 1, 'review': 2, 'check': 3,
    'review_decision': 4, 'revise': 5, 'polish': 6, 'finalize': 7, 'chapter_summary': 8,
  };
  // role+mode → stepKey 映射
  const STEP_EVENT_MAP = {
    'editor_in_chief+outline': 'outline',
    'writer+draft': 'draft',
    'critic+review': 'review',
    'consistency_officer+check': 'check',
    'editor_in_chief+review': 'review_decision',
    'writer+revise': 'revise',
    'polisher+polish': 'polish',
    'editor_in_chief+finalize': 'finalize',
    'editor_in_chief+chapter_summary': 'summary',
  };

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/run`);
  _currentRunWs = ws;  // 保存给重试对话框使用
  let firstStep = true;

  ws.onopen = () => {
    ws.send(JSON.stringify(collectFormData()));
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'step') {
      if (firstStep) {
        debateLog.innerHTML = '';
        firstStep = false;
      }
      appendDebateCard(msg);

      // 更新环形进度
      const stepKey = STEP_EVENT_MAP[msg.role + '+' + msg.mode];
      if (stepKey !== undefined) {
        const idx = STEP_KEY_MAP[stepKey];
        if (idx !== undefined) {
          _progressStep = idx;
          updateRingProgress(_progressStep + 1, PROGRESS_STEPS.length, msg.role);
        }
      }

    } else if (msg.type === 'done') {
      const _newRoundNum = (() => {
        const _badge = document.getElementById('round-badge');
        const _m = _badge.textContent.match(/(\d+)轮/);
        return _m ? parseInt(_m[1]) + 1 : 1;
      })();
      setSceneText(msg.scene_text, _newRoundNum, 0);
      renderDecisions(msg.major_decisions);

      // 标记环形进度全部完成 + 停止计时
      updateRingProgress(PROGRESS_STEPS.length, PROGRESS_STEPS.length, '');
      stopRunTimer();

      const nBtn = document.getElementById('next-round-btn');
      nBtn.dataset.sceneText = msg.scene_text;
      nBtn.dataset.chapterSummary = msg.chapter_summary || '';
      nBtn.classList.remove('hidden');

      if (msg.chapter_summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'chapter-summary';
        summaryEl.innerHTML = '<strong>本回摘要</strong><p>' + escHtml(msg.chapter_summary) + '</p>';
        decisions.insertAdjacentElement('afterbegin', summaryEl);
      }

      // 显示用量
      if (msg.usage) {
        const u = msg.usage;
        usageEl.innerHTML = `本轮已用 <strong>${(u.input_tokens + u.output_tokens).toLocaleString()}</strong> tokens`;
        usageEl.classList.remove('hidden');
      }

      // 刷新项目选择器的轮次数和上轮摘要
      loadProjectList().then(() => {
        if (currentProject) {
          document.getElementById('project-select').value = currentProject;
        }
      });
      if (currentProject) loadPrevSummary(currentProject);

      // 更新轮次徽章
      const badge = document.getElementById('round-badge');
      const match = badge.textContent.match(/(\d+)轮/);
      const currentCount = match ? parseInt(match[1]) : 0;
      badge.textContent = `${Math.max(currentCount, 0) + 1}轮`;
      badge.classList.remove('hidden');

      updateStatus('ready', '本轮完成');

      // 启用按钮并设为"继续下一轮"
      btn.disabled = false;
      btn.textContent = '继续下一轮';

    } else if (msg.type === 'step_error') {
      // 显示重试对话框
      const roleName = ROLE_NAMES[msg.role] || msg.role;
      const modeName = MODE_NAMES[msg.mode] || msg.mode;
      document.getElementById('retry-msg').textContent =
        `「${roleName}」在「${modeName}」阶段执行失败。是否重试该委员？`;
      document.getElementById('retry-detail-text').textContent = msg.error || '';
      document.getElementById('retry-overlay').classList.remove('hidden');

    } else if (msg.type === 'error') {
      debateLog.innerHTML += `<p style="color:#c06060;padding:20px 0">${renderErrorHtml(msg.message)}</p>`;
    }
  };

  ws.onclose = () => {
    btn.disabled    = false;
    btn.textContent = '开始创作';
    updateStatus('ready', '就绪');
  };

  ws.onerror = () => {
    debateLog.innerHTML = `<p style="color:#c06060;padding:20px 0">${renderErrorHtml('WebSocket 连接错误')}</p>`;
    updateStatus('error', '连接错误');
    btn.disabled    = false;
    btn.textContent = '开始创作';
  };
}

// ── 重试对话框：使用 _currentRunWs 引用当前 WebSocket ────────────────────────
let _currentRunWs = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('retry-retry-btn').addEventListener('click', () => {
    document.getElementById('retry-overlay').classList.add('hidden');
    if (_currentRunWs && _currentRunWs.readyState === WebSocket.OPEN) {
      _currentRunWs.send(JSON.stringify({ type: 'retry_decision', action: 'retry' }));
    }
  });
  document.getElementById('retry-skip-btn').addEventListener('click', () => {
    document.getElementById('retry-overlay').classList.add('hidden');
    if (_currentRunWs && _currentRunWs.readyState === WebSocket.OPEN) {
      _currentRunWs.send(JSON.stringify({ type: 'retry_decision', action: 'skip' }));
    }
  });
});

// ── 历史 Tab ──────────────────────────────────────────────────────────────────

async function loadHistory(slug) {
  const container = document.getElementById('history-list');
  const label = document.getElementById('history-project-label');
  const count = document.getElementById('history-round-count');
  const noProject = document.getElementById('history-no-project');
  const content = document.getElementById('history-content');

  if (!slug) {
    noProject.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  noProject.classList.add('hidden');
  content.classList.remove('hidden');
  label.textContent = `项目：${slug}`;

  try {
    // Fetch project list for round count
    const listRes = await fetch('/api/projects');
    const list = await listRes.json();
    const proj = list.find(p => p.slug === slug);
    count.textContent = `共 ${proj ? proj.round_count : 0} 轮`;

    // Fetch output.md
    const outRes = await fetch(`/api/projects/${slug}/output`);
    const { content: mdContent } = await outRes.json();

    container.innerHTML = '';
    if (!mdContent.trim()) {
      container.innerHTML = '<p class="placeholder">暂无历史记录。</p>';
      return;
    }

    // 按轮次拆分（以 # 第N轮： 为分隔）
    const sections = mdContent.split(/(?=^# 第)/m);
    sections.forEach(section => {
      if (!section.trim()) return;

      const lines = section.trim().split('\n');
      const heading = lines[0];
      const headingMatch = heading.match(/^# 第(\d+)轮：(.+)$/);
      if (!headingMatch) return;

      const roundNum = headingMatch[1];
      const title = headingMatch[2].trim();

      // 去掉分隔线 --- 和状态行，取正文
      const rest = lines.slice(1).join('\n');
      const statusMatch = rest.match(/状态：\[(.+?)\]/);
      const status = statusMatch ? statusMatch[1] : '待审';
      const body = rest
        .replace(/^---+$/m, '')
        .replace(/状态：\[.+?\]/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-card-header">
          <span class="history-round-num">第${roundNum}轮</span>
          <span class="history-round-title">${escHtml(title)}</span>
          <span class="history-round-chars">${body.length} 字</span>
          <span class="history-round-status">${escHtml(status)}</span>
        </div>
        <div class="history-round-body">${escHtml(body)}</div>
      `;
      card.querySelector('.history-card-header').addEventListener('click', () => {
        card.classList.toggle('expanded');
      });
      container.appendChild(card);
    });
  } catch {
    container.innerHTML = '<p class="placeholder" style="color:#c06060">加载失败。</p>';
  }
}

// ── 主题切换 ─────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved === 'dark' ? '' : 'light';
  }
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  document.documentElement.dataset.theme = isLight ? '' : 'light';
  localStorage.setItem('theme', isLight ? 'dark' : 'light');
}

// ── 侧栏折叠 ──────────────────────────────────────────────────────────────────

function initSidebar() {
  const sidebar = document.getElementById('left-sidebar');
  const saved = localStorage.getItem('sidebarCollapsed');
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
    sidebar.style.width = ''; // 折叠时清除拖拽宽度，让 CSS 生效
    document.getElementById('sidebar-toggle').textContent = '▶';
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('left-sidebar');
  const isCollapsed = sidebar.classList.contains('collapsed');
  if (isCollapsed) {
    sidebar.classList.remove('collapsed');
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) sidebar.style.width = savedWidth;
  } else {
    sidebar.style.width = '';
    sidebar.classList.add('collapsed');
  }
  localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  document.getElementById('sidebar-toggle').textContent = isCollapsed ? '◀' : '▶';
}

// ── 面板拖拽 ──────────────────────────────────────────────────────────────────

function initResize() {
  const handle = document.querySelector('.resize-handle[data-sidebar="left"]');
  if (!handle) return;
  const sidebar = document.getElementById('left-sidebar');

  // 恢复保存的宽度
  const savedWidth = localStorage.getItem('sidebarWidth');
  if (savedWidth) sidebar.style.width = savedWidth;

  let startX, startSize;

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const newSize = Math.max(48, Math.min(400, startSize + dx));
    sidebar.style.width = newSize + 'px';
  }

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startSize = sidebar.offsetWidth;
    handle.classList.add('active');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', () => {
      document.removeEventListener('mousemove', onMouseMove);
      handle.classList.remove('active');
      localStorage.setItem('sidebarWidth', sidebar.style.width);
    }, { once: true });
  });

  handle.addEventListener('dblclick', () => {
    sidebar.style.width = '';
    localStorage.removeItem('sidebarWidth');
  });
}

// ── 侧栏项目列表 ──────────────────────────────────────────────────────────────

function populateSidebarProjects(projects) {
  const list = document.getElementById('sidebar-project-list');
  list.innerHTML = '';
  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-project-item' + (p.slug === currentProject ? ' active' : '');
    btn.dataset.slug = p.slug;
    btn.textContent = `📖 ${p.name} (${p.round_count}轮)`;
    btn.addEventListener('click', () => {
      document.getElementById('project-select').value = p.slug;
      document.getElementById('project-select').dispatchEvent(new Event('change'));
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, p.slug);
    });
    list.appendChild(btn);
  });
}

// ── 右键上下文菜单 ────────────────────────────────────────────────────────────

function showContextMenu(x, y, slug) {
  const menu = document.getElementById('context-menu');
  menu.dataset.slug = slug;
  menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  menu.classList.remove('hidden');
}

function initContextMenu() {
  const menu = document.getElementById('context-menu');
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target)) menu.classList.add('hidden');
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    const slug = menu.dataset.slug;
    if (!slug) return;
    menu.classList.add('hidden');
    if (action === 'rename') showRenameDialog(slug);
    else if (action === 'delete') showDeleteConfirm(slug);
    else if (action === 'copy') copyProject(slug);
    else if (action === 'trash') trashProject(slug);
  });
}

function showRenameDialog(slug) {
  document.getElementById('confirm-title').textContent = '重命名项目';
  document.getElementById('confirm-msg').textContent = `将「${slug}」重命名为：`;
  document.getElementById('confirm-rename-wrap').classList.remove('hidden');
  document.getElementById('confirm-rename-field').value = slug;
  document.getElementById('confirm-extra').textContent = '';
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = '确认';
  okBtn.style.background = 'var(--color-primary)';
  const overlay = document.getElementById('confirm-overlay');
  overlay.dataset.action = 'rename';
  overlay.dataset.slug = slug;
  overlay.classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('confirm-rename-field').focus();
    document.getElementById('confirm-rename-field').select();
  }, 100);
}

function showDeleteConfirm(slug) {
  document.getElementById('confirm-title').textContent = '删除项目';
  document.getElementById('confirm-msg').textContent = `确定要删除项目「${slug}」吗？此操作不可恢复，所有数据将被永久删除。`;
  document.getElementById('confirm-rename-wrap').classList.add('hidden');
  document.getElementById('confirm-extra').textContent = '';
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = '删除';
  okBtn.style.background = 'var(--color-danger)';
  const overlay = document.getElementById('confirm-overlay');
  overlay.dataset.action = 'delete';
  overlay.dataset.slug = slug;
  overlay.classList.remove('hidden');
}

function initConfirmDialog() {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    const action = overlay.dataset.action;
    const slug = overlay.dataset.slug;
    if (!action || !slug) return;
    overlay.classList.add('hidden');
    if (action === 'delete') await deleteProject(slug);
    else if (action === 'rename') {
      const newName = document.getElementById('confirm-rename-field').value.trim();
      if (newName && newName !== slug) await renameProject(slug, newName);
    }
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
}

async function deleteProject(slug) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      if (currentProject === slug) {
        currentProject = '';
        document.getElementById('settings-editor').classList.add('hidden');
        document.getElementById('settings-no-project').classList.remove('hidden');
        document.getElementById('topbar-project').textContent = '';
        document.getElementById('round-badge').classList.add('hidden');
        document.getElementById('project-select').value = '';
        updateStatus('ready', '就绪');
      }
      await loadProjectList();
    } else alert('删除失败：' + (data.error || ''));
  } catch (e) { alert('删除失败：' + e.message); }
}

async function renameProject(slug, newName) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/rename`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json();
    if (data.ok) {
      await loadProjectList();
      if (currentProject === slug) {
        currentProject = data.new_slug;
        document.getElementById('topbar-project').textContent = `📖 ${data.new_slug}`;
        document.getElementById('project-select').value = data.new_slug;
        document.getElementById('project-select').dispatchEvent(new Event('change'));
      }
    } else alert('重命名失败：' + (data.error || ''));
  } catch (e) { alert('重命名失败：' + e.message); }
}

async function copyProject(slug) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/copy`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) await loadProjectList();
    else alert('复制失败：' + (data.error || ''));
  } catch (e) { alert('复制失败：' + e.message); }
}

async function trashProject(slug) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/trash`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      if (currentProject === slug) {
        currentProject = '';
        document.getElementById('settings-editor').classList.add('hidden');
        document.getElementById('settings-no-project').classList.remove('hidden');
        document.getElementById('topbar-project').textContent = '';
        document.getElementById('round-badge').classList.add('hidden');
        document.getElementById('project-select').value = '';
        updateStatus('ready', '就绪');
      }
      await loadProjectList();
    } else alert('移入回收站失败：' + (data.error || ''));
  } catch (e) { alert('移入回收站失败：' + e.message); }
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // ── 主题 + 侧栏恢复 ──
  initTheme();
  initSidebar();

  // ── 模式切换 (Phase 3) ──
  initModeToggle();

  // ── 主题切换 ──
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // ── 侧栏折叠切换 ──
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

  // ── Tab 切换 ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // ── 设定 Tab：角色行 ──
  document.getElementById('se-add-character').addEventListener('click', () => {
    addCharacterRow(document.getElementById('se-characters-list'));
  });
  document.getElementById('se-save').addEventListener('click', saveSettingsTab);

  // ── 设定 Tab：跳转到创作 ──
  document.getElementById('goto-create-tab').addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('create');
  });

  // ── 项目选择 ──
  const projectSelect = document.getElementById('project-select');
  projectSelect.addEventListener('change', async () => {
    const slug = projectSelect.value;
    if (slug) {
      await selectProject(slug);
    } else {
      currentProject = '';
      document.getElementById('settings-editor').classList.add('hidden');
      document.getElementById('settings-no-project').classList.remove('hidden');
    }
  });

  // ── 新建项目弹窗 ──
  document.getElementById('new-project-btn').addEventListener('click', () => {
    document.getElementById('new-project-overlay').classList.remove('hidden');
  });
  document.getElementById('new-project-close').addEventListener('click', () => {
    document.getElementById('new-project-overlay').classList.add('hidden');
  });
  document.getElementById('new-project-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('new-project-overlay').classList.add('hidden');
    }
  });

  document.getElementById('np-add-character').addEventListener('click', () => {
    addCharacterRow(document.getElementById('np-characters-list'));
  });

  document.getElementById('np-save').addEventListener('click', async () => {
    const title = document.getElementById('np-title').value.trim();
    const genre = document.getElementById('np-genre').value.trim();
    if (!title || !genre) {
      document.getElementById('np-msg').textContent = '书名和题材为必填';
      return;
    }

    const data = {
      name: title,
      genre,
      world_view: document.getElementById('np-world-view').value.trim(),
      characters: collectCharacters(document.getElementById('np-characters-list')),
    };

    try {
      const result = await createNewProject(data);
      if (!result.ok) {
        document.getElementById('np-msg').textContent = result.error || '创建失败';
        return;
      }
      document.getElementById('new-project-overlay').classList.add('hidden');
      document.getElementById('np-msg').textContent = '';
      // Reset form
      document.getElementById('np-title').value = '';
      document.getElementById('np-genre').value = '';
      document.getElementById('np-world-view').value = '';
      document.getElementById('np-characters-list').innerHTML = '';

      // Reload project list and select the new one
      await loadProjectList();
      document.getElementById('project-select').value = result.slug;
      projectSelect.dispatchEvent(new Event('change'));
      switchTab('create');
    } catch (e) {
      document.getElementById('np-msg').textContent = '创建失败：' + e.message;
    }
  });

  // ── 创建 Tab：运行 ──
  const slider  = document.getElementById('target-length');
  const display = document.getElementById('length-display');
  slider.addEventListener('input', () => { display.textContent = slider.value; });

  document.getElementById('run-btn').addEventListener('click', runDecision);

  // ── 右侧抽屉关闭 ──
  document.getElementById('drawer-close').addEventListener('click', () => {
    document.getElementById('right-drawer').classList.remove('open');
  });

  // ── 继续下一轮 ──
  document.getElementById('next-round-btn').addEventListener('click', () => {
    const btn = document.getElementById('next-round-btn');
    const sceneText = btn.dataset.sceneText || '';
    const chapterSummary = btn.dataset.chapterSummary || '';

    const blocks = sceneText.split(/\n\s*\n/).filter(p => p.trim());
    const lastPara = blocks.length > 1
      ? blocks[blocks.length - 1].trim()
      : sceneText.trim().slice(-200).trim();

    document.getElementById('prev-summary').value = chapterSummary;
    document.getElementById('last-paragraph').value = lastPara;

    btn.classList.add('hidden');
    runDecision();
  });

  // ── 历史 Tab ──
  document.getElementById('history-refresh').addEventListener('click', () => {
    loadHistory(currentProject);
  });

  // ── API Key 设置 ──
  initSettings();

  // ── 局部修改（Phase 2） ──
  initRewrite();

  // ── 面板拖拽 ──
  initResize();

  // ── 画中画 (Phase 4) ──
  initPip();

  // ── 设定弹窗 (Phase 5) ──
  initSettingsModal();

  // ── 命令面板 (Phase 6) ──
  initCommandPalette();

  // ── 快捷键 (Phase 6) ──
  initKeyboardShortcuts();

  // ── 致命错误处理 (Phase 7) ──
  initFatalErrorHandler();

  // ── 侧栏设定按钮 (Phase 6) ──
  document.getElementById('sidebar-settings-btn')?.addEventListener('click', openSettingsModal);

  // ── 右键上下文菜单 ──
  initContextMenu();

  // ── 确认对话框 ──
  initConfirmDialog();

  // ── 启动时加载项目列表 ──
  await loadProjectList();

  // 如果只有一个项目，自动选中
  if (projectSelect.options.length === 2) { // placeholder + 1 project
    projectSelect.value = projectSelect.options[1].value;
    projectSelect.dispatchEvent(new Event('change'));
  }
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// 设定弹窗 (Settings Modal, Phase 5)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

const ST_COMMITTEE_KEYS = ['editor_in_chief', 'writer', 'critic', 'consistency_officer', 'polisher'];
const ST_COMMITTEE_LABELS = {
  editor_in_chief: '主编', writer: '作家', critic: '批评家',
  consistency_officer: '一致性委员', polisher: '润色师',
};

function initSettingsModal() {
  const modal = document.getElementById('st-modal');
  const overlay = document.getElementById('st-modal');

  // Settings button (⚙️) opens modal
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);

  // Close button
  document.getElementById('st-modal-close').addEventListener('click', closeSettingsModal);

  // Overlay click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettingsModal();
  });

  // Tab switching
  document.querySelectorAll('.st-tab').forEach(tab => {
    tab.addEventListener('click', () => switchStTab(tab.dataset.stab));
  });

  // Save buttons
  document.getElementById('st-save').addEventListener('click', saveModalData);
  document.getElementById('st-save-apply').addEventListener('click', async () => {
    await saveModalData();
    closeSettingsModal();
  });

  // Add character button
  document.getElementById('st-add-char').addEventListener('click', () => {
    const grid = document.getElementById('st-char-grid');
    const card = createCharCard({ name: '', role: '', description: '', voice: '' }, true);
    grid.prepend(card);
    card.classList.add('editing');
    card.querySelector('.st-char-edit-inputs input')?.focus();
  });

  // Keyboard shortcut: Esc closes, Cmd+, opens
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeSettingsModal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      if (modal.classList.contains('hidden')) {
        openSettingsModal();
      } else {
        closeSettingsModal();
      }
    }
  });
}

async function openSettingsModal() {
  const modal = document.getElementById('st-modal');
  const slug = currentProject;
  if (!slug) return;

  document.getElementById('st-project-name').textContent = slug;
  modal.classList.remove('hidden');
  document.getElementById('stc-world').classList.add('active');

  try {
    // Load all data in parallel
    const [worldRes, charsRes, outlineRes, committeeRes] = await Promise.all([
      fetch(`/api/projects/${slug}/world`),
      fetch(`/api/projects/${slug}/characters`),
      fetch(`/api/projects/${slug}/outline`),
      fetch('/api/committee'),
    ]);

    const world = await worldRes.json();
    const chars = await charsRes.json();
    const outline = await outlineRes.json();
    const committee = await committeeRes.json();

    // Populate world tab
    document.getElementById('st-title').value = world.title || '';
    document.getElementById('st-genre').value = world.genre || '';
    document.getElementById('st-world-view').value = world.world_view || '';
    document.getElementById('st-style-tone').value = world.style?.tone || '';
    document.getElementById('st-style-pace').value = world.style?.pace || '';
    document.getElementById('st-style-pov').value = world.style?.pov || '';
    document.getElementById('st-forbidden').value = (world.constraints?.forbidden_themes || []).join(', ');

    // Populate character cards
    renderCharCards(chars.characters || []);

    // Populate outline
    document.getElementById('st-outline').value = outline.content || '';

    // Populate committee
    renderCommitteeForms(committee.committees || {});
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('st-modal');
  if (modal.classList.contains('hidden')) return;

  // Auto-save on close
  saveModalData().catch(() => {});
  modal.classList.add('hidden');
}

function switchStTab(tabName) {
  document.querySelectorAll('.st-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tabName));
  document.querySelectorAll('.st-tab-content').forEach(c => c.classList.toggle('active', c.id === `stc-${tabName}`));
}

async function saveModalData() {
  const slug = currentProject;
  if (!slug) return;

  // Collect world data
  const forbidden = document.getElementById('st-forbidden').value;
  const world = {
    title: document.getElementById('st-title').value.trim(),
    genre: document.getElementById('st-genre').value.trim(),
    world_view: document.getElementById('st-world-view').value.trim(),
    style: {
      tone: document.getElementById('st-style-tone').value.trim(),
      pace: document.getElementById('st-style-pace').value.trim(),
      pov: document.getElementById('st-style-pov').value.trim(),
    },
    constraints: {
      forbidden_themes: forbidden ? forbidden.split(',').map(s => s.trim()).filter(Boolean) : [],
      forbidden_devices: [],
    },
  };

  // Collect character data from cards
  const chars = {
    characters: collectCharsFromCards(),
  };

  // Collect outline
  const outline = {
    content: document.getElementById('st-outline').value,
  };

  // Collect committee
  const committees = collectCommitteeForms();

  try {
    await Promise.all([
      fetch(`/api/projects/${slug}/world`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(world),
      }),
      fetch(`/api/projects/${slug}/characters`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chars),
      }),
      fetch(`/api/projects/${slug}/outline`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outline),
      }),
      fetch('/api/committee', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ committees }),
      }),
    ]);
  } catch (e) {
    console.error('Failed to save settings:', e);
  }

  // If on the create tab and scene text exists, update scene-brief hint
  const sceneBriefHint = document.querySelector('.hint-auto, .hint-strict');
  if (sceneBriefHint) {
    // just a subtle refresh indicator
  }
}

// ── Character Cards ───────────────────────────────────────────────

function renderCharCards(characters) {
  const grid = document.getElementById('st-char-grid');
  grid.innerHTML = '';
  characters.forEach(c => grid.appendChild(createCharCard(c)));
}

function createCharCard(data, isNew = false) {
  const card = document.createElement('div');
  card.className = 'st-char-card';
  if (isNew) card.dataset.isNew = '1';

  const evoHtml = (data.evolution_history || []).slice(0, 3).map(e =>
    `<div class="st-evo-item">${escHtml(e.trait || e)}</div>`
  ).join('') || '<div style="font-size:11px;color:var(--text-tertiary);padding:2px 0;">无演化记录</div>';

  const evoCount = (data.evolution_history || []).length;

  card.innerHTML = `
    <div class="st-char-display">
      <div class="st-char-name">${escHtml(data.name || '未命名')}</div>
      <div class="st-char-role">${escHtml(data.role || '—')}</div>
      <div class="st-char-desc">${escHtml(data.description || '')}</div>
      <div class="st-char-voice">${data.voice ? '🗣 ' + escHtml(data.voice) : ''}</div>
      <div class="st-char-evolution">
        <div class="st-evo-title">演化历史 (${evoCount})</div>
        ${evoHtml}
      </div>
    </div>
    <div class="st-char-edit-inputs">
      <input class="st-ec-name" type="text" placeholder="姓名" value="${escHtml(data.name || '')}">
      <input class="st-ec-role" type="text" placeholder="身份" value="${escHtml(data.role || '')}">
      <textarea class="st-ec-desc" rows="2" placeholder="角色描述">${escHtml(data.description || '')}</textarea>
      <input class="st-ec-voice" type="text" placeholder="说话语气" value="${escHtml(data.voice || '')}">
    </div>
    <div class="st-char-actions">
      <button class="st-char-edit" data-action="edit">编辑</button>
      <button class="st-char-export" data-action="export">导出</button>
      <button class="st-char-delete" data-action="delete">删除</button>
    </div>
  `;

  card.querySelector('.st-char-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.classList.contains('editing')) {
      // Save inline: copy inputs back to display
      const n = card.querySelector('.st-ec-name').value.trim();
      const r = card.querySelector('.st-ec-role').value.trim();
      const d = card.querySelector('.st-ec-desc').value.trim();
      const v = card.querySelector('.st-ec-voice').value.trim();
      card.querySelector('.st-char-name').textContent = n || '未命名';
      card.querySelector('.st-char-role').textContent = r || '—';
      card.querySelector('.st-char-desc').textContent = d || '';
      card.querySelector('.st-char-voice').textContent = v ? '🗣 ' + v : '';
      card.classList.remove('editing');
    } else {
      card.classList.add('editing');
      card.querySelector('.st-ec-name')?.focus();
    }
    delete card.dataset.isNew;
  });

  card.querySelector('.st-char-export').addEventListener('click', (e) => {
    e.stopPropagation();
    const charData = {
      name: card.querySelector('.st-ec-name')?.value.trim() || card.querySelector('.st-char-name')?.textContent || '',
      role: card.querySelector('.st-ec-role')?.value.trim() || card.querySelector('.st-char-role')?.textContent || '',
      description: card.querySelector('.st-ec-desc')?.value.trim() || card.querySelector('.st-char-desc')?.textContent || '',
      voice: card.querySelector('.st-ec-voice')?.value.trim() || (card.querySelector('.st-char-voice')?.textContent.replace('🗣 ', '') || ''),
    };
    navigator.clipboard.writeText(JSON.stringify(charData, null, 2)).catch(() => {});
  });

  card.querySelector('.st-char-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    const name = card.querySelector('.st-char-name')?.textContent || '未命名';
    if (confirm(`确定删除角色「${name}」？`)) card.remove();
  });

  return card;
}

function collectCharsFromCards() {
  const cards = document.querySelectorAll('#st-char-grid .st-char-card');
  return Array.from(cards).map(card => {
    // If editing, get values from inputs; otherwise from display
    const isEditing = card.classList.contains('editing');
    return {
      name: (isEditing ? card.querySelector('.st-ec-name').value : card.querySelector('.st-char-name').textContent).trim(),
      role: (isEditing ? card.querySelector('.st-ec-role').value : card.querySelector('.st-char-role').textContent).trim(),
      description: (isEditing ? card.querySelector('.st-ec-desc').value : card.querySelector('.st-char-desc').textContent).trim(),
      voice: (isEditing ? card.querySelector('.st-ec-voice').value : card.querySelector('.st-char-voice').textContent.replace('🗣 ', '')).trim(),
    };
  }).filter(c => c.name);
}

// ── Committee Forms ───────────────────────────────────────────────

function renderCommitteeForms(committees) {
  const container = document.getElementById('st-committee-forms');
  container.innerHTML = '';

  ST_COMMITTEE_KEYS.forEach(key => {
    const member = committees[key] || {};
    const div = document.createElement('div');
    div.className = 'st-comm-member';
    div.dataset.key = key;
    div.innerHTML = `
      <div class="st-comm-header">${ST_COMMITTEE_LABELS[key] || key}</div>
      <div class="st-comm-row">
        <div class="st-comm-field">
          <label>Provider</label>
          <select class="st-comm-provider">
            <option value="claude">Claude</option>
            <option value="deepseek">DeepSeek</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div class="st-comm-field">
          <label>Temperature</label>
          <input type="range" class="st-comm-temp" min="0" max="1" step="0.1" value="${member.temperature ?? 0.7}">
          <div class="st-comm-temp-value">${member.temperature ?? 0.7}</div>
        </div>
        <div class="st-comm-field">
          <label>Max Tokens</label>
          <input type="number" class="st-comm-tokens" value="${member.max_tokens ?? 2000}" min="500" max="16000" step="500">
        </div>
      </div>
    `;
    div.querySelector('.st-comm-provider').value = member.provider || 'claude';
    div.querySelector('.st-comm-temp').addEventListener('input', function () {
      this.nextElementSibling.textContent = this.value;
    });
    container.appendChild(div);
  });
}

function collectCommitteeForms() {
  const data = {};
  document.querySelectorAll('#st-committee-forms .st-comm-member').forEach(div => {
    const key = div.dataset.key;
    data[key] = {
      name: ST_COMMITTEE_LABELS[key] || key,
      provider: div.querySelector('.st-comm-provider').value,
      temperature: parseFloat(div.querySelector('.st-comm-temp').value),
      max_tokens: parseInt(div.querySelector('.st-comm-tokens').value) || 2000,
    };
  });
  return data;
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// Toast 通知系统 (Phase 7)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

let _toastTimers = new Map();

function showToast(msg, type = 'success', actions = [], duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-msg">${msg}</div>`;
  if (actions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'toast-actions';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.addEventListener('click', (e) => {
        a.action(e);
        removeToast(el);
      });
      wrap.appendChild(btn);
    });
    el.appendChild(wrap);
  }
  container.appendChild(el);

  if (type !== 'error' && duration > 0) {
    const timer = setTimeout(() => removeToast(el), duration);
    _toastTimers.set(el, timer);
    el.addEventListener('mouseenter', () => {
      clearTimeout(_toastTimers.get(el));
    });
    el.addEventListener('mouseleave', () => {
      const t = setTimeout(() => removeToast(el), duration);
      _toastTimers.set(el, t);
    });
  }
}

function removeToast(el) {
  clearTimeout(_toastTimers.get(el));
  _toastTimers.delete(el);
  if (el.classList.contains('removing')) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 200);
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// 命令面板 (Phase 6)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

function initCommandPalette() {
  const overlay = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-search');
  const results = document.getElementById('cmd-results');
  let activeIdx = -1;
  let items = [];

  function buildItems(filter) {
    const q = (filter || '').toLowerCase();
    const groups = [];
    const allItems = [];

    // 项目
    const projItems = (_projectList || []).filter(p => !q || p.name.toLowerCase().includes(q)).map(p => ({
      group: '项目',
      icon: '📖',
      label: p.name,
      keys: `${p.round_count || 0}轮`,
      action: () => {
        const sel = document.getElementById('project-select');
        sel.value = p.slug;
        sel.dispatchEvent(new Event('change'));
        closeCmd();
      },
      sortKey: p.name,
    }));
    if (projItems.length) groups.push({ title: '项目', items: projItems });
    allItems.push(...projItems);

    // 命令
    const cmdItems = [
      { label: '开始新一轮', icon: '▶', keys: '⌘Enter', action: () => { closeCmd(); document.getElementById('run-btn')?.click(); } },
      { label: '切换主题', icon: '🌓', keys: '⌘⇧L', action: () => { closeCmd(); document.getElementById('theme-toggle')?.click(); } },
      { label: '打开设定', icon: '⚙️', keys: '⌘,', action: () => { closeCmd(); openSettingsModal(); } },
      { label: '切换模式', icon: '⇄', keys: '⌘⇧M', action: () => { closeCmd(); const active = document.querySelector('.mode-btn.active'); const other = document.querySelector('.mode-btn:not(.active)'); if (other) other.click(); } },
      { label: '切换到创作', icon: '✍', keys: '⌘1', action: () => { closeCmd(); switchTab('create'); } },
      { label: '切换到历史', icon: '📚', keys: '⌘2', action: () => { closeCmd(); switchTab('history'); } },
      { label: '新建项目', icon: '➕', keys: '⌘N', action: () => { closeCmd(); document.getElementById('new-project-btn')?.click(); } },
    ].filter(c => !q || c.label.toLowerCase().includes(q));
    if (cmdItems.length) groups.push({ title: '命令', items: cmdItems });
    allItems.push(...cmdItems);

    return { groups, allItems };
  }

  function render(filter) {
    const { groups, allItems } = buildItems(filter);
    items = allItems;
    activeIdx = items.length > 0 ? 0 : -1;

    results.innerHTML = groups.map(g => `
      <div class="cmd-group">
        <div class="cmd-group-title">${g.title}</div>
        ${g.items.map((item, i) => {
          const idx = allItems.indexOf(item);
          return `<div class="cmd-item${idx === 0 ? ' active' : ''}" data-idx="${idx}">
            <span class="cmd-item-icon">${item.icon}</span>
            <span class="cmd-item-label">${escHtml(item.label)}</span>
            ${item.keys ? `<span class="cmd-item-keys">${item.keys}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    `).join('');

    // 空状态
    if (!items.length) {
      results.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-disabled);font-size:var(--text-sm);">无匹配结果</div>';
    }
  }

  function closeCmd() {
    overlay.classList.add('hidden');
    input.blur();
  }

  input.addEventListener('input', () => render(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIdx < items.length - 1) activeIdx++;
      else activeIdx = 0;
      highlightActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIdx > 0) activeIdx--;
      else activeIdx = items.length - 1;
      highlightActive();
    } else if (e.key === 'Enter' && activeIdx >= 0 && activeIdx < items.length) {
      e.preventDefault();
      items[activeIdx].action();
    } else if (e.key === 'Escape') {
      closeCmd();
    }
  });

  function highlightActive() {
    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIdx);
      if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCmd();
  });

  // Click handler for items (delegated)
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-item');
    if (item) {
      const idx = parseInt(item.dataset.idx);
      if (idx >= 0 && idx < items.length) items[idx].action();
    }
  });

  // 全局快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('hidden')) {
        overlay.classList.remove('hidden');
        input.value = '';
        render('');
        setTimeout(() => input.focus(), 50);
      } else {
        closeCmd();
      }
    }
  });

  // 打开时自动聚焦搜索框
  const observer = new MutationObserver(() => {
    if (!overlay.classList.contains('hidden')) {
      setTimeout(() => input.focus(), 50);
    }
  });
  observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// 快捷键体系 (Phase 6)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.metaKey || e.ctrlKey;

    // Cmd+Enter: 开始/继续创作
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('run-btn')?.click();
    }

    // Cmd+N: 新建项目
    if (ctrl && e.key === 'n') {
      e.preventDefault();
      document.getElementById('new-project-btn')?.click();
    }

    // Cmd+S: 保存设定 (只在弹窗打开时)
    if (ctrl && e.key === 's' && !document.getElementById('st-modal').classList.contains('hidden')) {
      e.preventDefault();
      document.getElementById('st-save')?.click();
    }

    // Cmd+1: 创作Tab
    if (ctrl && e.key === '1') {
      e.preventDefault();
      switchTab('create');
    }

    // Cmd+2: 历史Tab
    if (ctrl && e.key === '2') {
      e.preventDefault();
      switchTab('history');
    }

    // Cmd+Shift+M: 切换模式
    if (ctrl && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      const other = document.querySelector('.mode-btn:not(.active)');
      if (other) other.click();
    }

    // Cmd+Shift+L: 切换主题
    if (ctrl && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      document.getElementById('theme-toggle')?.click();
    }

    // Cmd+B: 切换左侧栏
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      document.getElementById('sidebar-toggle')?.click();
    }

    // Cmd+/: 切换右侧抽屉
    if (ctrl && e.key === '/') {
      e.preventDefault();
      document.getElementById('drawer-close')?.click();
    }

    // Cmd+,: 打开设定 (also in initSettingsModal, but keep for safety)
    if (ctrl && e.key === ',' && document.getElementById('st-modal').classList.contains('hidden')) {
      e.preventDefault();
      openSettingsModal();
    }
  });

  // 更新状态栏快捷键提示
  updateShortcutsHint();
}

function updateShortcutsHint() {
  const el = document.getElementById('status-shortcuts');
  if (!el) return;
  const tab = document.querySelector('.tab.active')?.dataset.tab;
  const parts = ['⌘K 命令'];
  if (tab === 'create') parts.push('⌘Enter 创作');
  else if (tab === 'history') parts.push('');
  el.textContent = parts.join(' · ');
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──
// 加载 / 空 / 错误 状态 (Phase 7)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

function showSkeleton(container, count = 3, type = 'line') {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    if (type === 'card') {
      el.className = 'skeleton skeleton-card';
    } else if (type === 'char-card') {
      el.className = 'skeleton skeleton-char-card';
    } else {
      el.className = 'skeleton skeleton-line';
    }
    container.appendChild(el);
  }
}

function showEmptyState(container, icon, title, desc, btnLabel, btnAction) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${title}</div>
      ${desc ? `<div class="empty-state-desc">${desc}</div>` : ''}
      ${btnLabel ? `<button class="empty-state-btn" id="empty-state-btn">${btnLabel}</button>` : ''}
    </div>
  `;
  if (btnAction) {
    document.getElementById('empty-state-btn')?.addEventListener('click', btnAction);
  }
}

function initFatalErrorHandler() {
  const overlay = document.getElementById('fatal-error-overlay');
  const retryBtn = document.getElementById('fatal-error-retry');

  retryBtn.addEventListener('click', async () => {
    overlay.querySelector('.fatal-error-msg').textContent = '正在重连…';
    retryBtn.disabled = true;
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        overlay.classList.add('hidden');
        showToast('已重新连接', 'success');
      } else {
        throw new Error('not ok');
      }
    } catch {
      overlay.querySelector('.fatal-error-msg').textContent = '无法连接后端服务器，请确认服务已启动';
    }
    retryBtn.disabled = false;
  });

  // 全局 fetch 错误监听
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof TypeError && e.reason.message.includes('fetch')) {
      overlay.classList.remove('hidden');
    }
  });
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

const PROVIDERS = ['claude', 'deepseek', 'gemini'];

function initSettings() {
  const overlay     = document.getElementById('settings-overlay');
  const closeBtn    = document.getElementById('settings-close');
  const saveBtn     = document.getElementById('settings-save');

  // ⚙ button is now bound by initSettingsModal() to open the project settings modal
  closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  saveBtn.addEventListener('click', saveSettings);

  PROVIDERS.forEach(p => {
    document.querySelector(`.key-edit-btn[data-provider="${p}"]`)
      .addEventListener('click', () => {
        document.getElementById(`key-row-${p}`).classList.add('hidden');
        const inp = document.getElementById(`key-input-${p}`);
        inp.classList.remove('hidden');
        inp.focus();
      });
  });

  checkKeyOnStartup();
}

async function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('hidden');

  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    PROVIDERS.forEach(p => {
      const info      = data[p] || {};
      const badge     = document.getElementById(`badge-${p}`);
      const keyRow    = document.getElementById(`key-row-${p}`);
      const keyInput  = document.getElementById(`key-input-${p}`);
      const urlInput  = document.getElementById(`url-input-${p}`);

      if (info.key_configured) {
        badge.textContent = '已配置';
        badge.className   = 'provider-badge configured';
      } else {
        badge.textContent = '未配置';
        badge.className   = 'provider-badge unconfigured';
      }

      if (info.key_configured) {
        keyRow.classList.remove('hidden');
        keyInput.classList.add('hidden');
        keyInput.value = '';
      } else {
        keyRow.classList.add('hidden');
        keyInput.classList.remove('hidden');
        keyInput.value = '';
      }

      urlInput.value = info.base_url || '';
    });
  } catch (e) {
    showSettingsMsg('加载失败：' + e.message, true);
  }
}

async function saveSettings() {
  const saveBtn = document.getElementById('settings-save');
  saveBtn.disabled = true;
  showSettingsMsg('');

  const payload = {};
  PROVIDERS.forEach(p => {
    const keyInput = document.getElementById(`key-input-${p}`);
    const urlInput = document.getElementById(`url-input-${p}`);
    const newKey = (!keyInput.classList.contains('hidden')) ? keyInput.value.trim() : '';
    payload[p] = { key: newKey, base_url: urlInput.value.trim() };
  });

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showSettingsMsg('已保存');
    removeBanner();
    await openSettings();
  } catch (e) {
    showSettingsMsg('保存失败：' + e.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

function showSettingsMsg(text, isError = false) {
  const msg = document.getElementById('settings-msg');
  msg.textContent = text;
  msg.className = 'settings-msg' + (isError ? ' error' : '');
}

async function checkKeyOnStartup() {
  if (localStorage.getItem('keyBannerDismissed') === 'true') return;
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.claude?.key_configured) {
      showNoBanner();
    } else {
      localStorage.setItem('keyBannerDismissed', 'true');
    }
  } catch (_) { /* ignore */ }
}

function showNoBanner() {
  if (document.getElementById('no-key-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'no-key-banner';
  banner.className = 'no-key-banner';
  banner.innerHTML = `
    <span>尚未配置 Claude API Key，无法开始创作。</span>
    <button id="banner-settings-btn">去设置</button>
    <button id="banner-dismiss-btn" style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;opacity:0.6;">✕</button>
  `;
  banner.querySelector('#banner-settings-btn').addEventListener('click', openSettings);
  banner.querySelector('#banner-dismiss-btn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('keyBannerDismissed', 'true');
  });
  const topbar = document.querySelector('.topbar');
  topbar.insertAdjacentElement('afterend', banner);
}

function removeBanner() {
  const b = document.getElementById('no-key-banner');
  if (b) b.remove();
  localStorage.setItem('keyBannerDismissed', 'true');
}

// ── 局部修改（Phase 2） ──────────────────────────────────────────────────────

let _rewriteRange = null; // 保存当前选中的 Range

function initRewrite() {
  const sceneText = document.getElementById('scene-text');
  const toolbar = document.getElementById('rewrite-toolbar');
  const errorEl = document.getElementById('rewrite-error');
  if (!toolbar) return;

  // 右键菜单：选中文字时触发修改
  sceneText.addEventListener('contextmenu', (e) => {
    const sel = window.getSelection();
    const text = sel.toString().trim();

    if (!text || sel.rangeCount === 0) {
      return; // 无选中文字，让浏览器原生菜单出现
    }

    const range = sel.getRangeAt(0);
    if (!sceneText.contains(range.commonAncestorContainer)) {
      return;
    }

    e.preventDefault(); // 阻止原生菜单
    errorEl.classList.add('hidden');
    _rewriteRange = range;
    showRewriteToolbar(e.clientX, e.clientY);

    // 重新应用选中范围，维持视觉高亮
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // 点击其他地方隐藏工具栏
  document.addEventListener('mousedown', (e) => {
    if (!toolbar.contains(e.target) && e.target !== sceneText) {
      hideRewriteToolbar();
    }
  });

  // 确认修改
  document.getElementById('rewrite-confirm').addEventListener('click', doRewrite);

  // 取消
  document.getElementById('rewrite-cancel').addEventListener('click', hideRewriteToolbar);

  // Enter 键触发修改
  document.getElementById('rewrite-intent').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doRewrite();
    }
  });
}

function showRewriteToolbar(x, y) {
  const toolbar = document.getElementById('rewrite-toolbar');
  // 定位在鼠标上方
  toolbar.style.left = Math.min(x, window.innerWidth - 340) + 'px';
  toolbar.style.top = Math.max(10, y - 60) + 'px';
  toolbar.classList.remove('hidden');
  document.getElementById('rewrite-intent').focus();
}

function hideRewriteToolbar() {
  const toolbar = document.getElementById('rewrite-toolbar');
  toolbar.classList.add('hidden');
  _rewriteRange = null;
  // 清除文本选中状态
  window.getSelection().removeAllRanges();
}

function extractContextFromRange(sceneText, range) {
  // 获取选中文本前后各 500 字上下文
  const fullRange = document.createRange();
  fullRange.selectNodeContents(sceneText);

  const beforeRange = document.createRange();
  beforeRange.setStart(fullRange.startContainer, fullRange.startOffset);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const contextBefore = beforeRange.toString().slice(-500);

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(fullRange.endContainer, fullRange.endOffset);
  const contextAfter = afterRange.toString().slice(0, 500);

  return { contextBefore, contextAfter };
}

async function doRewrite() {
  if (!_rewriteRange || !currentProject) return;

  const sceneText = document.getElementById('scene-text');
  const selectedText = _rewriteRange.toString().trim();
  const editIntent = document.getElementById('rewrite-intent').value.trim();
  const errorEl = document.getElementById('rewrite-error');
  const confirmBtn = document.getElementById('rewrite-confirm');

  if (!editIntent) {
    document.getElementById('rewrite-intent').focus();
    return;
  }

  // 隐藏之前的错误
  errorEl.classList.add('hidden');

  const { contextBefore, contextAfter } = extractContextFromRange(sceneText, _rewriteRange);

  // 禁用按钮显示 loading 状态
  confirmBtn.disabled = true;
  confirmBtn.textContent = '修改中…';

  try {
    const res = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name: currentProject,
        selected_text: selectedText,
        context_before: contextBefore,
        context_after: contextAfter,
        edit_intent: editIntent,
      }),
    });
    const data = await res.json();
    if (!data.ok || !data.rewritten_text) {
      errorEl.textContent = data.error || '返回为空，请重新尝试';
      errorEl.classList.remove('hidden');
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认修改';
      return;
    }

    const rewritten = data.rewritten_text;

    // 在 DOM 中替换选中文本为带标记的 span
    _rewriteRange.deleteContents();
    const span = document.createElement('span');
    span.className = 'rewritten';
    span.textContent = rewritten;
    _rewriteRange.insertNode(span);

    // 闪烁绿色边框表示成功
    span.classList.add('rewrite-flash');
    setTimeout(() => span.classList.remove('rewrite-flash'), 1200);

    // 标记父段落为已修改
    const parentP = span.closest('p');
    if (parentP) parentP.classList.add('has-rewrite');

    // 清除选中状态
    window.getSelection().removeAllRanges();
    hideRewriteToolbar();

    // 统计修改次数并更新 meta
    const totalRewrites = document.querySelectorAll('#scene-text .rewritten').length;
    const metaRound = document.getElementById('scene-text-title').textContent.match(/第(\d+)轮/);
    const roundForMeta = metaRound ? parseInt(metaRound[1]) : 0;
    updateSceneMeta(roundForMeta, getSceneTextPlain().length, totalRewrites);

    // 更新 output.md 持久化（取纯文本内容）
    const fullText = getSceneTextPlain();
    const putRes = await fetch(`/api/projects/${currentProject}/output`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene_text: fullText }),
    });
    const putData = await putRes.json();
    if (!putData.ok) {
      errorEl.textContent = '修改已应用但保存失败：' + (putData.error || '');
      errorEl.classList.remove('hidden');
    }

    // 更新继续下一轮按钮的 sceneText
    const nBtn = document.getElementById('next-round-btn');
    nBtn.dataset.sceneText = fullText;

    // 重置输入
    document.getElementById('rewrite-intent').value = '';
  } catch (e) {
    errorEl.textContent = '网络错误：' + e.message;
    errorEl.classList.remove('hidden');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '确认修改';
  }
}
