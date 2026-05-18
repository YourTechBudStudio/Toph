import { readFile } from 'node:fs/promises';

import type { InferenceImageInput } from '../inference-provider';

export interface OpenAiSubImageInput {
  type: 'input_image';
  image_url: string;
  detail: InferenceImageInput['detail'];
}

export interface OpenAiSubResponsesPayload {
  model: string;
  reasoning: { effort: 'low' };
  instructions: string;
  input: Array<{
    role: 'user';
    content: Array<{ type: 'input_text'; text: string } | OpenAiSubImageInput>;
  }>;
  stream: true;
  store: false;
}

export async function readOpenAiSubImageInput(
  image: InferenceImageInput,
): Promise<OpenAiSubImageInput> {
  const bytes = await readFile(image.path);
  return {
    type: 'input_image',
    image_url: `data:${image.mimeType};base64,${bytes.toString('base64')}`,
    detail: image.detail,
  };
}

export function createOpenAiSubResponsesPayload(input: {
  model: string;
  instructions: string;
  inputText: string;
  imageInputs: OpenAiSubImageInput[];
}): OpenAiSubResponsesPayload {
  return {
    model: input.model,
    reasoning: { effort: 'low' },
    instructions: input.instructions,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: input.inputText }, ...input.imageInputs],
      },
    ],
    stream: true,
    store: false,
  };
}
