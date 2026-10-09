import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { verifyOpenAiConnection } from '@toph/dictation-core';

import { persistSecurely, readSecureJson, writeSecureJson } from '../../../storage/secure-json';
import {
  parseStoredConnection,
  parseStoredModels,
  type StoredConnection,
  type StoredModels,
} from './stored-provider';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
export const DEFAULT_POLISH_MODEL = 'gpt-5.4-mini';

/** The OpenAI API that polish calls, as on desktop. */
export type PolishApi = 'chat' | 'responses';

export const polishApis: readonly { value: PolishApi; label: string }[] = [
  { value: 'chat', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
];

/** Where the saved connection stands, as on desktop: only `connected` can dictate. */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'invalid';

export interface ConnectionDraft {
  readonly baseUrl: string;
  readonly apiKey: string;
}

const CONNECTION_KEY = 'toph.provider.connection';
const MODELS_KEY = 'toph.provider.models';
const LOG_TAG = '[toph:provider]';

interface ProviderState {
  /** Whether the saved provider has been read, so nothing decides from the defaults. */
  readonly loaded: boolean;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly status: ConnectionStatus;
  readonly error: string | null;
  /**
   * Credentials submitted but not saved: the ones being checked, or the ones that just failed.
   * A form that mounts mid-check or after a failure shows these rather than the saved ones.
   */
  readonly submitted: ConnectionDraft | null;
  readonly transcriptionModel: string;
  readonly polishModel: string;
  /** Empty means the model's own default. */
  readonly reasoningEffort: string;
  readonly polishApi: PolishApi;
  connect(draft: ConnectionDraft): void;
  remove(): void;
  setTranscriptionModel(model: string): void;
  setPolishModel(model: string): void;
  setReasoningEffort(effort: string): void;
  setPolishApi(api: PolishApi): void;
}

/**
 * The OpenAI (or OpenAI-compatible) connection and how transcription and polish use it, mirroring
 * the fields of desktop's OpenAI provider. Connect runs the same check as desktop and saves the
 * connection only when it passes; the connection and the model fields live in the phone's secure
 * storage and are read once at launch by `loadProvider()`.
 */
export const useProviderStore = create<ProviderState>()((set) => ({
  loaded: false,
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  status: 'disconnected',
  error: null,
  submitted: null,
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  polishModel: DEFAULT_POLISH_MODEL,
  reasoningEffort: '',
  polishApi: 'chat',
  connect: (draft) => {
    void checkAndSave(draft);
  },
  remove: () => {
    set({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      status: 'disconnected',
      error: null,
      submitted: null,
    });
    void persistSecurely(() => SecureStore.deleteItemAsync(CONNECTION_KEY), LOG_TAG);
  },
  setTranscriptionModel: (model) => {
    set({ transcriptionModel: model.trim() === '' ? DEFAULT_TRANSCRIPTION_MODEL : model.trim() });
    persistModels();
  },
  setPolishModel: (model) => {
    set({ polishModel: model.trim() === '' ? DEFAULT_POLISH_MODEL : model.trim() });
    persistModels();
  },
  setReasoningEffort: (effort) => {
    set({ reasoningEffort: effort.trim() });
    persistModels();
  },
  setPolishApi: (polishApi) => {
    set({ polishApi });
    persistModels();
  },
}));

/** Saves the model fields as they are when the write runs, so the last edit wins. */
function persistModels(): void {
  void writeSecureJson(
    MODELS_KEY,
    (): StoredModels => {
      const { transcriptionModel, polishModel, reasoningEffort, polishApi } =
        useProviderStore.getState();
      return { transcriptionModel, polishModel, reasoningEffort, polishApi };
    },
    LOG_TAG,
  );
}

async function checkAndSave(draft: ConnectionDraft): Promise<void> {
  const set = useProviderStore.setState;
  set({ status: 'connecting', error: null, submitted: draft });
  try {
    const { values } = await verifyOpenAiConnection({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey.trim(),
    });
    const connection: StoredConnection = {
      baseUrl: values.baseUrl ?? '',
      apiKey: values.apiKey ?? '',
    };
    const saved = await writeSecureJson(CONNECTION_KEY, () => connection, LOG_TAG);
    if (!saved) {
      throw new Error("Couldn't save the key on this phone.");
    }
    set({ ...connection, status: 'connected', error: null, submitted: null });
  } catch (error) {
    // The saved connection is left as it was; only this attempt failed.
    set({ status: 'invalid', error: error instanceof Error ? error.message : String(error) });
  }
}

let loading: Promise<void> | undefined;

/** Reads the saved provider once per process. Safe to call more than once (the keyboard's dictation task calls it too). */
export function loadProvider(): Promise<void> {
  loading ??= read();
  return loading;
}

async function read(): Promise<void> {
  const [connection, models] = await Promise.all([
    readSecureJson(CONNECTION_KEY, parseStoredConnection, LOG_TAG),
    readSecureJson(MODELS_KEY, parseStoredModels, LOG_TAG),
  ]);
  useProviderStore.setState({
    // A saved connection was verified when it was saved; a key that stopped working since then
    // shows up as a transcription error rather than being re-checked at every launch.
    ...(connection === null ? {} : { ...connection, status: 'connected' }),
    ...models,
    // Always, so the splash can never hang on a storage error.
    loaded: true,
  });
}

/** What dictation needs from the provider. */
export interface TranscriptionConfig {
  /** Fixed for the session it starts. */
  transcriptionModel: string;
  /** Read on every request, as on desktop. */
  credentials: () => Promise<{ formValues: Record<string, string> }>;
}

/** What dictation needs from the provider, or null unless connected. Not a hook. */
export function readTranscriptionConfig(): TranscriptionConfig | null {
  const { status, transcriptionModel } = useProviderStore.getState();
  if (status !== 'connected') {
    return null;
  }
  return {
    transcriptionModel,
    credentials: async () => {
      const { baseUrl, apiKey } = useProviderStore.getState();
      return { formValues: { baseUrl, apiKey } };
    },
  };
}

/** Whether the saved provider has been read. */
export function useProviderLoaded(): boolean {
  return useProviderStore((state) => state.loaded);
}

/** Whether dictation has a working provider connection. */
export function useProviderReady(): boolean {
  return useProviderStore((state) => state.status === 'connected');
}

/** The one-line summary the settings hub shows for the provider. */
export function useProviderSummary(): { connected: boolean; transcriptionModel: string } {
  const connected = useProviderReady();
  const transcriptionModel = useProviderStore((state) => state.transcriptionModel);
  return { connected, transcriptionModel };
}
