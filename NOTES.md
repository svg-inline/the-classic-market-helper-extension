# Notas técnicas

## Insight extraído do HTML real

A página de análise não expõe JSON por API pública, mas embute os dados dos gráficos em JavaScript inline.

Variáveis relevantes:

```txt
currencyRows
rows
```

`rows` contém dados diários do item selecionado:

```txt
item_id, stat_date, raw_trades, filtered_trades, buy_trades, sell_trades, total_gold, avg_price, median_price, min_price, max_price, range_min_price, range_max_price, updated_at
```

`currencyRows` contém movimentação geral diária de moedas:

```txt
stat_date, buy_gold_total, sell_gold_total, buy_trades, sell_trades, updated_at
```

Com isso, a extensão não precisa depender apenas de regex textual como `Preço médio:`. O parser principal agora lê esses arrays e só usa texto como fallback.

## Risco

O parser depende do servidor continuar renderizando `var rows = [...]` e `var currencyRows = [...]`. Se o painel migrar para bundle minificado, XHR ou outro nome de variável, será necessário ajustar `src/market.js` e `src/background.js`.
