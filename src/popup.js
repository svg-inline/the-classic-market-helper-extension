(() => {
  'use strict';

  const { TcmhMarket, TcmhStorage } = window;
  let state = null;
  let alarm = null;

  const sendMessage = (payload) => new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response || {}));
  });

  const renderStats = () => {
    const el = document.getElementById('stats');
    const settings = state?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const preset = TcmhStorage.REFRESH_PRESETS[settings.refreshPreset];
    const interval = settings.refreshPreset === 'custom' ? `${settings.customHours}h` : preset?.label || 'Cada 5 horas';
    const nextRun = alarm?.scheduledTime ? TcmhMarket.humanDateTime(alarm.scheduledTime) : 'Não agendado';

    el.innerHTML = `
      <div class="stat"><strong>Fixados</strong><span>${state?.pinned?.length || 0}</span></div>
      <div class="stat"><strong>Histórico</strong><span>${state?.history?.length || 0}</span></div>
      <div class="stat"><strong>Auto atualização</strong><span>${settings.autoRefreshEnabled ? 'Ativa' : 'Desativada'}</span></div>
      <div class="stat"><strong>Intervalo</strong><span>${TcmhMarket.escapeHTML(interval)}</span></div>
      <div class="stat"><strong>Última execução</strong><span>${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(state?.lastRefresh))}</span></div>
      <div class="stat"><strong>Próxima execução</strong><span>${TcmhMarket.escapeHTML(nextRun)}</span></div>
      <div class="stat"><strong>Status</strong><span>${TcmhMarket.escapeHTML(state?.lastRefreshStatus || 'never')}</span></div>
    `;
  };

  const renderPinned = () => {
    const el = document.getElementById('pinnedList');
    const items = (state?.pinned || []).slice(0, 5);

    if (!items.length) {
      el.innerHTML = '<div class="empty">Nenhum item fixado.</div>';
      return;
    }

    el.innerHTML = items.map((item) => {
      const key = TcmhMarket.slugKey(item);
      const snapshot = state.snapshots?.[key];
      const url = TcmhMarket.buildMarketUrl(item, state.settings);
      const name = item.item_name || item.q || item.item_id || key;
      const updated = snapshot?.capturedAt ? TcmhMarket.humanDateTime(snapshot.capturedAt) : 'Sem snapshot';

      return `
        <article class="item">
          <a href="${TcmhMarket.escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${TcmhMarket.escapeHTML(name)}</a>
          <p>ID ${TcmhMarket.escapeHTML(item.item_id || '-')} • ${TcmhMarket.escapeHTML(updated)}</p>
        </article>
      `;
    }).join('');
  };

  const render = () => {
    renderStats();
    renderPinned();
    document.getElementById('refreshAll').disabled = !(state?.pinned?.length);
  };

  const load = async () => {
    const response = await sendMessage({ type: 'GET_STATE' });
    state = response.state || await TcmhStorage.getState();
    alarm = response.alarm || null;
    render();
  };

  document.getElementById('openDashboard').addEventListener('click', async () => {
    await sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });

  document.getElementById('refreshAll').addEventListener('click', async () => {
    const button = document.getElementById('refreshAll');
    button.disabled = true;
    button.textContent = 'Atualizando...';

    const response = await sendMessage({ type: 'REFRESH_ALL' });
    state = response.state || state;
    button.textContent = 'Atualizar fixados';
    await load();
  });

  load().catch((error) => {
    document.body.innerHTML = `<main class="popup"><p class="empty">Falha ao carregar: ${TcmhMarket.escapeHTML(error.message || String(error))}</p></main>`;
  });
})();
