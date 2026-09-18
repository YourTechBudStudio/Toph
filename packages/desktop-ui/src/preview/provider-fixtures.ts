import type {
  AppSettings,
  ProviderConnection,
  ProviderFieldSpec,
  ProviderId,
  ProviderRole,
} from '@toph/desktop-contracts';

/**
 * Fixtures for the temporary provider preview page. They mirror what the main process publishes in
 * `ProviderState` and `AppSettings['providers']`; nothing here is imported by shipping code, and
 * the whole `preview/` folder is deleted in phase 05.
 */
export type ProviderPreviewFixture = {
  id: string;
  label: string;
  note: string;
  providers: ProviderConnection[];
  providerSettings: AppSettings['providers'];
  routing: Record<ProviderRole, ProviderId | null>;
};

const subTranscriptionFields: ProviderFieldSpec[] = [
  {
    kind: 'text',
    key: 'model',
    label: 'Transcription model',
    default: 'chatgpt-backend-transcribe',
    required: true,
  },
];

const subInferenceFields: ProviderFieldSpec[] = [
  {
    kind: 'text',
    key: 'model',
    label: 'Polishing model',
    default: 'gpt-5.6-luna',
    required: true,
  },
  {
    kind: 'text',
    key: 'reasoningEffort',
    label: 'Reasoning effort',
    description: "Leave empty to use the model's default.",
    default: 'medium',
  },
];

const openAiAuthFields: ProviderFieldSpec[] = [
  {
    kind: 'text',
    key: 'baseUrl',
    label: 'Base URL',
    description: 'Any OpenAI-compatible endpoint.',
    placeholder: 'https://api.openai.com/v1',
    default: '',
    required: true,
  },
  {
    kind: 'text',
    key: 'apiKey',
    label: 'API key',
    placeholder: 'sk-…',
    default: '',
    secret: true,
    required: true,
  },
];

const openAiTranscriptionFields: ProviderFieldSpec[] = [
  {
    kind: 'text',
    key: 'model',
    label: 'Transcription model',
    default: 'gpt-4o-transcribe',
    required: true,
  },
];

const openAiInferenceFields: ProviderFieldSpec[] = [
  {
    kind: 'text',
    key: 'model',
    label: 'Polishing model',
    default: 'gpt-5.4-mini',
    required: true,
  },
  {
    kind: 'text',
    key: 'reasoningEffort',
    label: 'Reasoning effort',
    description: 'Leave empty to omit the parameter.',
    default: '',
  },
  {
    kind: 'select',
    key: 'api',
    label: 'API',
    description: 'Which endpoint polishing calls.',
    options: [
      { value: 'chat', label: 'Chat completions' },
      { value: 'responses', label: 'Responses' },
    ],
    default: 'chat',
  },
];

function openAiSub(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'openai-sub',
    label: 'OpenAI (ChatGPT Plus/Pro subscription)',
    description: 'Use your ChatGPT subscription to transcribe recordings.',
    billingMode: 'subscription',
    roles: ['transcription', 'inference'],
    auth: { kind: 'oauth' },
    settingsFields: {
      provider: [],
      transcription: subTranscriptionFields,
      inference: subInferenceFields,
    },
    status: 'missing',
    accountId: null,
    expires: null,
    error: null,
    connectionSummary: {},
    ...overrides,
  };
}

function openAi(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'openai',
    label: 'OpenAI (API key)',
    description:
      'Use an OpenAI API key, or any OpenAI-compatible endpoint, for transcription and polishing.',
    billingMode: 'metered',
    roles: ['transcription', 'inference'],
    auth: { kind: 'form', fields: openAiAuthFields },
    settingsFields: {
      provider: [],
      transcription: openAiTranscriptionFields,
      inference: openAiInferenceFields,
    },
    status: 'missing',
    accountId: null,
    expires: null,
    error: null,
    connectionSummary: {},
    ...overrides,
  };
}

function defaultSettings(): AppSettings['providers'] {
  return {
    'openai-sub': {
      provider: {},
      transcription: { model: 'chatgpt-backend-transcribe' },
      inference: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' },
    },
    openai: {
      provider: {},
      transcription: { model: 'gpt-4o-transcribe' },
      inference: { model: 'gpt-5.4-mini', reasoningEffort: '', api: 'chat' },
    },
  };
}

export const providerPreviewFixtures: ProviderPreviewFixture[] = [
  {
    id: 'fresh',
    label: 'Fresh install',
    note: 'Nothing connected and nothing chosen. Neither provider is preferred, so both roles are unset.',
    providers: [openAiSub(), openAi()],
    providerSettings: defaultSettings(),
    routing: { transcription: null, inference: null },
  },
  {
    id: 'form-empty',
    label: 'ChatGPT connected, form empty',
    note: 'OpenAI is unused, so it reads a neutral "Not set up". Connect stays disabled until both fields are filled.',
    providers: [openAiSub({ status: 'connected', accountId: 'user@example.com' }), openAi()],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai-sub' },
  },
  {
    id: 'form-connecting',
    label: 'OpenAI connecting',
    note: 'Fields disabled, button reads Connecting…',
    providers: [
      openAiSub({ status: 'connected', accountId: 'user@example.com' }),
      openAi({ status: 'connecting' }),
    ],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai-sub' },
  },
  {
    id: 'form-connected',
    label: 'OpenAI connected',
    note: 'Connected: the same fields stay editable, the key reads as saved, and Reconnect only wakes up once something changes.',
    providers: [
      openAiSub({ status: 'connected', accountId: 'user@example.com' }),
      openAi({
        status: 'connected',
        connectionSummary: { baseUrl: 'https://api.openai.com/v1' },
      }),
    ],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai' },
  },
  {
    id: 'form-invalid',
    label: 'OpenAI invalid key',
    note: 'A broken connection opens itself: error row above the prefilled form, button reads Reconnect.',
    providers: [
      openAiSub({ status: 'connected', accountId: 'user@example.com' }),
      openAi({
        status: 'invalid',
        error: 'Invalid API key (HTTP 401).',
        connectionSummary: { baseUrl: 'https://api.openai.com/v1' },
      }),
    ],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai' },
  },
  {
    id: 'oauth-connecting',
    label: 'ChatGPT OAuth connecting',
    note: 'Parity with today: Settings has no manual-code box, only onboarding does.',
    providers: [openAiSub({ status: 'connecting' }), openAi()],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai-sub' },
  },
  {
    id: 'inference-only',
    label: 'OpenAI serves polishing only',
    note: 'The transcription select must hide OpenAI while the polishing select still offers it.',
    providers: [
      openAiSub({ status: 'connected', accountId: 'user@example.com' }),
      openAi({
        roles: ['inference'],
        status: 'connected',
        connectionSummary: { baseUrl: 'https://openrouter.example/v1' },
      }),
    ],
    providerSettings: defaultSettings(),
    routing: { transcription: 'openai-sub', inference: 'openai' },
  },
];
