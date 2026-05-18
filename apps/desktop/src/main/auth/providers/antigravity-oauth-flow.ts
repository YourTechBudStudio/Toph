import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import {
  openAiSubOAuthLogoPath,
  renderProviderOAuthErrorPage,
  renderProviderOAuthSuccessPage,
} from './openai-sub-oauth-page';

const authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const userInfoUrl = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const redirectUri = 'http://localhost:51121/oauth-callback';
const callbackPort = 51121;
const defaultProjectId = 'rising-fact-p41fc';
const antigravityEndpointDaily = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const antigravityEndpointAutopush = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';
const antigravityEndpointProd = 'https://cloudcode-pa.googleapis.com';
const projectLoadEndpoints = [
  antigravityEndpointProd,
  antigravityEndpointDaily,
  antigravityEndpointAutopush,
] as const;
const scopes = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

interface AntigravityOAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface AntigravityOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  email?: string;
  projectId?: string;
}

export interface PendingAntigravityOAuthFlow {
  authorizationUrl: string;
  exchangeAuthorizationInput: (input: string) => Promise<AntigravityOAuthTokens>;
  waitForCallback: () => Promise<AntigravityOAuthTokens>;
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

function createState(verifier: string) {
  return base64UrlEncode(Buffer.from(JSON.stringify({ verifier, projectId: '' }), 'utf8'));
}

function readAntigravityOAuthClientConfig(): AntigravityOAuthClientConfig {
  const clientId = process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'Antigravity OAuth client is not configured. Set TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID and TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET before connecting this provider.',
    );
  }

  return { clientId, clientSecret };
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

function buildAuthorizationUrl(
  pkce: { challenge: string },
  state: string,
  config: AntigravityOAuthClientConfig,
) {
  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

function antigravityHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.18.3 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': `{"ideType":"ANTIGRAVITY","platform":"${
      process.platform === 'win32' ? 'WINDOWS' : 'MACOS'
    }","pluginType":"GEMINI"}`,
  };
}

async function fetchUserEmail(accessToken: string) {
  const response = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
  });
  if (!response.ok) {
    return undefined;
  }

  const json = (await response.json()) as { email?: unknown };
  return typeof json.email === 'string' ? json.email : undefined;
}

async function fetchProjectId(accessToken: string) {
  const headers = antigravityHeaders();
  for (const endpoint of projectLoadEndpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'Client-Metadata': headers['Client-Metadata'],
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: process.platform === 'win32' ? 'WINDOWS' : 'MACOS',
            pluginType: 'GEMINI',
          },
        }),
      });
      if (!response.ok) {
        continue;
      }

      const json = (await response.json()) as {
        cloudaicompanionProject?: unknown;
      };
      if (typeof json.cloudaicompanionProject === 'string' && json.cloudaicompanionProject.trim()) {
        return json.cloudaicompanionProject.trim();
      }
      if (
        typeof json.cloudaicompanionProject === 'object' &&
        json.cloudaicompanionProject !== null
      ) {
        const id = (json.cloudaicompanionProject as { id?: unknown }).id;
        if (typeof id === 'string' && id.trim()) {
          return id.trim();
        }
      }
    } catch {
      // Try the next Antigravity endpoint.
    }
  }

  return defaultProjectId;
}

function packRefreshToken(refreshToken: string, projectId?: string) {
  return `${refreshToken}|${projectId ?? ''}`;
}

function unpackRefreshToken(refreshToken: string) {
  const [refresh, projectId] = refreshToken.split('|', 2);
  return { refresh, projectId: projectId || undefined };
}

async function exchangeAuthorizationCode(options: {
  code: string;
  verifier: string;
  config: AntigravityOAuthClientConfig;
}): Promise<AntigravityOAuthTokens> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: '*/*',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
    body: new URLSearchParams({
      client_id: options.config.clientId,
      client_secret: options.config.clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: options.verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Antigravity provider login failed: HTTP ${response.status} ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };

  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    throw new Error('Antigravity provider login response did not include expected token fields.');
  }

  const [email, projectId] = await Promise.all([
    fetchUserEmail(json.access_token),
    fetchProjectId(json.access_token),
  ]);

  return {
    access: json.access_token,
    refresh: packRefreshToken(json.refresh_token, projectId),
    expires: Date.now() + json.expires_in * 1000,
    accountId: email,
    email,
    projectId,
  };
}

export async function refreshAntigravityOAuthToken(
  refreshToken: string,
): Promise<AntigravityOAuthTokens> {
  const config = readAntigravityOAuthClientConfig();
  const unpacked = unpackRefreshToken(refreshToken);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: '*/*',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: unpacked.refresh,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Antigravity provider token refresh failed: HTTP ${response.status} ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };

  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error(
      'Antigravity provider token refresh response did not include expected token fields.',
    );
  }

  const projectId = unpacked.projectId ?? (await fetchProjectId(json.access_token));
  const nextRefreshToken =
    typeof json.refresh_token === 'string' && json.refresh_token
      ? json.refresh_token
      : unpacked.refresh;

  return {
    access: json.access_token,
    refresh: packRefreshToken(nextRefreshToken, projectId),
    expires: Date.now() + json.expires_in * 1000,
    projectId,
  };
}

export async function createAntigravityOAuthFlow(): Promise<PendingAntigravityOAuthFlow> {
  const config = readAntigravityOAuthClientConfig();
  const pkce = createPkce();
  const state = createState(pkce.verifier);
  const authorizationUrl = buildAuthorizationUrl(pkce, state, config);
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

    if (url.pathname !== '/oauth-callback') {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderProviderOAuthErrorPage('Callback route not found.'));
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
      response.end(renderProviderOAuthErrorPage(detail));
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      const detail = 'Provider login did not include an authorization code.';
      if (url.searchParams.get('state') === state) {
        rejectCallback?.(new Error(detail));
      }
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderProviderOAuthErrorPage(detail));
      return;
    }

    if (url.searchParams.get('state') !== state) {
      const detail = 'Provider login state did not match the current login attempt.';
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderProviderOAuthErrorPage(detail));
      return;
    }

    settleCallback?.(url.toString());
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      renderProviderOAuthSuccessPage(
        'Your Antigravity provider is connected and ready for polish inference. You can close this window and return to Toph.',
      ),
    );
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

    return exchangeAuthorizationCode({ code: parsed.code, verifier: pkce.verifier, config });
  };

  return {
    authorizationUrl,
    exchangeAuthorizationInput,
    async waitForCallback() {
      return exchangeAuthorizationInput(await callbackInput);
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
