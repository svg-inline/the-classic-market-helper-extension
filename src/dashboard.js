(() => {
  "use strict";

  const { TcmhMarket, TcmhStorage } = window;
  const ALERT_LABELS = {
    avg_above: "Última média acima",
    avg_below: "Última média abaixo",
    median_above: "Última mediana acima",
    median_below: "Última mediana abaixo",
    trades_above: "Trades do último dia acima",
    variation_above: "Variação do período acima de %",
    variation_below: "Variação do período abaixo de %",
  };

  let state = null;
  let alarm = null;
  let selectedKey = "";
  let activeTab = "monitor";
  let searchValue = "";
  let pipWindow = null;
  let refreshProgress = null;

  const $ = (selector) => document.querySelector(selector);
  const sendMessage = (payload) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage(payload, (response) =>
        resolve(response || {}),
      ),
    );
  const n = (value) => TcmhMarket.parseNumber(value);
  const fmt = (value) => TcmhMarket.formatInteger(value);
  const pct = (value) =>
    `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n(value))}%`;
  const itemKey = (item) => TcmhMarket.slugKey(item);
  const allItems = () => [...(state?.pinned || []), ...(state?.history || [])];
  const getSelectedItem = () =>
    allItems().find((item) => itemKey(item) === selectedKey) ||
    state?.pinned?.[0] ||
    state?.history?.[0] ||
    null;
  const getSnapshot = (key = selectedKey) => state?.snapshots?.[key] || null;
  const normalizedSearch = (value) =>
    TcmhMarket.searchTokens(value).join(" ");
  const selectedName = () => {
    const item = getSelectedItem();
    const snapshot = getSnapshot(item ? itemKey(item) : selectedKey);
    return (
      snapshot?.itemName ||
      item?.item_name ||
      item?.q ||
      item?.item_id ||
      "Nenhum item selecionado"
    );
  };

  const labelForItem = (item, snapshot = null) =>
    snapshot?.itemName ||
    item?.item_name ||
    item?.q ||
    item?.item_id ||
    itemKey(item || {});

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const setRefreshProgress = (progress) => {
    if (!progress) {
      refreshProgress = null;
      renderRefreshHeaderStatus();
      return;
    }

    refreshProgress = {
      timestamp: Date.now(),
      ...progress,
    };
    renderRefreshHeaderStatus();
  };

  const renderRefreshHeaderStatus = () => {
    const el = $("#refreshHeaderStatus");
    if (!el) return;

    if (!refreshProgress) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }

    const phase = ["running", "success", "error", "complete"].includes(
      refreshProgress.phase,
    )
      ? refreshProgress.phase
      : "running";
    const prefix = {
      running: "Atualizando",
      success: "OK",
      error: "Erro",
      complete: "Concluído",
    }[phase];
    const itemPart = refreshProgress.itemName
      ? ` · ${refreshProgress.itemName}`
      : "";
    const countPart =
      refreshProgress.total > 1 && refreshProgress.index
        ? ` ${refreshProgress.index}/${refreshProgress.total}`
        : "";
    const detail = refreshProgress.error ? ` · ${refreshProgress.error}` : "";
    const text = `${refreshProgress.message || `${prefix}${countPart}${itemPart}`}${detail}`;

    el.hidden = false;
    el.className = `topbar-status is-${phase}`;
    el.title = text;
    el.innerHTML = `
      <span class="topbar-status__dot" aria-hidden="true"></span>
      <span class="topbar-status__text">${TcmhMarket.escapeHTML(text)}</span>
    `;
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
    const items = Array.from(
      new Map(allItems().map((item) => [itemKey(item), item])).values(),
    );
    const exactMatches = items.filter((item) =>
      TcmhMarket.hasConcreteItemId(item, getSnapshot(itemKey(item))) &&
      itemMatchesSearch(item, query, true),
    );

    if (exactMatches.length === 1) {
      return exactMatches[0];
    }

    return null;
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

  const storeRelatedMatches = async (searchItem, matches) => {
    const items = matches.map((relatedItem) =>
      itemFromRelatedSearch(searchItem, relatedItem),
    );
    const response = await sendMessage({ type: "UPSERT_HISTORY_ITEMS", items });
    state = response.state || state;
    return items;
  };

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

  const iconForItem = (item, snapshot = null) => {
    const itemId = item?.item_id || snapshot?.stats?.latest?.item_id || "";
    return (
      snapshot?.iconUrl ||
      item?.iconUrl ||
      (itemId
        ? `https://theclassic.games/assets/img/iconpw126/${itemId}.png`
        : "")
    );
  };

  const itemAvatar = (item, snapshot = null, className = "item-avatar") => {
    const iconUrl = iconForItem(item, snapshot);
    const name =
      snapshot?.itemName ||
      item?.item_name ||
      item?.q ||
      item?.item_id ||
      "Item";

    if (iconUrl) {
      return `<span class="${className}"><img src="${TcmhMarket.escapeHTML(iconUrl)}" alt="${TcmhMarket.escapeHTML(name)}" loading="lazy" referrerpolicy="no-referrer"></span>`;
    }

    return `<span class="${className} ${className}--fallback">${TcmhMarket.escapeHTML(String(name).slice(0, 1).toUpperCase())}</span>`;
  };

  const isPinned = (key) =>
    (state?.pinned || []).some((item) => itemKey(item) === key);

  const refreshAndStoreItem = async (item) => {
    setRefreshProgress({
      phase: "running",
      scope: "item",
      itemKey: itemKey(item),
      itemName: labelForItem(item),
      index: 1,
      total: 1,
      message: `Atualizando ${labelForItem(item)}`,
    });
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

  const searchItemDirectly = async (query) => {
    const term = TcmhMarket.normalizeSpace(query);

    if (!term) {
      return;
    }

    const localItem = findItemFromSearch(term);
    if (localItem) {
      selectedKey = itemKey(localItem);
      setText("itemSearchStatus", "Item selecionado da lista local.");
      render();
      return;
    }

    const settings = state?.settings || TcmhStorage.DEFAULT_SETTINGS;
    const searchItem = TcmhMarket.createItemFromSearch(term, settings);
    if (!searchItem) {
      return;
    }

    setText("itemSearchStatus", "Buscando item...");

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
      setText(
        "itemSearchStatus",
        `${storedItems.length} resultados encontrados. Selecione o item correto no histórico.`,
      );
    } else if (relatedMatches.length === 1 && relatedMatches[0]?.item_id) {
      const directItem = itemFromRelatedSearch(searchItem, relatedMatches[0]);
      await refreshAndStoreItem(directItem);
      setText("itemSearchStatus", "Resultado encontrado e carregado.");
    } else {
      const normalizedItem = itemFromSnapshot(searchItem, snapshot);
      const historyResponse = await sendMessage({
        type: "UPSERT_HISTORY",
        item: normalizedItem,
        snapshot,
      });
      state = historyResponse.state || state;
      selectedKey = itemKey(normalizedItem);
      setText(
        "itemSearchStatus",
        snapshot?.ok
          ? "Item carregado."
          : "Busca aberta no histórico; verifique sua sessão no painel.",
      );
    }

    render();
  };

  const load = async () => {
    const response = await sendMessage({ type: "GET_STATE" });
    state = response.state || (await TcmhStorage.getState());
    alarm = response.alarm || null;
    const fromUrl = new URLSearchParams(location.search).get("key");
    if (fromUrl) selectedKey = fromUrl;
    if (!selectedKey)
      selectedKey = state.pinned?.[0]
        ? itemKey(state.pinned[0])
        : state.history?.[0]
          ? itemKey(state.history[0])
          : "";
  };

  const renderStatus = () => {
    const settings = state.settings || TcmhStorage.DEFAULT_SETTINGS;
    const preset = TcmhStorage.REFRESH_PRESETS[settings.refreshPreset];
    const interval =
      settings.refreshPreset === "custom"
        ? `${settings.customHours}h`
        : preset?.label || "Cada 5 horas";
    const nextRun = alarm?.scheduledTime
      ? TcmhMarket.humanDateTime(alarm.scheduledTime)
      : "Não agendado";
    $("#statusGrid").innerHTML = `
      <div><strong>Fixados</strong><span>${state.pinned.length}</span></div>
      <div><strong>Histórico</strong><span>${state.history.length}</span></div>
      <div><strong>Alertas</strong><span>${state.alerts.length}</span></div>
      <div><strong>Intervalo</strong><span>${TcmhMarket.escapeHTML(interval)}</span></div>
      <div><strong>Última execução</strong><span>${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(state.lastRefresh))}</span></div>
      <div><strong>Próxima execução</strong><span>${TcmhMarket.escapeHTML(nextRun)}</span></div>
      <div><strong>Status</strong><span>${TcmhMarket.escapeHTML(state.lastRefreshStatus || "never")}</span></div>
      <div><strong>Item principal</strong><span>${TcmhMarket.escapeHTML(selectedName())}</span></div>
    `;
  };

  const renderSidebar = () => {
    setText("pinnedCount", String(state.pinned.length));
    const sourceItems = searchValue
      ? Array.from(
          new Map(allItems().map((item) => [itemKey(item), item])).values(),
        )
      : state.pinned;
    const items = sourceItems.filter((item) => {
      if (!searchValue) return true;
      return [item.item_name, item.item_id, item.q, item.game]
        .join(" ")
        .toLowerCase()
        .includes(searchValue.toLowerCase());
    });

    $("#sidebarItems").innerHTML = items.length
      ? items
          .map((item) => {
            const key = itemKey(item);
            const snapshot = getSnapshot(key);
            const name =
              snapshot?.itemName ||
              item.item_name ||
              item.q ||
              item.item_id ||
              key;
            const latest = snapshot?.metrics?.averagePrice
              ? `Últ. média ${snapshot.metrics.averagePrice}`
              : "Sem snapshot";
            return `
        <button class="item-button ${key === selectedKey ? "is-active" : ""}" type="button" data-select-key="${TcmhMarket.escapeHTML(key)}">
          ${itemAvatar(item, snapshot, "item-avatar item-avatar--small")}
          <span class="item-button__text">
            <strong>${TcmhMarket.escapeHTML(name)}</strong>
            <span>ID ${TcmhMarket.escapeHTML(item.item_id || "-")} • ${TcmhMarket.escapeHTML(latest)}</span>
          </span>
        </button>
      `;
          })
          .join("")
      : `<div class="empty">Nenhum item ${searchValue ? "encontrado" : "fixado"}.</div>`;
  };

  const metricCard = (label, value, modifier = "") => `
    <div class="metric-card ${modifier}"><strong>${TcmhMarket.escapeHTML(label)}</strong><span>${TcmhMarket.escapeHTML(value || "-")}</span></div>
  `;

  const renderSelectedSummary = () => {
    const item = getSelectedItem();
    if (!item) {
      $("#selectedSummary").innerHTML =
        '<section class="panel empty">Nenhum item fixado ainda. Fixe um item pela página de análise.</section>';
      return;
    }

    const key = itemKey(item);
    const snapshot = getSnapshot(key);
    const metrics = snapshot?.metrics || {};
    const trendValue = n(snapshot?.stats?.trend?.avgPricePct || 0);
    const trendClass =
      trendValue > 0 ? "is-positive" : trendValue < 0 ? "is-negative" : "";
    const url = TcmhMarket.buildMarketUrl(item, state.settings);
    const title =
      snapshot?.itemName || item.item_name || item.q || item.item_id || key;
    const pinned = isPinned(key);
    const hasMarketData = Boolean(
      snapshot?.stats?.itemRows?.length ||
      metrics.latestDate ||
      metrics.averagePrice,
    );

    $("#selectedSummary").innerHTML = `
      <section class="panel summary">
        <div class="summary__header">
          <div class="summary__identity">
            ${itemAvatar(item, snapshot)}
            <div class="summary__title">
              <h3>${TcmhMarket.escapeHTML(title)}</h3>
              <p>ID ${TcmhMarket.escapeHTML(item.item_id || "-")} • ${TcmhMarket.escapeHTML(item.start_date || "-")} até ${TcmhMarket.escapeHTML(item.end_date || "-")} • Snapshot ${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(snapshot?.capturedAt))}</p>
            </div>
          </div>
          <div class="summary__actions">
            ${hasMarketData ? "" : '<button class="button" type="button" data-action="refresh-selected">Buscar dados</button>'}
            <button class="button button--secondary" type="button" data-action="pin-selected" ${pinned ? "disabled" : ""}>${pinned ? "Salvo" : "Salvar item"}</button>
            <a class="button button--secondary" href="${TcmhMarket.escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Abrir análise</a>
          </div>
        </div>
        <div class="metric-grid">
          ${metricCard("Último dia", metrics.latestDate)}
          ${metricCard("Última média", metrics.averagePrice)}
          ${metricCard("Última mediana", metrics.medianPrice)}
          ${metricCard("Últ. mínimo / máximo", `${metrics.minPrice || "-"} / ${metrics.maxPrice || "-"}`)}
          ${metricCard("Trades último dia", metrics.filteredTrades)}
          ${metricCard("Compra / venda", `${metrics.buyTrades || "-"} / ${metrics.sellTrades || "-"}`)}
          ${metricCard("Média do período", metrics.periodAveragePrice)}
          ${metricCard("Variação no período", metrics.trendAvg, trendClass)}
        </div>
      </section>
    `;
  };

  const pointsFor = (rows, field, width, height, minY, maxY) => {
    if (!rows.length) return "";
    const span = Math.max(1, maxY - minY);
    return rows
      .map((row, index) => {
        const x = rows.length === 1 ? 0 : (index / (rows.length - 1)) * width;
        const y = height - ((n(row[field]) - minY) / span) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const renderChart = () => {
    const snapshot = getSnapshot();
    const rows = snapshot?.stats?.itemRows || [];
    if (!rows.length) {
      $("#priceChart").innerHTML =
        '<div class="empty">Sem dados de gráfico para o item selecionado.</div>';
      setText("chartHint", "");
      return;
    }

    const values = rows
      .flatMap((row) => [n(row.avg_price), n(row.min_price), n(row.max_price)])
      .filter(Boolean);
    const minYBase = Math.min(...values);
    const maxYBase = Math.max(...values);
    const padding = Math.max(1, (maxYBase - minYBase) * 0.12);
    const minY = Math.max(0, minYBase - padding);
    const maxY = maxYBase + padding;
    const w = 880;
    const h = 260;
    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
        const y = h * ratio;
        const labelValue = maxY - (maxY - minY) * ratio;
        return `<line class="grid-line" x1="0" y1="${y}" x2="${w}" y2="${y}"/><text x="0" y="${Math.max(10, y - 4)}">${fmt(labelValue)}</text>`;
      })
      .join("");
    const firstDate = rows[0]?.stat_date || "";
    const lastDate = rows.at(-1)?.stat_date || "";
    setText("chartHint", `${rows.length} dia(s) • ${firstDate} → ${lastDate}`);

    $("#priceChart").innerHTML = `
      <svg viewBox="0 0 ${w} ${h + 42}" role="img" aria-label="Evolução diária de preço">
        <g transform="translate(0, 8)">
          ${grid}
          <polyline class="max" points="${pointsFor(rows, "max_price", w, h, minY, maxY)}" />
          <polyline class="min" points="${pointsFor(rows, "min_price", w, h, minY, maxY)}" />
          <polyline class="avg" points="${pointsFor(rows, "avg_price", w, h, minY, maxY)}" />
          <line class="axis" x1="0" y1="${h}" x2="${w}" y2="${h}" />
          <text x="0" y="${h + 24}">${TcmhMarket.escapeHTML(firstDate)}</text>
          <text x="${w - 74}" y="${h + 24}">${TcmhMarket.escapeHTML(lastDate)}</text>
        </g>
      </svg>
      <div class="legend"><span><i class="avg-dot"></i>Média</span><span><i class="min-dot"></i>Mínimo</span><span><i class="max-dot"></i>Máximo</span></div>
    `;
  };

  const renderRelated = () => {
    const snapshot = getSnapshot();
    const related = snapshot?.relatedItems || [];
    $("#relatedItems").innerHTML = related.length
      ? related
          .map(
            (item) => `
      <a class="related-card" href="${TcmhMarket.escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">
        ${itemAvatar(item, null, "item-avatar item-avatar--small")}
        <span class="related-card__text">
          <strong>${TcmhMarket.escapeHTML(item.item_name)}</strong>
          <span>#${TcmhMarket.escapeHTML(item.item_id)}${item.averagePrice ? ` • Preço médio ${TcmhMarket.escapeHTML(item.averagePrice)}` : ""}</span>
        </span>
      </a>
    `,
          )
          .join("")
      : '<div class="empty">Nenhum item relacionado capturado.</div>';
  };

  const renderHistoryTable = () => {
    const snapshot = getSnapshot();
    const rows = [...(snapshot?.stats?.itemRows || [])].reverse();
    if (!rows.length) {
      $("#historyTable").innerHTML =
        '<div class="empty">Sem histórico diário salvo.</div>';
      return;
    }

    $("#historyTable").innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Média</th><th>Mediana</th><th>Mín.</th><th>Máx.</th><th>Trades</th><th>Compra</th><th>Venda</th><th>Volume</th><th>Atualizado</th></tr></thead>
        <tbody>${rows
          .map(
            (row) => `
          <tr>
            <td>${TcmhMarket.escapeHTML(row.stat_date || "")}</td>
            <td>${fmt(row.avg_price)}</td>
            <td>${fmt(row.median_price)}</td>
            <td>${fmt(row.min_price)}</td>
            <td>${fmt(row.max_price)}</td>
            <td>${fmt(row.filtered_trades)}</td>
            <td>${fmt(row.buy_trades)}</td>
            <td>${fmt(row.sell_trades)}</td>
            <td>${fmt(row.total_gold)}</td>
            <td>${TcmhMarket.escapeHTML(row.updated_at || "")}</td>
          </tr>`,
          )
          .join("")}
        </tbody>
      </table>
    `;
  };

  const renderAlerts = () => {
    setText("alertCount", String(state.alerts.length));
    const select = $("#alertItem");
    select.innerHTML = state.pinned
      .map((item) => {
        const key = itemKey(item);
        const snap = getSnapshot(key);
        const name =
          snap?.itemName || item.item_name || item.q || item.item_id || key;
        return `<option value="${TcmhMarket.escapeHTML(key)}">${TcmhMarket.escapeHTML(name)}</option>`;
      })
      .join("");
    if (
      selectedKey &&
      state.pinned.some((item) => itemKey(item) === selectedKey)
    )
      select.value = selectedKey;

    $("#alertsList").innerHTML = state.alerts.length
      ? state.alerts
          .map(
            (alert) => `
      <article class="alert-card">
        <div>
          <strong>${TcmhMarket.escapeHTML(alert.itemName || alert.itemKey)}</strong>
          <p>${TcmhMarket.escapeHTML(ALERT_LABELS[alert.condition] || alert.condition)} • alvo ${TcmhMarket.escapeHTML(alert.target)} • ${alert.enabled === false ? "desativado" : "ativo"}</p>
          <p>${alert.lastTriggeredAt ? `Último disparo: ${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(alert.lastTriggeredAt))}` : "Nunca disparou"}</p>
        </div>
        <div class="alert-card__actions">
          <button class="button button--secondary button--small" type="button" data-alert-toggle="${TcmhMarket.escapeHTML(alert.id)}">${alert.enabled === false ? "Ativar" : "Pausar"}</button>
          <button class="button button--secondary button--small" type="button" data-alert-delete="${TcmhMarket.escapeHTML(alert.id)}">Excluir</button>
        </div>
      </article>
    `,
          )
          .join("")
      : '<div class="empty">Nenhum alerta configurado.</div>';
  };

  const updateConditionalFields = () => {
    const customWrap = $("#customHoursWrap");
    const rollingWrap = $("#rollingDaysWrap");
    if (customWrap)
      customWrap.style.display =
        $("#refreshPreset")?.value === "custom" ? "block" : "none";
    if (rollingWrap)
      rollingWrap.style.display =
        $("#dateMode")?.value === "rolling" ? "block" : "none";
  };

  const renderSettings = () => {
    const settings = {
      ...TcmhStorage.DEFAULT_SETTINGS,
      ...(state.settings || {}),
    };
    $("#refreshPreset").innerHTML = Object.entries(TcmhStorage.REFRESH_PRESETS)
      .map(
        ([value, config]) =>
          `<option value="${value}">${TcmhMarket.escapeHTML(config.label)}</option>`,
      )
      .join("");
    $("#autoRefreshEnabled").checked = Boolean(settings.autoRefreshEnabled);
    $("#refreshPreset").value = settings.refreshPreset;
    $("#customHours").value = settings.customHours;
    $("#dateMode").value = settings.dateMode;
    $("#rollingDays").value = settings.rollingDays;
    $("#maxHistory").value = settings.maxHistory;
    $("#alertNotificationsEnabled").checked =
      settings.alertNotificationsEnabled !== false;
    $("#alertCooldownHours").value = settings.alertCooldownHours ?? 6;
    $("#notifyOnRefreshError").checked = Boolean(settings.notifyOnRefreshError);
    $("#notifyOnRefreshSuccess").checked = Boolean(
      settings.notifyOnRefreshSuccess,
    );
    updateConditionalFields();
  };

  const switchTab = (tab) => {
    activeTab = tab;
    document
      .querySelectorAll("[data-tab]")
      .forEach((button) =>
        button.classList.toggle("is-active", button.dataset.tab === activeTab),
      );
    document
      .querySelectorAll("[data-tab-panel]")
      .forEach((panel) =>
        panel.classList.toggle(
          "is-active",
          panel.dataset.tabPanel === activeTab,
        ),
      );
  };

  const getPipUrl = () => {
    const key =
      selectedKey || (getSelectedItem() ? itemKey(getSelectedItem()) : "");

    return chrome.runtime.getURL(`src/pip.html?key=${encodeURIComponent(key)}`);
  };

  const syncPipFrame = () => {
    if (!pipWindow || pipWindow.closed) {
      return;
    }

    const frame = pipWindow.document.getElementById("tcmh-pip-frame");

    if (!frame) {
      return;
    }

    const nextUrl = getPipUrl();

    if (frame.src !== nextUrl) {
      frame.src = nextUrl;
    }
  };

  const renderPipFrame = (doc) => {
    doc.open();
    doc.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Market PiP</title>
        <style>
          html,
          body {
            background: #07101f;
            height: 100%;
            margin: 0;
            overflow: hidden;
            width: 100%;
          }

          iframe {
            border: 0;
            display: block;
            height: 100%;
            width: 100%;
          }
        </style>
      </head>
      <body>
        <iframe
          id="tcmh-pip-frame"
          src="${TcmhMarket.escapeHTML(getPipUrl())}"
          title="The Classic Market Helper PiP"
        ></iframe>
      </body>
    </html>
  `);
    doc.close();
  };

  const openPip = async () => {
    const pipUrl = getPipUrl();

    if ("documentPictureInPicture" in window) {
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 430,
        height: 620,
      });

      renderPipFrame(pipWindow.document);
      return;
    }

    window.open(pipUrl, "tcmh-pip", "width=430,height=620,popup=yes");
  };

  const render = () => {
    setText(
      "pageTitle",
      activeTab === "monitor"
        ? "Dashboard full screen"
        : document.querySelector(`[data-tab="${activeTab}"]`)?.textContent ||
            "Dashboard",
    );
    renderRefreshHeaderStatus();
    renderStatus();
    renderSidebar();
    renderSelectedSummary();
    renderChart();
    renderRelated();
    renderHistoryTable();
    renderAlerts();
    renderSettings();
    syncPipFrame();
  };

  const refreshAll = async () => {
    const total = state?.pinned?.length || 0;
    setRefreshProgress({
      phase: "running",
      scope: "all",
      index: total ? 1 : 0,
      total,
      message: total
        ? `Iniciando atualização de ${total} item(ns)...`
        : "Nenhum item fixado para atualizar.",
    });
    const response = await sendMessage({ type: "START_REFRESH_ALL" });
    if (response.error) {
      setRefreshProgress({
        phase: "error",
        scope: "all",
        index: 0,
        total,
        message: "Falha ao iniciar atualização.",
        error: response.error,
      });
      return;
    }
    state = response.state || state;
    render();
  };

  const refreshSelected = async () => {
    const item = getSelectedItem();
    if (!item) return;
    setRefreshProgress({
      phase: "running",
      scope: "item",
      itemKey: itemKey(item),
      itemName: labelForItem(item, getSnapshot(itemKey(item))),
      index: 1,
      total: 1,
      message: `Atualizando ${labelForItem(item, getSnapshot(itemKey(item)))}`,
    });
    const response = await sendMessage({ type: "START_REFRESH_ITEM", item });
    if (response.error) {
      setRefreshProgress({
        phase: "error",
        scope: "item",
        itemKey: itemKey(item),
        itemName: labelForItem(item, getSnapshot(itemKey(item))),
        index: 1,
        total: 1,
        message: "Falha ao iniciar atualização.",
        error: response.error,
      });
      return;
    }
    state = response.state || state;
    selectedKey = itemKey(item);
    render();
  };

  const pinSelected = async () => {
    const item = getSelectedItem();
    if (!item) return;
    const key = itemKey(item);
    const snapshot = getSnapshot(key);
    const response = await sendMessage({
      type: "PIN_ITEM",
      item: itemFromSnapshot(item, snapshot),
      snapshot,
    });
    state = response.state || state;
    selectedKey = key;
    setText("itemSearchStatus", "Item salvo nos monitorados.");
    render();
  };

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: state.schemaVersion || 1,
      settings: state.settings || {},
      pinned: state.pinned || [],
      history: state.history || [],
      snapshots: state.snapshots || {},
      alerts: state.alerts || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `the-classic-market-helper-dashboard-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setText("dataStatus", "JSON exportado.");
  };

  const csvForSelected = () => {
    const rows = getSnapshot()?.stats?.itemRows || [];
    const header = [
      "date",
      "avg_price",
      "median_price",
      "min_price",
      "max_price",
      "filtered_trades",
      "buy_trades",
      "sell_trades",
      "total_gold",
      "updated_at",
    ];
    return [
      header.join(","),
      ...rows.map((row) =>
        header.map((key) => JSON.stringify(String(row[key] ?? ""))).join(","),
      ),
    ].join("\n");
  };

  const bindEvents = () => {
    document.addEventListener("click", async (event) => {
      const tabButton = event.target.closest("[data-tab]");
      if (tabButton) {
        switchTab(tabButton.dataset.tab);
        render();
        return;
      }
      const itemButton = event.target.closest("[data-select-key]");
      if (itemButton) {
        selectedKey = itemButton.dataset.selectKey;
        render();
        return;
      }
      const pinButton = event.target.closest('[data-action="pin-selected"]');
      if (pinButton) {
        await pinSelected();
        return;
      }
      const refreshSelectedButton = event.target.closest(
        '[data-action="refresh-selected"]',
      );
      if (refreshSelectedButton) {
        await refreshSelected();
        return;
      }
      const toggle = event.target.closest("[data-alert-toggle]");
      if (toggle) {
        const id = toggle.dataset.alertToggle;
        const alert = state.alerts.find((entry) => entry.id === id);
        const response = await sendMessage({
          type: "UPDATE_ALERT",
          id,
          patch: { enabled: alert?.enabled === false },
        });
        state = response.state || state;
        render();
        return;
      }
      const del = event.target.closest("[data-alert-delete]");
      if (del) {
        const response = await sendMessage({
          type: "DELETE_ALERT",
          id: del.dataset.alertDelete,
        });
        state = response.state || state;
        render();
      }
    });

    $("#itemSearch").addEventListener("input", (event) => {
      searchValue = event.target.value;
      renderSidebar();
    });
    $("#itemSearchForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await searchItemDirectly($("#itemSearch").value);
    });
    $("#refreshAllTop").addEventListener("click", refreshAll);
    $("#refreshSelected").addEventListener("click", refreshSelected);
    $("#openPip").addEventListener("click", openPip);
    $("#exportData").addEventListener("click", exportData);
    $("#copyTable").addEventListener("click", async () => {
      await navigator.clipboard.writeText(csvForSelected());
    });
    $("#refreshPreset").addEventListener("change", updateConditionalFields);
    $("#dateMode").addEventListener("change", updateConditionalFields);

    $("#alertForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = $("#alertItem").value;
      const item = allItems().find((entry) => itemKey(entry) === key);
      const response = await sendMessage({
        type: "CREATE_ALERT",
        alert: {
          itemKey: key,
          itemName: getSnapshot(key)?.itemName || item?.item_name || key,
          condition: $("#alertCondition").value,
          target: Number($("#alertTarget").value),
        },
      });
      state = response.state || state;
      event.target.reset();
      render();
    });

    $("#settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const settings = {
        autoRefreshEnabled: $("#autoRefreshEnabled").checked,
        refreshPreset: $("#refreshPreset").value,
        customHours: Number($("#customHours").value || 24),
        dateMode: $("#dateMode").value,
        rollingDays: Number($("#rollingDays").value || 30),
        maxHistory: Number($("#maxHistory").value || 50),
        alertNotificationsEnabled: $("#alertNotificationsEnabled").checked,
        alertCooldownHours: Number($("#alertCooldownHours").value || 6),
        notifyOnRefreshError: $("#notifyOnRefreshError").checked,
        notifyOnRefreshSuccess: $("#notifyOnRefreshSuccess").checked,
      };
      const response = await sendMessage({ type: "UPDATE_SETTINGS", settings });
      state = response.state || state;
      alarm = response.alarm || alarm;
      setText("settingsStatus", "Configuração salva.");
      render();
    });

    $("#importData").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        const response = await sendMessage({ type: "IMPORT_STATE", payload });
        state = response.state || state;
        alarm = response.alarm || alarm;
        setText("dataStatus", "JSON importado.");
        render();
      } catch (error) {
        setText(
          "dataStatus",
          `Falha ao importar: ${error.message || String(error)}`,
        );
      } finally {
        event.target.value = "";
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "REFRESH_PROGRESS") {
        return;
      }

      const progress = message.progress || null;
      setRefreshProgress(progress);

      if (
        progress &&
        ["success", "complete", "error"].includes(progress.phase)
      ) {
        load()
          .then(render)
          .catch(() => {});
      }
    });
  };

  load()
    .then(() => {
      bindEvents();
      switchTab(activeTab);
      render();
    })
    .catch((error) => {
      document.body.innerHTML = `<main class="app"><section class="panel"><p class="empty">Falha ao carregar dashboard: ${TcmhMarket.escapeHTML(error.message || String(error))}</p></section></main>`;
    });
})();
