/**
 * ai-one v2 design tokens — the single place visual values live (Issue #41).
 *
 * Components and pages never name a colour, radius or shadow directly: they use the semantic
 * Tailwind classes from `tailwind.config.js` (`bg-v2-surface`, `text-v2-ink-2`, `rounded-v2-md`…),
 * which resolve to the `--v2-*` custom properties that `<V2Scope>` writes from this file.
 * Re-skinning the whole v2 UI = editing a skin below (or adding one); no component changes.
 *
 * Baseline: docs/design/v2-product-design.md §8 and docs/design/v2-prototype/styles.css (#34).
 * Text colours were darkened slightly where the prototype values missed WCAG AA on their own
 * backgrounds; the contrast floors are enforced in src/__tests__/v2-tokens.test.ts.
 */

export const V2_STATUS_TONES = ['run', 'rework', 'you', 'block', 'done', 'paused', 'unknown'] as const;
/** Semantic status. Business code picks a tone; only tokens decide what colour a tone is. */
export type V2StatusTone = (typeof V2_STATUS_TONES)[number];

export function isV2StatusTone(value: unknown): value is V2StatusTone {
  return typeof value === 'string' && (V2_STATUS_TONES as readonly string[]).includes(value);
}

/** Anything unrecognised (e.g. a value from external data) degrades to `unknown`, never to a colour. */
export function toV2StatusTone(value: unknown): V2StatusTone {
  return isV2StatusTone(value) ? value : 'unknown';
}

type StatusColorKey = V2StatusTone | `${V2StatusTone}Soft` | `${V2StatusTone}Line`;

export type V2ColorKey =
  | 'bg' // window
  | 'panel' // main work area
  | 'surface' // cards, inputs
  | 'sunken' // wells, segmented tracks
  | 'hover' // translucent hover wash
  | 'line' // hairlines
  | 'lineStrong' // control borders
  | 'ink' // primary text
  | 'ink2' // secondary text
  | 'ink3' // metadata only; never the sole carrier of essential information
  | 'primary' // primary action fill
  | 'primaryHover'
  | 'onPrimary'
  | 'focus' // focus ring
  | 'island' // the few dark floating elements (status island, HUD popover)
  | 'onIsland'
  | StatusColorKey;

export interface V2ModeTokens {
  color: Record<V2ColorKey, string>;
  shadow: { card: string; float: string };
}

export interface V2ShapeTokens {
  radius: { sm: string; md: string; lg: string; xl: string; pill: string };
  font: { sans: string; mono: string };
  /** Type scale: page title · task title · "now" line · body · meta · micro. */
  text: { title: string; heading: string; lead: string; body: string; meta: string; micro: string };
  space: { xs: string; sm: string; md: string; lg: string; xl: string; card: string; page: string };
  /** Control heights. */
  control: { sm: string; md: string; lg: string };
}

export type V2Mode = 'light' | 'dark';
export type V2ModePreference = V2Mode | 'auto';

export interface V2Skin {
  id: string;
  label: string;
  description: string;
  shape: V2ShapeTokens;
  light: V2ModeTokens;
  dark: V2ModeTokens;
}

const FONT_SANS = '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
const FONT_MONO = '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

const TEXT_SCALE: V2ShapeTokens['text'] = { title: '24px', heading: '19px', lead: '16px', body: '13px', meta: '12px', micro: '11px' };

