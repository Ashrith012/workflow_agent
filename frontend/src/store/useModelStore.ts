import { create } from 'zustand';
import { api } from '../api/client';
import { MODEL_GROUPS } from '../nodes/models';
import type { OptionGroup } from '../types';

export interface TenantModel {
  model_key: string;
  name: string;
  provider: string;
  kind: 'hosted' | 'selfhosted';
  status: string;
  base_url: string;
}

interface ModelState {
  /** Authorized models from the tenant admin; null until loaded (then the static catalog is the fallback). */
  models: TenantModel[] | null;
  load: () => Promise<void>;
}

/**
 * The AI Agent node's model choices come from what the tenant admin authorizes, not from
 * the shipped catalog, so a newly authorized model — including the admin's own self-hosted
 * LLM — is selectable in the builder straight away.
 */
export const useModelStore = create<ModelState>()((set, get) => ({
  models: null,
  load: async () => {
    if (get().models) return;
    try {
      set({ models: await api<TenantModel[]>('/api/fde/models') });
    } catch {
      set({ models: [] }); // Fall back to the static catalog below.
    }
  },
}));

/** Authorized models as picker groups, with self-hosted ones in their own group. */
export function modelGroups(models: TenantModel[] | null): OptionGroup[] {
  if (!models || models.length === 0) return MODEL_GROUPS;
  const groups = new Map<string, OptionGroup>();
  for (const m of models) {
    const label = m.kind === 'selfhosted' ? `${m.provider} (your own LLM)` : m.provider;
    const group = groups.get(label) ?? { label, options: [] };
    group.options.push({ value: m.model_key, label: m.status === 'deprecated' ? `${m.name} (deprecated)` : m.name });
    groups.set(label, group);
  }
  // Self-hosted groups last, so the familiar hosted providers stay at the top of the list.
  return [...groups.values()].sort((a, b) => Number(a.label.includes('your own')) - Number(b.label.includes('your own')));
}
