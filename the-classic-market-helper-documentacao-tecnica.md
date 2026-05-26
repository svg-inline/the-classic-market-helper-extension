# The Classic Market Helper — Documentação Técnica da Extensão

## 1. Resumo

A **The Classic Market Helper** é uma extensão Chrome/Edge para melhorar o uso da página de análise de mercado do painel **The Classic Games**.

Página alvo:

```txt
https://userpanel.theclassic.games/panel/market-analysis
```

Exemplo real de URL analisada:

```txt
https://userpanel.theclassic.games/panel/market-analysis?game=pw126&q=PEDRA&start_date=21%2F04%2F2026&end_date=20%2F05%2F2026&item_id=11208
```

A extensão não usa API JSON pública. Ela trabalha sobre o **HTML server-rendered** retornado pelo painel e extrai os dados úteis da página, incluindo dados visíveis no DOM e dados embutidos em scripts JavaScript usados pelos gráficos.

## 2. Objetivo da extensão

A extensão existe para reduzir o trabalho manual de pesquisa no painel de mercado.

Principais funções:

- monitorar itens específicos;
- buscar item diretamente por ID ou nome, sem selecionar manualmente no painel;
- buscar dados da página em background;
- extrair preços do HTML;
- salvar histórico diário de preços;
- gerar alertas de preço;
- exibir dashboard full screen;
- exibir painel flutuante na página;
- exportar/importar dados locais;
- abrir um monitor compacto em Document Picture-in-Picture para o item principal.

## 3. O que a extensão não faz

A extensão não deve:

- capturar login;
- capturar senha;
- salvar cookies;
- salvar tokens de sessão;
- burlar autenticação;
- modificar dados no servidor;
- enviar dados para servidor externo;
- executar scripts vindos do HTML buscado;
- depender de uma API privada não documentada.

Ela usa a sessão já existente do navegador, igual a aba normal do usuário.

## 4. Por que extensão e não PWA

PWA puro não é o melhor caminho para esse caso.

Uma PWA rodando em outro domínio, como `localhost` ou `app.seudominio.com`, teria que buscar HTML de `userpanel.theclassic.games`. Isso cairia em bloqueios de CORS. Mesmo usando `credentials: "include"`, o navegador só permite ler a resposta se o servidor liberar CORS corretamente.

A extensão é mais adequada porque:

- roda sobre a página logada;
- pode usar permissões de host para o domínio do painel;
- consegue buscar HTML do mesmo domínio com cookies da sessão ativa;
- consegue injetar painel flutuante no DOM da página;
- pode ter popup, options page e dashboard próprio;
- pode salvar dados no `chrome.storage.local`.

## 5. Arquitetura geral

Arquitetura recomendada:

```txt
Chrome/Edge Extension Manifest V3

├── manifest.json
├── background.js              # Service Worker
├── content-script.js          # Roda dentro da página do painel
├── parser.js                  # Extratores de HTML/scripts
├── storage.js                 # Camada de persistência local
├── dashboard.html
├── dashboard.js               # Dashboard full screen
├── popup.html
├── popup.js
├── options.html
├── options.js
├── pip.html                   # UI compacta para Document PiP
├── pip.js
└── styles.css
```

Fluxo principal:

```txt
Usuário logado no painel
        ↓
Extensão injeta content-script na página /panel/market-analysis
        ↓
Content-script lê URL, DOM e estado da página atual
        ↓
Usuário fixa ou monitora item
        ↓
Opcionalmente busca item por ID/nome pela dashboard ou painel flutuante
        ↓
Background faz fetch periódico do HTML usando a sessão ativa
        ↓
Parser extrai dados do HTML
        ↓
Storage salva histórico/preços/alertas
        ↓
Dashboard, popup, painel flutuante e PiP exibem os dados
```

## 6. Permissões necessárias no Manifest V3

Base sugerida:

```json
{
  "manifest_version": 3,
  "name": "The Classic Market Helper",
  "version": "0.3.0",
  "permissions": [
    "storage",
    "alarms",
    "tabs"
  ],
  "host_permissions": [
    "https://userpanel.theclassic.games/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://userpanel.theclassic.games/panel/market-analysis*"
      ],
      "js": [
        "parser.js",
        "content-script.js"
      ],
      "css": [
        "styles.css"
      ],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "dashboard.html"
}
```

Permissões explicadas:

| Permissão | Uso |
|---|---|
| `storage` | Salvar itens monitorados, histórico, alertas e configurações. |
| `alarms` | Executar atualização em intervalos definidos. |
| `tabs` | Abrir dashboard, focar aba do painel ou ler URL ativa quando necessário. |
| `host_permissions` | Permitir fetch/leitura do domínio `userpanel.theclassic.games`. |

## 7. Como a extensão usa login/sessão

A extensão não autentica o usuário diretamente.

Fluxo correto:

```txt
1. Usuário faz login normalmente no painel.
2. O navegador salva a sessão/cookie.
3. A extensão faz requisições para o painel usando a sessão atual.
4. Se a sessão expirar, o painel retorna login/redirect em vez da página esperada.
```

Request base:

```js
const response = await fetch(url, {
  method: 'GET',
  credentials: 'include',
  cache: 'no-store',
});

const html = await response.text();
```

