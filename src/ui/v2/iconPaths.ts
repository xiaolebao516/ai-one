/** 16px stroke icons (24-unit viewBox), drawn in currentColor. Add only what a v2 page actually uses. */
export const V2_ICON_PATHS = {
  arrowLeft: ['M19 12H5', 'm12 19-7-7 7-7'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronDown: ['m6 9 6 6 6-6'],
  check: ['M20 6 9 17l-5-5'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  refresh: ['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M8 16H3v5'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
  layers: ['m12 2 10 5-10 5L2 7Z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54Z'],
  gitPr: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 9a9 9 0 0 1-9 9'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
} as const satisfies Record<string, readonly string[]>;

export type V2IconName = keyof typeof V2_ICON_PATHS;
