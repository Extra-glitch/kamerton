// В браузере приёма файлов через «Поделиться» нет: здесь заглушки. Телефонная версия — ShareReceiver.native.tsx.
import type { ReactNode } from 'react';

export function ShareRoot({ children }: { children: ReactNode }) { return <>{children}</>; }
export function ShareReceiver() { return null; }
