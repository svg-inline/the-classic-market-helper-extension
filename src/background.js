'use strict';

const ALARM_NAME = 'tcmh-refresh-prices';
const STORAGE_DEFAULTS = Object.freeze({
  schemaVersion: 2,
  settings: {
    autoRefreshEnabled: true,
    refreshPreset: 'every_5_hours',
    customHours: 24,
    dateMode: 'saved',
    rollingDays: 30,
    maxHistory: 50,
    notifyOnRefreshError: true,
    notifyOnRefreshSuccess: false,
    alertNotificationsEnabled: true,
    alertCooldownHours: 6
  },
  pinned: [],
  history: [],
  snapshots: {},
  alerts: [],
  lastRefresh: null,
  lastRefreshStatus: 'never'
});

const REFRESH_PRESETS = Object.freeze({
  every_5_hours: { label: 'Cada 5 horas', hours: 5 },
  three_times_day: { label: '3 vezes ao dia', hours: 8 },
  two_times_day: { label: '2 vezes ao dia', hours: 12 },
  once_day: { label: '1 vez ao dia', hours: 24 },
  every_2_days: { label: 'Cada 2 dias', hours: 48 },
  every_3_days: { label: 'Cada 3 dias', hours: 72 },
  weekly: { label: 'A cada 7 dias', hours: 168 },
  every_15_days: { label: 'A cada 15 dias', hours: 360 },
  monthly: { label: 'A cada 30 dias', hours: 720 },
  custom: { label: 'Intervalo personalizado', hours: null }
});

const storageGet = (keys = null) => new Promise((resolve) => {
  chrome.storage.local.get(keys, (result) => resolve(result || {}));
});

const storageSet = (payload) => new Promise((resolve) => {
  chrome.storage.local.set(payload, () => resolve());
});

const getState = async () => {
  const result = await storageGet(null);
  const settings = { ...STORAGE_DEFAULTS.settings, ...(result.settings || {}) };

  return {
    ...STORAGE_DEFAULTS,
    ...result,
    settings,
    pinned: Array.isArray(result.pinned) ? result.pinned : [],
    history: Array.isArray(result.history) ? result.history : [],
    snapshots: result.snapshots && typeof result.snapshots === 'object' ? result.snapshots : {},
    alerts: Array.isArray(result.alerts) ? result.alerts : []
  };
};

const resolveRefreshHours = (settings) => {
  const merged = { ...STORAGE_DEFAULTS.settings, ...(settings || {}) };

  if (merged.refreshPreset === 'custom') {
    const custom = Number(merged.customHours);
    return Number.isFinite(custom) && custom >= 1 ? custom : STORAGE_DEFAULTS.settings.customHours;
  }

  return REFRESH_PRESETS[merged.refreshPreset]?.hours || REFRESH_PRESETS.every_5_hours.hours;
};

const pad2 = (value) => String(value).padStart(2, '0');
const formatDateBr = (date) => `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;

const makeRollingRange = (days = 30) => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.max(1, Number(days) || 30));

  return {
    start_date: formatDateBr(start),
    end_date: formatDateBr(end)
  };
};

const normalizeSpace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slugKey = (item) => `${item.game || 'pw126'}:${item.item_id || item.q || 'unknown'}`;

const decodeHTML = (value) => String(value || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#039;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&ccedil;/gi, 'ç')
  .replace(/&eacute;/gi, 'é')
  .replace(/&aacute;/gi, 'á')
  .replace(/&atilde;/gi, 'ã')
  .replace(/&otilde;/gi, 'õ');

const buildMarketUrl = (item, settings = {}) => {
  const url = new URL('/panel/market-analysis', 'https://userpanel.theclassic.games');
  const base = { ...item };

  if (settings.dateMode === 'rolling') {
    Object.assign(base, makeRollingRange(settings.rollingDays || 30));
  }

  url.searchParams.set('game', base.game || 'pw126');

  if (base.q) {
    url.searchParams.set('q', base.q);
  }

  if (base.start_date) {
    url.searchParams.set('start_date', base.start_date);
  }

  if (base.end_date) {
    url.searchParams.set('end_date', base.end_date);
  }

  if (base.item_id) {
    url.searchParams.set('item_id', base.item_id);
  }

  return url.toString();
};

const compactTextFromHTML = (html = '') => normalizeSpace(
  String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#039;/gi, "'")
    .replace(/&quot;/gi, '"')
);

const parseNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? '').trim();
  if (!raw) {
    return 0;
  }

  const normalized = raw
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/(?<=\d)\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatInteger = (value) => new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}).format(Math.round(parseNumber(value)));

const formatPercent = (value) => `${new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(parseNumber(value))}%`;

const findNumberAfterLabel = (text, labels) => {
  const safeText = normalizeSpace(text);

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}[^0-9R$-]{0,40}(R\\$\\s*)?([0-9][0-9.]*,?[0-9]*)`, 'i');
    const match = safeText.match(regex);
    if (match?.[2]) {
      return match[2];
    }
  }

  return '';
};

