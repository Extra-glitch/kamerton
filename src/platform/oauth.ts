import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { HttpError, httpJson, query } from '@/net/http';
import type { SourceContext } from '@/sources/types';

const REDIRECT = 'kamerton://spotify-auth';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(Crypto.getRandomBytes(length), (b) => chars[b % chars.length]).join('');
}

function param(url: string, name: string) {
  const m = url.match(new RegExp(`[?&#]${name}=([^&#]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function saveTokens(ctx: SourceContext, r: any) {
  await ctx.setConfig('spotify', {
    accessToken: r.access_token,
    expiresAt: String(Date.now() + (r.expires_in - 60) * 1000),
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}),
  });
}

/** Вход по OAuth 2.0 + PKCE. Секрет приложения не используется. */
export async function spotifyLogin(ctx: SourceContext): Promise<void> {
  const { clientId } = await ctx.getConfig('spotify');
  if (!clientId) throw new HttpError('auth', 'Сначала укажите Client ID.');
  const verifier = randomString(64);
  const state = randomString(16);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  const url = `https://accounts.spotify.com/authorize?${query({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, state, code_challenge_method: 'S256', code_challenge: toUrlSafe(digest) })}`;
  const res = await WebBrowser.openAuthSessionAsync(url, REDIRECT);
  if (res.type !== 'success') throw new HttpError('auth', 'Вход в Spotify отменён.');
  if (param(res.url, 'state') !== state) throw new HttpError('auth', 'Ответ Spotify не прошёл проверку. Попробуйте ещё раз.');
  const code = param(res.url, 'code');
  if (!code) throw new HttpError('auth', `Spotify отказал во входе: ${param(res.url, 'error') ?? 'причина не указана'}.`);
  const tokens = await httpJson(TOKEN_URL, { method: 'POST', service: 'Spotify', headers: FORM, body: query({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }) });
  await saveTokens(ctx, tokens);
}

export async function spotifyAccessToken(ctx: SourceContext): Promise<string | null> {
  const c = await ctx.getConfig('spotify');
  if (c.accessToken && Number(c.expiresAt) > Date.now()) return c.accessToken;
  if (!c.refreshToken || !c.clientId) return null;
  try {
    const r = await httpJson(TOKEN_URL, { method: 'POST', service: 'Spotify', headers: FORM, body: query({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId }) });
    await saveTokens(ctx, r);
    return r.access_token;
  } catch (e) {
    if ((e as HttpError).kind === 'auth') await ctx.setConfig('spotify', { accessToken: '', refreshToken: '', expiresAt: '' });
    throw e;
  }
}
