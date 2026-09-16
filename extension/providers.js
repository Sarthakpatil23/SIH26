// Browy Custom Providers Page logic.
// Manages OmniRoute, DeepSeek, OpenRouter, Ollama, and custom OpenAI-compatible gateways.

(function () {
  const PRESETS = {
    omniroute: {
      name: 'OmniRoute (Local)',
      type: 'omniroute',
      url: 'http://localhost:20128/v1',
      models: 'auto, auto/best-coding, auto/best-reasoning, deepseek-chat, deepseek-reasoner',
      defaultModel: 'auto',
    },
    deepseek: {
      name: 'DeepSeek Official',
      type: 'deepseek',
      url: 'https://api.deepseek.com/v1',
      models: 'deepseek-chat, deepseek-reasoner',
      defaultModel: 'deepseek-chat',
    },
    openrouter: {
      name: 'OpenRouter',
      type: 'openai-compatible',
      url: 'https://openrouter.ai/api/v1',
      models: 'deepseek/deepseek-chat, anthropic/claude-3.5-sonnet, openai/gpt-4o',
      defaultModel: 'deepseek/deepseek-chat',
    },
    ollama: {
      name: 'Ollama (Local)',
      type: 'openai-compatible',
      url: 'http://localhost:11434/v1',
      models: 'qwen2.5-coder:latest, llama3.3:latest, deepseek-r1:latest',
      defaultModel: 'qwen2.5-coder:latest',
    },
    custom: {
      name: 'Custom Provider',
      type: 'openai-compatible',
      url: 'https://api.your-endpoint.com/v1',
      models: 'default-model',
      defaultModel: 'default-model',
    },
  };

  // ── DOM Elements ──────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const activeProviderName = $('activeProviderName');
  const activeProviderMeta = $('activeProviderMeta');
  const resetCopilotBtn    = $('resetCopilotBtn');
  const providersList      = $('providersList');
  const providerFormCard   = $('providerFormCard');
  const formTitle          = $('formTitle');
  const providerForm       = $('providerForm');
  const providerId         = $('providerId');
  const providerName       = $('providerName');
  const providerType       = $('providerType');
  const providerUrl        = $('providerUrl');
  const providerKey        = $('providerKey');
  const toggleKeyBtn       = $('toggleKeyBtn');
  const providerModels     = $('providerModels');
  const providerDefaultModel = $('providerDefaultModel');
  const addNewBtn          = $('addNewBtn');
  const cancelFormBtn      = $('cancelFormBtn');
  const testFormBtn        = $('testFormBtn');
  const toast              = $('toast');

  let activeProviderId = null;
  let providers = [];
  let port = null;

  // ── Toast Helper ──────────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, type = '') {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 3500);
  }

  // ── Persistence: chrome.storage + Host sync ──────────────────────────────
  async function loadFromStorage() {
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      if (settings?.providersData) {
        providers = settings.providersData.providers || [];
        activeProviderId = settings.providersData.activeProviderId || null;
        render();
      }
    } catch {}
  }

  async function saveToStorage() {
    try {
      const { settings = {} } = await chrome.storage.local.get(['settings']);
      settings.providersData = {
        activeProviderId,
        providers,
      };
      await chrome.storage.local.set({ settings });
    } catch {}
  }

  // ── Native Host Port ──────────────────────────────────────────────────────
  function connectHost() {
    try {
      port = chrome.runtime.connect({ name: 'providers' });
      port.onMessage.addListener((msg) => {
        if (msg.type === 'provider.list.result') {
          activeProviderId = msg.activeProviderId;
          providers = msg.providers || [];
          saveToStorage();
          render();
        } else if (msg.type === 'provider.test.result') {
          if (msg.ok) {
            showToast(`✓ Connection successful! ${msg.models?.length ? `(${msg.models.length} models detected)` : ''}`, 'ok');
          } else {
            showToast(`✕ Connection failed: ${msg.error || 'Unknown error'}`, 'err');
          }
        }
      });

      // Request initial list
      port.postMessage({ type: 'provider.list' });
    } catch (e) {
      console.warn('Providers page: host connect error', e);
    }
  }

  function postToHost(msg) {
    if (!port) {
      connectHost();
    }
    try {
      port.postMessage(msg);
    } catch (e) {
      console.warn('postToHost failed:', e);
    }
  }

  // ── Direct Browser-side Test Connection ──────────────────────────────────
  async function testConnection(providerObj) {
    const baseUrl = (providerObj.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) {
      showToast('Base URL is required to test connection', 'err');
      return;
    }

    showToast('Testing connection…');

    // If host is connected, let the native host run the test
    if (port) {
      postToHost({ type: 'provider.test', provider: providerObj });
      return;
    }

    // Direct browser fetch fallback
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (providerObj.apiKey) {
        headers['Authorization'] = `Bearer ${providerObj.apiKey}`;
      }

      // Try GET /models
      const res = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
      if (res.ok) {
        showToast('✓ Connection successful! Endpoint is reachable.', 'ok');
        return;
      }
      showToast(`HTTP ${res.status}: ${res.statusText}`, 'err');
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'err');
    }
  }

  // ── Render UI ─────────────────────────────────────────────────────────────
  function render() {
    // 1. Active provider banner
    const active = providers.find((p) => p.id === activeProviderId);
    if (active) {
      activeProviderName.textContent = `${active.name} (${active.defaultModel || active.models[0] || 'default'})`;
      activeProviderMeta.textContent = `Custom Provider · ${active.baseUrl}`;
      resetCopilotBtn.style.display = 'inline-flex';
    } else {
      activeProviderName.textContent = 'GitHub Copilot (Built-in Default)';
      activeProviderMeta.textContent = 'Routes through your GitHub Copilot subscription';
      resetCopilotBtn.style.display = 'none';
    }

    // 2. Providers list
    providersList.innerHTML = '';
    if (!providers.length) {
      providersList.innerHTML = `
        <div class="empty-state">
          No custom providers configured yet. Click a preset above or "+ Add Custom Provider" to begin.
        </div>`;
      return;
    }

    providers.forEach((p) => {
      const card = document.createElement('div');
      const isActive = p.id === activeProviderId;
      card.className = `provider-card ${isActive ? 'is-active' : ''}`;

      const modelsArr = p.models || [];
      const modelsHtml = modelsArr.map((m) => {
        const isDef = m === p.defaultModel;
        return `<span class="model-chip ${isDef ? 'default' : ''}">${m}${isDef ? ' ★' : ''}</span>`;
      }).join('');

      card.innerHTML = `
        <div class="card-top">
          <div class="card-title-row">
            <span class="card-title">${escapeHtml(p.name)}</span>
            <span class="type-badge ${p.type}">${escapeHtml(p.type)}</span>
          </div>
          ${isActive ? `<span class="active-pill">● ACTIVE</span>` : ''}
        </div>
        <div class="card-endpoint">${escapeHtml(p.baseUrl)}</div>
        <div class="card-models-title">// Models</div>
        <div class="card-models">${modelsHtml || '<span class="model-chip">none</span>'}</div>
        <div class="card-actions">
          ${!isActive ? `<button class="btn sm outline-primary set-active-btn" data-id="${p.id}">Set as Active</button>` : ''}
          <button class="btn sm test-btn" data-id="${p.id}">Test Connection</button>
          <button class="btn sm edit-btn" data-id="${p.id}">Edit</button>
          <button class="btn sm danger del-btn" data-id="${p.id}">Delete</button>
        </div>
      `;

      providersList.appendChild(card);
    });
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Form Handling ─────────────────────────────────────────────────────────
  function openForm(providerData = null) {
    providerFormCard.classList.add('open');
    if (providerData) {
      formTitle.textContent = `Edit Provider: ${providerData.name}`;
      providerId.value = providerData.id;
      providerName.value = providerData.name;
      providerType.value = providerData.type || 'openai-compatible';
      providerUrl.value = providerData.baseUrl || '';
      providerKey.value = providerData.apiKey || '';
      providerModels.value = (providerData.models || []).join(', ');
      providerDefaultModel.value = providerData.defaultModel || '';
    } else {
      formTitle.textContent = 'Add Custom Provider';
      providerId.value = '';
      providerForm.reset();
    }
    providerName.focus();
  }

  function closeForm() {
    providerFormCard.classList.remove('open');
    providerId.value = '';
    providerForm.reset();
  }

  function getFormData() {
    const rawModels = providerModels.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const id = providerId.value || 'prov-' + Math.random().toString(36).slice(2, 10);
    const defModel = providerDefaultModel.value.trim() || rawModels[0] || 'default';

    return {
      id,
      name: providerName.value.trim(),
      type: providerType.value,
      baseUrl: providerUrl.value.trim(),
      apiKey: providerKey.value.trim(),
      models: rawModels.length ? rawModels : [defModel],
      defaultModel: defModel,
    };
  }

  // ── Event Listeners ───────────────────────────────────────────────────────
  addNewBtn.addEventListener('click', () => openForm());
  cancelFormBtn.addEventListener('click', () => closeForm());

  toggleKeyBtn.addEventListener('click', () => {
    if (providerKey.type === 'password') {
      providerKey.type = 'text';
      toggleKeyBtn.textContent = 'Hide';
    } else {
      providerKey.type = 'password';
      toggleKeyBtn.textContent = 'Show';
    }
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const presetKey = btn.getAttribute('data-preset');
      const p = PRESETS[presetKey];
      if (!p) return;
      openForm({
        id: '',
        name: p.name,
        type: p.type,
        baseUrl: p.url,
        apiKey: '',
        models: p.models.split(', ').map(s => s.trim()),
        defaultModel: p.defaultModel,
      });
      showToast(`Loaded ${p.name} template — enter your API key to finish`, 'ok');
    });
  });

  // Save form
  providerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = getFormData();
    if (!data.name || !data.baseUrl) {
      showToast('Name and Base URL are required', 'err');
      return;
    }

    const existingIdx = providers.findIndex((p) => p.id === data.id);
    if (existingIdx >= 0) {
      providers[existingIdx] = data;
    } else {
      providers.push(data);
      // Auto-activate if this is the first custom provider
      if (!activeProviderId) {
        activeProviderId = data.id;
      }
    }

    saveToStorage();
    postToHost({ type: 'provider.save', provider: data });
    if (activeProviderId === data.id) {
      postToHost({ type: 'provider.setActive', id: activeProviderId });
    }

    closeForm();
    render();
    showToast(`Saved ${data.name}`, 'ok');
  });

  // Test form button
  testFormBtn.addEventListener('click', () => {
    const data = getFormData();
    testConnection(data);
  });

  // Reset to default Copilot
  resetCopilotBtn.addEventListener('click', () => {
    activeProviderId = null;
    saveToStorage();
    postToHost({ type: 'provider.setActive', id: null });
    render();
    showToast('Switched to built-in GitHub Copilot', 'ok');
  });

  // Delegated buttons in providers list
  providersList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const p = providers.find((x) => x.id === id);
    if (!p) return;

    if (btn.classList.contains('set-active-btn')) {
      activeProviderId = id;
      saveToStorage();
      postToHost({ type: 'provider.setActive', id });
      render();
      showToast(`Activated ${p.name}`, 'ok');
    } else if (btn.classList.contains('test-btn')) {
      testConnection(p);
    } else if (btn.classList.contains('edit-btn')) {
      openForm(p);
    } else if (btn.classList.contains('del-btn')) {
      if (confirm(`Delete provider "${p.name}"?`)) {
        providers = providers.filter((x) => x.id !== id);
        if (activeProviderId === id) activeProviderId = null;
        saveToStorage();
        postToHost({ type: 'provider.delete', id });
        render();
        showToast(`Deleted ${p.name}`);
      }
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  loadFromStorage();
  connectHost();
})();