const extractVariableArrayFromHTML = (html, variableName) => {
  const escapedName = escapeRegExp(variableName);
  const regex = new RegExp(`\\bvar\\s+${escapedName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, 'm');
  const match = String(html || '').match(regex);

  if (!match?.[1]) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};

const extractMarketRowsFromHTML = (html) => {
  const rows = extractVariableArrayFromHTML(html, 'rows');
  return rows.filter((row) => row && typeof row === 'object' && 'avg_price' in row && 'item_id' in row);
};

const extractCurrencyRowsFromHTML = (html) => {
  const rows = extractVariableArrayFromHTML(html, 'currencyRows');
  return rows.filter((row) => row && typeof row === 'object' && 'buy_gold_total' in row && 'sell_gold_total' in row);
};

const extractItemNameFromHTML = (html, itemId = '') => {
  const raw = String(html || '');
  const id = escapeRegExp(itemId);

  if (id) {
    const ariaRegex = new RegExp(`<a[^>]+item_id=${id}(?:[^>]*)aria-label="([^"]+)"`, 'i');
    const ariaMatch = raw.match(ariaRegex);
    if (ariaMatch?.[1]) {
      return normalizeSpace(decodeHTML(ariaMatch[1]));
    }

    const databaseRegex = new RegExp(`<div[^>]+class="[^"]*fw-semibold[^"]*"[^>]*>([^<]+)<\\/div>[\\s\\S]{0,500}<a[^>]+/search/item/${id}`, 'i');
    const databaseMatch = raw.match(databaseRegex);
    if (databaseMatch?.[1]) {
      return normalizeSpace(decodeHTML(databaseMatch[1]));
    }
  }

  return '';
};

const extractItemIconFromHTML = (html, itemId = '') => {
  const raw = String(html || '');
  const id = escapeRegExp(itemId);

  if (!id) {
    return '';
  }

  const iconRegex = new RegExp(`<img[^>]+src="([^"]*/icon[^"/]*/${id}\\.(?:png|webp|jpg|jpeg)[^"]*)"`, 'i');
  const iconMatch = raw.match(iconRegex);

  return iconMatch?.[1] ? decodeHTML(iconMatch[1]) : '';
};

