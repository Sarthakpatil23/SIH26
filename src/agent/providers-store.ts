// Storage for custom LLM providers (OmniRoute, DeepSeek, OpenRouter, etc.)
// Persisted across native-host restarts in ~/.browy/data/providers.json.

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CustomProviderConfig, ProvidersStore } from '../types.js';

const DATA_DIR = path.join(os.homedir(), '.browy', 'data');
const PROVIDERS_PATH = path.join(DATA_DIR, 'providers.json');

const DEFAULT_STORE: ProvidersStore = {
  activeProviderId: null, // null means use default GitHub Copilot
  providers: [],
};

export function loadProvidersStore(): ProvidersStore {
  try {
    if (!fs.existsSync(PROVIDERS_PATH)) {
      return { ...DEFAULT_STORE };
    }
    const raw = fs.readFileSync(PROVIDERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        activeProviderId: parsed.activeProviderId || null,
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      };
    }
  } catch {
    // Fail-soft: return default empty store on corruption/missing file
  }
  return { ...DEFAULT_STORE };
}

export function saveProvidersStore(store: ProvidersStore): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save providers store:', err);
  }
}

export function getActiveProvider(): CustomProviderConfig | null {
  const store = loadProvidersStore();
  if (!store.activeProviderId) return null;
  return store.providers.find((p) => p.id === store.activeProviderId) || null;
}

export function setActiveProvider(id: string | null): void {
  const store = loadProvidersStore();
  store.activeProviderId = id;
  saveProvidersStore(store);
}

export function saveProvider(config: CustomProviderConfig): CustomProviderConfig {
  const store = loadProvidersStore();
  const existingIdx = store.providers.findIndex((p) => p.id === config.id);
  const now = Date.now();

  const toSave: CustomProviderConfig = {
    ...config,
    updatedAt: now,
    createdAt: existingIdx >= 0 ? store.providers[existingIdx].createdAt || now : now,
  };

  if (existingIdx >= 0) {
    store.providers[existingIdx] = toSave;
  } else {
    store.providers.push(toSave);
  }

  saveProvidersStore(store);
  return toSave;
}

export function deleteProvider(id: string): boolean {
  const store = loadProvidersStore();
  const beforeLen = store.providers.length;
  store.providers = store.providers.filter((p) => p.id !== id);
  if (store.activeProviderId === id) {
    store.activeProviderId = null;
  }
  if (store.providers.length !== beforeLen) {
    saveProvidersStore(store);
    return true;
  }
  return false;
}
