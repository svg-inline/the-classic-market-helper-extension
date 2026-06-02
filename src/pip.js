(() => {
  "use strict";

  const { TcmhMarket, TcmhStorage } = window;
  const app = document.getElementById("app");
  const params = new URLSearchParams(window.location.search);

  let state = null;
  let alarm = null;
  let selectedKey = params.get("key") || "";
  let activeTab = params.get("tab") || "main";
  let searchValue = params.get("q") || "";
  let searchStatus = "";
  let progressMessage = "";
  let isRefreshing = false;
  let isSearching = false;

  const ALERT_LABELS = {
    avg_above: "Última média acima",
    avg_below: "Última média abaixo",
    median_above: "Última mediana acima",
    median_below: "Última mediana abaixo",
    trades_above: "Trades do último dia acima",
    variation_above: "Variação do período acima de %",
    variation_below: "Variação do período abaixo de %",
  };

  const e = (value) => TcmhMarket.escapeHTML(value ?? "");
  const n = (value) => TcmhMarket.parseNumber(value);
  const fmt = (value) => TcmhMarket.formatInteger(value);
  const itemKey = (item) => TcmhMarket.slugKey(item);

  const sendMessage = (payload) =>
    new Promise((resolve) => {
      if (!window.chrome?.runtime?.sendMessage) {
        resolve({});
        return;
      }

      chrome.runtime.sendMessage(payload, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { error: error.message } : response || {});
      });
    });

  const uniqueItems = (items) =>
    Array.from(
      new Map(
        (items || []).filter(Boolean).map((item) => [itemKey(item), item]),
      ).values(),
    );

  const allItems = () =>
    uniqueItems([...(state?.pinned || []), ...(state?.history || [])]);

  const getItem = (key = selectedKey) =>
    allItems().find((item) => itemKey(item) === key) || null;

  const getSelectedItem = () =>
    getItem(selectedKey) || state?.pinned?.[0] || state?.history?.[0] || null;

  const getSnapshot = (key = selectedKey) => state?.snapshots?.[key] || null;

  const normalizedSearch = (value) =>
    TcmhMarket.searchTokens(value).join(" ");

  const labelForItem = (item, snapshot = null) =>
    snapshot?.itemName ||
    item?.item_name ||
    item?.q ||
    item?.item_id ||
    itemKey(item || {});

  const iconForItem = (item, snapshot = null) => {
    const id = item?.item_id || snapshot?.stats?.latest?.item_id || "";
    return (
      snapshot?.iconUrl ||
      item?.iconUrl ||
      (id ? `https://theclassic.games/assets/img/iconpw126/${id}.png` : "")
    );
  };

  const avatar = (item, snapshot = null, className = "pip-avatar") => {
    const name = labelForItem(item, snapshot) || "Item";
    const iconUrl = iconForItem(item, snapshot);

    if (iconUrl) {
      return `<span class="${className}"><img src="${e(iconUrl)}" alt="${e(name)}" loading="lazy" referrerpolicy="no-referrer"></span>`;
    }

    return `<span class="${className}">${e(String(name).slice(0, 1).toUpperCase() || "?")}</span>`;
  };

  const statusInfo = (snapshot) => {
    if (!snapshot) {
      return { label: "sem dados", className: "is-warning" };
    }

    if (snapshot.loginRequired) {
      return { label: "login", className: "is-error" };
    }

    if (snapshot.ok === false) {
      return { label: "erro", className: "is-error" };
    }

    return { label: "ok", className: "is-ok" };
  };

  const trendInfo = (snapshot) => {
    const pct = n(snapshot?.stats?.trend?.avgPricePct || 0);

    if (pct > 0) {
      return {
        label: `▲ ${pct.toFixed(2).replace(".", ",")}%`,
        className: "is-positive",
      };
    }

    if (pct < 0) {
      return {
        label: `▼ ${Math.abs(pct).toFixed(2).replace(".", ",")}%`,
        className: "is-negative",
      };
    }

    return { label: "0,00%", className: "is-neutral" };
  };

  const metricCard = (label, value, modifier = "") => `
    <div class="pip-metric ${modifier}">
      <b>${e(label)}</b>
      <strong>${e(value || "-")}</strong>
    </div>
  `;

  const priceRange = (snapshot) => {
    const latest = snapshot?.stats?.latest || {};
    const period = snapshot?.stats?.period || {};
    const min = n(period.minPrice || latest.min_price);
    const avg = n(latest.avg_price || period.averagePrice);
    const max = n(period.maxPrice || latest.max_price);

    if (!min || !avg || !max || min >= max) {
      return null;
    }

    const rawPosition = ((avg - min) / (max - min)) * 100;
    const position = Math.max(0, Math.min(100, rawPosition));
    const opportunity =
      position <= 20
        ? { label: "perto da mínima", className: "is-low" }
        : position >= 80
          ? { label: "perto da máxima", className: "is-high" }
          : { label: "meio da faixa", className: "is-neutral" };

    return { min, avg, max, position, opportunity };
  };

  const renderRange = (snapshot) => {
    const range = priceRange(snapshot);

    if (!range) {
      return "";
    }

    return `
      <section class="pip-range">
        <div class="pip-section-title">
          <h2>Faixa do período</h2>
          <span class="pip-opportunity ${range.opportunity.className}">${e(range.opportunity.label)}</span>
        </div>
        <div class="pip-range__bar" aria-label="Posição do preço médio na faixa do período">
          <span class="pip-range__marker" style="--position: ${range.position.toFixed(2)}%"></span>
        </div>
        <div class="pip-range__labels">
          <span class="pip-muted">Mín. ${fmt(range.min)}</span>
          <span class="pip-muted">Méd. ${fmt(range.avg)}</span>
          <span class="pip-muted">Máx. ${fmt(range.max)}</span>
        </div>
      </section>
    `;
  };

  const sparkline = (snapshot) => {
    const rows = snapshot?.stats?.itemRows || [];
    const values = rows
      .map((row) => n(row.avg_price))
      .filter((value) => value > 0);

    if (values.length < 2) {
      return '<svg class="pip-sparkline" viewBox="0 0 100 22" aria-hidden="true"><path d="M2 11 H98"></path></svg>';
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const points = values
      .map((value, index) => {
        const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
        const y = 20 - ((value - min) / span) * 18 + 1;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return `<svg class="pip-sparkline" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
  };

  const itemUrl = (item) =>
    TcmhMarket.buildMarketUrl(
      item,
      state?.settings || TcmhStorage.DEFAULT_SETTINGS,
    );

  const selectedData = () => {
    const item = getSelectedItem();
    const key = item ? itemKey(item) : selectedKey;
    return {
      item,
      key,
      snapshot: getSnapshot(key),
    };
  };

  const itemMatchesSearch = (item, query, exactOnly = false) => {
    const needle = normalizedSearch(query);

    if (!needle || !item) {
      return false;
    }

    const snapshot = getSnapshot(itemKey(item));
    const exactValues = [
      item.item_id,
      item.item_name,
      item.q,
      snapshot?.itemName,
      snapshot?.stats?.latest?.item_id,
    ]
      .filter(Boolean)
      .map((value) => normalizedSearch(value));

    if (exactValues.includes(needle)) {
      return true;
    }

    if (exactOnly) {
      return false;
    }

    return [item.item_name, item.item_id, item.q, item.game, snapshot?.itemName]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  };

  const findItemFromSearch = (query) => {
    const exactMatches = allItems().filter((item) =>
      TcmhMarket.hasConcreteItemId(item, getSnapshot(itemKey(item))) &&
      itemMatchesSearch(item, query, true),
    );

    return exactMatches.length === 1 ? exactMatches[0] : null;
  };

  const relatedMatchesFromSearch = (relatedItems, query) => {
    const related = Array.isArray(relatedItems) ? relatedItems : [];
    const scored = related
      .map((item) => ({
        item,
        score: TcmhMarket.searchMatchScore(item, query),
      }))
      .filter((entry) => entry.score >= 500)
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      return scored
        .map((entry) => entry.item);
    }

    return related.length === 1 ? related : [];
  };

  const itemFromRelatedSearch = (searchItem, relatedItem) => ({
    ...searchItem,
    q: "",
    item_id: relatedItem.item_id,
    item_name: relatedItem.item_name,
    iconUrl: relatedItem.iconUrl || "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const itemFromSnapshot = (item, snapshot) => {
    const latestId = String(snapshot?.stats?.latest?.item_id || "").trim();
    const itemId = latestId || item.item_id || "";
    const itemName = snapshot?.itemName || item.item_name || item.q || itemId;
    const iconUrl = snapshot?.iconUrl || item.iconUrl || "";

    return {
      ...item,
      item_id: itemId,
      item_name: itemName,
      iconUrl,
      updatedAt: Date.now(),
    };
  };

  const storeRelatedMatches = async (searchItem, matches) => {
    const items = matches.map((relatedItem) =>
      itemFromRelatedSearch(searchItem, relatedItem),
    );
    const response = await sendMessage({ type: "UPSERT_HISTORY_ITEMS", items });
    state = response.state || state;
    return items;
  };

  const refreshAndStoreItem = async (item) => {
    const refreshResponse = await sendMessage({ type: "REFRESH_ITEM", item });
    const snapshot = refreshResponse.snapshot || null;
    const normalizedItem = itemFromSnapshot(item, snapshot);
    const historyResponse = await sendMessage({
      type: "UPSERT_HISTORY",
      item: normalizedItem,
      snapshot,
    });
    state = historyResponse.state || refreshResponse.state || state;
    selectedKey = itemKey(normalizedItem);
    return { item: normalizedItem, snapshot };
  };

  const renderMain = () => {
    const { item, key, snapshot } = selectedData();

    if (!item) {
      return '<section class="pip-empty">Nenhum item salvo ainda.</section>';
    }

    const metrics = snapshot?.metrics || {};
    const status = statusInfo(snapshot);
    const trend = trendInfo(snapshot);
    const hasMarketUrl = Boolean(item.item_id || item.q);

    return `
      <section class="pip-card">
        <div class="pip-identity">
          ${avatar(item, snapshot)}
          <div class="pip-title">
            <strong title="${e(labelForItem(item, snapshot))}">${e(labelForItem(item, snapshot))}</strong>
            <span>ID ${e(item.item_id || "-")} • ${e(metrics.latestDate || "sem data")}</span>
          </div>
          <span class="pip-status ${status.className}">${e(status.label)}</span>
        </div>

        <div class="pip-metric-grid">
          ${metricCard("Última média", metrics.averagePrice)}
          ${metricCard("Mediana", metrics.medianPrice)}
          ${metricCard("Mín. / Máx.", `${metrics.minPrice || "-"} / ${metrics.maxPrice || "-"}`)}
          ${metricCard("Trades", metrics.filteredTrades)}
          ${metricCard("Compra / venda", `${metrics.buyTrades || "-"} / ${metrics.sellTrades || "-"}`)}
          ${metricCard("Variação", metrics.trendAvg || trend.label, trend.className)}
        </div>

        ${renderRange(snapshot)}

        <div class="pip-actions">
          <button class="pip-button pip-button--primary" type="button" data-action="refresh-selected" ${isRefreshing ? "disabled" : ""}>${isRefreshing ? "Atualizando" : "Atualizar"}</button>
          <button class="pip-button" type="button" data-action="open-dashboard">Dashboard</button>
          <a class="pip-button" href="${hasMarketUrl ? e(itemUrl(item)) : "#"}" target="_blank" rel="noopener noreferrer" aria-disabled="${hasMarketUrl ? "false" : "true"}">Análise</a>
        </div>

        <footer class="pip-footer">
          Snapshot ${e(TcmhMarket.humanDateTime(snapshot?.capturedAt))}${progressMessage ? ` • ${e(progressMessage)}` : ""}
        </footer>
      </section>
    `;
  };

  const renderWatchItem = (item, snapshot) => {
    const metrics = snapshot?.metrics || {};
    const icon = iconForItem(item, snapshot);
    const name = labelForItem(item, snapshot) || "Item";
    const updatedAt = TcmhMarket.humanDateTime(
      snapshot?.capturedAt || snapshot?.updatedAt,
    );
    const iconMarkup = icon
      ? `<img
          class="pip-watch-item__icon"
          src="${e(icon)}"
          alt="${e(name)}"
          loading="lazy"
          referrerpolicy="no-referrer"
        >`
      : `<span class="pip-watch-item__icon" aria-hidden="true">${e(String(name).slice(0, 1).toUpperCase() || "?")}</span>`;

    return `
    <article class="pip-watch-item">
      <div class="pip-watch-item__header">
        ${iconMarkup}
        <div class="pip-watch-item__headings">
          <h3 class="pip-watch-item__name">${e(name)}</h3>
          <p class="pip-watch-item__date">
            Últ. atualização: ${e(updatedAt || "-")}
          </p>
        </div>
      </div>

      <div class="pip-watch-item__prices">
        <div class="pip-watch-item__price">
          <span class="pip-watch-item__label">Mínimo</span>
          <strong class="pip-watch-item__value">
            ${e(metrics.minPrice || "-")}
          </strong>
        </div>

        <div class="pip-watch-item__price">
          <span class="pip-watch-item__label">Médio</span>
          <strong class="pip-watch-item__value">
            ${e(metrics.averagePrice || "-")}
          </strong>
        </div>

        <div class="pip-watch-item__price">
          <span class="pip-watch-item__label">Máximo</span>
          <strong class="pip-watch-item__value">
            ${e(metrics.maxPrice || "-")}
          </strong>
        </div>
      </div>
    </article>
  `;
  };

  const renderWatchlist = () => {
    const items = state?.pinned || [];

    if (!items.length) {
      return '<section class="pip-empty">Nenhum item fixado.</section>';
    }

    return `
      <section class="pip-card">
        <div class="pip-section-title">
          <h2>Itens monitorados</h2>
          <span class="pip-badge">${items.length}</span>
        </div>
        <div class="pip-list">
          ${items
            .map((item) => renderWatchItem(item, getSnapshot(itemKey(item))))
            .join("")}
        </div>
      </section>
    `;
  };

  const renderSearchItem = (item) => {
    const key = itemKey(item);
    const snapshot = getSnapshot(key);
    const metrics = snapshot?.metrics || {};
    const name = labelForItem(item, snapshot) || "Item";
    const latest = metrics.averagePrice
      ? `Média ${metrics.averagePrice}`
      : "Sem snapshot";

    return `
      <button class="pip-item ${key === selectedKey ? "is-active" : ""}" type="button" data-select-key="${e(key)}">
        ${avatar(item, snapshot, "pip-avatar pip-avatar--small")}
        <span class="pip-item__text">
          <span class="pip-item__row">
            <strong>${e(name)}</strong>
            <span class="pip-trend ${trendInfo(snapshot).className}">${e(trendInfo(snapshot).label)}</span>
          </span>
          <span>ID ${e(item.item_id || "-")} • ${e(latest)}</span>
        </span>
      </button>
    `;
  };

  const renderSearch = () => {
    const term = TcmhMarket.normalizeSpace(searchValue);
    const matches = term
      ? allItems()
          .filter((item) => itemMatchesSearch(item, term))
      : allItems().slice(0, 8);

    return `
      <section class="pip-card">
        <form class="pip-search" data-role="pip-search-form">
          <input
            class="pip-search__input"
            type="search"
            data-role="pip-search-input"
            placeholder="Nome ou ID do item"
            value="${e(searchValue)}"
            autocomplete="off"
          >
          <button class="pip-button pip-button--primary" type="submit" ${isSearching ? "disabled" : ""}>${isSearching ? "Buscando" : "Buscar"}</button>
        </form>

        ${searchStatus ? `<div class="pip-search__status">${e(searchStatus)}</div>` : ""}

        <div class="pip-section-title">
          <h2>${term ? "Resultados" : "Itens recentes"}</h2>
          <span class="pip-badge">${matches.length}</span>
        </div>
        <div class="pip-list">
          ${
            matches.length
              ? matches.map(renderSearchItem).join("")
              : '<div class="pip-muted">Nenhum item local encontrado. Busque pelo nome ou ID para carregar do painel.</div>'
          }
        </div>
      </section>
    `;
  };

  const renderAlerts = () => {
    const alerts = state?.alerts || [];
    const activeAlerts = alerts.filter(
      (alert) => alert && alert.enabled !== false,
    );

    if (!activeAlerts.length) {
      return '<section class="pip-empty">Nenhum alerta ativo.</section>';
    }

    return `
      <section class="pip-card">
        <div class="pip-section-title">
          <h2>Alertas ativos</h2>
          <span class="pip-badge">${activeAlerts.length}</span>
        </div>
        <div class="pip-list">
          ${activeAlerts
            .slice(0, 10)
            .map((alert) => {
              const snapshot = getSnapshot(alert.itemKey);
              const last = alert.lastTriggeredAt
                ? `Disparou ${TcmhMarket.humanDateTime(alert.lastTriggeredAt)}`
                : "Nunca disparou";
              const condition =
                ALERT_LABELS[alert.condition] || alert.condition || "Alerta";
              const triggered = Boolean(alert.lastTriggeredAt);

              return `
              <article class="pip-alert ${triggered ? "is-triggered" : ""}">
                <strong>${e(snapshot?.itemName || alert.itemName || alert.itemKey)}</strong>
                <p>${e(condition)} • alvo ${e(alert.target)}</p>
                <p>${e(last)}</p>
                ${alert.lastMessage ? `<p>${e(alert.lastMessage)}</p>` : ""}
              </article>
            `;
            })
            .join("")}
        </div>
        ${activeAlerts.length > 10 ? `<div class="pip-muted">Mostrando 10 de ${activeAlerts.length}. Use o dashboard para lista completa.</div>` : ""}
      </section>
    `;
  };

  const renderTabs = () => `
    <nav class="pip-tabs" role="tablist" aria-label="Seções do PiP">
      <button class="pip-tab ${activeTab === "main" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeTab === "main"}" data-tab="main">Principal</button>
      <button class="pip-tab ${activeTab === "watchlist" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeTab === "watchlist"}" data-tab="watchlist">Monitorados</button>
      <button class="pip-tab ${activeTab === "search" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeTab === "search"}" data-tab="search">Busca</button>
      <button class="pip-tab ${activeTab === "alerts" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeTab === "alerts"}" data-tab="alerts">Alertas</button>
    </nav>
  `;

  const renderActivePanel = () => {
    if (activeTab === "watchlist") {
      return renderWatchlist();
    }

    if (activeTab === "search") {
      return renderSearch();
    }

    if (activeTab === "alerts") {
      return renderAlerts();
    }

    return renderMain();
  };

  const render = () => {
    if (!state) {
      app.innerHTML =
        '<section class="pip-empty">Carregando dados...</section>';
      return;
    }

    const { item, snapshot } = selectedData();
    const status = statusInfo(snapshot);
    const interval =
      state.settings?.autoRefreshEnabled === false ? "auto off" : "auto on";
    const nextRun = alarm?.scheduledTime
      ? TcmhMarket.humanDateTime(alarm.scheduledTime)
      : "não agendado";

    app.innerHTML = `
      <div class="pip-shell">
        <header class="pip-top">
          <div class="pip-identity">
            ${avatar(item, snapshot)}
            <div class="pip-title">
              <strong title="${e(labelForItem(item, snapshot))}">${e(labelForItem(item, snapshot) || "Market Helper")}</strong>
              <span>${e(interval)} • próxima ${e(nextRun)}</span>
            </div>
            <span class="pip-status ${status.className}">${e(status.label)}</span>
          </div>
          ${renderTabs()}
        </header>

        <div class="pip-panel" role="tabpanel">
          ${renderActivePanel()}
        </div>
      </div>
    `;
  };

  const load = async () => {
    const response = await sendMessage({ type: "GET_STATE" });
    state = response.state || (await TcmhStorage.getState());
    alarm = response.alarm || null;

    if (!selectedKey) {
      selectedKey = state.pinned?.[0]
        ? itemKey(state.pinned[0])
        : state.history?.[0]
          ? itemKey(state.history[0])
          : "";
    }

    render();
  };

  const refreshSelected = async () => {
    const item = getSelectedItem();

    if (!item || isRefreshing) {
      return;
    }

    isRefreshing = true;
    progressMessage = `Atualizando ${labelForItem(item, getSnapshot(itemKey(item)))}`;
    render();

    const response = await sendMessage({ type: "START_REFRESH_ITEM", item });

    if (response.error) {
      progressMessage = `Falha: ${response.error}`;
      isRefreshing = false;
      render();
      return;
    }

    state = response.state || state;
    progressMessage = "Atualização iniciada";
    render();
  };

  const searchItemDirectly = async (query) => {
    const term = TcmhMarket.normalizeSpace(query);

    if (!term || isSearching) {
      return;
    }

    const localItem = findItemFromSearch(term);
    if (localItem) {
      selectedKey = itemKey(localItem);
      activeTab = "main";
      searchStatus = "Item selecionado da lista local.";
      render();
      return;
    }

    const settings = state?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const searchItem = TcmhMarket.createItemFromSearch(term, settings);
    if (!searchItem) {
      return;
    }

    isSearching = true;
    searchStatus = "Buscando item...";
    render();

    try {
      const refreshResponse = await sendMessage({
        type: "REFRESH_ITEM",
        item: searchItem,
      });
      const snapshot = refreshResponse.snapshot || null;
      state = refreshResponse.state || state;
      const relatedMatches = !searchItem.item_id
        ? relatedMatchesFromSearch(snapshot?.relatedItems, term)
        : [];

      if (relatedMatches.length > 1) {
        const storedItems = await storeRelatedMatches(searchItem, relatedMatches);
        selectedKey = storedItems[0] ? itemKey(storedItems[0]) : selectedKey;
        searchStatus = `${storedItems.length} resultados encontrados. Escolha o item correto.`;
      } else if (relatedMatches.length === 1 && relatedMatches[0]?.item_id) {
        const directItem = itemFromRelatedSearch(searchItem, relatedMatches[0]);
        await refreshAndStoreItem(directItem);
        activeTab = "main";
        searchStatus = "Resultado encontrado e carregado.";
      } else {
        const normalizedItem = itemFromSnapshot(searchItem, snapshot);
        const historyResponse = await sendMessage({
          type: "UPSERT_HISTORY",
          item: normalizedItem,
          snapshot,
        });
        state = historyResponse.state || state;
        selectedKey = itemKey(normalizedItem);
        activeTab = "main";
        searchStatus = snapshot?.ok
          ? "Item carregado."
          : "Busca salva no histórico; verifique sua sessão no painel.";
      }
    } catch (error) {
      searchStatus = `Falha na busca: ${error.message || String(error)}`;
    } finally {
      isSearching = false;
      render();
    }
  };

  const handleClick = async (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      activeTab = tabButton.dataset.tab || "main";
      render();
      return;
    }

    const selectButton = event.target.closest("[data-select-key]");
    if (selectButton) {
      selectedKey = selectButton.dataset.selectKey || selectedKey;
      activeTab = "main";
      render();
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;

    if (action === "refresh-selected") {
      await refreshSelected();
      return;
    }

    if (action === "open-dashboard") {
      await sendMessage({ type: "OPEN_DASHBOARD" });
    }
  };

  app.addEventListener("click", (event) => {
    handleClick(event).catch((error) => {
      progressMessage = `Erro: ${error.message || String(error)}`;
      isRefreshing = false;
      isSearching = false;
      render();
    });
  });

  app.addEventListener("input", (event) => {
    const input = event.target.closest('[data-role="pip-search-input"]');
    if (!input) {
      return;
    }

    searchValue = input.value;
    render();
    const nextInput = app.querySelector('[data-role="pip-search-input"]');
    nextInput?.focus();
    nextInput?.setSelectionRange?.(searchValue.length, searchValue.length);
  });

  app.addEventListener("submit", (event) => {
    const form = event.target.closest('[data-role="pip-search-form"]');
    if (!form) {
      return;
    }

    event.preventDefault();
    searchItemDirectly(searchValue).catch((error) => {
      searchStatus = `Falha na busca: ${error.message || String(error)}`;
      isSearching = false;
      render();
    });
  });

  if (window.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "REFRESH_PROGRESS") {
        return;
      }

      const progress = message.progress || {};
      progressMessage = progress.message || "";
      isRefreshing = progress.phase === "running";

      if (["success", "error", "complete"].includes(progress.phase)) {
        load().catch(() => render());
        return;
      }

      render();
    });
  }

  if (window.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      const watchedKeys = [
        "pinned",
        "history",
        "snapshots",
        "alerts",
        "settings",
        "lastRefresh",
        "lastRefreshStatus",
        "refreshJob",
      ];
      if (watchedKeys.some((key) => key in changes)) {
        load().catch(() => render());
      }
    });
  }

  load().catch((error) => {
    app.innerHTML = `<section class="pip-empty">Falha ao carregar PiP: ${e(error.message || String(error))}</section>`;
  });

  setInterval(() => {
    load().catch(() => render());
  }, 30000);
})();
