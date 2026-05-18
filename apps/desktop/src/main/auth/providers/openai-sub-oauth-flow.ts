import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import {
  openAiSubOAuthLogoPath,
  renderOpenAiSubOAuthErrorPage,
  renderOpenAiSubOAuthSuccessPage,
} from './openai-sub-oauth-page';

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const authorizeUrl = 'https://auth.openai.com/oauth/authorize';
const tokenUrl = 'https://auth.openai.com/oauth/token';
const redirectUri = 'http://localhost:1455/auth/callback';
const callbackPort = 1455;
const jwtClaimPath = 'https://api.openai.com/auth';
const callbackTimeoutMs = 120_000;
const tokenRequestTimeoutMs = 30_000;

export interface OpenAiSubOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface PendingOpenAiSubOAuthFlow {
  authorizationUrl: string;
  exchangeAuthorizationInput: (input: string) => Promise<OpenAiSubOAuthTokens>;
  waitForCallback: () => Promise<OpenAiSubOAuthTokens>;
  dispose: () => Promise<void>;
}

function base64UrlEncode(input: Buffer) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkce() {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return base64UrlEncode(randomBytes(32));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function fetchToken(
  init: RequestInit,
  timeoutMessage = 'OpenAI provider token request timed out. Try connecting again.',
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tokenRequestTimeoutMs);
  try {
    return await fetch(tokenUrl, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(timeoutMessage, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseAuthorizationInput(input: string) {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // Not a URL; fall through to raw code/query parsing.
  }

  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: value };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function extractAccountIdFromToken(token: string) {
  const payload = decodeJwtPayload(token);
  const topLevelAccountId = payload?.chatgpt_account_id;
  if (typeof topLevelAccountId === 'string' && topLevelAccountId.length > 0) {
    return topLevelAccountId;
  }

  const authClaim = payload?.[jwtClaimPath];
  if (typeof authClaim === 'object' && authClaim !== null) {
    const accountId = (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    if (typeof accountId === 'string' && accountId.length > 0) {
      return accountId;
    }
  }

  const organizations = payload?.organizations;
  if (Array.isArray(organizations)) {
    const organizationId = (organizations[0] as { id?: unknown } | undefined)?.id;
    if (typeof organizationId === 'string' && organizationId.length > 0) {
      return organizationId;
    }
  }

  return undefined;
}

function buildAuthorizationUrl(pkce: { challenge: string }, state: string) {
  const url = new URL(authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email offline_access');
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'toph');
  return url.toString();
}

async function exchangeAuthorizationCode(options: {
  code: string;
  verifier: string;
}): Promise<OpenAiSubOAuthTokens> {
  const response = await fetchToken({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: options.code,
      code_verifier: options.verifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI provider login failed: HTTP ${response.status} ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    id_token?: unknown;
  };

  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    throw new Error('OpenAI provider login response did not include expected token fields.');
  }

  const accountId =
    (typeof json.id_token === 'string' ? extractAccountIdFromToken(json.id_token) : undefined) ??
    extractAccountIdFromToken(json.access_token);

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

export async function refreshOpenAiSubOAuthToken(
  refreshToken: string,
): Promise<OpenAiSubOAuthTokens> {
  const response = await fetchToken(
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    },
    'OpenAI provider token refresh timed out. Reconnect the provider to continue.',
  );

  if (!response.ok) {
    throw new Error(
      `OpenAI provider token refresh failed: HTTP ${response.status} ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    id_token?: unknown;
  };

  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    throw new Error(
      'OpenAI provider token refresh response did not include expected token fields.',
    );
  }

  const accountId =
    (typeof json.id_token === 'string' ? extractAccountIdFromToken(json.id_token) : undefined) ??
    extractAccountIdFromToken(json.access_token);

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

export async function createOpenAiSubOAuthFlow(): Promise<PendingOpenAiSubOAuthFlow> {
  const pkce = createPkce();
  const state = createState();
  const authorizationUrl = buildAuthorizationUrl(pkce, state);
  let server: Server | null = null;
  let settleCallback: ((input: string) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;

  const callbackInput = new Promise<string>((resolve, reject) => {
    settleCallback = resolve;
    rejectCallback = reject;
  });
  callbackInput.catch(() => {});

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${callbackPort}`);
    if (url.pathname === '/assets/logo.png') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
      });
      response.end(readFileSync(openAiSubOAuthLogoPath));
      return;
    }

    if (url.pathname !== '/auth/callback') {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderOpenAiSubOAuthErrorPage('Callback route not found.'));
      return;
    }

    if (url.searchParams.get('error')) {
      const detail =
        url.searchParams.get('error_description') ??
        url.searchParams.get('error') ??
        'Login failed.';
      if (url.searchParams.get('state') === state) {
        rejectCallback?.(new Error(detail));
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderOpenAiSubOAuthErrorPage(detail));
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      const detail = 'Provider login did not include an authorization code.';
      if (url.searchParams.get('state') === state) {
        rejectCallback?.(new Error(detail));
      }
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderOpenAiSubOAuthErrorPage(detail));
      return;
    }

    if (url.searchParams.get('state') !== state) {
      const detail = 'Provider login state did not match the current login attempt.';
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderOpenAiSubOAuthErrorPage(detail));
      return;
    }

    settleCallback?.(url.toString());
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderOpenAiSubOAuthSuccessPage());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(callbackPort, '127.0.0.1', () => {
        server!.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    throw error;
  }

  const exchangeAuthorizationInput = async (input: string) => {
    const parsed = parseAuthorizationInput(input);
    if (!parsed.code) {
      throw new Error('Provider login did not include an authorization code.');
    }
    if (parsed.state && parsed.state !== state) {
      throw new Error('Provider login state did not match the current login attempt.');
    }

    return exchangeAuthorizationCode({ code: parsed.code, verifier: pkce.verifier });
  };

  return {
    authorizationUrl,
    exchangeAuthorizationInput,
    async waitForCallback() {
      const input = await withTimeout(
        callbackInput,
        callbackTimeoutMs,
        'OpenAI provider login timed out. Try connecting again.',
      );
      return exchangeAuthorizationInput(input);
    },
    async dispose() {
      rejectCallback?.(new Error('Provider login was cancelled.'));
      if (!server) {
        return;
      }

      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = null;
    },
  };
}