const extractLinkedItemsFromHTML = (html) => {
  const raw = String(html || '');
  const items = [];
  const regex = /<a[^>]+href="([^"]*\/panel\/market-analysis\?[^"]*item_id=([^&"]+)[^"]*)"[^>]*class="[^"]*stretched-link[^"]*"[^>]*aria-label="([^"]+)"[^>]*><\/a>[\s\S]{0,900}?(?:Pre(?:ç|&ccedil;)o m(?:é|&eacute;)dio:\s*([0-9.]+))?/gi;
  let match = regex.exec(raw);

  while (match) {
    const href = decodeHTML(match[1]);
    const id = decodeURIComponent(match[2] || '');
    const name = normalizeSpace(decodeHTML(match[3] || ''));
    const averagePrice = match[4] ? normalizeSpace(match[4]) : '';
    const nearby = raw.slice(Math.max(0, match.index - 700), Math.min(raw.length, regex.lastIndex + 900));
    const iconUrl = extractItemIconFromHTML(nearby, id);

    if (id && name) {
      items.push({ item_id: id, item_name: name, iconUrl, averagePrice, url: href });
    }

    match = regex.exec(raw);
  }

  const seen = new Set();
  return items.filter((item) => {
    const key = item.item_id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const sortRowsByDate = (rows) => [...rows].sort((a, b) => String(a.stat_date || '').localeCompare(String(b.stat_date || '')));


const valuesForField = (rows, field) => rows
  .map((row) => parseNumber(row?.[field]))
  .filter((value) => Number.isFinite(value) && value > 0);

const averageField = (rows, field) => {
  const values = valuesForField(rows, field);
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const sumField = (rows, field) => valuesForField(rows, field).reduce((sum, value) => sum + value, 0);
const minField = (rows, field) => {
  const values = valuesForField(rows, field);
  return values.length ? Math.min(...values) : 0;
};
const maxField = (rows, field) => {
  const values = valuesForField(rows, field);
  return values.length ? Math.max(...values) : 0;
};

const buildSnapshotFromMarketRows = (rows, source = {}, html = '') => {
  const sortedRows = sortRowsByDate(rows);
  const first = sortedRows[0] || {};
  const latest = sortedRows[sortedRows.length - 1] || {};
  const firstAvg = parseNumber(first.avg_price);
  const latestAvg = parseNumber(latest.avg_price);
  const trendAbs = latestAvg - firstAvg;
  const trendPct = firstAvg ? (trendAbs / firstAvg) * 100 : 0;
  const itemId = String(latest.item_id || source.itemId || '').trim();
  const itemName = extractItemNameFromHTML(html, itemId) || source.itemName || itemId || source.itemKey || '';
  const iconUrl = extractItemIconFromHTML(html, itemId) || source.iconUrl || '';
  const currencyRows = extractCurrencyRowsFromHTML(html);
  const latestCurrency = sortRowsByDate(currencyRows).at(-1) || null;

  return {
    ok: true,
    loginRequired: false,
    capturedAt: Date.now(),
    sourceUrl: source.url || '',
    itemKey: source.itemKey || '',
    itemName,
    iconUrl,
    parserConfidence: 'high',
    parserSource: 'inline_apexcharts_rows',
    metrics: {
      latestDate: latest.stat_date || '',
      averagePrice: formatInteger(latest.avg_price),
      medianPrice: formatInteger(latest.median_price),
      minPrice: formatInteger(latest.min_price),
      maxPrice: formatInteger(latest.max_price),
      filteredTrades: formatInteger(latest.filtered_trades),
      rawTrades: formatInteger(latest.raw_trades),
      buyTrades: formatInteger(latest.buy_trades),
      sellTrades: formatInteger(latest.sell_trades),
      totalGold: formatInteger(latest.total_gold),
      periodAveragePrice: formatInteger(averageField(sortedRows, 'avg_price')),
      periodMinPrice: formatInteger(minField(sortedRows, 'min_price')),
      periodMaxPrice: formatInteger(maxField(sortedRows, 'max_price')),
      periodFilteredTrades: formatInteger(sumField(sortedRows, 'filtered_trades')),
      periodTotalGold: formatInteger(sumField(sortedRows, 'total_gold')),
      trendAvg: `${trendAbs >= 0 ? '+' : ''}${formatInteger(trendAbs)} (${trendPct >= 0 ? '+' : ''}${formatPercent(trendPct)})`,
      sampleDays: formatInteger(sortedRows.length),
      updatedAt: latest.updated_at || ''
    },
    stats: {
      itemRows: sortedRows,
      first,
      latest,
      trend: {
        avgPriceAbs: trendAbs,
        avgPricePct: trendPct
      },
      currencyRows,
      latestCurrency,
      period: {
        averagePrice: averageField(sortedRows, 'avg_price'),
        minPrice: minField(sortedRows, 'min_price'),
        maxPrice: maxField(sortedRows, 'max_price'),
        filteredTrades: sumField(sortedRows, 'filtered_trades'),
        totalGold: sumField(sortedRows, 'total_gold')
      }
    },
    relatedItems: extractLinkedItemsFromHTML(html),
    rawTextPreview: compactTextFromHTML(html).slice(0, 1200)
  };
};

const parseSnapshotFromText = (text, source = {}) => {
  const normalized = normalizeSpace(text);
  const lower = normalized.toLowerCase();
  const loginRequired = (lower.includes('login') && lower.includes('password')) || (lower.includes('entrar') && lower.includes('senha'));
  const metrics = {
    averagePrice: findNumberAfterLabel(normalized, ['Preço médio', 'Media', 'Média', 'Average', 'Avg']),
    minPrice: findNumberAfterLabel(normalized, ['Menor preço', 'Preço mínimo', 'Min', 'Minimum']),
    maxPrice: findNumberAfterLabel(normalized, ['Maior preço', 'Preço máximo', 'Max', 'Maximum']),
    lastPrice: findNumberAfterLabel(normalized, ['Último preço', 'Ultimo preço', 'Preço atual', 'Last price']),
    trades: findNumberAfterLabel(normalized, ['Negociações', 'Transações', 'Vendas', 'Quantidade', 'Trades'])
  };

  return {
    ok: !loginRequired,
    loginRequired,
    capturedAt: Date.now(),
    sourceUrl: source.url || '',
    itemKey: source.itemKey || '',
    itemName: source.itemName || '',
    iconUrl: source.iconUrl || '',
    metrics,
    rawTextPreview: normalized.slice(0, 1200),
    parserConfidence: Object.values(metrics).some(Boolean) ? 'medium' : 'low',
    parserSource: 'text_fallback'
  };
};

const parseSnapshotFromHTML = (html, source = {}) => {
  const normalized = compactTextFromHTML(html);
  const lower = normalized.toLowerCase();
  const loginRequired = (lower.includes('login') && lower.includes('password')) || (lower.includes('entrar') && lower.includes('senha'));
  const rows = extractMarketRowsFromHTML(html);

  if (rows.length) {
    const snapshot = buildSnapshotFromMarketRows(rows, source, html);
    snapshot.ok = !loginRequired;
    snapshot.loginRequired = loginRequired;
    return snapshot;
  }

  const snapshot = parseSnapshotFromText(normalized, source);
  snapshot.relatedItems = extractLinkedItemsFromHTML(html);
  return snapshot;
};

const mergeUniqueByKey = (items, nextItem, max = 50) => {
  if (!nextItem) {
    return Array.isArray(items) ? items : [];
  }

  const key = slugKey(nextItem);
  const list = Array.isArray(items) ? items : [];

  return [
    { ...nextItem, updatedAt: Date.now() },
    ...list.filter((item) => slugKey(item) !== key)
  ].slice(0, max);
};

const scheduleAlarm = async (settingsInput = null) => {
  const state = settingsInput ? { settings: settingsInput } : await getState();
  const settings = { ...STORAGE_DEFAULTS.settings, ...(state.settings || settingsInput || {}) };

  await chrome.alarms.clear(ALARM_NAME);

  if (!settings.autoRefreshEnabled) {
    return { scheduled: false };
  }

  const hours = resolveRefreshHours(settings);
  const periodInMinutes = Math.max(60, Math.round(hours * 60));

  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: Math.min(5, periodInMinutes),
    periodInMinutes
  });

  const alarm = await chrome.alarms.get(ALARM_NAME);

  return {
    scheduled: true,
    hours,
    nextRunAt: alarm?.scheduledTime || null
  };
};

const notify = async (title, message) => {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message
    });
  } catch (_error) {
    // Notifications are optional. Ignore failures.
  }
};