Ponto crítico: `credentials: 'include'` é obrigatório para enviar os cookies da sessão ativa.

A extensão deve detectar sessão expirada verificando se o HTML retornado parece tela de login em vez da página de análise.

Exemplo:

```js
const isLoginPage = (html) => {
  return /\/login|name=["']password["']|auth\/login/i.test(html);
};
```

## 8. Como o site busca os dados

A página de análise usa requisição `GET` e recarrega a página.

Formulário principal observado:

```html
<form method="get" action="https://userpanel.theclassic.games/panel/market-analysis">
  <select class="form-select" name="game" required></select>
  <input type="text" class="form-control" name="q" value="PEDRA">
  <input type="hidden" name="start_date" value="21/04/2026">
  <input type="hidden" name="end_date" value="20/05/2026">
  <input type="hidden" name="item_id" value="11208">
</form>
```

Parâmetros usados:

| Parâmetro | Exemplo | Função |
|---|---:|---|
| `game` | `pw126` | Define o jogo/servidor. |
| `q` | `PEDRA` | Termo textual da busca. |
| `start_date` | `21/04/2026` | Data inicial do período. |
| `end_date` | `20/05/2026` | Data final do período. |
| `item_id` | `11208` | Item específico selecionado. |

A busca textual retorna uma lista de resultados. O clique em um item gera uma nova URL com `item_id` e recarrega a página.

## 9. Construção de URL para buscar item

Função base:

```js
const buildMarketUrl = ({ game, q, startDate, endDate, itemId }) => {
  const url = new URL('https://userpanel.theclassic.games/panel/market-analysis');

  url.searchParams.set('game', game || 'pw126');

  if (q) {
    url.searchParams.set('q', q);
  }

  if (startDate) {
    url.searchParams.set('start_date', startDate);
  }

  if (endDate) {
    url.searchParams.set('end_date', endDate);
  }

  if (itemId) {
    url.searchParams.set('item_id', itemId);
  }

  return url.toString();
};
```

Para monitorar um item, a extensão monta a URL e busca o HTML em background.

## 10. Como a busca em background funciona

A busca em background deve ficar no `background.js`/Service Worker.

Fluxo:

```txt
1. Ler lista de itens monitorados no chrome.storage.local.
2. Para cada item, montar URL com game, item_id, start_date e end_date.
3. Fazer fetch(url, { credentials: 'include' }).
4. Ler HTML como texto.
5. Validar se a resposta é a página esperada.
6. Parsear HTML com DOMParser e regex controlada.
7. Extrair dados de preço e negociação.
8. Salvar snapshot no histórico local.
9. Verificar alertas configurados.
10. Notificar dashboard/popup/content-script sobre atualização.
```

Exemplo:

```js
const fetchMarketHtml = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  if (!html.includes('market-analysis')) {
    throw new Error('Resposta inesperada: HTML não parece ser a página de análise.');
  }

  if (/name=["']password["']|\/login/i.test(html)) {
    throw new Error('Sessão expirada ou usuário não logado.');
  }

  return html;
};
```

## 11. Intervalos de atualização

A extensão deve permitir intervalos grandes e controlados, para evitar excesso de requests.

Opções sugeridas:

```txt
Manual
A cada 5 horas
1 vez ao dia
2 vezes ao dia
3 vezes ao dia
A cada 2 dias
A cada 3 dias
```

Com `chrome.alarms`:

```js
chrome.alarms.create('tcg-market-refresh', {
  periodInMinutes: 60 * 5,
});
```

Para intervalos como 1, 2 ou 3 vezes ao dia, use minutos equivalentes:

| Opção | `periodInMinutes` |
|---|---:|
| A cada 5 horas | `300` |
| 1 vez ao dia | `1440` |
| 2 vezes ao dia | `720` |
| 3 vezes ao dia | `480` |
| A cada 2 dias | `2880` |
| A cada 3 dias | `4320` |

## 12. Onde os preços estão no HTML

Existem duas fontes principais:

1. **Cards visíveis no DOM**.
2. **Arrays JavaScript embutidos nos scripts dos gráficos**.

A fonte mais forte para preço histórico é o array `rows`, usado no gráfico de evolução do preço médio do item.

Trecho observado no HTML:

```js
var rows = [
  {
    "id": "141",
    "game_key": "pw126",
    "item_id": "11208",
    "stat_date": "2026-04-21",
    "raw_trades": "833",
    "filtered_trades": "805",
    "buy_trades": "363",
    "sell_trades": "442",
    "total_gold": "1652835578",
    "avg_price": "76575.5491",
    "median_price": "77000.0000",
    "min_price": "60000.0000",
    "max_price": "85990.0000",
    "range_min_price": "50050.0000",
    "range_max_price": "103950.0000",
    "updated_at": "2026-05-20 02:52:00"
  }
];
```

Esse array contém mais dados do que o tooltip mostra.

Campos úteis:

