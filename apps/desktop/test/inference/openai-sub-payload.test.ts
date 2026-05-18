import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createOpenAiSubResponsesPayload,
  readOpenAiSubImageInput,
} from '../../src/main/inference/providers/openai-sub-payload.ts';

test('builds OpenAI-sub image inputs as responses input_image parts', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-openai-sub-'));
  const imagePath = join(tempDir, 'context.jpg');
  await writeFile(imagePath, Buffer.from('fake-image'));

  try {
    const imageInput = await readOpenAiSubImageInput({
      path: imagePath,
      mimeType: 'image/jpeg',
      detail: 'high',
    });
    const payload = createOpenAiSubResponsesPayload({
      model: 'gpt-5.4-mini',
      instructions: 'Polish the transcript.',
      inputText: 'raw text',
      imageInputs: [imageInput],
    });

    assert.deepEqual(payload, {
      model: 'gpt-5.4-mini',
      reasoning: { effort: 'low' },
      instructions: 'Polish the transcript.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'raw text' },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${Buffer.from('fake-image').toString('base64')}`,
              detail: 'high',
            },
          ],
        },
      ],
      stream: true,
      store: false,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