const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const ALERT_CONDITIONS = Object.freeze({
  avg_above: { label: 'Última média acima', metric: 'latestAvg', op: '>=' },
  avg_below: { label: 'Última média abaixo', metric: 'latestAvg', op: '<=' },
  median_above: { label: 'Última mediana acima', metric: 'latestMedian', op: '>=' },
  median_below: { label: 'Última mediana abaixo', metric: 'latestMedian', op: '<=' },
  trades_above: { label: 'Trades do último dia acima', metric: 'latestTrades', op: '>=' },
  variation_above: { label: 'Variação do período acima de %', metric: 'trendPct', op: '>=' },
  variation_below: { label: 'Variação do período abaixo de %', metric: 'trendPct', op: '<=' }
});

const getAlertMetricValue = (snapshot, condition) => {
  const latest = snapshot?.stats?.latest || {};
  const trend = snapshot?.stats?.trend || {};
  const metric = ALERT_CONDITIONS[condition]?.metric || '';

  if (metric === 'latestAvg') return parseNumber(latest.avg_price);
  if (metric === 'latestMedian') return parseNumber(latest.median_price);
  if (metric === 'latestTrades') return parseNumber(latest.filtered_trades);
  if (metric === 'trendPct') return parseNumber(trend.avgPricePct);
  return 0;
};

