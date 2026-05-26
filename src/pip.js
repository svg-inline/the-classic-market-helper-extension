(() => {
  'use strict';
  const { TcmhMarket } = window;
  const keyFromUrl = new URLSearchParams(location.search).get('key') || '';
  const sendMessage = (payload) => new Promise((resolve) => chrome.runtime.sendMessage(payload, (response) => resolve(response || {})));
  let key = keyFromUrl;

  const render = async () => {
    const response = await sendMessage({ type: 'GET_STATE' });
    const state = response.state || {};
    if (!key) key = state.pinned?.[0] ? TcmhMarket.slugKey(state.pinned[0]) : '';
    const item = [...(state.pinned || []), ...(state.history || [])].find((entry) => TcmhMarket.slugKey(entry) === key) || state.pinned?.[0];
    const snapshot = state.snapshots?.[key || (item ? TcmhMarket.slugKey(item) : '')];
    const m = snapshot?.metrics || {};
    document.getElementById('app').innerHTML = `
      <header><strong>${TcmhMarket.escapeHTML(snapshot?.itemName || item?.item_name || 'Item')}</strong><span>ID ${TcmhMarket.escapeHTML(item?.item_id || '-')}</span></header>
      <section><b>Última média</b><strong>${TcmhMarket.escapeHTML(m.averagePrice || '-')}</strong></section>
      <section><b>Mediana</b><strong>${TcmhMarket.escapeHTML(m.medianPrice || '-')}</strong></section>
      <section><b>Mín. / Máx.</b><strong>${TcmhMarket.escapeHTML(m.minPrice || '-')} / ${TcmhMarket.escapeHTML(m.maxPrice || '-')}</strong></section>
      <section><b>Trades</b><strong>${TcmhMarket.escapeHTML(m.filteredTrades || '-')}</strong></section>
      <footer>Atualizado ${TcmhMarket.escapeHTML(TcmhMarket.humanDateTime(snapshot?.capturedAt))}</footer>
    `;
  };

  render();
  setInterval(render, 30000);
})();
