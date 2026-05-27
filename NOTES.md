# Notas técnicas

## Fonte de dados

A página de análise não expõe uma API JSON pública. Os dados usados pela extensão vêm do HTML server-rendered do painel:

- links e cards visíveis no DOM;
- scripts inline usados pelos gráficos;
- texto visível apenas como fallback.

As variáveis mais importantes embutidas no HTML são:

```txt
rows
currencyRows
```

`rows` contém dados diários do item selecionado:

```txt
item_id, stat_date, raw_trades, filtered_trades, buy_trades, sell_trades, total_gold,
avg_price, median_price, min_price, max_price, range_min_price, range_max_price, updated_at
```

`currencyRows` contém movimentação diária de moedas do jogo/servidor:

```txt
stat_date, buy_gold_total, sell_gold_total, buy_trades, sell_trades, updated_at
```

## Parser atual

O parser principal está duplicado de forma intencional em `src/market.js` e `src/background.js`, porque o service worker não compartilha o objeto `window` do content script/dashboard.

Ordem de confiabilidade:

1. `rows` para histórico e métricas do item.
2. `currencyRows` para movimentação global de moedas.
3. Links `item_id`, `aria-label`, `pwdatabase` e ícones para identidade do item.
4. Texto visível como fallback fraco.

Quando `rows` existe, o snapshot usa `parserSource: "inline_apexcharts_rows"` e `parserConfidence: "high"`.

## Modelo local

Estado salvo em `chrome.storage.local`:

```txt
schemaVersion
settings
pinned
history
snapshots
alerts
lastRefresh
lastRefreshStatus
refreshJob
```

Chave lógica do item:

```txt
game:item_id
```

Se o item ainda veio de uma busca textual sem ID, a chave temporária usa `game:q`.

## Atualização

O background usa `chrome.alarms` para agendamento e uma fila persistida em `refreshJob` para atualizar vários itens. Entre requisições ao painel existe um atraso aleatório de 30 a 60 segundos, reduzindo rajadas de fetch.

Intervalos suportados:

```txt
5h, 8h, 12h, 24h, 48h, 72h, 168h, 360h, 720h ou personalizado
```

O modo de datas pode usar o período salvo no item ou uma janela móvel (`dateMode: "rolling"`) recalculada antes de montar a URL.

## Alertas

Condições atuais:

```txt
avg_above
avg_below
median_above
median_below
trades_above
variation_above
variation_below
```

As notificações locais dependem da permissão `notifications` no Manifest V3 e respeitam `alertCooldownHours`.

## Importação/exportação

O JSON exportado inclui:

```txt
settings, pinned, history, snapshots, alerts
```

Na importação, a extensão aceita apenas essas chaves conhecidas e mistura `settings` importado com os defaults atuais.

## Riscos

O parser depende do servidor continuar renderizando `var rows = [...]` e `var currencyRows = [...]`.

Se o painel migrar para bundle minificado, XHR, nomes diferentes de variável ou outra biblioteca de gráfico, será necessário ajustar `src/market.js` e `src/background.js`.

Também há risco nos seletores de cards e resultados de busca. Sempre priorizar identificadores menos visuais, como `href`, `item_id`, `aria-label`, `name` e links do `pwdatabase`, antes de classes CSS.