const evaluateCondition = (value, condition, target) => {
  const config = ALERT_CONDITIONS[condition];
  const numericTarget = parseNumber(target);
  if (!config || !Number.isFinite(value) || !Number.isFinite(numericTarget)) {
    return false;
  }
  return config.op === '>=' ? value >= numericTarget : value <= numericTarget;
};

const buildAlertMessage = (alert, snapshot, value) => {
  const config = ALERT_CONDITIONS[alert.condition] || { label: alert.condition || 'Alerta' };
  const itemName = snapshot?.itemName || alert.itemName || alert.itemKey || 'Item';
  const suffix = alert.condition?.startsWith('variation_') ? '%' : '';
  return `${itemName}: ${config.label} (${formatInteger(value)}${suffix}; alvo ${alert.target}${suffix}).`;
};

const evaluateAlerts = async (state, snapshots, touchedKeys = null) => {
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  if (!alerts.length || state.settings?.alertNotificationsEnabled === false) {
    return alerts;
  }

  const now = Date.now();
  const cooldownMs = Math.max(0, Number(state.settings?.alertCooldownHours || 6)) * 60 * 60 * 1000;
  const touched = touchedKeys ? new Set(touchedKeys) : null;
  let changed = false;

  const nextAlerts = [];
  for (const alert of alerts) {
    if (!alert || alert.enabled === false) {
      nextAlerts.push(alert);
      continue;
    }

    if (touched && !touched.has(alert.itemKey)) {
      nextAlerts.push(alert);
      continue;
    }

    const snapshot = snapshots?.[alert.itemKey];
    if (!snapshot?.ok) {
      nextAlerts.push(alert);
      continue;
    }

    const value = getAlertMetricValue(snapshot, alert.condition);
    const triggered = evaluateCondition(value, alert.condition, alert.target);
    const canNotify = !alert.lastTriggeredAt || (now - Number(alert.lastTriggeredAt)) >= cooldownMs;

    if (triggered && canNotify) {
      const message = buildAlertMessage(alert, snapshot, value);
      await notify('Alerta de preço — The Classic', message);
      nextAlerts.push({
        ...alert,
        lastTriggeredAt: now,
        lastValue: value,
        lastMessage: message
      });
      changed = true;
    } else {
      nextAlerts.push(alert);
    }
  }

  return changed ? nextAlerts : alerts;
};

const fetchSnapshotForItem = async (item, settings) => {
  const itemKey = slugKey(item);
  const url = buildMarketUrl(item, settings);
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  });

  const html = await response.text();
  const snapshot = parseSnapshotFromHTML(html, {
    url: response.url || url,
    itemKey,
    itemName: item.item_name || item.q || item.item_id || itemKey,
    iconUrl: item.iconUrl || ''
  });

  snapshot.httpStatus = response.status;
  snapshot.finalUrl = response.url || url;

  if (!response.ok) {
    snapshot.ok = false;
    snapshot.error = `HTTP ${response.status}`;
  }

  if (snapshot.finalUrl && !snapshot.finalUrl.includes('/panel/market-analysis')) {
    snapshot.ok = false;
    snapshot.loginRequired = true;
    snapshot.error = 'Sessão expirada ou redirecionada para fora da análise de mercado.';
  }

  return snapshot;
};