| Campo | Significado provável | Uso na extensão |
|---|---|---|
| `stat_date` | Dia do dado | eixo temporal / histórico |
| `avg_price` | Preço médio | preço principal |
| `median_price` | Mediana | métrica alternativa mais robusta |
| `min_price` | Menor preço | suporte de preço |
| `max_price` | Maior preço | resistência de preço |
| `raw_trades` | Trades brutos | volume bruto |
| `filtered_trades` | Trades filtrados | volume confiável para exibir |
| `buy_trades` | Trades de compra | volume por lado |
| `sell_trades` | Trades de venda | volume por lado |
| `total_gold` | Volume total em moedas | liquidez/volume financeiro |
| `range_min_price` | Faixa mínima calculada | possível filtro/outlier |
| `range_max_price` | Faixa máxima calculada | possível filtro/outlier |
| `updated_at` | Última atualização do registro | controle de freshness |

## 13. Diferença entre preço do dia e preço do período

O gráfico inteiro representa o período selecionado.

Cada objeto dentro de `rows` representa um dia.

Exemplo:

```txt
Período: 21/04/2026 até 20/05/2026
Cada ponto: 1 dia dentro desse período
Último snapshot: último dia disponível dentro do período
```

Logo:

- `avg_price` do último objeto = média do último dia disponível;
- média do período = cálculo feito pela extensão usando todos os dias;
- variação no período = comparação entre primeiro e último dia;
- trades do último dia = `filtered_trades` do último objeto;
- trades do período = soma de `filtered_trades` de todos os objetos.

Rótulos recomendados na UI:

```txt
Último dia
Última média
Média do período
Variação no período
Trades do último dia
Trades do período
```

Evitar rótulo genérico como “Média” sem contexto.

## 14. Como extrair o array `rows`

A forma mais direta é procurar o trecho `var rows = [...]` dentro do HTML.

Exemplo:

```js
const extractJsArray = (html, varName) => {
  const pattern = new RegExp(`var\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`);
  const match = html.match(pattern);

  if (!match) {
    return [];
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.warn(`Falha ao parsear ${varName}`, error);
    return [];
  }
};

const rows = extractJsArray(html, 'rows');
const currencyRows = extractJsArray(html, 'currencyRows');
```

Essa regex funciona porque o array está em formato JSON válido dentro do JavaScript.

Não executar o script. Apenas ler a string e parsear o array.

## 15. Por que não executar scripts do HTML buscado

O HTML retornado pode conter scripts completos da página.

A extensão não deve usar `eval`, `Function`, `innerHTML` com scripts ativos ou execução direta de JavaScript externo.

Motivos:

- risco de segurança;
- comportamento imprevisível;
- quebra de CSP;
- execução duplicada de scripts da página;
- risco de misturar estado da página atual com dados buscados.

Correto:

```js
const doc = new DOMParser().parseFromString(html, 'text/html');
```

Errado:

```js
eval(scriptText);
```

## 16. Dados do gráfico de moedas

Além do item específico, o HTML também traz `currencyRows`.

Trecho observado:

```js
var currencyRows = [
  {
    "id": "2",
    "game_key": "pw126",
    "stat_date": "2026-04-21",
    "buy_gold_total": "2453121374",
    "sell_gold_total": "5609785470",
    "buy_trades": "3907",
    "sell_trades": "12095",
    "updated_at": "2026-05-20 02:52:00"
  }
];
```

Uso possível:

| Campo | Uso |
|---|---|
| `buy_gold_total` | Volume de moedas em compras no dia. |
| `sell_gold_total` | Volume de moedas em vendas no dia. |
| `buy_trades` | Quantidade de trades de compra no dia. |
| `sell_trades` | Quantidade de trades de venda no dia. |

Esses dados são globais da movimentação diária de moedas do jogo/servidor, não necessariamente do item específico.

## 17. Seletores principais da página

Seletores estáveis observados no HTML.

### 17.1. Formulário de filtros

```css
form[action*="/panel/market-analysis"]
select[name="game"]
input[name="q"]
input[name="start_date"]
input[name="end_date"]
input[name="item_id"]
button[type="submit"]
```

Uso:

- ler o jogo selecionado;
- ler termo de busca;
- ler período atual;
- detectar item atual;
- gerar novo link preservando datas.

### 17.2. Cards de resultados da pesquisa

```css
.card.custom-card
.card-title
.stretched-link[href*="/panel/market-analysis"]
a[href*="pwdatabase.theclassic.games/search/item/"]
.fw-semibold
.text-muted
img[src*="/iconpw126/"]
```

Uso:

- capturar item_id pelo link;
- capturar nome pelo `aria-label` do link ou `.fw-semibold`;
- capturar ícone pelo `img[src]`;
- capturar URL de análise pelo `.stretched-link`.

### 17.3. Lista “Itens mais negociados”

```css
.card-title
.stretched-link[aria-label]
a[href*="pwdatabase.theclassic.games/search/item/"]
```

A identificação do bloco pode ser feita buscando um card cujo título seja:

```txt
Itens mais negociados
```

Dados extraíveis:

- nome do item;
- item_id;
- URL da análise;
- preço médio textual visível;
- URL do ícone.

### 17.4. Bloco “Resultados da pesquisa”

Identificar card por título:

```txt
Resultados da pesquisa
```

Cada item possui:

```html
<a href="...item_id=806" class="stretched-link" aria-label="Pedra Britada"></a>
<img src="https://theclassic.games/assets/img/iconpw126/806.png">
<div class="fw-semibold">Pedra Britada</div>
<a href="https://pwdatabase.theclassic.games/search/item/806">#806</a>
```

### 17.5. Gráfico de moedas

