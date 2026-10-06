/** Joins class names, dropping the falsy ones a conditional leaves behind. */
export function cn(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
