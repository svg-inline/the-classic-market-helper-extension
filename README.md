# The Classic Market Helper

Extensão Chrome/Edge Manifest V3 para melhorar o uso da página `https://userpanel.theclassic.games/panel/market-analysis`.

## Funcionalidades

- Painel flutuante na página de análise.
- Histórico automático do item acessado.
- Itens monitorados/fixados.
- Atualização manual e automática dos itens monitorados.
- Dashboard full screen em `src/dashboard.html`.
- Histórico diário de preços com gráfico local.
- Alertas de preço com notificações locais.
- Exportar/importar JSON.
- Configuração de intervalo: 5h, 1/2/3 vezes ao dia, cada 2/3/7/15/30 dias ou personalizado.
- PiP para item principal usando Document Picture-in-Picture quando disponível, com fallback em popup.

## Instalação local

1. Extraia o ZIP.
2. Abra `chrome://extensions`.
3. Ative “Modo do desenvolvedor”.
4. Clique em “Carregar sem compactação”.
5. Selecione a pasta `the-classic-market-helper-extension`.
6. Faça login no painel The Classic normalmente.
7. Abra `https://userpanel.theclassic.games/panel/market-analysis`.

## Segurança

A extensão não salva login, senha, cookies ou tokens. Ela usa a sessão já ativa no navegador para buscar o HTML da página de análise e salvar snapshots locais em `chrome.storage.local`.

## Observação técnica

O parser prioriza os arrays JavaScript embutidos no HTML da página (`rows` e `currencyRows`). Quando esses arrays não existem, ele usa fallback textual com menor precisão.
