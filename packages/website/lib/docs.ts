export const LATEST_VERSION = 'v1';
export const ALL_VERSIONS = ['v1'] as const;

export type Version = (typeof ALL_VERSIONS)[number];

/** Group an array of objects by a string property. */
export function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const group = String(item[key]);
    (groups[group] ??= []).push(item);
  }
  return groups;
}
