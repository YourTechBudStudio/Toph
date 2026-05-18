import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { ProviderId } from '@toph/desktop-contracts';

import { RoutingSection } from './routing-section';

test('renders custom model IDs without truncating and commits custom edits on blur', () => {
  const onTranscriptionModelChange = vi.fn<(model: string) => void>();
  const customModel = 'custom-provider-model-with-a-very-long-id-that-should-not-be-truncated';
  const onProviderChange = vi.fn<(providerId: ProviderId) => void>();
  const onInferenceModelChange = vi.fn<(model: string) => void>();

  render(
    <RoutingSection
      transcriptionProviderItems={[{ value: 'antigravity', label: 'Google Antigravity OAuth' }]}
      inferenceProviderItems={[{ value: 'antigravity', label: 'Google Antigravity OAuth' }]}
      transcriptionProviderId="antigravity"
      transcriptionModel={customModel}
      inferenceProviderId="antigravity"
      inferenceModel="antigravity-gemini-3.1-flash-lite"
      disabled={false}
      onTranscriptionProviderChange={onProviderChange}
      onTranscriptionModelChange={onTranscriptionModelChange}
      onInferenceProviderChange={onProviderChange}
      onInferenceModelChange={onInferenceModelChange}
    />,
  );

  const renderedModel = screen
    .getAllByText(customModel)
    .find((element) => element.tagName.toLowerCase() === 'code');
  if (!renderedModel) {
    throw new Error('Expected the full custom model value to render in the model summary.');
  }
  expect(renderedModel.className).toContain('break-all');

  const customInput = screen.getByPlaceholderText('Custom model ID');
  fireEvent.change(customInput, { target: { value: 'custom-next-model' } });
  expect(onTranscriptionModelChange).not.toHaveBeenCalled();

  fireEvent.blur(customInput);
  expect(onTranscriptionModelChange).toHaveBeenCalledWith('custom-next-model');
});
