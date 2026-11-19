// Сервисы, которые нельзя законно воспроизводить внутри нашего плеера.
// Здесь только то, что подтверждено исследованием: ссылка, импорт по названиям, задел под официальный SDK.

import { caps, type MusicSourceAdapter, type SourceDoc } from './types';

const q = (v: { title: string; artist: string }) => encodeURIComponent(`${v.artist} ${v.title}`.trim());

function linkOnly(id: string, name: string, doc: SourceDoc, url: (s: string) => string, over: Parameters<typeof caps>[0] = {}): MusicSourceAdapter {
  return {
    id, name, category: 'commercial', doc,
    capabilities: caps({ supportsDeepLink: true, ...over }),
    status: async () => ({ state: 'link_only' }),
    externalUrl: (v) => v.externalUrl ?? url(q(v)),
  };
}

function prepared(id: string, name: string, doc: SourceDoc, url: (s: string) => string, over: Parameters<typeof caps>[0], detail: string): MusicSourceAdapter {
  return { ...linkOnly(id, name, doc, url, over), status: async () => ({ state: 'not_implemented', detail }) };
}

export const yandex = linkOnly('yandex', 'Яндекс Музыка', {
  summary: 'Открываем песню в официальном приложении. Плейлисты переносятся по названиям.',
  limits: ['Официального публичного API нет, поэтому воспроизведение внутри Камертона невозможно.', 'Неофициальные библиотеки работают через закрытый API приложения, их мы не используем.'],
  unconfirmed: ['Наличие официального экспорта библиотеки не подтверждено.'],
  setup: ['Скопируйте названия песен и вставьте их в разделе «Импорт музыки».'],
}, (s) => `https://music.yandex.ru/search?text=${s}`);

export const vk = linkOnly('vk', 'VK Музыка', {
  summary: 'Открываем поиск в VK. Плейлисты переносятся по названиям.',
  limits: ['Методы аудио закрыты для сторонних приложений с декабря 2016 года, кроме загрузки.'],
  unconfirmed: ['Наличие официального экспорта библиотеки не подтверждено.'],
  setup: ['Скопируйте названия песен и вставьте их в разделе «Импорт музыки».'],
  docsUrl: 'https://dev.vk.com',
}, (s) => `https://vk.com/audio?q=${s}`);

export const zvuk = linkOnly('zvuk', 'Звук', {
  summary: 'Открываем поиск в Звуке. В самом Звуке есть перенос плейлистов из Яндекс Музыки по ссылке.',
  limits: ['Публичного API для сторонних приложений не найдено, поэтому воспроизведение внутри Камертона невозможно.'],
  unconfirmed: [],
  setup: [],
}, (s) => `https://zvuk.com/search?query=${s}`);

export const bandcamp = linkOnly('bandcamp', 'Bandcamp', {
  summary: 'Переход к поиску на Bandcamp, где можно поддержать автора покупкой.',
  limits: ['Подходящий публичный API для стороннего плеера не найден.'],
  unconfirmed: ['Условия интеграции подробно не исследовались.'],
  setup: [],
}, (s) => `https://bandcamp.com/search?q=${s}`);

export const youtubeMusic = linkOnly('youtube_music', 'YouTube Music', {
  summary: 'Переход к поиску в YouTube Music.',
  limits: ['Публичного API воспроизведения нет. Звук YouTube нельзя отделять от видео и играть в фоне.'],
  unconfirmed: [],
  setup: [],
}, (s) => `https://music.youtube.com/search?q=${s}`);

export const spotifyPlayback = 'Импорт работает. Управление приложением Spotify (App Remote) требует нативного SDK и в этой версии не включено.';

export const apple = prepared('apple', 'Apple Music', {
  summary: 'Задел под MusicKit for Android. Сейчас доступен только переход к поиску.',
  limits: ['Нужны платная программа Apple Developer, сервер для подписи токена и подписка пользователя.', 'Требуется приложение Apple Music на телефоне.'],
  unconfirmed: ['Оплата программы из России и работа SDK с новыми версиями Apple Music не подтверждены.'],
  setup: ['Понадобится Apple Developer Program, ключ MusicKit и сервер для JWT. Ключ нельзя хранить в приложении.'],
  docsUrl: 'https://developer.apple.com/musickit/',
}, (s) => `https://music.apple.com/search?term=${s}`, { playback: 'external-app', auth: 'oauthConfidential', requiresBackend: true, requiresUserSubscription: true, requiresOfficialApp: true }, 'Нужны платный аккаунт Apple и сервер');

export const tidal = prepared('tidal', 'TIDAL', {
  summary: 'Задел под официальный SDK. Сейчас доступен только переход к поиску.',
  limits: ['Сторонним приложениям официально разрешены только превью через неизменённый модуль Player.'],
  unconfirmed: ['Документация расходится в вопросе полных треков, поэтому принято строгое толкование.'],
  setup: [],
  docsUrl: 'https://developer.tidal.com',
}, (s) => `https://listen.tidal.com/search?q=${s}`, { playback: 'preview-only', auth: 'oauthPkce' }, 'Только превью, SDK не подключён');
