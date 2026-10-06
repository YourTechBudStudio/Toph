import { create } from 'zustand';

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

const CHECK_MS = 1100;

interface ProviderState {
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
 * the fields of desktop's OpenAI provider. Mocked: connecting "verifies" after a moment and
 * accepts any http(s) base URL with a non-empty key. Secure storage and a real check arrive with in-app dictation.
 */
export const useProviderStore = create<ProviderState>()((set) => ({
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  status: 'disconnected',
  error: null,
  submitted: null,
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  polishModel: DEFAULT_POLISH_MODEL,
  reasoningEffort: '',
  polishApi: 'chat',
  connect: ({ baseUrl, apiKey }) => {
    set({ status: 'connecting', error: null, submitted: { baseUrl, apiKey } });
    setTimeout(() => {
      if (!/^https?:\/\/\S+$/u.test(baseUrl.trim())) {
        set({
          status: 'invalid',
          error: "That base URL isn't something I can reach. Check for typos, then blame DNS.",
        });
        return;
      }
      set({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        status: 'connected',
        error: null,
        submitted: null,
      });
    }, CHECK_MS);
  },
  remove: () =>
    set({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      status: 'disconnected',
      error: null,
      submitted: null,
    }),
  setTranscriptionModel: (model) =>
    set({ transcriptionModel: model.trim() === '' ? DEFAULT_TRANSCRIPTION_MODEL : model.trim() }),
  setPolishModel: (model) =>
    set({ polishModel: model.trim() === '' ? DEFAULT_POLISH_MODEL : model.trim() }),
  setReasoningEffort: (effort) => set({ reasoningEffort: effort.trim() }),
  setPolishApi: (polishApi) => set({ polishApi }),
}));

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
