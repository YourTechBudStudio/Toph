import type { ProviderDefinition } from '../provider-definition';
import { verifyOpenAiConnection } from './connection-check';
import { createOpenAiInferenceClient } from './inference-client';
import { createOpenAiTranscriptionClient } from './transcription-client';

const defaultBaseUrl = 'https://api.openai.com/v1';

export const openAiProviderDefinition: ProviderDefinition = {
  id: 'openai',
  label: 'OpenAI (API key)',
  description:
    'Use an OpenAI API key, or any OpenAI-compatible endpoint, for transcription and polishing.',
  billingMode: 'metered',
  roles: ['transcription', 'inference'],
  auth: {
    kind: 'form',
    fields: [
      {
        kind: 'text',
        key: 'baseUrl',
        label: 'Base URL',
        placeholder: defaultBaseUrl,
        default: defaultBaseUrl,
        required: true,
      },
      {
        kind: 'text',
        key: 'apiKey',
        label: 'API key',
        default: '',
        secret: true,
        required: true,
      },
    ],
    verify: verifyOpenAiConnection,
  },
  settingsFields: {
    provider: [],
    transcription: [
      {
        kind: 'text',
        key: 'model',
        label: 'Transcription model',
        default: 'gpt-4o-transcribe',
        required: true,
      },
    ],
    inference: [
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
        description: "Leave empty to use the model's default.",
        default: '',
      },
      {
        kind: 'select',
        key: 'api',
        label: 'API',
        options: [
          { value: 'chat', label: 'Chat Completions' },
          { value: 'responses', label: 'Responses' },
        ],
        default: 'chat',
      },
    ],
  },
  createTranscriptionClient: createOpenAiTranscriptionClient,
  createInferenceClient: createOpenAiInferenceClient,
};