const refreshItem = async (item) => {
  const state = await getState();
  const snapshot = await fetchSnapshotForItem(item, state.settings);
  const itemKey = slugKey(item);
  const snapshots = {
    ...state.snapshots,
    [itemKey]: snapshot
  };

  const pinned = state.pinned.map((current) => slugKey(current) === itemKey ? {
    ...current,
    item_name: snapshot.itemName || current.item_name,
    iconUrl: snapshot.iconUrl || current.iconUrl || '',
    updatedAt: Date.now(),
    lastRefreshAt: snapshot.capturedAt,
    lastRefreshOk: snapshot.ok
  } : current);

  const alerts = await evaluateAlerts(state, snapshots, [itemKey]);

  await storageSet({
    snapshots,
    pinned,
    alerts,
    lastRefresh: Date.now(),
    lastRefreshStatus: snapshot.ok ? 'ok' : 'error'
  });

  return snapshot;
};

const refreshAllPinned = async () => {
  const state = await getState();
  const pinned = state.pinned;

  if (!pinned.length) {
    await storageSet({
      lastRefresh: Date.now(),
      lastRefreshStatus: 'no_items'
    });
    return { ok: true, total: 0, success: 0, failed: 0, snapshots: {} };
  }

  const snapshots = { ...state.snapshots };
  let success = 0;
  let failed = 0;

  for (const item of pinned) {
    const key = slugKey(item);

    try {
      const snapshot = await fetchSnapshotForItem(item, state.settings);
      snapshots[key] = snapshot;

      if (snapshot.ok) {
        success += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      snapshots[key] = {
        ok: false,
        capturedAt: Date.now(),
        sourceUrl: buildMarketUrl(item, state.settings),
        itemKey: key,
        itemName: item.item_name || item.q || item.item_id || key,
        metrics: {},
        rawTextPreview: '',
        parserConfidence: 'none',
        parserSource: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const now = Date.now();
  const nextPinned = pinned.map((item) => {
    const snapshot = snapshots[slugKey(item)];
    return {
      ...item,
      item_name: snapshot?.itemName || item.item_name,
      iconUrl: snapshot?.iconUrl || item.iconUrl || '',
      updatedAt: now,
      lastRefreshAt: snapshot?.capturedAt || now,
      lastRefreshOk: Boolean(snapshot?.ok)
    };
  });

  const alerts = await evaluateAlerts(state, snapshots, pinned.map((item) => slugKey(item)));

  await storageSet({
    snapshots,
    pinned: nextPinned,
    alerts,
    lastRefresh: now,
    lastRefreshStatus: failed ? 'partial_error' : 'ok'
  });

  if (failed && state.settings.notifyOnRefreshError) {
    await notify('The Classic Market Helper', `${failed} item(ns) não foram atualizados. Verifique se a sessão do painel ainda está ativa.`);
  } else if (!failed && state.settings.notifyOnRefreshSuccess) {
    await notify('The Classic Market Helper', `${success} item(ns) atualizado(s).`);
  }

  return {
    ok: failed === 0,
    total: pinned.length,
    success,
    failed,
    snapshots
  };
};

const handleMessage = async (message) => {
  const type = message?.type;

  if (type === 'GET_STATE') {
    const state = await getState();
    const alarm = await chrome.alarms.get(ALARM_NAME);
    return { state, alarm };
  }

  if (type === 'UPSERT_HISTORY') {
    const state = await getState();
    const item = message.item;
    const snapshot = message.snapshot;
    const itemKey = item ? slugKey(item) : '';
    const history = mergeUniqueByKey(state.history, item, state.settings.maxHistory);
    const snapshots = snapshot && itemKey ? {
      ...state.snapshots,
      [itemKey]: snapshot
    } : state.snapshots;

    await storageSet({ history, snapshots });
    return { state: await getState() };
  }

  if (type === 'PIN_ITEM') {
    const state = await getState();
    const item = message.item;
    const snapshot = message.snapshot;
    const itemKey = item ? slugKey(item) : '';
    const pinned = mergeUniqueByKey(state.pinned, item, 500);
    const snapshots = snapshot && itemKey ? {
      ...state.snapshots,
      [itemKey]: snapshot
    } : state.snapshots;

    await storageSet({ pinned, snapshots });
    return { state: await getState() };
  }

  if (type === 'UNPIN_ITEM') {
    const state = await getState();
    const key = message.key;
    const pinned = state.pinned.filter((item) => slugKey(item) !== key);

    await storageSet({ pinned });
    return { state: await getState() };
  }

  if (type === 'REMOVE_HISTORY') {
    const state = await getState();
    const key = message.key;
    const history = state.history.filter((item) => slugKey(item) !== key);

    await storageSet({ history });
    return { state: await getState() };
  }

  if (type === 'UPDATE_SETTINGS') {
    const state = await getState();
    const settings = { ...state.settings, ...(message.settings || {}) };

    await storageSet({ settings });
    const alarm = await scheduleAlarm(settings);
    return { state: await getState(), alarm };
  }

  if (type === 'REFRESH_ITEM') {
    const snapshot = await refreshItem(message.item);
    return { snapshot, state: await getState() };
  }

  if (type === 'REFRESH_ALL') {
    const result = await refreshAllPinned();
    return { result, state: await getState() };
  }


  if (type === 'OPEN_DASHBOARD') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
    return { ok: true };
  }

  if (type === 'CREATE_ALERT') {
    const state = await getState();
    const payload = message.alert || {};
    const alert = {
      id: payload.id || makeId(),
      enabled: payload.enabled !== false,
      itemKey: String(payload.itemKey || '').trim(),
      itemName: String(payload.itemName || '').trim(),
      condition: String(payload.condition || 'avg_below'),
      target: Number(payload.target || 0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTriggeredAt: null,
      lastMessage: ''
    };

    if (!alert.itemKey || !Number.isFinite(alert.target)) {
      return { error: 'Alerta inválido.' };
    }

    await storageSet({ alerts: [alert, ...state.alerts] });
    return { state: await getState() };
  }

  if (type === 'UPDATE_ALERT') {
    const state = await getState();
    const id = String(message.id || '').trim();
    const patch = message.patch || {};
    const alerts = state.alerts.map((alert) => alert.id === id ? {
      ...alert,
      ...patch,
      updatedAt: Date.now()
    } : alert);

    await storageSet({ alerts });
    return { state: await getState() };
  }

  if (type === 'DELETE_ALERT') {
    const state = await getState();
    const id = String(message.id || '').trim();
    const alerts = state.alerts.filter((alert) => alert.id !== id);

    await storageSet({ alerts });
    return { state: await getState() };
  }

  if (type === 'IMPORT_STATE') {
    const payload = message.payload || {};
    const state = await getState();
    const next = {
      settings: { ...state.settings, ...(payload.settings || {}) },
      pinned: Array.isArray(payload.pinned) ? payload.pinned : state.pinned,
      history: Array.isArray(payload.history) ? payload.history : state.history,
      snapshots: payload.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : state.snapshots,
      alerts: Array.isArray(payload.alerts) ? payload.alerts : state.alerts
    };

    await storageSet(next);
    const alarm = await scheduleAlarm(next.settings);
    return { state: await getState(), alarm };
  }

  return { error: `Mensagem desconhecida: ${type}` };
};

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await storageSet({
    schemaVersion: STORAGE_DEFAULTS.schemaVersion,
    settings: { ...STORAGE_DEFAULTS.settings, ...state.settings }
  });
  await scheduleAlarm(state.settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) {
    return;
  }

  refreshAllPinned().catch(async (error) => {
    await storageSet({
      lastRefresh: Date.now(),
      lastRefreshStatus: 'error'
    });
    await notify('The Classic Market Helper', `Falha na atualização: ${error instanceof Error ? error.message : String(error)}`);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({
      error: error instanceof Error ? error.message : String(error)
    }));

  return true;
});
