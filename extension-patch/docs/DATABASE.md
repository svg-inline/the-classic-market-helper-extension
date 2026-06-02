# Banco de dados

## market_items

Tabela mestre por item.

Chave lógica:

```txt
game + item_id
```

Campos principais:

```txt
game
item_id
item_name
icon_url
last_snapshot_at
```

## market_item_snapshots

Cada POST da extensão gera um snapshot.

Campos principais:

```txt
fetched_at
latest_avg_price
latest_median_price
latest_min_price
latest_max_price
period_avg_price
period_min_price
period_max_price
trend_avg_pct
raw
```

`raw` guarda o snapshot sanitizado, sem `rawTextPreview`, `html` ou `rawHtml`.

## market_item_price_days

Histórico diário por item e data.

Chave lógica:

```txt
game + item_id + stat_date
```

Essa tabela é usada para histórico e gráficos futuros.
