import { create } from 'zustand';
import type { VersionFilter } from '@/core/choose';
import { kvGet, kvSet, setSourceChoice } from '@/db/repo';
import { DEFAULT_PRIORITY, DIRECT_SOURCES } from '@/sources/registry';
import type { QualityPreference } from '@/sources/types';

export interface Settings {
  onboarded: boolean;
  profileName: string;
  theme: 'system' | 'dark' | 'light';
  discovery: number;
  versionFilter: VersionFilter;
  /** В поиске показывать только то, что играет целиком. */
  fullOnly: boolean;
  /** Подкрашивать приложение цветами обложки текущего трека. */
  coverColors: boolean;
  /** Фоновые анимации. Системная настройка «Уменьшить движение» учитывается всегда. */
  animations: boolean;
  qualityWifi: QualityPreference;
  qualityCell: QualityPreference;
  fade: boolean;
  volume: number;
  recordHistory: boolean;
  videoEnabled: boolean;
  lrclibEnabled: boolean;
  musicBrainzEnabled: boolean;
  listenBrainzEnabled: boolean;
  dailyNotification: boolean;
  seedTags: string[];
  seedArtists: string[];
  sourcePriority: string[];
}

export const DEFAULTS: Settings = {
  onboarded: false, profileName: '', theme: 'dark', discovery: 0.5, versionFilter: 'original_first', fullOnly: false, coverColors: true, animations: true,
  qualityWifi: 'lossless', qualityCell: 'normal', fade: false, volume: 1, recordHistory: true, videoEnabled: true, lrclibEnabled: false,
  musicBrainzEnabled: true, listenBrainzEnabled: true, dailyNotification: false, seedTags: [], seedArtists: [], sourcePriority: DEFAULT_PRIORITY,
};

interface Store extends Settings {
  loaded: boolean;
  load(): Promise<void>;
  set(patch: Partial<Settings>): void;
}

const pick = (s: Store): Settings => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, (s as any)[k]])) as unknown as Settings;

export const useSettings = create<Store>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  async load() {
    const saved = await kvGet<Partial<Settings>>('settings', {});
    const next = { ...DEFAULTS, ...saved };
    setSourceChoice({ directSources: DIRECT_SOURCES, priority: next.sourcePriority, versionFilter: next.versionFilter });
    set({ ...next, loaded: true });
  },
  set(patch) {
    set(patch);
    const s = pick(get());
    setSourceChoice({ directSources: DIRECT_SOURCES, priority: s.sourcePriority, versionFilter: s.versionFilter });
    void kvSet('settings', s);
  },
}));

export const settings = () => useSettings.getState();
