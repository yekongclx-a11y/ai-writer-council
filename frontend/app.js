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
};

const REVERSIBILITY_NAMES = {
  low:    '不可逆',
  medium: '可修正',
  high:   '可撤销',
};

// ── 默认角色数据（暗流） ──────────────────────────────────────────────────────

const DEFAULT_CHARACTERS = [
  {
    name: '陈默',
    role: '主角',
    description: '前刑警，因一起冤案辞职，性格阴郁、直觉敏锐。',
    voice: '话少，用词精准，带一点自嘲',
  },
  {
    name: '林晓薇',
    role: '配角',
    description: '年轻记者，追查同一条线索，与陈默立场不同但目标相近。',
    voice: '敏锐、直接，偶尔逞强',
  },
];

// ── 角色行 ───────────────────────────────────────────────────────────────────

function addCharacterRow(data = {}) {
  const list = document.getElementById('characters-list');
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
  list.appendChild(row);
}

// ── 表单收集 ─────────────────────────────────────────────────────────────────

function splitTrim(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function collectFormData() {
  const characters = Array.from(
    document.querySelectorAll('.character-row')
  ).map(row => ({
    name:        row.querySelector('.char-name').value.trim(),
    role:        row.querySelector('.char-role').value.trim(),
    description: row.querySelector('.char-desc').value.trim(),
    voice:       row.querySelector('.char-voice').value.trim(),
  })).filter(c => c.name);

  return {
    setting: {
      title:      document.getElementById('title').value.trim(),
      genre:      document.getElementById('genre').value.trim(),
      world_view: document.getElementById('world-view').value.trim(),
      characters,
      style: {
        tone: document.getElementById('style-tone').value.trim(),
        pace: document.getElementById('style-pace').value.trim(),
        pov:  document.getElementById('style-pov').value.trim(),
      },
      constraints: {
        forbidden_themes:  splitTrim(document.getElementById('forbidden-themes').value),
        forbidden_devices: [],
      },
    },
    brief: {
      scene_brief:          document.getElementById('scene-brief').value.trim(),
      scene_setting:        document.getElementById('scene-setting').value.trim(),
      goal:                 document.getElementById('goal').value.trim(),
      involved_characters:  splitTrim(document.getElementById('involved-characters').value),
      must_include:         splitTrim(document.getElementById('must-include').value),
      must_avoid:           splitTrim(document.getElementById('must-avoid').value),
      pace_for_this_round:  document.getElementById('pace').value.trim(),
      emotional_arc:        document.getElementById('emotional-arc').value.trim(),
      target_length:        parseInt(document.getElementById('target-length').value, 10),
    },
  };
}

// ── 逐步追加辩论卡片 ──────────────────────────────────────────────────────────

function appendDebateCard(entry) {
  const container = document.getElementById('debate-log');
  const card = document.createElement('div');
  card.className = 'debate-card';

  const roleName  = ROLE_NAMES[entry.role]  || entry.role;
  const modeName  = MODE_NAMES[entry.mode]  || entry.mode;
  const charCount = entry.output.length;

  card.innerHTML = `
    <div class="debate-card-header">
      <span class="role-badge role-${escHtml(entry.role)}">${escHtml(roleName)}</span>
      <span class="mode-label">${escHtml(modeName)}</span>
      <span class="char-count">${charCount} 字</span>
      <span class="expand-icon">▶</span>
    </div>
    <div class="debate-card-body">${escHtml(entry.output)}</div>
  `;

  card.querySelector('.debate-card-header').addEventListener('click', () => {
    card.classList.toggle('expanded');
  });

  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
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
    const typeName = DECISION_TYPE_NAMES[d.type] || d.type;
    const revName  = REVERSIBILITY_NAMES[d.reversibility] || d.reversibility;
    card.innerHTML = `
      <div class="decision-type">${escHtml(typeName)}</div>
      <div class="decision-desc">${escHtml(d.description)}</div>
      <div class="decision-rev">可逆性：${escHtml(revName)}</div>
    `;
    container.appendChild(card);
  });
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 主流程（WebSocket）────────────────────────────────────────────────────────

