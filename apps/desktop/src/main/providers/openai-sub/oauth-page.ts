import logoPath from '../../../../../../assets/logo.png?asset';

export const openAiSubOAuthLogoPath = logoPath;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOpenAiSubOAuthPage(options: {
  status: 'success' | 'error';
  title: string;
  message: string;
  errorDetail?: string;
}) {
  const isSuccess = options.status === 'success';
  const safeTitle = escapeHtml(options.title);
  const safeMessage = escapeHtml(options.message);
  const safeErrorDetail = options.errorDetail ? escapeHtml(options.errorDetail) : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Toph - ${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --canvas: #24273a;
      --canvas-elevated: #363a4f;
      --text-primary: #cad3f5;
      --text-secondary: #a5adcb;
      --text-tertiary: #6e738d;
      --accent-blue: #8aadf4;
      --accent-violet: #c6a0f6;
      --accent-green: #a6da95;
      --accent-red: #ed8796;
      --accent-cyan: #91d7e3;
      --spark: #7dc4e4;
      --font-display: 'Sora', system-ui, -apple-system, sans-serif;
      --font-body: 'Source Sans 3', system-ui, -apple-system, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { min-height: 100%; }
    body {
      overflow: hidden;
      font-family: var(--font-body);
      color: var(--text-primary);
      background: var(--canvas);
    }

    .atmosphere {
      position: fixed;
      inset: 0;
      background:
        linear-gradient(135deg, rgba(138, 173, 244, 0.04) 0%, transparent 50%, rgba(198, 160, 246, 0.04) 100%),
        linear-gradient(225deg, rgba(125, 196, 228, 0.035) 0%, transparent 60%, rgba(145, 215, 227, 0.03) 100%),
        var(--canvas);
    }

    .center-stage {
      position: relative;
      z-index: 1;
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .card {
      width: min(100%, 430px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 2rem;
      background: var(--canvas-elevated);
      padding: 2.5rem;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
      animation: cardEnter 800ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      opacity: 0;
      transform: translateY(16px) scale(0.98);
    }

    @keyframes cardEnter {
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .brand {
      display: inline-flex;
      align-items: center;
      margin-bottom: 2rem;
      animation: fadeIn 600ms 180ms ease-out forwards;
      opacity: 0;
    }

    .brand-logo {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      object-fit: cover;
      box-shadow: 0 8px 24px rgba(138, 173, 244, 0.18);
    }

    .status-icon {
      display: grid;
      width: 72px;
      height: 72px;
      margin: 0 auto 1.5rem;
      place-items: center;
      border-radius: 999px;
      animation: iconEnter 700ms 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      opacity: 0;
      transform: scale(0.8);
    }

    .status-icon.success {
      border: 1px solid rgba(166, 218, 149, 0.2);
      background: rgba(166, 218, 149, 0.12);
      box-shadow: 0 0 32px rgba(166, 218, 149, 0.08);
      color: var(--accent-green);
    }

    .status-icon.error {
      border: 1px solid rgba(237, 135, 150, 0.2);
      background: rgba(237, 135, 150, 0.12);
      box-shadow: 0 0 32px rgba(237, 135, 150, 0.08);
      color: var(--accent-red);
    }

    @keyframes iconEnter {
      to { opacity: 1; transform: scale(1); }
    }

    .status-icon svg { width: 32px; height: 32px; }
    .checkmark-path {
      stroke-dasharray: 48;
      stroke-dashoffset: 48;
      animation: drawCheck 600ms 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }

    @keyframes drawCheck { to { stroke-dashoffset: 0; } }

    h1 {
      margin-bottom: 0.75rem;
      font-family: var(--font-display);
      font-size: 1.78rem;
      font-weight: 650;
      letter-spacing: -0.045em;
      color: var(--text-primary);
      animation: fadeIn 600ms 420ms ease-out forwards;
      opacity: 0;
    }

    p {
      margin-bottom: 1.5rem;
      color: var(--text-secondary);
      font-size: 1rem;
      line-height: 1.6;
      animation: fadeIn 600ms 500ms ease-out forwards;
      opacity: 0;
    }

    .error-detail {
      margin-bottom: 1.5rem;
      border: 1px solid rgba(237, 135, 150, 0.14);
      border-radius: 1rem;
      background: rgba(237, 135, 150, 0.08);
      padding: 0.875rem 1.125rem;
      color: var(--accent-red);
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 0.8125rem;
      text-align: left;
      word-break: break-word;
      animation: fadeIn 600ms 560ms ease-out forwards;
      opacity: 0;
    }

    .action-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      animation: fadeIn 600ms 620ms ease-out forwards;
      opacity: 0;
    }

    .close-hint {
      color: var(--text-tertiary);
      font-size: 0.84rem;
    }

    .countdown {
      display: inline-grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-secondary);
      font-family: var(--font-display);
      font-size: 0.75rem;
      font-weight: 650;
    }

    @keyframes fadeIn { to { opacity: 1; } }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="atmosphere" aria-hidden="true"></div>
  <main class="center-stage">
    <section class="card" aria-labelledby="oauth-title">
      <div class="brand">
        <img class="brand-logo" src="/assets/logo.png" alt="" aria-hidden="true">
      </div>
      <div class="status-icon ${options.status}" aria-hidden="true">
        ${
          isSuccess
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path class="checkmark-path" d="M20 6L9 17l-5-5"></path></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        }
      </div>
      <h1 id="oauth-title">${safeTitle}</h1>
      <p>${safeMessage}</p>
      ${safeErrorDetail ? `<div class="error-detail">${safeErrorDetail}</div>` : ''}
      <div class="action-row">
        ${
          isSuccess
            ? '<span class="close-hint">Closing in</span><span class="countdown" id="countdown">3</span>'
            : '<span class="close-hint">You can close this window and try again from Toph.</span>'
        }
      </div>
    </section>
  </main>
  ${
    isSuccess
      ? '<script>let value=3;const el=document.getElementById("countdown");const timer=setInterval(()=>{value-=1;if(el)el.textContent=String(Math.max(value,0));if(value<=0){clearInterval(timer);window.close();}},1000);</script>'
      : ''
  }
</body>
</html>`;
}

export function renderOpenAiSubOAuthSuccessPage() {
  return renderOpenAiSubOAuthPage({
    status: 'success',
    title: 'Authorization Successful',
    message:
      'Your provider is connected and ready to transcribe. You can close this window and return to Toph.',
  });
}

export function renderOpenAiSubOAuthErrorPage(detail: string) {
  return renderOpenAiSubOAuthPage({
    status: 'error',
    title: 'Authorization Failed',
    message: 'Something went wrong while connecting your provider. You may need to try again.',
    errorDetail: detail,
  });
}
