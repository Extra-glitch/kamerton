import type { Availability, ExplicitState, SourceTrack } from './types';
import { parseTitle, resolveExplicit } from './versions';

export type VersionFilter = 'original_first' | 'all' | 'clean_only';

export interface ChooseOptions {
  directSources: Set<string>;
  priority: string[];
  versionFilter: VersionFilter;
  userChoice?: string | null;
}

const AVAIL: Record<Availability, number> = {
  full: 0, preview: 2, subscription_required: 3, external_only: 3, region_blocked: 4, gone: 5,
};
const ORIGINAL_FIRST: Record<ExplicitState, number> = { explicit: 0, not_explicit: 1, unknown: 2, clean: 4 };
const CLEAN_FIRST: Record<ExplicitState, number> = { clean: 0, not_explicit: 1, unknown: 2, explicit: 4 };

export function effectiveExplicit(s: Pick<SourceTrack, 'explicit' | 'title'>): ExplicitState {
  return resolveExplicit(s.explicit, parseTitle(s.title).versionTags);
}

function qualityRank(s: SourceTrack): number {
  if (s.localPath) return 10000;
  if (s.quality?.lossless) return 5000;
  return s.quality?.bitrateKbps ?? 0;
}

/** Выбор источника по умолчанию: полный трек, оригинал, затем приоритет и качество. */
export function chooseSource(sources: SourceTrack[], o: ChooseOptions): SourceTrack | null {
  if (!sources.length) return null;
  const pinned = o.userChoice ? sources.find((s) => s.id === o.userChoice && s.availability !== 'gone') : undefined;
  if (pinned) return pinned;
  const rank = (s: SourceTrack) => {
    const p = o.priority.indexOf(s.source);
    return p < 0 ? o.priority.length : p;
  };
  const versions = o.versionFilter === 'clean_only' ? CLEAN_FIRST : ORIGINAL_FIRST;
  return [...sources].sort(
    (a, b) =>
      AVAIL[a.availability] - AVAIL[b.availability] ||
      Number(!o.directSources.has(a.source)) - Number(!o.directSources.has(b.source)) ||
      (o.versionFilter === 'all' ? 0 : versions[effectiveExplicit(a)] - versions[effectiveExplicit(b)]) ||
      rank(a) - rank(b) ||
      qualityRank(b) - qualityRank(a),
  )[0];
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  full: 'Можно слушать целиком',
  preview: 'Только фрагмент',
  subscription_required: 'Нужна подписка',
  external_only: 'Только в официальном сервисе',
  region_blocked: 'Недоступно в вашем регионе',
  gone: 'Больше недоступно',
};
