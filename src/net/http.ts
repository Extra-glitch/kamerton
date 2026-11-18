// Сетевой слой: тайм-ауты, понятные ошибки, повторы и ограничение частоты запросов.

export const USER_AGENT = 'Kamerton/0.1.0 (personal music player; Android; React Native)';

export type HttpErrorKind = 'offline' | 'timeout' | 'auth' | 'rate_limit' | 'not_found' | 'server' | 'bad_response';

export class HttpError extends Error {
  constructor(public kind: HttpErrorKind, message: string, public status?: number, public retryAfterSec?: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

/** Очередь с минимальным интервалом: MusicBrainz и ListenBrainz разрешают 1 запрос в секунду. */
export class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private intervalMs: number, private now = () => Date.now(), private sleep = delay) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.last + this.intervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      return task();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  limiter?: RateLimiter;
  service?: string;
}

async function once(url: string, o: HttpOptions): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 15000);
  const service = o.service ?? 'Сервис';
  try {
    const res = await fetch(url, {
      method: o.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...o.headers },
      body: o.body,
      signal: ctrl.signal,
    });
    if (res.ok) return res;
    const retryAfter = Number(res.headers?.get?.('Retry-After')) || undefined;
    if (res.status === 401 || res.status === 403) throw new HttpError('auth', `${service}: нет доступа. Проверьте ключ или войдите заново.`, res.status);
    if (res.status === 404) throw new HttpError('not_found', `${service}: ничего не найдено по этому адресу.`, 404);
    if (res.status === 429 || res.status === 503) throw new HttpError('rate_limit', `${service}: слишком много запросов, повторите чуть позже.`, res.status, retryAfter);
    throw new HttpError('server', `${service}: ошибка сервера (${res.status}).`, res.status);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new HttpError('timeout', `${service} не отвечает. Проверьте интернет.`);
    throw new HttpError('offline', `${service} недоступен. Проверьте интернет или адрес сервера.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function httpResponse(url: string, o: HttpOptions = {}): Promise<Response> {
  const attempts = (o.retries ?? 1) + 1;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await (o.limiter ? o.limiter.run(() => once(url, o)) : once(url, o));
    } catch (e) {
      last = e;
      const kind = (e as HttpError).kind;
      const retriable = kind === 'server' || kind === 'timeout' || kind === 'rate_limit' || kind === 'offline';
      if (!retriable || i === attempts - 1) break;
      await delay(Math.min(((e as HttpError).retryAfterSec ?? 0) * 1000 || 400 * 2 ** i, 5000));
    }
  }
  throw last;
}

export async function httpJson<T = any>(url: string, o: HttpOptions = {}): Promise<T> {
  const res = await httpResponse(url, o);
  try {
    return (await res.json()) as T;
  } catch {
    throw new HttpError('bad_response', `${o.service ?? 'Сервис'} вернул непонятный ответ.`);
  }
}

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Выполняет задачи параллельно, но не больше limit одновременно. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
