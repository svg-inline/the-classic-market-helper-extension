(() => {
  "use strict";

  const { TcmhMarket, TcmhStorage } = window;
  const app = document.getElementById("app");
  const params = new URLSearchParams(window.location.search);

  let state = null;
  let alarm = null;
  let selectedKey = params.get("key") || "";
  let activeTab = params.get("tab") || "main";
  let progressMessage = "";
  let isRefreshing = false;

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
      <button class="pip-tab ${activeTab === "alerts" ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeTab === "alerts"}" data-tab="alerts">Alertas</button>
    </nav>
  `;

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
          ${activeTab === "watchlist" ? renderWatchlist() : activeTab === "alerts" ? renderAlerts() : renderMain()}
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
