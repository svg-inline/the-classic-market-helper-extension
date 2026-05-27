(() => {
  'use strict';

  if (window.__TCMH_CONTENT_LOADED__) {
    return;
  }

  window.__TCMH_CONTENT_LOADED__ = true;

  const { TcmhMarket, TcmhStorage } = window;
  const PANEL_ID = 'tcmh-market-helper';

  let currentState = null;
  let currentAlarm = null;
  let filterValue = '';
  let searchStatus = '';
  let collapsed = false;
  let currentItem = null;
  let busy = false;

  const sendMessage = (payload) => new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response || {}));
  });

  const getCurrentSnapshot = (item) => {
    if (!item) {
      return null;
    }

    const key = TcmhMarket.slugKey(item);
    return TcmhMarket.parseSnapshotFromDocument(document, {
      url: window.location.href,
      itemKey: key,
      itemName: item.item_name,
      iconUrl: item.iconUrl || ''
    });
  };

  const hydrateState = async () => {
    const response = await sendMessage({ type: 'GET_STATE' });
    currentState = response.state || await TcmhStorage.getState();
    currentAlarm = response.alarm || null;
    return currentState;
  };

  const upsertCurrentHistory = async () => {
    currentItem = TcmhMarket.createItemFromPage(document);

    if (!currentItem) {
      return;
    }

    const snapshot = getCurrentSnapshot(currentItem);
    const response = await sendMessage({
      type: 'UPSERT_HISTORY',
      item: currentItem,
      snapshot
    });

    if (response.state) {
      currentState = response.state;
    }
  };

  const getPanel = () => document.getElementById(PANEL_ID);
  const normalizedSearch = (value) => TcmhMarket.normalizeSpace(value).replace(/^#/, '').toLowerCase();

  const metricLabel = (key) => ({
    latestDate: 'Data',
    averagePrice: 'Últ. média',
    medianPrice: 'Últ. mediana',
    minPrice: 'Últ. mín.',
    maxPrice: 'Últ. máx.',
    lastPrice: 'Últ.',
    trades: 'Qtd.',
    filteredTrades: 'Trades',
    rawTrades: 'Brutos',
    buyTrades: 'Compras',
    sellTrades: 'Vendas',
    totalGold: 'Volume',
    periodAveragePrice: 'Média período',
    periodFilteredTrades: 'Trades período',
    trendAvg: 'Var. período',
    sampleDays: 'Dias',
    updatedAt: 'Atualizado em'
  }[key] || key);

  const METRIC_ORDER = [
    'latestDate',
    'averagePrice',
    'medianPrice',
    'minPrice',
    'maxPrice',
    'filteredTrades',
    'buyTrades',
    'sellTrades',
    'periodAveragePrice',
    'periodFilteredTrades',
    'trendAvg'
  ];

  const renderMetrics = (snapshot) => {
    if (!snapshot?.metrics) {
      return '<div class="tcmh-item__metrics tcmh-muted">Sem snapshot</div>';
    }

    const entries = METRIC_ORDER
      .filter((key) => Boolean(snapshot.metrics[key]))
      .map((key) => [key, snapshot.metrics[key]]);

    if (!entries.length) {
      return `<div class="tcmh-item__metrics tcmh-muted">Snapshot salvo, parser ${TcmhMarket.escapeHTML(snapshot.parserConfidence || 'baixo')}</div>`;
    }

    const confidenceLabel = snapshot.parserConfidence === 'high' ? 'preciso' : snapshot.parserConfidence || 'baixo';

    return `<div class="tcmh-item__metrics" title="Parser: ${TcmhMarket.escapeHTML(confidenceLabel)}">${entries.map(([key, value]) => `
      <span class="tcmh-metric"><strong>${TcmhMarket.escapeHTML(metricLabel(key))}</strong> ${TcmhMarket.escapeHTML(value)}</span>
    `).join('')}</div>`;
  };

  const renderItem = (item, kind) => {
    const key = TcmhMarket.slugKey(item);
    const snapshot = currentState?.snapshots?.[key];
    const settings = currentState?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const url = TcmhMarket.buildMarketUrl(item, settings);
    const name = item.item_name || item.q || item.item_id || key;
    const subtitleParts = [
      item.item_id ? `ID ${item.item_id}` : '',
      item.start_date && item.end_date ? `${item.start_date} - ${item.end_date}` : '',
      snapshot?.capturedAt ? `Atualizado ${TcmhMarket.humanDateTime(snapshot.capturedAt)}` : ''
    ].filter(Boolean);

    return `
      <article class="tcmh-item" data-key="${TcmhMarket.escapeHTML(key)}" data-kind="${TcmhMarket.escapeHTML(kind)}">
        <div class="tcmh-item__main">
          <a class="tcmh-item__title" href="${TcmhMarket.escapeHTML(url)}">${TcmhMarket.escapeHTML(name)}</a>
          <div class="tcmh-item__meta">${TcmhMarket.escapeHTML(subtitleParts.join(' • '))}</div>
          ${renderMetrics(snapshot)}
        </div>
        <div class="tcmh-item__actions">
          ${kind === 'pinned' ? `<button class="tcmh-icon-button" type="button" data-action="refresh-item" data-key="${TcmhMarket.escapeHTML(key)}" title="Atualizar este item">↻</button>` : ''}
          <button class="tcmh-icon-button" type="button" data-action="${kind === 'pinned' ? 'unpin' : 'remove-history'}" data-key="${TcmhMarket.escapeHTML(key)}" title="Remover">×</button>
        </div>
      </article>
    `;
  };

  const matchesFilter = (item) => {
    if (!filterValue) {
      return true;
    }

    const haystack = [item.item_name, item.item_id, item.q, item.game].join(' ').toLowerCase();
    return haystack.includes(filterValue.toLowerCase());
  };

  const itemMatchesSearch = (item, query, exactOnly = false) => {
    const needle = normalizedSearch(query);

    if (!needle || !item) {
      return false;
    }

    const snapshot = currentState?.snapshots?.[TcmhMarket.slugKey(item)];
    const exactValues = [item.item_id, item.item_name, item.q, snapshot?.itemName]
      .filter(Boolean)
      .map((value) => normalizedSearch(value));

    if (exactValues.includes(needle)) {
      return true;
    }

    if (exactOnly) {
      return false;
    }

    return [item.item_name, item.item_id, item.q, item.game, snapshot?.itemName]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  };

  const findItemFromSearch = (query) => {
    const lists = [currentState?.pinned || [], currentState?.history || []];
    const items = Array.from(new Map(lists.flat().map((item) => [TcmhMarket.slugKey(item), item])).values());
    const exactMatches = items.filter((item) => itemMatchesSearch(item, query, true));

    if (exactMatches.length === 1) {
      return exactMatches[0];
    }

    return null;
  };

  const relatedMatchesFromSearch = (relatedItems, query) => {
    const needle = normalizedSearch(query);
    const related = Array.isArray(relatedItems) ? relatedItems : [];

    const exactMatches = related.filter((item) => normalizedSearch(item.item_id) === needle || normalizedSearch(item.item_name) === needle);
    if (exactMatches.length) {
      return exactMatches;
    }

    const prefixMatches = related.filter((item) => normalizedSearch(item.item_name).startsWith(needle));
    if (prefixMatches.length) {
      return prefixMatches;
    }

    return related.length === 1 ? related : [];
  };

  const itemFromRelatedSearch = (searchItem, relatedItem) => ({
    ...searchItem,
    q: '',
    item_id: relatedItem.item_id,
    item_name: relatedItem.item_name,
    iconUrl: relatedItem.iconUrl || '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const storeRelatedMatches = async (searchItem, matches) => {
    const items = matches.map((relatedItem) => itemFromRelatedSearch(searchItem, relatedItem));
    const response = await sendMessage({ type: 'UPSERT_HISTORY_ITEMS', items });
    currentState = response.state || currentState;
    return items;
  };

  const itemFromSnapshot = (item, snapshot) => {
    const latestId = String(snapshot?.stats?.latest?.item_id || '').trim();
    const itemId = latestId || item.item_id || '';
    const itemName = snapshot?.itemName || item.item_name || item.q || itemId;
    const iconUrl = snapshot?.iconUrl || item.iconUrl || '';

    return {
      ...item,
      item_id: itemId,
      item_name: itemName,
      iconUrl,
      updatedAt: Date.now()
    };
  };

  const refreshAndStoreItem = async (item) => {
    const refreshResponse = await sendMessage({ type: 'REFRESH_ITEM', item });
    const snapshot = refreshResponse.snapshot || null;
    const normalizedItem = itemFromSnapshot(item, snapshot);
    const historyResponse = await sendMessage({ type: 'UPSERT_HISTORY', item: normalizedItem, snapshot });
    currentState = historyResponse.state || refreshResponse.state || currentState;
    return { item: normalizedItem, snapshot };
  };

  const renderList = (items, kind) => {
    const filtered = (items || []).filter(matchesFilter);

    if (!filtered.length) {
      return `<div class="tcmh-empty">Nenhum item ${kind === 'pinned' ? 'fixado' : 'no histórico'}.</div>`;
    }

    return filtered.map((item) => renderItem(item, kind)).join('');
  };

  const getRefreshLabel = () => {
    const settings = currentState?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const preset = TcmhStorage.REFRESH_PRESETS[settings.refreshPreset];

    if (settings.refreshPreset === 'custom') {
      return `Personalizado: ${settings.customHours}h`;
    }

    return preset?.label || 'Cada 5 horas';
  };

  const renderPanel = () => {
    const panel = getPanel();
    if (!panel || !currentState) {
      return;
    }

    const settings = currentState.settings || TcmhStorage.DEFAULT_SETTINGS;
    const pinnedCount = currentState.pinned?.length || 0;
    const historyCount = currentState.history?.length || 0;
    const nextRun = currentAlarm?.scheduledTime ? TcmhMarket.humanDateTime(currentAlarm.scheduledTime) : 'Não agendado';
    const currentName = currentItem?.item_name || currentItem?.q || currentItem?.item_id || 'Nenhum item atual';

    panel.innerHTML = `
      <div class="tcmh-shell ${collapsed ? 'is-collapsed' : ''}">
        <header class="tcmh-header">
          <button class="tcmh-title-button" type="button" data-action="toggle-panel">
            <span class="tcmh-title">Market Helper</span>
            <span class="tcmh-count">${pinnedCount}</span>
          </button>
          <button class="tcmh-icon-button" type="button" data-action="toggle-panel" title="Minimizar">${collapsed ? '▣' : '–'}</button>
        </header>

        <div class="tcmh-body">
          <section class="tcmh-current">
            <div class="tcmh-current__label">Item atual</div>
            <div class="tcmh-current__name">${TcmhMarket.escapeHTML(currentName)}</div>
            <div class="tcmh-actions-row">
              <button class="tcmh-button" type="button" data-action="pin-current" ${currentItem ? '' : 'disabled'}>Fixar item atual</button>
              <button class="tcmh-button tcmh-button--secondary" type="button" data-action="refresh-current" ${currentItem ? '' : 'disabled'}>Atualizar</button>
            </div>
          </section>

          <section class="tcmh-settings-summary">
            <div><strong>Auto:</strong> ${settings.autoRefreshEnabled ? 'ativo' : 'desativado'}</div>
            <div><strong>Intervalo:</strong> ${TcmhMarket.escapeHTML(getRefreshLabel())}</div>
            <div><strong>Próximo:</strong> ${TcmhMarket.escapeHTML(nextRun)}</div>
          </section>

          <form class="tcmh-toolbar" data-role="search-form">
            <input class="tcmh-input" type="search" data-role="filter" placeholder="Filtrar por nome ou ID" value="${TcmhMarket.escapeHTML(filterValue)}">
            <button class="tcmh-icon-button" type="submit" title="Buscar item por nome ou ID">⌕</button>
            <button class="tcmh-icon-button" type="button" data-action="open-dashboard" title="Dashboard full screen">▣</button>
            <button class="tcmh-icon-button" type="button" data-action="open-options" title="Opções">⚙</button>
          </form>
          ${searchStatus ? `<div class="tcmh-search-status">${TcmhMarket.escapeHTML(searchStatus)}</div>` : ''}

          <div class="tcmh-actions-row">
            <button class="tcmh-button tcmh-button--secondary" type="button" data-action="refresh-all" ${pinnedCount ? '' : 'disabled'}>${busy ? 'Atualizando...' : 'Atualizar fixados'}</button>
          </div>

          <section class="tcmh-section">
            <h3>Fixados</h3>
            <div class="tcmh-list">${renderList(currentState.pinned, 'pinned')}</div>
          </section>

          <section class="tcmh-section">
            <h3>Histórico</h3>
            <div class="tcmh-list">${renderList(currentState.history, 'history')}</div>
          </section>
        </div>
      </div>
    `;
  };

  const mountPanel = () => {
    if (getPanel()) {
      return;
    }

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'The Classic Market Helper');
    document.body.append(panel);
  };

  const findItemByKey = (key) => {
    const lists = [currentState?.pinned || [], currentState?.history || []];
    return lists.flat().find((item) => TcmhMarket.slugKey(item) === key) || null;
  };

  const navigateToItem = (item) => {
    const settings = currentState?.settings || TcmhStorage.DEFAULT_SETTINGS;
    window.location.assign(TcmhMarket.buildMarketUrl(item, settings));
  };

  const searchItemDirectly = async (query) => {
    const term = TcmhMarket.normalizeSpace(query);

    if (!term) {
      return;
    }

    const localItem = findItemFromSearch(term);
    if (localItem) {
      navigateToItem(localItem);
      return;
    }

    const settings = currentState?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const searchItem = TcmhMarket.createItemFromSearch(term, settings);
    if (!searchItem) {
      return;
    }

    busy = true;
    searchStatus = 'Buscando item...';
    renderPanel();

    try {
      const refreshResponse = await sendMessage({ type: 'REFRESH_ITEM', item: searchItem });
      const snapshot = refreshResponse.snapshot || null;
      currentState = refreshResponse.state || currentState;
      const relatedMatches = !searchItem.item_id ? relatedMatchesFromSearch(snapshot?.relatedItems, term) : [];

      if (relatedMatches.length > 1) {
        const storedItems = await storeRelatedMatches(searchItem, relatedMatches);
        searchStatus = `${storedItems.length} resultados encontrados. Escolha o item correto no histórico.`;
        busy = false;
        renderPanel();
        return;
      }

      if (relatedMatches.length === 1 && relatedMatches[0]?.item_id) {
        const directItem = itemFromRelatedSearch(searchItem, relatedMatches[0]);
        const directResult = await refreshAndStoreItem(directItem);
        navigateToItem(directResult.item);
        return;
      }

      const normalizedItem = itemFromSnapshot(searchItem, snapshot);
      const historyResponse = await sendMessage({ type: 'UPSERT_HISTORY', item: normalizedItem, snapshot });
      currentState = historyResponse.state || currentState;
      navigateToItem(normalizedItem);
    } catch (error) {
      searchStatus = `Falha na busca: ${error.message || String(error)}`;
      busy = false;
      renderPanel();
    }
  };

  const handleAction = async (action, target) => {
    if (action === 'toggle-panel') {
      collapsed = !collapsed;
      renderPanel();
      return;
    }

    if (action === 'open-dashboard' || action === 'open-options') {
      await sendMessage({ type: 'OPEN_DASHBOARD' });
      return;
    }

    if (action === 'pin-current') {
      if (!currentItem) {
        return;
      }

      const snapshot = getCurrentSnapshot(currentItem);
      const response = await sendMessage({ type: 'PIN_ITEM', item: currentItem, snapshot });
      currentState = response.state || currentState;
      renderPanel();
      return;
    }

    if (action === 'refresh-current') {
      if (!currentItem) {
        return;
      }

      busy = true;
      renderPanel();
      const response = await sendMessage({ type: 'REFRESH_ITEM', item: currentItem });
      currentState = response.state || currentState;
      busy = false;
      renderPanel();
      return;
    }

    if (action === 'refresh-all') {
      busy = true;
      renderPanel();
      const response = await sendMessage({ type: 'REFRESH_ALL' });
      currentState = response.state || currentState;
      busy = false;
      renderPanel();
      return;
    }

    if (action === 'refresh-item') {
      const key = target.getAttribute('data-key');
      const item = findItemByKey(key);
      if (!item) {
        return;
      }

      busy = true;
      renderPanel();
      const response = await sendMessage({ type: 'REFRESH_ITEM', item });
      currentState = response.state || currentState;
      busy = false;
      renderPanel();
      return;
    }

    if (action === 'unpin') {
      const key = target.getAttribute('data-key');
      const response = await sendMessage({ type: 'UNPIN_ITEM', key });
      currentState = response.state || currentState;
      renderPanel();
      return;
    }

    if (action === 'remove-history') {
      const key = target.getAttribute('data-key');
      const response = await sendMessage({ type: 'REMOVE_HISTORY', key });
      currentState = response.state || currentState;
      renderPanel();
    }
  };

  const bindEvents = () => {
    document.addEventListener('click', async (event) => {
      const actionTarget = event.target.closest?.('[data-action]');
      if (!actionTarget || !getPanel()?.contains(actionTarget)) {
        return;
      }

      event.preventDefault();
      const action = actionTarget.getAttribute('data-action');
      await handleAction(action, actionTarget);
    });

    document.addEventListener('input', (event) => {
      const input = event.target.closest?.('[data-role="filter"]');
      if (!input || !getPanel()?.contains(input)) {
        return;
      }

      filterValue = input.value;
      renderPanel();
      const nextInput = getPanel()?.querySelector('[data-role="filter"]');
      nextInput?.focus();
      nextInput?.setSelectionRange?.(filterValue.length, filterValue.length);
    });

    document.addEventListener('submit', async (event) => {
      const form = event.target.closest?.('[data-role="search-form"]');
      if (!form || !getPanel()?.contains(form)) {
        return;
      }

      event.preventDefault();
      await searchItemDirectly(filterValue);
    });
  };

  const init = async () => {
    mountPanel();
    await hydrateState();
    await upsertCurrentHistory();
    await hydrateState();
    bindEvents();
    renderPanel();
  };

  init().catch((error) => {
    console.error('[TCMH] Falha ao inicializar extensão:', error);
  });
})();
