// Встроенный плеер YouTube. Он один на всё приложение и не перезагружается при переходах:
// на экране плеера он стоит сверху, на остальных экранах становится панелью над разделами.

import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { currentVideo, handleVideoEvent, registerVideoSender, setVideoCollapsed, stopVideo, useVideo, videoIdOf, videoNext, videoPause, videoToggle } from '@/player/video';
import { Badge, Cover, IconBtn, T } from './kit';
import { TAB_HEIGHT, useColors } from './theme';

// Адрес страницы, с которой встроен плеер: по правилам YouTube он указывает на приложение.
const ORIGIN = 'https://app.kamerton.player';
const TABS = ['/', '/search', '/library', '/profile'];
const HIDDEN = ['/onboarding', '/embed'];
export const VIDEO_TOP = 64; // отступ видео от верха экрана плеера без учёта выреза

function html(id: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%}</style></head><body><div id="p"></div>
<script>
var player=null,ready=false,queued=null;
function post(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.onerror=function(){post({t:'error',code:-1});};document.head.appendChild(s);
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{width:'100%',height:'100%',videoId:'${id}',playerVars:{playsinline:1,rel:0,autoplay:1,origin:'${ORIGIN}',widget_referrer:'${ORIGIN}'},
    events:{onReady:function(){ready=true;if(queued){window.cmd(queued.c,queued.a);queued=null;}else{player.playVideo();}},
      onStateChange:function(e){post({t:'state',s:e.data});},
      onError:function(e){post({t:'error',code:e.data});}}});
  setInterval(function(){if(ready&&player.getCurrentTime){post({t:'time',p:player.getCurrentTime(),d:player.getDuration()});}},1000);
}
window.cmd=function(c,a){
  if(!ready){queued={c:c,a:a};return;}
  if(c==='load')player.loadVideoById(a);else if(c==='play')player.playVideo();else if(c==='pause')player.pauseVideo();else if(c==='seek')player.seekTo(a,true);
};
</script></body></html>`;
}

/** Где показывать видео: на экране плеера, панелью над разделами или нигде (тогда пауза). */
export function useVideoPlace(): 'player' | 'float' | 'none' {
  const path = usePathname();
  const active = useVideo((v) => v.active);
  const collapsed = useVideo((v) => v.collapsed);
  if (!active || HIDDEN.includes(path)) return 'none';
  if (path === '/player') return 'player';
  return collapsed ? 'none' : 'float';
}

/** Высота плавающей панели видео: нужна экранам, чтобы последний пункт списка не прятался под ней. */
export function useVideoInset(): number {
  const { width } = useWindowDimensions();
  const place = useVideoPlace();
  return place === 'float' ? Math.round((width - 20) * 9 / 16) + 12 : 0;
}

export function VideoHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const path = usePathname();
  const ref = useRef<{ injectJavaScript(js: string): void } | null>(null);
  const active = useVideo((v) => v.active);
  const first = useRef<string | null>(null);
  const place = useVideoPlace();
  const track = useVideo((v) => v.queue[v.index]);
  const id = videoIdOf(track);
  if (active && id && !first.current) first.current = id;
  if (!active) first.current = null;

  useEffect(() => {
    registerVideoSender((cmd) => {
      const js = cmd.cmd === 'load' ? `window.cmd('load','${cmd.id}')` : cmd.cmd === 'seek' ? `window.cmd('seek',${cmd.sec})` : `window.cmd('${cmd.cmd}')`;
      ref.current?.injectJavaScript(`${js};true;`);
    });
    return () => registerVideoSender(null);
  }, []);
  // Видео нельзя продолжать в фоне и когда его не видно.
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') videoPause(); }); return () => sub.remove(); }, []);
  useEffect(() => { if (place === 'none') videoPause(); }, [place]);

  if (!active || !first.current || Platform.OS === 'web') return null;
  const tabs = TABS.includes(path);
  const fw = width - 20;
  const style = place === 'player'
    ? { top: insets.top + VIDEO_TOP, left: 16, width: width - 32, height: Math.round((width - 32) * 9 / 16), borderRadius: 18 }
    : place === 'float'
      ? { bottom: insets.bottom + 8 + (tabs ? TAB_HEIGHT : 0) + 64 + 10, left: 10, width: fw, height: Math.round(fw * 9 / 16), borderRadius: 20 }
      : { top: -1000, left: 0, width: 1, height: 1, borderRadius: 0 }; // скрыто: видео на паузе
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', overflow: 'hidden', backgroundColor: '#000', borderWidth: place === 'float' ? 1 : 0, borderColor: c.stroke, ...style }}>
      <WebView ref={ref as never} source={{ html: html(first.current), baseUrl: ORIGIN }} style={{ backgroundColor: '#000' }} allowsInlineMediaPlayback allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false} javaScriptEnabled setSupportMultipleWindows={false}
        onMessage={(e: { nativeEvent: { data: string } }) => { try { handleVideoEvent(JSON.parse(e.nativeEvent.data)); } catch { /* чужое сообщение */ } }}
        onShouldStartLoadWithRequest={(r: { url: string; isTopFrame?: boolean }) => r.url.startsWith(ORIGIN) || r.url.startsWith('about:') || !r.isTopFrame} />
    </View>
  );
}

/** Строка управления видео в нижней панели вместо обычного мини-плеера. */
export function VideoMini() {
  const c = useColors();
  const t = useVideo((v) => v.queue[v.index]);
  const playing = useVideo((v) => v.playing);
  const collapsed = useVideo((v) => v.collapsed);
  const progress = useVideo((v) => (v.durationSec ? v.positionSec / v.durationSec : 0));
  if (!t) return null;
  return (
    <View>
      <Pressable testID="video-mini" accessibilityRole="button" accessibilityLabel={`Открыть плеер: ${t.title}`} onPress={() => router.push('/player')} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, height: 64, paddingLeft: 9, paddingRight: 4 }}>
        <Cover uri={t.coverUrl} title={t.artist} size={46} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="title" numberOfLines={1}>{t.title}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Badge label="YouTube" tone="muted" /><T v="small" c="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{t.artist}</T></View>
        </View>
        <IconBtn name={collapsed ? 'up' : 'down'} label={collapsed ? 'Показать видео' : 'Свернуть видео'} onPress={() => setVideoCollapsed(!collapsed)} />
        <IconBtn name={playing ? 'pause' : 'play'} label={playing ? 'Пауза' : 'Играть'} onPress={videoToggle} />
        <IconBtn name="next" label="Следующее видео" onPress={videoNext} />
      </Pressable>
      <View style={{ height: 2, marginHorizontal: 14, borderRadius: 1, backgroundColor: c.line, overflow: 'hidden' }}><View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: c.accent }} /></View>
    </View>
  );
}

export { currentVideo, stopVideo };
