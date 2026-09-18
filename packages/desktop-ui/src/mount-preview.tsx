import '@fontsource/sora/400.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ProviderPreviewApp } from './preview/provider-preview-app';

import './styles.css';

/** Temporary mock-UI entry point. Removed in phase 05. */
export function mountProviderPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <ProviderPreviewApp />
    </StrictMode>,
  );
}