/** Design baseline (#34 §8): warm paper + ink, colour reserved for status, ink primary button. */
const PAPER: V2Skin = {
  id: 'paper',
  label: '纸墨 Paper',
  description: '#34 设计稿基线：暖灰纸面、墨色主按钮，颜色只留给状态，琥珀色永远是“需要你”。',
  shape: {
    radius: { sm: '6px', md: '8px', lg: '12px', xl: '16px', pill: '999px' },
    font: { sans: FONT_SANS, mono: FONT_MONO },
    text: TEXT_SCALE,
    space: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', card: '16px', page: '32px' },
    control: { sm: '26px', md: '30px', lg: '34px' },
  },
  light: {
    color: {
      bg: '#F3F2EE',
      panel: '#FAF9F7',
      surface: '#FFFFFF',
      sunken: '#ECEBE6',
      hover: 'rgba(24, 22, 18, 0.045)',
      line: 'rgba(24, 22, 18, 0.085)',
      lineStrong: 'rgba(24, 22, 18, 0.14)',
      ink: '#1C1B18',
      ink2: '#5A5851',
      ink3: '#85827A',
      primary: '#1C1B18',
      primaryHover: '#33312C',
      onPrimary: '#FFFFFF',
      focus: '#2563D9',
      island: '#161513',
      onIsland: '#E8E6E0',
      run: '#2563D9',
      runSoft: '#EAF1FF',
      runLine: '#B9CDF5',
      rework: '#7340D6',
      reworkSoft: '#F2ECFE',
      reworkLine: '#D3C2F5',
      you: '#965A05',
      youSoft: '#FFF4E2',
      youLine: '#F0C98A',
      block: '#B9322E',
      blockSoft: '#FDECEB',
      blockLine: '#F2B8B5',
      done: '#237545',
      doneSoft: '#E8F5EC',
      doneLine: '#B5DDC3',
      paused: '#5A5851',
      pausedSoft: '#EFEEEA',
      pausedLine: 'rgba(24, 22, 18, 0.14)',
      unknown: '#5A5851',
      unknownSoft: 'transparent',
      unknownLine: 'rgba(24, 22, 18, 0.28)',
    },
    shadow: {
      card: '0 1px 2px rgba(20, 18, 14, 0.05), 0 0 0 1px rgba(24, 22, 18, 0.085)',
      float: '0 8px 28px rgba(20, 18, 14, 0.12), 0 1px 3px rgba(20, 18, 14, 0.08)',
    },
  },
  dark: {
    color: {
      bg: '#121211',
      panel: '#191918',
      surface: '#201F1E',
      sunken: '#0E0E0D',
      hover: 'rgba(255, 250, 240, 0.05)',
      line: 'rgba(255, 250, 240, 0.08)',
      lineStrong: 'rgba(255, 250, 240, 0.14)',
      ink: '#EEEDE8',
      ink2: '#ABA89F',
      ink3: '#8A877F',
      primary: '#EEEDE8',
      primaryHover: '#D9D7D0',
      onPrimary: '#141413',
      focus: '#78A6FF',
      island: '#050505',
      onIsland: '#E8E6E0',
      run: '#78A6FF',
      runSoft: 'rgba(120, 166, 255, 0.12)',
      runLine: 'rgba(120, 166, 255, 0.38)',
      rework: '#B79BFF',
      reworkSoft: 'rgba(183, 155, 255, 0.12)',
      reworkLine: 'rgba(183, 155, 255, 0.38)',
      you: '#F2B65C',
      youSoft: 'rgba(242, 182, 92, 0.11)',
      youLine: 'rgba(242, 182, 92, 0.38)',
      block: '#FF7D72',
      blockSoft: 'rgba(255, 125, 114, 0.11)',
      blockLine: 'rgba(255, 125, 114, 0.38)',
      done: '#62D196',
      doneSoft: 'rgba(98, 209, 150, 0.11)',
      doneLine: 'rgba(98, 209, 150, 0.36)',
      paused: '#ABA89F',
      pausedSoft: 'rgba(255, 250, 240, 0.06)',
      pausedLine: 'rgba(255, 250, 240, 0.14)',
      unknown: '#ABA89F',
      unknownSoft: 'transparent',
      unknownLine: 'rgba(255, 250, 240, 0.28)',
    },
    shadow: {
      card: '0 0 0 1px rgba(255, 250, 240, 0.08)',
      float: '0 10px 34px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)',
    },
  },
};

/**
 * Alternative for comparison: cool slate neutrals, an indigo primary, softer and rounder
 * surfaces with outlined cards and slightly roomier controls. Same semantics, other values.
 */
