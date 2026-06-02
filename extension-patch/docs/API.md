# API

Base local:

```txt
http://localhost:3000
```

Base produção:

```txt
https://SEU_APP.vercel.app
```

## GET /api/market/items/:game/:itemId

Consulta o cache do item.

```bash
curl "http://localhost:3000/api/market/items/pw126/11208"
```

Resposta com cache fresco:

```json
{
  "ok": true,
  "data": {
    "game": "pw126",
    "itemId": "11208",
    "source": "supabase",
    "fresh": true,
    "needsRefresh": false,
    "cache": {
      "ttlHours": 12,
      "ageSeconds": 300
    },
    "item": {},
    "snapshot": {}
  }
}
```

Resposta sem cache ou cache velho:

```json
{
  "ok": false,
  "data": {
    "game": "pw126",
    "itemId": "11208",
    "source": "supabase",
    "fresh": false,
    "needsRefresh": true,
    "cache": {
      "ttlHours": 12,
      "ageSeconds": null
    },
    "item": null,
    "snapshot": null
  }
}
```

## POST /api/market/items/:game/:itemId/snapshot

Salva snapshot vindo da extensão.

Headers:

```txt
content-type: application/json
x-tcmh-api-key: valor_de_TCMH_EXTENSION_API_KEY
```

Payload:

```json
{
  "item": {
    "game": "pw126",
    "item_id": "11208",
    "item_name": "Pedra Imortal",
    "iconUrl": "https://theclassic.games/assets/img/iconpw126/11208.png"
  },
  "snapshot": {
    "ok": true,
    "capturedAt": 1779830000000,
    "itemName": "Pedra Imortal",
    "parserSource": "inline_apexcharts_rows",
    "parserConfidence": "high",
    "stats": {
      "latest": {},
      "itemRows": []
    }
  }
}
```

## GET /api/market/search

Busca itens já salvos no Supabase.

```bash
curl "http://localhost:3000/api/market/search?game=pw126&q=pedra"
```

## GET /api/market/items/:game/:itemId/history

Retorna histórico diário salvo.

```bash
curl "http://localhost:3000/api/market/items/pw126/11208/history?days=30"
```

## GET /api/market/stats

Resumo para dashboard.

## GET /api/health

Healthcheck simples.
