import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { sourceContext } from '@/platform/secureConfig';
import { ADAPTERS, CATEGORY_LABEL, playbackLabel, STATE_LABEL } from '@/sources/registry';
import type { SourceCategory } from '@/sources/types';
import { useUi } from '@/state/app';
import { Row, Screen, T } from '@/ui/kit';

const ORDER: SourceCategory[] = ['own', 'server', 'independent', 'open', 'radio', 'commercial'];

export default function Sources() {
  const v = useUi((u) => u.dataVersion);
  const q = useQuery({ queryKey: ['sources', v], queryFn: async () => new Map(await Promise.all(ADAPTERS.map(async (a) => [a.id, await a.status(sourceContext)] as const))), staleTime: 0 });
  return (
    <Screen title="Источники музыки">
      <T c="muted" style={{ marginTop: -8 }}>Здесь видно, что каждый сервис разрешает на самом деле.</T>
      {ORDER.map((cat) => (
        <View key={cat} style={{ marginTop: 26 }}>
          <T v="h2" style={{ marginBottom: 4 }}>{CATEGORY_LABEL[cat]}</T>
          {ADAPTERS.filter((a) => a.category === cat).map((a) => {
            const st = q.data?.get(a.id);
            return <Row key={a.id} testID={`source-${a.id}`} title={a.name} sub={`${st ? STATE_LABEL[st.state] : '…'}. ${playbackLabel(a)}${st?.detail ? `. ${st.detail}` : ''}`} onPress={() => router.push({ pathname: '/sources/[id]', params: { id: a.id } })} />;
          })}
        </View>
      ))}
    </Screen>
  );
}
