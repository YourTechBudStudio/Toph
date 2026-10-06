/**
 * Token values mirrored from `global.css`, for the places Tailwind classes cannot reach:
 * SVG props, icon colors, gradients, and navigator options.
 *
 * `global.css` is the source of truth. Change it first, then mirror the value here.
 */

export const colors = {
  canvas: '#24273a',
  canvasElevated: '#363a4f',
  canvasSubtle: '#2e3244',
  textPrimary: '#cad3f5',
  textSecondary: '#a5adcb',
  textTertiary: '#6e738d',
  accentBlue: '#8aadf4',
  accentViolet: '#c6a0f6',
  accentAmber: '#f5a97f',
  accentGreen: '#a6da95',
  accentRed: '#ed8796',
  accentCyan: '#91d7e3',
  spark: '#7dc4e4',
  line: 'rgba(255, 255, 255, 0.06)',
  lineStrong: 'rgba(255, 255, 255, 0.1)',
  /** For highlights and sheens only, always at partial opacity. */
  white: '#ffffff',
} as const;

export type ColorName = keyof typeof colors;

export const fonts = {
  display: 'Sora_600SemiBold',
  displayRegular: 'Sora_400Regular',
  displayMedium: 'Sora_500Medium',
  displayBold: 'Sora_700Bold',
  body: 'SourceSans3_400Regular',
  bodyMedium: 'SourceSans3_500Medium',
  bodySemibold: 'SourceSans3_600SemiBold',
  bodyBold: 'SourceSans3_700Bold',
} as const;

/** Horizontal screen gutter, in logical pixels. */
export const gutter = 20;

/** A token color at partial opacity, for gradients and glows that must follow the palette. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);

  return `rgba(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)}, ${String(alpha)})`;
}

/**
 * The accent families a surface can be tinted with. Each one names a token color; components map
 * a tone to literal class names so Tailwind can see them.
 */
export type Tone = 'neutral' | 'blue' | 'violet' | 'green' | 'amber' | 'red' | 'cyan';

export const toneColor: Record<Tone, string> = {
  neutral: colors.textSecondary,
  blue: colors.accentBlue,
  violet: colors.accentViolet,
  green: colors.accentGreen,
  amber: colors.accentAmber,
  red: colors.accentRed,
  cyan: colors.accentCyan,
};
