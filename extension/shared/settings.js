import { ext } from './ext.js';

export const SPEED_PRESETS = {
  safe: { label: 'Safe', min: 6, max: 12, note: 'Same pace as gallery-dl\'s default. Recommended.' },
  balanced: { label: 'Balanced', min: 3, max: 6, note: 'Faster; small profiles only.' },
  fast: { label: 'Fast', min: 1, max: 2, note: 'High risk of "Please wait a few minutes" blocks.' },
  custom: { label: 'Custom', min: null, max: null, note: 'Your own delay range.' },
};

export const DEFAULT_SETTINGS = Object.freeze({
  speed: 'safe',
  customMin: 6,
  customMax: 12,
  windowCap: true,
  mediaConcurrency: 3,
  rootFolder: 'Gram Archiver',
  filenameTemplate: '{date}_{shortcode}_{index}',
  conflictAction: 'overwrite',
  theme: 'system',
  profileButton: true,
  eraseDownloadHistory: false,
  debugLog: false,
  lastJobOptions: null,
});

export async function loadSettings() {
  try {
    const stored = await ext.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await ext.storage.local.set({ settings: next });
  return next;
}

export function delayRange(settings) {
  if (settings.speed === 'custom') {
    const min = Math.max(0, Number(settings.customMin) || 0);
    const max = Math.max(min, Number(settings.customMax) || min);
    return { min, max };
  }
  const p = SPEED_PRESETS[settings.speed] || SPEED_PRESETS.safe;
  return { min: p.min, max: p.max };
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
