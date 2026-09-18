import type { ProviderDefinition } from '../provider-definition';
import { createOpenAiSubInferenceClient } from './inference-client';
import { createOpenAiSubOAuthFlow, refreshOpenAiSubOAuthToken } from './oauth-flow';
import { createOpenAiSubTranscriptionClient } from './transcription-client';

export const openAiSubProviderDefinition: ProviderDefinition = {
  id: 'openai-sub',
  label: 'OpenAI (ChatGPT Plus/Pro subscription)',
  description: 'Use your ChatGPT subscription to transcribe recordings.',
  billingMode: 'subscription',
  roles: ['transcription', 'inference'],
  auth: {
    kind: 'oauth',
    createFlow: createOpenAiSubOAuthFlow,
    refresh: refreshOpenAiSubOAuthToken,
  },
  settingsFields: {
    provider: [],
    transcription: [
      {
        kind: 'text',
        key: 'model',
        label: 'Transcription model',
        default: 'chatgpt-backend-transcribe',
        required: true,
      },
    ],
    inference: [
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
    ],
  },
  createTranscriptionClient: createOpenAiSubTranscriptionClient,
  createInferenceClient: createOpenAiSubInferenceClient,
};
