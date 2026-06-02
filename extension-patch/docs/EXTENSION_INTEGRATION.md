# Integração com a extensão atual

Objetivo: antes da extensão buscar o HTML do painel, ela deve consultar o Next.js. Se o cache estiver fresco, usa Supabase. Se estiver ausente ou vencido, mantém o fluxo atual e depois envia o snapshot para o backend.

## 1. Adicionar permissões no manifest

Adicionar o domínio da Vercel em `host_permissions`:

```json
{
  "host_permissions": [
    "https://userpanel.theclassic.games/*",
    "https://SEU_APP.vercel.app/*"
  ]
}
```

## 2. Configuração mínima no background.js

```js
const REMOTE_CACHE_BASE_URL = 'https://SEU_APP.vercel.app';
const REMOTE_CACHE_API_KEY = 'mesmo_valor_de_TCMH_EXTENSION_API_KEY';
const REMOTE_CACHE_ENABLED = true;
```

Observação: chave em extensão é visível para usuários avançados. Use isso como proteção inicial, não como segurança final.

## 3. Funções para consultar e gravar cache

```js
const remoteItemPath = (item) => {
  const game = encodeURIComponent(item.game || 'pw126');
  const itemId = encodeURIComponent(item.item_id || '');
  return `/api/market/items/${game}/${itemId}`;
};

const readRemoteCache = async (item) => {
  if (!REMOTE_CACHE_ENABLED || !item?.item_id) {
    return null;
  }

  const response = await fetch(`${REMOTE_CACHE_BASE_URL}${remoteItemPath(item)}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.data || null;
};

const writeRemoteSnapshot = async (item, snapshot) => {
  if (!REMOTE_CACHE_ENABLED || !item?.item_id || !snapshot?.ok) {
    return null;
  }

  const response = await fetch(`${REMOTE_CACHE_BASE_URL}${remoteItemPath(item)}/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tcmh-api-key': REMOTE_CACHE_API_KEY,
    },
    body: JSON.stringify({ item, snapshot }),
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
};
```

## 4. Usar antes do fetch do painel

No fluxo atual, antes de chamar `fetchSnapshotForItemNow(item, settings)`, faça:

```js
const fetchSnapshotWithRemoteCache = async (item, settings) => {
  const remote = await readRemoteCache(item);

  if (remote?.fresh && remote.snapshot?.raw) {
    return {
      ...remote.snapshot.raw,
      capturedAt: new Date(remote.snapshot.fetched_at).getTime(),
      sourceUrl: remote.snapshot.source_url || remote.snapshot.raw.sourceUrl || '',
      fromRemoteCache: true,
    };
  }

  const snapshot = await fetchSnapshotForItemNow(item, settings);
  await writeRemoteSnapshot(item, snapshot).catch(() => null);
  return snapshot;
};
```

Depois troque chamadas internas:

```diff
- const snapshot = await fetchSnapshotForItemNow(item, settings)
+ const snapshot = await fetchSnapshotWithRemoteCache(item, settings)
```

## 5. Comportamento esperado

```txt
Cache HIT fresco:
  extensão não chama o painel do jogo
  usa snapshot salvo no Supabase

Cache MISS ou STALE:
  extensão chama o painel como já faz hoje
  parseia rows/currencyRows
  envia snapshot ao backend

Erro remoto:
  extensão ignora o backend
  mantém fluxo local atual
```

## 6. Não enviar HTML bruto

Não envie `rawTextPreview`, HTML completo, cookie, token ou dados de login para o backend. Este projeto sanitiza `rawTextPreview`, mas a extensão também deve evitar mandar dados sensíveis.