```css
#marketCurrencyChart
```

Título do card:

```txt
Movimentação diária de moedas (compras e vendas)
```

Dados reais vêm de:

```js
var currencyRows = [...];
```

### 17.6. Gráfico do item

```css
#marketItemPriceChart
```

Título do card:

```txt
Evolução diária do preço médio do item
```

Dados reais vêm de:

```js
var rows = [...];
```

## 18. Extração de itens dos cards

Função sugerida:

```js
const parseMarketItemsFromDoc = (doc) => {
  const links = [...doc.querySelectorAll('a.stretched-link[href*="/panel/market-analysis"]')];

  return links.map((link) => {
    const url = new URL(link.href, location.origin);
    const itemId = url.searchParams.get('item_id');
    const game = url.searchParams.get('game') || 'pw126';
    const name = link.getAttribute('aria-label')?.trim() || '';
    const card = link.closest('.border, .card, .col-12') || link.parentElement;
    const title = card?.querySelector('.fw-semibold')?.textContent?.trim() || name;
    const dbLink = card?.querySelector('a[href*="pwdatabase.theclassic.games/search/item/"]')?.href || '';
    const icon = card?.querySelector('img[src*="/icon"]')?.src || '';

    if (!itemId) {
      return null;
    }

    return {
      game,
      itemId,
      name: title || name || `Item #${itemId}`,
      url: url.toString(),
      databaseUrl: dbLink,
      iconUrl: icon,
    };
  }).filter(Boolean);
};
```

Implementação atual:

- `extractLinkedItemsFromHTML(html)` lê links de `/panel/market-analysis?...item_id=...`;
- o nome vem preferencialmente do `aria-label` do link ou do `.fw-semibold` próximo;
- `extractItemIconFromHTML(html, itemId)` procura `img[src*="/icon.../{item_id}.png"]`;
- cada item relacionado pode carregar `{ item_id, item_name, iconUrl, averagePrice, url }`;
- `iconUrl` é preservado quando a busca textual encontra um resultado e a extensão refaz a busca por `item_id`.

Exemplo de extração de ícone:

```js
const extractItemIconFromHTML = (html, itemId) => {
  const pattern = new RegExp(`<img[^>]+src="([^"]*/icon[^"/]*/${itemId}\\.(?:png|webp|jpg|jpeg)[^"]*)"`, 'i');
  const match = String(html || '').match(pattern);
  return match?.[1] || '';
};
```

## 19. Extração do item atual

Prioridade de leitura:

```txt
1. URL atual: searchParams.item_id
2. Form hidden: input[name="item_id"]
3. Bloco do gráfico do item: link pwdatabase #ID
4. Ícone: /iconpw126/{item_id}.png
5. Nome: .fw-semibold perto de #marketItemPriceChart
```

Função sugerida:

```js
const parseCurrentItem = (doc, currentUrl) => {
  const url = new URL(currentUrl);
  const itemIdFromUrl = url.searchParams.get('item_id');
  const itemIdFromInput = doc.querySelector('input[name="item_id"]')?.value || '';
  const itemId = itemIdFromUrl || itemIdFromInput;

  const chart = doc.querySelector('#marketItemPriceChart');
  const chartCard = chart?.closest('.card');

  const name = chartCard?.querySelector('.fw-semibold')?.textContent?.trim() || '';
  const iconUrl = chartCard?.querySelector('img[src*="/icon"]')?.src || '';
  const databaseUrl = chartCard?.querySelector('a[href*="pwdatabase.theclassic.games/search/item/"]')?.href || '';

  if (!itemId) {
    return null;
  }

  return {
    game: url.searchParams.get('game') || doc.querySelector('select[name="game"]')?.value || 'pw126',
    q: url.searchParams.get('q') || doc.querySelector('input[name="q"]')?.value || '',
    startDate: url.searchParams.get('start_date') || doc.querySelector('input[name="start_date"]')?.value || '',
    endDate: url.searchParams.get('end_date') || doc.querySelector('input[name="end_date"]')?.value || '',
    itemId,
    name: name || `Item #${itemId}`,
    iconUrl,
    databaseUrl,
    url: currentUrl,
  };
};
```

## 20. Normalização dos dados de preço

O HTML retorna números como string.

Exemplo:

```json
{
  "avg_price": "81011.5984",
  "median_price": "81700.0000",
  "min_price": "75000.0000",
  "max_price": "85900.0000"
}
```

Normalizar:

```js
const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const normalizePriceRow = (row) => ({
  date: row.stat_date || '',
  avgPrice: toNumber(row.avg_price),
  medianPrice: toNumber(row.median_price),
  minPrice: toNumber(row.min_price),
  maxPrice: toNumber(row.max_price),
  rangeMinPrice: toNumber(row.range_min_price),
  rangeMaxPrice: toNumber(row.range_max_price),
  rawTrades: toNumber(row.raw_trades),
  filteredTrades: toNumber(row.filtered_trades),
  buyTrades: toNumber(row.buy_trades),
  sellTrades: toNumber(row.sell_trades),
  totalGold: toNumber(row.total_gold),
  updatedAt: row.updated_at || '',
});
```

## 21. Cálculo do resumo do item

Resumo recomendado:

```js
const buildItemSummary = (rows) => {
  const normalizedRows = rows.map(normalizePriceRow).filter((row) => row.date);

  if (!normalizedRows.length) {
    return null;
  }

  const first = normalizedRows[0];
  const last = normalizedRows[normalizedRows.length - 1];

  const periodAvgPrice = normalizedRows.reduce((sum, row) => sum + row.avgPrice, 0) / normalizedRows.length;
  const periodTrades = normalizedRows.reduce((sum, row) => sum + row.filteredTrades, 0);
  const periodBuyTrades = normalizedRows.reduce((sum, row) => sum + row.buyTrades, 0);
  const periodSellTrades = normalizedRows.reduce((sum, row) => sum + row.sellTrades, 0);

  const absoluteChange = last.avgPrice - first.avgPrice;
  const percentChange = first.avgPrice > 0 ? (absoluteChange / first.avgPrice) * 100 : 0;

  return {
    firstDate: first.date,
    lastDate: last.date,
    lastAvgPrice: last.avgPrice,
    lastMedianPrice: last.medianPrice,
    lastMinPrice: last.minPrice,
    lastMaxPrice: last.maxPrice,
    lastFilteredTrades: last.filteredTrades,
    lastBuyTrades: last.buyTrades,
    lastSellTrades: last.sellTrades,
    periodAvgPrice,
    periodTrades,
    periodBuyTrades,
    periodSellTrades,
    absoluteChange,
    percentChange,
    rows: normalizedRows,
  };
};
```

## 22. Modelo de dados local

Usar `chrome.storage.local`.

Estrutura sugerida:

```json
{
  "settings": {
    "refreshIntervalMinutes": 300,
    "defaultGame": "pw126",
    "defaultPeriodDays": 30,
    "maxHistoryDays": 180
  },
  "watchedItems": [
    {
      "id": "pw126:11208",
      "game": "pw126",
      "itemId": "11208",
      "name": "Pedra Imortal",
      "q": "PEDRA",
      "iconUrl": "https://theclassic.games/assets/img/iconpw126/11208.png",
      "databaseUrl": "https://pwdatabase.theclassic.games/search/item/11208",
      "enabled": true,
      "favorite": true,
      "createdAt": 1779830000000,
      "updatedAt": 1779830000000,
      "lastFetchAt": 1779830000000,
      "lastStatus": "ok"
    }
  ],
  "priceHistory": {
    "pw126:11208": [
      {
        "date": "2026-05-20",
        "avgPrice": 81011.5984,
        "medianPrice": 81700,
        "minPrice": 75000,
        "maxPrice": 85900,
        "filteredTrades": 127,
        "buyTrades": 35,
        "sellTrades": 92,
        "totalGold": 259841031,
        "updatedAt": "2026-05-20 07:20:12",
        "capturedAt": 1779830000000
      }
    ]
  },
  "alerts": [
    {
      "id": "alert-1",
      "itemKey": "pw126:11208",
      "type": "below",
      "targetPrice": 75000,
      "enabled": true,
      "lastTriggeredAt": null
    }
  ]
}
```

Modelo usado pela implementação atual:

```json
{
  "pinned": [
    {
      "game": "pw126",
      "q": "PEDRA",
      "item_id": "11208",
      "item_name": "Pedra Imortal",
      "iconUrl": "https://theclassic.games/assets/img/iconpw126/11208.png",
      "start_date": "26/04/2026",
      "end_date": "26/05/2026",
      "createdAt": 1779830000000,
      "updatedAt": 1779830000000,
      "lastRefreshAt": 1779830000000,
      "lastRefreshOk": true
    }
  ],
  "history": [],
  "snapshots": {
    "pw126:11208": {
      "ok": true,
      "itemKey": "pw126:11208",
      "itemName": "Pedra Imortal",
      "iconUrl": "https://theclassic.games/assets/img/iconpw126/11208.png",
      "capturedAt": 1779830000000,
      "metrics": {},
      "stats": {},
      "relatedItems": []
    }
  }
}
```

Regra importante: `itemName` e `iconUrl` extraídos do HTML têm prioridade sobre o termo digitado pelo usuário. Assim, uma busca por `798` pode aparecer na UI como `Tábua de Qualidade` com o ícone correto.

## 23. Chave única do item

Usar `game:item_id`.

Exemplo:

```txt
pw126:11208
```

Função:

```js
const getItemKey = (game, itemId) => `${game}:${itemId}`;
```

Motivo: o mesmo `item_id` pode teoricamente existir em jogos diferentes.

## 24. Histórico de preços

A extensão deve salvar snapshots por data.

Regra:

- se já existir registro da mesma data, atualizar;
- se for data nova, adicionar;
- ordenar por data crescente;
- limitar por `maxHistoryDays`.

Exemplo:

```js
const upsertHistoryRow = (history, itemKey, row) => {
  const currentRows = history[itemKey] || [];
  const nextRows = currentRows.filter((entry) => entry.date !== row.date);

  nextRows.push({
    ...row,
    capturedAt: Date.now(),
  });

  nextRows.sort((a, b) => a.date.localeCompare(b.date));

  history[itemKey] = nextRows.slice(-180);

  return history;
};
```

## 25. Alertas de preço

Tipos de alerta:

```txt
below: avisar quando o preço médio ficar abaixo de X
above: avisar quando o preço médio ficar acima de X
change_percent: avisar quando variar mais de X% no período
```

Exemplo:

```js
const shouldTriggerAlert = (alert, summary) => {
  if (!alert.enabled || !summary) {
    return false;
  }

  if (alert.type === 'below') {
    return summary.lastAvgPrice <= alert.targetPrice;
  }

  if (alert.type === 'above') {
    return summary.lastAvgPrice >= alert.targetPrice;
  }

  if (alert.type === 'change_percent') {
    return Math.abs(summary.percentChange) >= alert.targetPercent;
  }

  return false;
};
```

Para notificação visual, usar:

- badge no popup;
- lista no dashboard;
- painel flutuante;
- opcionalmente `chrome.notifications`, se a permissão for adicionada.

## 26. Dashboard full screen

O dashboard deve ser uma página da extensão:

```txt
chrome-extension://{extension-id}/dashboard.html
```

Entradas para abrir:

```txt
Popup da extensão → Dashboard
Painel flutuante → botão Dashboard
chrome://extensions → Detalhes → Opções
```

Blocos recomendados:

```txt
Resumo geral
Itens monitorados
Busca direta por ID/nome
Histórico de preços
Alertas ativos
Últimas atualizações
Configurações de intervalo
Exportar/importar
Logs técnicos
```

Cards por item:

```txt
Ícone do item
Nome do item
ID do item
Último dia
Última média
Média do período
Mínimo / Máximo
Trades do último dia
Trades do período
Variação no período
Última atualização
Status da última busca
```

Comportamento implementado na dashboard:

- o resumo do item principal mostra avatar/ícone, nome real, ID, período e data do snapshot;
- itens monitorados na sidebar mostram ícone, nome e última média;
- itens relacionados da busca também mostram ícone quando `iconUrl` foi capturado;
- itens ainda não fixados exibem o botão `Salvar item`;
- ao salvar, a dashboard envia `PIN_ITEM` com o item normalizado e o snapshot atual;
- depois de salvo, o botão muda para `Salvo` e o item aparece em `Monitorados`.

## 27. Painel flutuante na página

O `content-script` injeta um painel compacto dentro da página real.

Uso:

- fixar item atual;
- ver resumo do item atual;
- buscar item diretamente por ID ou nome;
- abrir dashboard;
- abrir PiP;
- forçar atualização manual;
- ver status da sessão.

Local recomendado:

```css
.tcg-market-helper-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
}
```

Evitar depender do layout interno do painel do site para posicionar a UI. Como o site tem sidebar, header sticky e cards dinâmicos, a extensão deve usar container próprio fixo.

## 28. Document Picture-in-Picture

O PiP tradicional é para vídeo.

Para mostrar HTML em janela flutuante, usar **Document Picture-in-Picture API**.

Fluxo:

```txt
Usuário clica “Abrir PiP”
        ↓
