import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { setSubsonicDisplayConfig } from '@/sources/subsonic';
import type { SourceContext } from '@/sources/types';

// Ключи и токены хранятся только в защищённом хранилище Android, а не в базе и не в файлах.
const memory = new Map<string, string>();
const keyOf = (id: string) => `source.${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return memory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}
async function write(key: string, value: string | null) {
  if (Platform.OS === 'web') { if (value === null) memory.delete(key); else memory.set(key, value); return; }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export const sourceContext: SourceContext = {
  async getConfig(id) {
    try { return JSON.parse((await read(keyOf(id))) ?? '{}'); } catch { return {}; }
  },
  async setConfig(id, values) {
    const current = await this.getConfig(id);
    const next = { ...current, ...values };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    await write(keyOf(id), JSON.stringify(next));
    if (id === 'subsonic') setSubsonicDisplayConfig(next);
  },
  async clearConfig(id) { await write(keyOf(id), null); if (id === 'subsonic') setSubsonicDisplayConfig({}); },
};
