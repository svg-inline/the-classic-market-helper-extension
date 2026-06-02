// Exemplo de integração para colar/adaptar no background.js da extensão.
// Não substitui o arquivo inteiro.

const REMOTE_CACHE_BASE_URL = "https://the-classic-marketplace.vercel.app/";
const REMOTE_CACHE_API_KEY = "slfEiJRh2aaW8UpcATZJ7bktHHSVRfI0";
const REMOTE_CACHE_ENABLED = true;

const remoteItemPath = (item) => {
  const game = encodeURIComponent(item.game || "pw126");
  const itemId = encodeURIComponent(item.item_id || "");
  return `/api/market/items/${game}/${itemId}`;
};

const readRemoteCache = async (item) => {
  if (!REMOTE_CACHE_ENABLED || !item?.item_id) return null;

  try {
    const response = await fetch(
      `${REMOTE_CACHE_BASE_URL}${remoteItemPath(item)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.data || null;
  } catch (_error) {
    return null;
  }
};

const writeRemoteSnapshot = async (item, snapshot) => {
  if (!REMOTE_CACHE_ENABLED || !item?.item_id || !snapshot?.ok) return null;

  try {
    const response = await fetch(
      `${REMOTE_CACHE_BASE_URL}${remoteItemPath(item)}/snapshot`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tcmh-api-key": REMOTE_CACHE_API_KEY,
        },
        body: JSON.stringify({ item, snapshot }),
      },
    );

    if (!response.ok) return null;
    return response.json();
  } catch (_error) {
    return null;
  }
};

const fetchSnapshotWithRemoteCache = async (item, settings) => {
  const remote = await readRemoteCache(item);

  if (remote?.fresh && remote.snapshot?.raw) {
    return {
      ...remote.snapshot.raw,
      capturedAt: new Date(remote.snapshot.fetched_at).getTime(),
      sourceUrl:
        remote.snapshot.source_url || remote.snapshot.raw.sourceUrl || "",
      fromRemoteCache: true,
    };
  }

  const snapshot = await fetchSnapshotForItemNow(item, settings);
  await writeRemoteSnapshot(item, snapshot);
  return snapshot;
};

// Trocar:
// const snapshot = await fetchSnapshotForItemNow(item, settings);
// Por:
// const snapshot = await fetchSnapshotWithRemoteCache(item, settings);
