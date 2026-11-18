import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'play' | 'pause' | 'next' | 'prev' | 'shuffle' | 'repeat' | 'repeatOne' | 'heart' | 'heartOn' | 'plus' | 'queue' | 'more' | 'back' | 'down' | 'close'
  | 'lyrics' | 'video' | 'similar' | 'check' | 'up' | 'search' | 'radio' | 'timer' | 'share' | 'trash' | 'link' | 'thumbDown' | 'cover' | 'fork' | 'volume';

/** Собственный набор значков: единая толщина линии и прямые окончания. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const s = { stroke: color, strokeWidth: 1.9, fill: 'none', strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const };
  const f = { fill: color };
  let body: React.ReactNode;
  switch (name) {
    case 'play': body = <Path {...f} d="M7 4.5v15l12.5-7.5z" />; break;
    case 'pause': body = <><Rect {...f} x="6.5" y="5" width="4" height="14" /><Rect {...f} x="13.5" y="5" width="4" height="14" /></>; break;
    case 'next': body = <><Path {...f} d="M5 5v14l10.5-7z" /><Rect {...f} x="16.5" y="5" width="2.6" height="14" /></>; break;
    case 'prev': body = <><Path {...f} d="M19 5v14L8.5 12z" /><Rect {...f} x="4.9" y="5" width="2.6" height="14" /></>; break;
    case 'shuffle': body = <Path {...s} d="M3.5 7H7c4.5 0 5.5 10 10 10h3M3.5 17H7c1.6 0 2.8-1.2 3.8-2.8M13.2 9.8C14.200 8.200 15.400 7 17 7h3M17.500 4.500 20 7l-2.500 2.500M17.500 14.500 20 17l-2.500 2.500" />; break;
    case 'repeat': body = <Path {...s} d="M4 11V8h14M15.500 5 18.500 8l-3 3M20 13v3H6M8.500 19l-3-3 3-3" />; break;
    case 'repeatOne': body = <><Path {...s} d="M4 11V8h14M15.500 5 18.500 8l-3 3M20 13v3H6M8.500 19l-3-3 3-3" /><Path {...f} d="M11.200 10.200h1.800v4h-1.300v-2.700l-.8.3z" /></>; break;
    case 'heart': body = <Path {...s} d="M12 20S4 15 4 9.300C4 6.700 6 5 8.200 5c1.600 0 3 .9 3.800 2.300C12.800 5.900 14.200 5 15.800 5 18 5 20 6.700 20 9.300 20 15 12 20 12 20z" />; break;
    case 'heartOn': body = <Path {...f} d="M12 20.500S3.200 15.300 3.200 9.300C3.200 6.300 5.500 4.200 8.200 4.200c1.500 0 2.900.7 3.800 1.900.9-1.200 2.300-1.900 3.800-1.900 2.700 0 5 2.100 5 5.100 0 6-8.800 11.200-8.800 11.200z" />; break;
    case 'plus': body = <Path {...s} d="M12 5v14M5 12h14" />; break;
    case 'queue': body = <><Path {...s} d="M4 6.500h16M4 12h10M4 17.500h7" /><Path {...f} d="M16 13.500v7l5.500-3.500z" /></>; break;
    case 'more': body = <><Circle {...f} cx="5.500" cy="12" r="1.700" /><Circle {...f} cx="12" cy="12" r="1.700" /><Circle {...f} cx="18.500" cy="12" r="1.700" /></>; break;
    case 'back': body = <Path {...s} d="M14.500 5.500 8 12l6.500 6.500" />; break;
    case 'down': body = <Path {...s} d="M5.500 9 12 15.500 18.500 9" />; break;
    case 'up': body = <Path {...s} d="M5.500 15 12 8.500 18.500 15" />; break;
    case 'close': body = <Path {...s} d="M6 6l12 12M18 6 6 18" />; break;
    case 'lyrics': body = <Path {...s} d="M4 5.500h16M4 10.500h16M4 15.500h10M4 20h6" />; break;
    case 'video': body = <><Rect {...s} x="3.500" y="5.500" width="17" height="13" /><Path {...f} d="M10 9v6l5-3z" /></>; break;
    case 'similar': body = <><Circle {...s} cx="9" cy="12" r="5.500" /><Circle {...s} cx="15" cy="12" r="5.500" /></>; break;
    case 'check': body = <Path {...s} d="M4.500 12.500 10 18 19.500 7" />; break;
    case 'search': body = <><Circle {...s} cx="10.500" cy="10.500" r="6" /><Path {...s} d="M15 15l5 5" /></>; break;
    case 'radio': body = <><Circle {...f} cx="12" cy="12" r="2.200" /><Path {...s} d="M7.500 7.500a6.400 6.400 0 0 0 0 9M16.500 7.500a6.400 6.400 0 0 1 0 9M4.500 4.500a10.600 10.600 0 0 0 0 15M19.500 4.500a10.600 10.600 0 0 1 0 15" /></>; break;
    case 'timer': body = <><Circle {...s} cx="12" cy="13" r="7.500" /><Path {...s} d="M12 9v4l2.500 2M9.500 3h5" /></>; break;
    case 'share': body = <Path {...s} d="M12 15V4M7.500 8 12 3.500 16.500 8M5 13v7.500h14V13" />; break;
    case 'trash': body = <Path {...s} d="M4.500 7h15M9.500 7V4h5v3M6.500 7l1 13.500h9l1-13.500" />; break;
    case 'link': body = <Path {...s} d="M14 4.500h5.500V10M19 5l-8.500 8.500M10 6H4.500v13.500H18V14" />; break;
    case 'thumbDown': body = <Path {...s} d="M5 5l14 14M9 4.500h7.500L20 13h-5l1 4.500-2 2.500-3.500-5M4 4.500v9h4" />; break;
    case 'cover': body = <><Rect {...s} x="4" y="4" width="16" height="16" /><Circle {...s} cx="12" cy="12" r="3.500" /></>; break;
    case 'volume': body = <><Path {...f} d="M4 9.500v5h3.500L12.500 19V5L7.500 9.500z" /><Path {...s} d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.800 7.800 0 0 1 0 11" /></>; break;
    case 'fork': body = <Path stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" d="M8 3v8.500c0 2.400 1.800 4 4 4s4-1.600 4-4V3M12 15.500V21" />; break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
