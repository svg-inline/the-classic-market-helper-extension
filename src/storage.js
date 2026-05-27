(() => {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    autoRefreshEnabled: true,
    refreshPreset: 'every_5_hours',
    customHours: 24,
    dateMode: 'saved',
    rollingDays: 30,
    maxHistory: 50,
    notifyOnRefreshError: true,
    notifyOnRefreshSuccess: false,
    alertNotificationsEnabled: true,
    alertCooldownHours: 6
  });

  const REFRESH_PRESETS = Object.freeze({
    every_5_hours: { label: 'Cada 5 horas', hours: 5 },
    three_times_day: { label: '3 vezes ao dia', hours: 8 },
    two_times_day: { label: '2 vezes ao dia', hours: 12 },
    once_day: { label: '1 vez ao dia', hours: 24 },
    every_2_days: { label: 'Cada 2 dias', hours: 48 },
    every_3_days: { label: 'Cada 3 dias', hours: 72 },
    weekly: { label: 'A cada 7 dias', hours: 168 },
    every_15_days: { label: 'A cada 15 dias', hours: 360 },
    monthly: { label: 'A cada 30 dias', hours: 720 },
    custom: { label: 'Intervalo personalizado', hours: null }
  });

  const DEFAULT_STATE = Object.freeze({
    schemaVersion: 2,
    settings: DEFAULT_SETTINGS,
    pinned: [],
    history: [],
    snapshots: {},
    alerts: [],
    lastRefresh: null,
    lastRefreshStatus: 'never'
  });

  const hasChromeStorage = () => Boolean(window.chrome?.storage?.local);
  const LOCAL_FALLBACK_KEY = 'tcmh-storage-fallback';

  const storageGet = (keys = null) => new Promise((resolve) => {
    if (hasChromeStorage()) {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
      return;
    }

    try {
      const result = JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || '{}');
      resolve(result && typeof result === 'object' ? result : {});
    } catch (_error) {
      resolve({});
    }
  });

  const storageSet = (payload) => new Promise((resolve) => {
    if (hasChromeStorage()) {
      chrome.storage.local.set(payload, () => resolve());
      return;
    }

    storageGet(null).then((current) => {
      localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify({
        ...current,
        ...(payload || {})
      }));
      resolve();
    });
  });

  const storageClear = () => new Promise((resolve) => {
    if (hasChromeStorage()) {
      chrome.storage.local.clear(() => resolve());
      return;
    }

    localStorage.removeItem(LOCAL_FALLBACK_KEY);
    resolve();
  });

  const getState = async () => {
    const result = await storageGet(null);
    const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };

    return {
      ...DEFAULT_STATE,
      ...result,
      settings,
      pinned: Array.isArray(result.pinned) ? result.pinned : [],
      history: Array.isArray(result.history) ? result.history : [],
      snapshots: result.snapshots && typeof result.snapshots === 'object' ? result.snapshots : {},
      alerts: Array.isArray(result.alerts) ? result.alerts : []
    };
  };

  const saveStatePatch = async (patch) => {
    await storageSet(patch);
    return getState();
  };

  const resolveRefreshHours = (settings) => {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    if (merged.refreshPreset === 'custom') {
      const value = Number(merged.customHours);
      return Number.isFinite(value) && value >= 1 ? value : DEFAULT_SETTINGS.customHours;
    }

    return REFRESH_PRESETS[merged.refreshPreset]?.hours || REFRESH_PRESETS.every_5_hours.hours;
  };

  window.TcmhStorage = {
    DEFAULT_SETTINGS,
    REFRESH_PRESETS,
    getState,
    saveStatePatch,
    storageGet,
    storageSet,
    storageClear,
    resolveRefreshHours
  };
})();