Extensão abre janela compacta
        ↓
PiP mostra item principal
        ↓
Dashboard/background continua atualizando dados
        ↓
PiP recebe atualização por mensagem ou storage listener
```

Conteúdo ideal do PiP:

```txt
Nome do item
ID
Última média
Mín / Máx
Trades
Compras / Vendas
Variação no período
Última atualização
```

Limitações:

- depende de Chrome/Edge modernos;
- exige ação do usuário para abrir;
- a janela PiP depende da aba/contexto original;
- não é ideal para lista grande;
- deve mostrar apenas 1 item principal.

## 29. Busca local e busca direta dentro da extensão

Existem dois comportamentos relacionados ao mesmo campo de busca da UI:

1. **Filtro local enquanto digita**: filtra dados já salvos, sem consultar o site.
2. **Busca direta ao confirmar**: ao pressionar Enter ou clicar no botão de busca, a extensão tenta abrir/carregar o item por ID ou nome usando o painel em background.

Campos para busca:

```txt
name
itemId
game
q
category
tags
snapshot.itemName
snapshot.iconUrl
```

Exemplo:

```js
const filterWatchedItems = (items, search) => {
  const term = String(search || '').trim().toLowerCase();

  if (!term) {
    return items;
  }

  return items.filter((item) => {
    return [item.name, item.itemId, item.game, item.q, item.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
};
```

Implementação atual:

- `dashboard.html` possui o formulário `#itemSearchForm`;
- `content-script.js` renderiza um formulário no card flutuante com `data-role="search-form"`;
- o campo continua filtrando itens locais no evento `input`;
- o submit chama a busca direta;
- se o termo bater com item salvo em `pinned` ou `history`, esse item é selecionado/aberto;
- se o termo for numérico, é tratado como `item_id`;
- se o termo for texto, é tratado como `q`;
- o item buscado é salvo no histórico via `UPSERT_HISTORY`.
- o item pesquisado pode ser fixado na dashboard pelo botão `Salvar item`.

Normalização do termo:

```js
const normalizedSearch = (value) => {
  return normalizeSpace(value).replace(/^#/, '').toLowerCase();
};
```

Criação de item temporário para busca direta:

```js
const createItemFromSearch = (query, settings = {}) => {
  const term = normalizeSpace(query).replace(/^#/, '');

  if (!term) {
    return null;
  }

  const item = {
    game: 'pw126',
    item_name: term,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (/^\d+$/.test(term)) {
    item.item_id = term;
  } else {
    item.q = term;
  }

  return item;
};
```

Observação: a implementação real cria o item de busca com uma janela móvel inicial de datas. Se `dateMode` estiver como `rolling`, `buildMarketUrl` recalcula essa janela antes de montar a URL final.

## 30. Busca no site em background por termo textual

Existem dois modos diferentes:

### 30.1. Buscar item específico

Usa `item_id`.

```txt
/panel/market-analysis?game=pw126&start_date=21%2F04%2F2026&end_date=20%2F05%2F2026&item_id=11208
```

Esse é o modo mais confiável para monitoramento.

### 30.2. Buscar lista de itens por texto

Usa `q`.

```txt
/panel/market-analysis?game=pw126&q=PEDRA&start_date=21%2F04%2F2026&end_date=20%2F05%2F2026
```

Depois o parser lê os cards de “Resultados da pesquisa”.

Uso:

- autocomplete local da extensão;
- buscar novos itens para monitorar;
- salvar resultados candidatos.

Fluxo implementado para busca direta por nome:

```txt
1. Criar item temporário com q={termo}.
2. Fazer REFRESH_ITEM para buscar o HTML da página de análise.
3. Ler relatedItems/resultados capturados do HTML.
4. Se houver resultado compatível, criar novo item com item_id real.
5. Fazer REFRESH_ITEM novamente usando item_id.
6. Normalizar `item_id`, `item_name` e `iconUrl` a partir do snapshot.
7. Salvar snapshot e item normalizado no histórico.
8. Selecionar o item na dashboard ou navegar o card flutuante para a URL real.
9. Se o usuário clicar em `Salvar item`, gravar em `pinned` via `PIN_ITEM`.
```

Não usar somente o modo textual para histórico de preço quando houver resultado com `item_id`, porque os dados completos de preço vêm melhor quando há `item_id` selecionado.

No dashboard, a busca direta não precisa navegar a aba atual: ela carrega o snapshot em background e seleciona o item. No painel flutuante, a busca direta navega a página para a URL montada, preservando a experiência de continuar no painel real.

## 31. Parser completo sugerido

```js
const parseMarketAnalysisHtml = (html, sourceUrl) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const rows = extractJsArray(html, 'rows');
  const currencyRows = extractJsArray(html, 'currencyRows');
  const currentItem = parseCurrentItem(doc, sourceUrl);
  const listedItems = parseMarketItemsFromDoc(doc);
  const iconUrl = currentItem?.iconUrl || extractItemIconFromHTML(html, currentItem?.itemId);
  const normalizedRows = rows.map(normalizePriceRow).filter((row) => row.date);
  const summary = buildItemSummary(rows);

  return {
    currentItem: currentItem ? { ...currentItem, iconUrl } : null,
    listedItems,
    rows: normalizedRows,
    currencyRows,
    summary,
    parsedAt: Date.now(),
    sourceUrl,
  };
};
```

No snapshot salvo pela implementação atual, os campos de identidade ficam junto dos dados parseados:

```js
{
  itemKey: 'pw126:11208',
  itemName: 'Pedra Imortal',
  iconUrl: 'https://theclassic.games/assets/img/iconpw126/11208.png',
  relatedItems: [
    { item_id: '798', item_name: 'Tábua de Qualidade', iconUrl: '...', url: '...' }
  ]
}
```

## 32. Validações do parser

Antes de aceitar o resultado:

```js
const validateParsedMarketData = (data) => {
  if (!data) {
    return { ok: false, reason: 'empty_data' };
  }

  if (!data.currentItem?.itemId) {
    return { ok: false, reason: 'missing_item_id' };
  }

  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    return { ok: false, reason: 'missing_price_rows' };
  }

  if (!data.summary) {
    return { ok: false, reason: 'missing_summary' };
  }

  return { ok: true };
};
```

Se falhar:

- marcar `lastStatus` do item como erro;
- salvar mensagem técnica;
- não apagar histórico anterior;
- exibir aviso no dashboard.

## 33. Riscos dos seletores

O painel não oferece contrato de API. Portanto, seletores podem quebrar.

Riscos principais:

| Risco | Impacto | Mitigação |
|---|---|---|
| Mudança de classes Bootstrap | Parser dos cards pode falhar | Priorizar `href`, `name`, `id`, `aria-label`. |
| Mudança do nome `rows` | Parser dos gráficos falha | Criar fallback por `marketItemPriceChart` e padrões de campos. |
| HTML de login retornado | Parser lê página errada | Detectar login/sessão expirada. |
| Gráfico muda de ApexCharts para outro lib | Arrays podem mudar | Separar parser em módulo e logar falhas. |
| Item sem dados no período | `rows` vazio | Mostrar “sem dados no período”, não erro fatal. |

## 34. Estratégia de fallback

Ordem de confiabilidade:

```txt
1. Array JS `rows` para dados históricos do item.
2. Array JS `currencyRows` para movimentação de moedas.
3. DOM do card do gráfico para nome/ícone/ID.
4. Cards com `.stretched-link` para busca/listagem de itens.
5. Texto visível “Preço médio:” como fallback fraco.
```

Fallback textual de preço médio:

```js
const extractAveragePriceFromText = (text) => {
  const match = String(text || '').match(/Preço médio:\s*([\d.]+)/i);
  return match ? Number(match[1].replace(/\./g, '')) : 0;
};
```

Esse fallback é mais frágil, porque depende do idioma e do texto visível.

## 35. Formatação de moeda/número

A página usa formato brasileiro/português visualmente.

Função recomendada:

```js
const formatInteger = (value) => {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
};
```

Exemplo:

```txt
81011.5984 → 81.012
259841031 → 259.841.031
```

## 36. Exportar/importar dados

Exportar:

```js
const exportData = async () => {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `the-classic-market-helper-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
```

Importar:

- validar JSON;
- validar versão/schema;
- não importar scripts;
- sobrescrever apenas chaves conhecidas;
- fazer backup antes de substituir.

Chaves permitidas:

```txt
settings
watchedItems
priceHistory
alerts
categories
```

## 37. Logs técnicos

Salvar logs mínimos para debug:

```json
{
  "createdAt": 1779830000000,
  "level": "error",
  "scope": "parser",
  "itemKey": "pw126:11208",
  "message": "missing_price_rows"
}
```

Evitar salvar HTML completo por padrão, pois pode conter dados do painel/logado.

Se for necessário debug avançado, criar opção manual:

```txt
Ativar modo diagnóstico por 10 minutos
```

Mesmo assim, mascarar dados sensíveis.

## 38. Segurança obrigatória

Regras:

- usar `textContent`, não `innerHTML`, ao renderizar dados extraídos;
- não executar scripts do HTML parseado;
- não salvar cookies/tokens;
- não enviar dados para servidores externos;
- não usar CDN externa na extensão;
- limitar permissões ao domínio necessário;
- validar importação JSON;
- tratar sessão expirada;
- manter dados no navegador do usuário.

Exemplo seguro:

```js
const title = document.createElement('div');
title.textContent = item.name;
```

Evitar:

```js
title.innerHTML = item.name;
```

## 39. Performance

Cuidados:

- não atualizar muitos itens em paralelo;
- usar fila com concorrência baixa;
- aguardar um intervalo aleatório de 30 a 60 segundos entre requisições ao painel;
- evitar intervalos curtos;
- não salvar HTML bruto repetidamente;
- salvar somente dados normalizados;
- limitar histórico;
- recalcular dashboard sob demanda ou com debounce.

Fila simples com throttle:

```js
const randomDelayMs = () => 30000 + Math.round(Math.random() * 30000);

const runSequentially = async (items, task) => {
  const results = [];

  for (const [index, item] of items.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, randomDelayMs()));
    }

    results.push(await task(item));
  }

  return results;
};
```

## 40. Limitações reais

A extensão depende do HTML atual do painel.

Limitações:

- se o painel mudar o HTML, o parser pode quebrar;
- se o usuário não estiver logado, não haverá dados;
- se o servidor bloquear requests frequentes, atualização pode falhar;
- se não houver dados no período, não há preço para salvar;
- `currencyRows` é dado global do jogo, não do item;
- `buy_trades` e `sell_trades` são nomes técnicos do HTML; a interpretação “compra/venda” deve ser mostrada com cautela.

## 41. Critérios de aceite

A extensão está correta quando:

- abre dashboard full screen;
- injeta painel flutuante na página de análise;
- fixa item atual;
- busca item por ID ou nome pela dashboard;
- busca item por ID ou nome pelo painel flutuante;
- exibe nome real e ícone do item quando o HTML fornece esses dados;
- permite salvar item pesquisado em Monitorados sem precisar buscar novamente;
- monitora item por `game:item_id`;
- busca HTML em background com sessão ativa;
- extrai `rows` e `currencyRows` quando disponíveis;
- salva histórico diário por item;
- exibe última média, média do período, variação e trades;
- permite configurar intervalo de atualização;
- exporta/importa dados;
- alerta quando preço cruza regra configurada;
- não salva login, senha, cookie ou token;
- não executa scripts do HTML buscado.

## 42. Roadmap técnico

### Fase 1 — Base funcional

```txt
Content-script
Painel flutuante
Fixar item atual
Parser de URL e DOM
Storage local
Dashboard básico
```

### Fase 2 — Monitoramento

```txt
Background fetch
chrome.alarms
Parser de rows/currencyRows
Histórico diário
Status da última atualização
```

### Fase 3 — Produto utilizável

```txt
Alertas de preço
Exportar/importar
Busca local
Busca direta por ID/nome
Categorias/tags
Configuração de intervalo
```

### Fase 4 — Experiência avançada

```txt
Dashboard full screen refinado
Document PiP
Comparação entre itens
Gráficos próprios da extensão
Logs técnicos
Modo diagnóstico
```

## 43. Decisão técnica final

A melhor abordagem é manter como extensão Chrome/Edge Manifest V3.

Motivo: a extensão consegue trabalhar sobre a página logada, usar a sessão atual do navegador, buscar o HTML em background e salvar dados localmente sem depender de API externa.

A fonte principal dos preços não é o tooltip do gráfico. A fonte principal é o array JavaScript `rows` embutido no HTML da página. Os cards visíveis servem como complemento para nome, ID, ícone e links dos itens.

A extensão deve tratar o HTML como uma fonte instável, com parser isolado, validação forte, fallback e logs de erro.
