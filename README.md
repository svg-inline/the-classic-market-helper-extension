# The Classic Market Helper

Extensão Chrome/Edge Manifest V3 para acompanhar itens da página de análise de mercado do **The Classic Games**:

```txt
https://userpanel.theclassic.games/panel/market-analysis
```

A extensão roda localmente no navegador, usa a sessão já ativa do usuário no painel e salva os dados em `chrome.storage.local`.

## Funcionalidades

- Painel flutuante dentro da página de Market Analysis.
- Dashboard full screen em `src/dashboard.html`.
- Popup rápido com resumo e atalho para atualizar os itens fixados.
- Fixar/remover itens monitorados.
- Busca direta por nome ou ID pela dashboard e pelo painel flutuante.
- Captura de nome real, ID, ícone, link e itens relacionados a partir do HTML do painel.
- Atualização manual de um item ou de todos os fixados.
- Atualização automática por `chrome.alarms`.
- Fila de atualização com intervalo aleatório entre requisições.
- Histórico diário por item com tabela, gráfico SVG local e cópia em CSV.
- Alertas de preço/volume/variação com notificações locais e cooldown.
- Exportar/importar JSON com configurações, fixados, histórico, snapshots e alertas.
- Janela compacta do item principal via Document Picture-in-Picture quando disponível, com fallback em popup.

## Instalação local

1. Extraia o ZIP.
2. Abra `chrome://extensions` ou `edge://extensions`.
3. Ative o modo de desenvolvedor.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `the-classic-market-helper-extension`.
6. Faça login no painel The Classic normalmente.
7. Abra a página de Market Analysis.

## Como usar

1. Abra um item no painel de Market Analysis.
2. Use o painel flutuante para fixar o item atual.
3. Abra o dashboard pelo popup da extensão ou pelo botão do painel flutuante.
4. Pesquise novos itens por nome ou ID.
5. Ajuste intervalo, janela de datas e notificações na aba **Configuração**.
6. Crie alertas na aba **Alertas de preço**.
7. Exporte um backup JSON quando quiser migrar ou guardar os dados locais.

## Configurações de atualização

Intervalos disponíveis:

- cada 5 horas;
- 3, 2 ou 1 vez ao dia;
- cada 2, 3, 7, 15 ou 30 dias;
- intervalo personalizado em horas.

O período usado nas URLs pode ser o período salvo no item ou uma janela móvel recalculada automaticamente.

## Dados e segurança

A extensão não salva login, senha, cookies ou tokens. Ela também não envia dados para servidores externos.

O parser lê o HTML retornado pelo painel e prioriza os arrays JavaScript inline `rows` e `currencyRows`, usados pelos gráficos da página. Quando esses arrays não existem, usa fallback textual com menor precisão.

Permissões atuais:

- `storage`: salvar configurações e dados locais;
- `alarms`: agendar atualizações;
- `notifications`: emitir alertas locais;
- `host_permissions` para `https://userpanel.theclassic.games/*`: buscar o HTML da página logada.

## Estrutura principal

```txt
manifest.json
icons/
src/
  background.js       # service worker, fetch, alarmes, fila e alertas
  content-script.js   # painel flutuante na página do painel
  market.js           # parser, formatadores e construção de URLs
  storage.js          # defaults e helpers de chrome.storage.local
  dashboard.html/js   # dashboard full screen
  popup.html/js       # popup da extensão
  pip.html/js         # fallback compacto para PiP/popup
  options.html/js     # tela legada de opções
```

## Limitações

O painel não oferece uma API pública para esses dados. Se o HTML da página mudar, principalmente os arrays `rows` e `currencyRows`, será necessário ajustar o parser em `src/market.js` e `src/background.js`.
