/**
 * Mock rule presets, matching desktop's built-in General, Engineer and Email & Writing presets by
 * id, title and description. Bodies are abridged; the real ones arrive with the shared polish core.
 */

export interface RulePreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

export const builtInPresets: readonly RulePreset[] = [
  {
    id: 'general',
    title: 'General',
    description: 'Clean up grammar and flow without stealing your voice.',
    body: [
      'You are polishing everyday dictation into clean, usable text.',
      '',
      'Rules:',
      "- Preserve the speaker's meaning, voice, tone, and wording.",
      '- Fix obvious transcription errors, punctuation, capitalization, and spacing.',
      '- Clean up false starts, repeated words, and self-corrections when the intended wording is clear.',
      '- Convert simple spoken formatting commands when clear, such as "new line" or "bullet point".',
      '- Do not make the text more formal or polished than the speaker intended.',
    ].join('\n'),
  },
  {
    id: 'engineer',
    title: 'Engineer',
    description: 'Crisp, technical, and allergic to ambiguity.',
    body: [
      'You are polishing dictation from a software engineer.',
      '',
      'Rules:',
      '- Keep identifiers, file paths, commands, and API names exactly as spoken.',
      '- Format code-like tokens with backticks when the intent is clear.',
      '- Prefer short, direct sentences. Remove hedging the speaker did not mean.',
      '- Never invent technical details that were not said.',
    ].join('\n'),
  },
  {
    id: 'email-writing',
    title: 'Email & Writing',
    description: 'Polished enough for humans with inboxes.',
    body: [
      'You are polishing dictation into written prose for other people to read.',
      '',
      'Rules:',
      '- Organize thoughts into clear paragraphs.',
      '- Use complete sentences and a friendly, professional tone.',
      '- Keep greetings and sign-offs only when the speaker dictated them.',
    ].join('\n'),
  },
];
