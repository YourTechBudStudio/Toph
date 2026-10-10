import { Directory, File, Paths } from 'expo-file-system';

/**
 * Rows store file paths relative to the app's private document directory, because its absolute
 * location can change between app updates. These resolve them.
 */
export function appFile(relativePath: string): File {
  return new File(Paths.document, relativePath);
}

export function appDirectory(...segments: string[]): Directory {
  return new Directory(Paths.document, ...segments);
}