const MIST: V2Skin = {
  id: 'mist',
  label: '雾蓝 Mist',
  description: '对照方案：冷灰石板底、靛蓝主按钮、更大的圆角和更宽松的控件，卡片用描边而不是投影。',
  shape: {
    radius: { sm: '8px', md: '10px', lg: '14px', xl: '20px', pill: '999px' },
    font: { sans: FONT_SANS, mono: FONT_MONO },
    text: { ...TEXT_SCALE, body: '13.5px', meta: '12.5px' },
    space: { xs: '4px', sm: '8px', md: '14px', lg: '18px', xl: '28px', card: '18px', page: '36px' },
    control: { sm: '28px', md: '32px', lg: '38px' },
  },
  light: {
    color: {
      bg: '#EDF0F5',
      panel: '#F6F8FB',
      surface: '#FFFFFF',
      sunken: '#E3E8EF',
      hover: 'rgba(30, 41, 59, 0.05)',
      line: 'rgba(30, 41, 59, 0.10)',
      lineStrong: 'rgba(30, 41, 59, 0.18)',
      ink: '#121826',
      ink2: '#4A5466',
      ink3: '#6F7889',
      primary: '#4338CA',
      primaryHover: '#3730A3',
      onPrimary: '#FFFFFF',
      focus: '#4338CA',
      island: '#0F172A',
      onIsland: '#E2E8F0',
      run: '#0B66A8',
      runSoft: '#E5F2FB',
      runLine: '#AFD3EE',
      rework: '#8B2FD8',
      reworkSoft: '#F5EAFE',
      reworkLine: '#DAB8F5',
      you: '#A14E00',
      youSoft: '#FFF1E0',
      youLine: '#F5C38D',
      block: '#BE2A3A',
      blockSoft: '#FDEBEE',
      blockLine: '#F3B5BE',
      done: '#18724C',
      doneSoft: '#E5F5EE',
      doneLine: '#A9DDC6',
      paused: '#4A5466',
      pausedSoft: '#EBEEF3',
      pausedLine: 'rgba(30, 41, 59, 0.18)',
      unknown: '#4A5466',
      unknownSoft: 'transparent',
      unknownLine: 'rgba(30, 41, 59, 0.32)',
    },
    shadow: {
      card: '0 0 0 1px rgba(30, 41, 59, 0.12)',
      float: '0 16px 40px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(30, 41, 59, 0.10)',
    },
  },
  dark: {
    color: {
      bg: '#0C1018',
      panel: '#111622',
      surface: '#171D2B',
      sunken: '#090C13',
      hover: 'rgba(226, 232, 240, 0.06)',
      line: 'rgba(226, 232, 240, 0.09)',
      lineStrong: 'rgba(226, 232, 240, 0.16)',
      ink: '#E6EAF2',
      ink2: '#A4ADBE',
      ink3: '#7F889A',
      primary: '#8B93F8',
      primaryHover: '#A5ABFA',
      onPrimary: '#0B1020',
      focus: '#8B93F8',
      island: '#03050A',
      onIsland: '#E2E8F0',
      run: '#5CB8F5',
      runSoft: 'rgba(92, 184, 245, 0.12)',
      runLine: 'rgba(92, 184, 245, 0.38)',
      rework: '#D29BFF',
      reworkSoft: 'rgba(210, 155, 255, 0.12)',
      reworkLine: 'rgba(210, 155, 255, 0.38)',
      you: '#FFB766',
      youSoft: 'rgba(255, 183, 102, 0.11)',
      youLine: 'rgba(255, 183, 102, 0.38)',
      block: '#FF8090',
      blockSoft: 'rgba(255, 128, 144, 0.11)',
      blockLine: 'rgba(255, 128, 144, 0.38)',
      done: '#4FD3A0',
      doneSoft: 'rgba(79, 211, 160, 0.11)',
      doneLine: 'rgba(79, 211, 160, 0.36)',
      paused: '#A4ADBE',
      pausedSoft: 'rgba(226, 232, 240, 0.06)',
      pausedLine: 'rgba(226, 232, 240, 0.16)',
      unknown: '#A4ADBE',
      unknownSoft: 'transparent',
      unknownLine: 'rgba(226, 232, 240, 0.30)',
    },
    shadow: {
      card: '0 0 0 1px rgba(226, 232, 240, 0.10)',
      float: '0 16px 44px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(226, 232, 240, 0.08)',
    },
  },
};

export const V2_SKINS = { paper: PAPER, mist: MIST } as const satisfies Record<string, V2Skin>;
export type V2SkinId = keyof typeof V2_SKINS;
export const V2_SKIN_IDS = Object.keys(V2_SKINS) as V2SkinId[];
export const V2_DEFAULT_SKIN: V2SkinId = 'paper';

export function isV2SkinId(value: unknown): value is V2SkinId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(V2_SKINS, value);
}

function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}

/** `--v2-*` custom properties for one skin + mode. The only bridge from tokens to CSS. */
export function v2CssVariables(skinId: V2SkinId, mode: V2Mode): Record<string, string> {
  const skin = V2_SKINS[skinId];
  const modeTokens = skin[mode];
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(modeTokens.color)) vars[`--v2-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(modeTokens.shadow)) vars[`--v2-shadow-${key}`] = value;
  for (const [key, value] of Object.entries(skin.shape.radius)) vars[`--v2-radius-${key}`] = value;
  for (const [key, value] of Object.entries(skin.shape.font)) vars[`--v2-font-${key}`] = value;
  for (const [key, value] of Object.entries(skin.shape.text)) vars[`--v2-text-${key}`] = value;
  for (const [key, value] of Object.entries(skin.shape.space)) vars[`--v2-space-${key}`] = value;
  for (const [key, value] of Object.entries(skin.shape.control)) vars[`--v2-control-${key}`] = value;
  return vars;
}