function runDecision() {
  const btn       = document.getElementById('run-btn');
  const debateLog = document.getElementById('debate-log');
  const sceneText = document.getElementById('scene-text');
  const decisions = document.getElementById('decisions');

  btn.disabled    = true;
  btn.textContent = '创作中…';
  debateLog.innerHTML = '<p class="loading-msg">委员会正在开会，请稍候…</p>';
  sceneText.textContent = '';
  decisions.innerHTML   = '';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws/run`);
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

    } else if (msg.type === 'done') {
      sceneText.textContent = msg.scene_text;
      renderDecisions(msg.major_decisions);
      if (msg.chapter_summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'chapter-summary';
        summaryEl.innerHTML = '<strong>本回摘要</strong><p>' + escHtml(msg.chapter_summary) + '</p>';
        decisions.insertAdjacentElement('afterbegin', summaryEl);
      }

    } else if (msg.type === 'error') {
      debateLog.innerHTML += `<p style="color:#c06060;padding:20px 0">${escHtml(msg.message)}</p>`;
    }
  };

  ws.onclose = () => {
    btn.disabled    = false;
    btn.textContent = '开始创作';
  };

  ws.onerror = () => {
    debateLog.innerHTML = '<p style="color:#c06060;padding:20px 0">WebSocket 连接错误，请确认服务器正在运行。</p>';
    btn.disabled    = false;
    btn.textContent = '开始创作';
  };
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  DEFAULT_CHARACTERS.forEach(addCharacterRow);

  document.getElementById('add-character').addEventListener('click', () => addCharacterRow());

  const slider  = document.getElementById('target-length');
  const display = document.getElementById('length-display');
  slider.addEventListener('input', () => { display.textContent = slider.value; });

  document.getElementById('run-btn').addEventListener('click', runDecision);

  initSettings();
});

// ── API Key 设置 ──────────────────────────────────────────────────────────────

const PROVIDERS = ['claude', 'deepseek', 'gemini'];

function initSettings() {
  const overlay     = document.getElementById('settings-overlay');
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn    = document.getElementById('settings-close');
  const saveBtn     = document.getElementById('settings-save');

  settingsBtn.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  saveBtn.addEventListener('click', saveSettings);

  // "修改" 按钮：点击后隐藏已配置行，显示输入框
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

      // badge
      if (info.key_configured) {
        badge.textContent = '已配置';
        badge.className   = 'provider-badge configured';
      } else {
        badge.textContent = '未配置';
        badge.className   = 'provider-badge unconfigured';
      }

      // key 行：已配置时显示"已配置 ✓"行，隐藏输入框；未配置时直接显示输入框
      if (info.key_configured) {
        keyRow.classList.remove('hidden');
        keyInput.classList.add('hidden');
        keyInput.value = '';
      } else {
        keyRow.classList.add('hidden');
        keyInput.classList.remove('hidden');
        keyInput.value = '';
      }

      // base url：显示用户已设置的值（若有），否则留空（placeholder 展示官方地址）
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
    // 只有输入框可见且有内容时才传 key（避免覆盖已配置的 key）
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
    // 刷新 badge 状态
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
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.claude?.key_configured) {
      showNoBanner();
    }
  } catch (_) { /* 服务器未就绪，忽略 */ }
}

function showNoBanner() {
  if (document.getElementById('no-key-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'no-key-banner';
  banner.className = 'no-key-banner';
  banner.innerHTML = `
    <span>尚未配置 Claude API Key，无法开始创作。</span>
    <button id="banner-settings-btn">去设置</button>
  `;
  banner.querySelector('#banner-settings-btn').addEventListener('click', openSettings);
  const header = document.querySelector('header');
  header.insertAdjacentElement('afterend', banner);
}

function removeBanner() {
  const b = document.getElementById('no-key-banner');
  if (b) b.remove();
}
