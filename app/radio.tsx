import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { friendlyError } from '@/net/http';
import { radioByCountry, radioByTag, radioTop } from '@/sources/radio';
import { storeRadio } from '@/services/media';
import { useSettings } from '@/state/settings';
import { playTracks } from '@/state/app';
import { Chip, Loading, Notice, Screen, Shelf, T } from '@/ui/kit';
import { TrackRow } from '@/ui/music';

const TAGS = [['', 'Популярные'], ['country:RU', 'Россия'], ['rock', 'Рок'], ['jazz', 'Джаз'], ['electronic', 'Электроника'], ['ambient', 'Эмбиент'], ['classical', 'Классика'], ['indie', 'Инди'], ['news', 'Новости']];

export default function Radio() {
  const [tag, setTag] = useState('');
  const off = useSettings((x) => x.disabledSources).includes('radio');
  const q = useQuery({ enabled: !off, queryKey: ['radio', tag], queryFn: async () => storeRadio(tag.startsWith('country:') ? await radioByCountry(tag.slice(8)) : tag ? await radioByTag(tag) : await radioTop()) });
  return (
    <Screen title="Радио">
      <T c="muted" style={{ marginTop: -8, marginBottom: 12 }}>Живой эфир из открытого каталога Radio Browser.</T>
      <Shelf>{TAGS.map(([id, l]) => <Chip key={id} label={l} on={tag === id} onPress={() => setTag(id)} />)}</Shelf>
      {off ? <Notice tone="muted" text="Радио выключено в Диагностике источников. Включите его там, чтобы слушать эфир." /> : null}
      {q.isLoading && !off ? <Loading /> : null}
      {q.isError ? <Notice tone="danger" text={friendlyError(q.error)} /> : null}
      {q.data?.map((t) => <TrackRow key={t.id} t={t} onPress={() => void playTracks([t], 0, 'radio-station')} />)}
    </Screen>
  );
}
