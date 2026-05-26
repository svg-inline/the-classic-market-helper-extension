(() => {
  'use strict';

  const { TcmhMarket, TcmhStorage } = window;
  let state = null;
  let alarm = null;

  const sendMessage = (payload) => new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response || {}));
  });

  const setStatus = (id, message) => {
    document.getElementById(id).textContent = message;
  };

  const getSettingsFromForm = () => ({
    autoRefreshEnabled: document.getElementById('autoRefreshEnabled').checked,
    refreshPreset: document.getElementById('refreshPreset').value,
    customHours: Math.max(1, Number(document.getElementById('customHours').value) || 24),
    dateMode: document.getElementById('dateMode').value,
    rollingDays: Math.max(1, Number(document.getElementById('rollingDays').value) || 30),
    maxHistory: Math.max(10, Number(document.getElementById('maxHistory').value) || 50),
    notifyOnRefreshError: document.getElementById('notifyOnRefreshError').checked,
    notifyOnRefreshSuccess: document.getElementById('notifyOnRefreshSuccess').checked
  });

  const updateConditionalFields = () => {
    const refreshPreset = document.getElementById('refreshPreset').value;
    const dateMode = document.getElementById('dateMode').value;

    document.getElementById('customHoursField').hidden = refreshPreset !== 'custom';
    document.getElementById('rollingDaysField').hidden = dateMode !== 'rolling';
  };

  const fillForm = () => {
    const settings = state?.settings || TcmhStorage.DEFAULT_SETTINGS;

    document.getElementById('autoRefreshEnabled').checked = Boolean(settings.autoRefreshEnabled);
    document.getElementById('refreshPreset').value = settings.refreshPreset || 'every_5_hours';
    document.getElementById('customHours').value = settings.customHours || 24;
    document.getElementById('dateMode').value = settings.dateMode || 'saved';
    document.getElementById('rollingDays').value = settings.rollingDays || 30;
    document.getElementById('maxHistory').value = settings.maxHistory || 50;
    document.getElementById('notifyOnRefreshError').checked = Boolean(settings.notifyOnRefreshError);
    document.getElementById('notifyOnRefreshSuccess').checked = Boolean(settings.notifyOnRefreshSuccess);
    updateConditionalFields();
  };

  const renderStatus = () => {
    const settings = state?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const preset = TcmhStorage.REFRESH_PRESETS[settings.refreshPreset];
    const interval = settings.refreshPreset === 'custom' ? `${settings.customHours}h` : preset?.label || 'Cada 5 horas';
    const nextRun = alarm?.scheduledTime ? TcmhMarket.humanDateTime(alarm.scheduledTime) : 'Não agendado';
    const el = document.getElementById('statusGrid');

    el.innerHTML = `
      <div class="status-item"><strong>Fixados</strong><span>${state?.pinned?.length || 0}</span></div>
      <div class="status-item"><strong>Histórico</strong><span>${state?.history?.length || 0}</span></div>
      <div class="status-item"><strong>Intervalo</strong><span>${TcmhMarket.escapeHTML(interval)}</span></div>
      <div class="status-item"><strong>Próxima execução</strong><span>${TcmhMarket.escapeHTML(nextRun)}</span></div>
      <div class="status-item"><strong>Última execução</strong><span>${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(state?.lastRefresh))}</span></div>
      <div class="status-item"><strong>Status</strong><span>${TcmhMarket.escapeHTML(state?.lastRefreshStatus || 'never')}</span></div>
    `;
  };

  const renderPinned = () => {
    const el = document.getElementById('pinnedList');
    const items = state?.pinned || [];

    if (!items.length) {
      el.innerHTML = '<div class="empty">Nenhum item fixado ainda.</div>';
      return;
    }

    el.innerHTML = items.map((item) => {
      const key = TcmhMarket.slugKey(item);
      const snapshot = state.snapshots?.[key];
      const url = TcmhMarket.buildMarketUrl(item, state.settings);
      const name = item.item_name || item.q || item.item_id || key;
      const updated = snapshot?.capturedAt ? TcmhMarket.humanDateTime(snapshot.capturedAt) : 'Sem snapshot';
      const ok = snapshot ? (snapshot.ok ? 'OK' : 'Falhou') : 'Pendente';

      return `
        <article class="item">
          <div>
            <a href="${TcmhMarket.escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${TcmhMarket.escapeHTML(name)}</a>
            <p>ID ${TcmhMarket.escapeHTML(item.item_id || '-')} • ${TcmhMarket.escapeHTML(updated)} • ${TcmhMarket.escapeHTML(ok)}</p>
          </div>
          <button class="button button--secondary" type="button" data-action="refresh-item" data-key="${TcmhMarket.escapeHTML(key)}">Atualizar</button>
        </article>
      `;
    }).join('');
  };

  const render = () => {
    fillForm();
    renderStatus();
    renderPinned();
    document.getElementById('refreshAll').disabled = !(state?.pinned?.length);
  };

  const load = async () => {
    const response = await sendMessage({ type: 'GET_STATE' });
    state = response.state || await TcmhStorage.getState();
    alarm = response.alarm || null;
    render();
  };

  const findPinnedByKey = (key) => (state?.pinned || []).find((item) => TcmhMarket.slugKey(item) === key);

  document.getElementById('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('settingsStatus', 'Salvando...');

    const response = await sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: getSettingsFromForm()
    });

    state = response.state || state;
    alarm = response.alarm || alarm;
    render();
    setStatus('settingsStatus', 'Opções salvas.');
  });

  document.getElementById('refreshPreset').addEventListener('change', updateConditionalFields);
  document.getElementById('dateMode').addEventListener('change', updateConditionalFields);

  document.getElementById('refreshAll').addEventListener('click', async () => {
    const button = document.getElementById('refreshAll');
    button.disabled = true;
    button.textContent = 'Atualizando...';

    const response = await sendMessage({ type: 'REFRESH_ALL' });
    state = response.state || state;
    button.textContent = 'Atualizar fixados agora';
    await load();
  });

  document.getElementById('pinnedList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="refresh-item"]');
    if (!button) {
      return;
    }

    const item = findPinnedByKey(button.getAttribute('data-key'));
    if (!item) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Atualizando...';

    const response = await sendMessage({ type: 'REFRESH_ITEM', item });
    state = response.state || state;
    await load();
  });

  document.getElementById('exportData').addEventListener('click', async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: state?.schemaVersion || 1,
      settings: state?.settings || {},
      pinned: state?.pinned || [],
      history: state?.history || [],
      snapshots: state?.snapshots || {},
      alerts: state?.alerts || []
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `the-classic-market-helper-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('dataStatus', 'JSON exportado.');
  });

  document.getElementById('importData').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await sendMessage({ type: 'IMPORT_STATE', payload });
      state = response.state || state;
      alarm = response.alarm || alarm;
      render();
      setStatus('dataStatus', 'JSON importado.');
    } catch (error) {
      setStatus('dataStatus', `Falha ao importar: ${error.message || String(error)}`);
    } finally {
      event.target.value = '';
    }
  });

  load().catch((error) => {
    document.body.innerHTML = `<main class="page"><section class="card"><p class="muted">Falha ao carregar opções: ${TcmhMarket.escapeHTML(error.message || String(error))}</p></section></main>`;
  });
})();
