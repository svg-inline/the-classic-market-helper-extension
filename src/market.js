(() => {
  'use strict';

  const MARKET_PATH = '/panel/market-analysis';
  const DEFAULT_GAME = 'pw126';

  const pad2 = (value) => String(value).padStart(2, '0');

  const formatDateBr = (date) => {
    const value = date instanceof Date ? date : new Date(date);
    return `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
  };

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

  const SEARCH_STOP_WORDS = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'o', 'os']);

  const normalizeSearchText = (value) => normalizeSpace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[★☆#]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase();

  const searchTokens = (value) => normalizeSearchText(value)
    .split(' ')
    .filter((token) => token && !SEARCH_STOP_WORDS.has(token));

  const searchMatchScore = (item = {}, query = '') => {
    const needleId = normalizeSearchText(query).replace(/\s/g, '');
    const itemId = normalizeSearchText(item.item_id || '').replace(/\s/g, '');

    if (needleId && itemId && needleId === itemId) {
      return 1000;
    }

    const queryText = searchTokens(query).join(' ');
    const nameText = searchTokens(item.item_name || item.q || '').join(' ');

    if (!queryText || !nameText) {
      return 0;
    }

    let score = 0;

    if (nameText === queryText) {
      score = 900;
    } else if (nameText.startsWith(queryText)) {
      score = 800;
    } else if (nameText.includes(queryText)) {
      score = 700;
    } else {
      const nameTokens = new Set(nameText.split(' '));
      const queryTokens = queryText.split(' ');
      const matchedTokens = queryTokens.filter((token) => nameTokens.has(token));

      if (matchedTokens.length === queryTokens.length) {
        score = 600;
      } else if (matchedTokens.length) {
        score = Math.round((matchedTokens.length / queryTokens.length) * 300);
      }
    }

    if (/^(molde|receita|fragmento|parte)\b/.test(nameText)) {
      score -= 150;
    }

    return Math.max(0, score);
  };

  const hasConcreteItemId = (item = {}, snapshot = null) =>
    Boolean(item?.item_id || snapshot?.stats?.latest?.item_id);

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[char]));

  const decodeHTML = (value) => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  };

  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const slugKey = (item) => `${item.game || DEFAULT_GAME}:${item.item_id || item.q || 'unknown'}`;

  const createItemFromSearch = (query, settings = {}) => {
    const term = normalizeSpace(query).replace(/^#/, '');

    if (!term) {
      return null;
    }

    const now = Date.now();
    const item = {
      game: DEFAULT_GAME,
      ...makeRollingRange(settings.rollingDays || 30),
      item_name: term,
      createdAt: now,
      updatedAt: now
    };

    if (/^\d+$/.test(term)) {
      item.item_id = term;
    } else {
      item.q = term;
    }

    return item;
  };

  const parseMarketUrl = (href = window.location.href) => {
    const url = new URL(href, window.location.origin);
    const params = url.searchParams;

    return {
      game: params.get('game') || DEFAULT_GAME,
      q: params.get('q') || '',
      start_date: params.get('start_date') || '',
      end_date: params.get('end_date') || '',
      item_id: params.get('item_id') || '',
      url: url.toString()
    };
  };

  const buildMarketUrl = (item, settings = {}) => {
    const url = new URL(MARKET_PATH, 'https://userpanel.theclassic.games');
    const base = { ...item };

    if (settings.dateMode === 'rolling') {
      Object.assign(base, makeRollingRange(settings.rollingDays || 30));
    }

    url.searchParams.set('game', base.game || DEFAULT_GAME);

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

  const getTextBySelectors = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector?.(selector);
      const text = normalizeSpace(node?.textContent || node?.getAttribute?.('title') || '');
      if (text) {
        return text;
      }
    }

    return '';
  };

  const getNameNearItemLink = (doc, itemId) => {
    if (!itemId) {
      return '';
    }

    const link = doc.querySelector?.(`a[href*="/search/item/${CSS.escape(String(itemId))}"], a[href*="item_id=${CSS.escape(String(itemId))}"]`);
    const scope = link?.closest?.('.card-body, .border, .custom-card, .row, .d-flex') || link?.parentElement || null;
    const text = getTextBySelectors(scope || doc, ['.fw-semibold', '[aria-label]']);

    if (text && !/^#?\d+$/.test(text)) {
      return text;
    }

    const ariaLabel = link?.getAttribute?.('aria-label') || '';
    if (ariaLabel && !/^#?\d+$/.test(ariaLabel)) {
      return normalizeSpace(ariaLabel);
    }

    return '';
  };

  const getItemIconFromDocument = (doc, itemId) => {
    if (!itemId) {
      return '';
    }

    const safeId = CSS.escape(String(itemId));
    const img = doc.querySelector?.(`img[src*="/icon"][src*="/${safeId}."]`);

    return img?.src || '';
  };

  const getItemNameFromDocument = (doc = document, params = {}) => {
    const byCurrentItemLink = getNameNearItemLink(doc, params.item_id);
    if (byCurrentItemLink) {
      return byCurrentItemLink;
    }

    const selectors = [
      '[data-item-name]',
      '[data-testid="item-name"]',
      '.item-name',
      '.market-item-name',
      '.select2-selection__rendered'
    ];

    const text = getTextBySelectors(doc, selectors);

    if (text && !/^market analysis$/i.test(text) && !/^an[aá]lise$/i.test(text)) {
      return text;
    }

    if (params.q && params.item_id) {
      return `${params.q} #${params.item_id}`;
    }

    return params.q || params.item_id || 'Item sem nome';
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

  const parseSnapshotFromDocument = (doc = document, source = {}) => {
    const html = doc.documentElement?.outerHTML || doc.body?.innerHTML || '';
    return parseSnapshotFromHTML(html, source);
  };

  const createItemFromPage = (doc = document) => {
    const params = parseMarketUrl(window.location.href);

    if (!params.item_id) {
      return null;
    }

    const itemName = getItemNameFromDocument(doc, params);
    const iconUrl = getItemIconFromDocument(doc, params.item_id);
    const now = Date.now();

    return {
      ...params,
      item_name: itemName,
      iconUrl,
      createdAt: now,
      updatedAt: now
    };
  };

  const mergeUniqueByKey = (items, nextItem, max = 50) => {
    if (!nextItem) {
      return Array.isArray(items) ? items : [];
    }

    const key = slugKey(nextItem);
    const list = Array.isArray(items) ? items : [];
    const normalized = [
      { ...nextItem, updatedAt: Date.now() },
      ...list.filter((item) => slugKey(item) !== key)
    ];

    return normalized.slice(0, max);
  };

  const humanDateTime = (timestamp) => {
    if (!timestamp) {
      return 'Nunca';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  };

  window.TcmhMarket = {
    MARKET_PATH,
    DEFAULT_GAME,
    formatDateBr,
    makeRollingRange,
    normalizeSpace,
    normalizeSearchText,
    searchTokens,
    searchMatchScore,
    hasConcreteItemId,
    escapeHTML,
    slugKey,
    createItemFromSearch,
    parseMarketUrl,
    buildMarketUrl,
    getItemNameFromDocument,
    compactTextFromHTML,
    parseNumber,
    formatInteger,
    extractVariableArrayFromHTML,
    extractMarketRowsFromHTML,
    extractCurrencyRowsFromHTML,
    extractItemIconFromHTML,
    extractLinkedItemsFromHTML,
    parseSnapshotFromText,
    parseSnapshotFromHTML,
    parseSnapshotFromDocument,
    createItemFromPage,
    mergeUniqueByKey,
    humanDateTime
  };
})();
