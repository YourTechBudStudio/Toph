import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { SettingsTextInput } from './settings-controls';

describe('SettingsTextInput', () => {
  it('keeps an editing draft and commits it on blur', () => {
    const onCommit = vi.fn<(value: string) => void>();

    render(<SettingsTextInput value="gpt" onCommit={onCommit} />);

    const input = screen.getByRole<HTMLInputElement>('textbox');
    input.focus();

    fireEvent.change(input, { target: { value: 'gpt-' } });
    fireEvent.change(input, { target: { value: 'gpt-5' } });

    expect(document.activeElement).toBe(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('gpt-5');
  });

  it('commits the editing draft when Enter is pressed', () => {
    const onCommit = vi.fn<(value: string) => void>();

    render(<SettingsTextInput value="gpt" onCommit={onCommit} />);

    const input = screen.getByRole<HTMLInputElement>('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'gpt-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.activeElement).not.toBe(input);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('gpt-5');
  });
});
