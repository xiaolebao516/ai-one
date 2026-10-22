import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../ui/v2/contrast';
import {
  V2_SKIN_IDS,
  V2_SKINS,
  V2_STATUS_TONES,
  toV2StatusTone,
  v2CssVariables,
  type V2Mode,
} from '../ui/v2/tokens';

const MODES: V2Mode[] = ['light', 'dark'];
const combos = V2_SKIN_IDS.flatMap((skin) => MODES.map((mode) => ({ skin, mode })));

describe('v2 design tokens', () => {
  it('offers at least two complete skins with identical token names in both modes', () => {
    expect(V2_SKIN_IDS.length).toBeGreaterThanOrEqual(2);
    const reference = Object.keys(v2CssVariables('paper', 'light')).sort();
    for (const { skin, mode } of combos) {
      const vars = v2CssVariables(skin, mode);
      expect(Object.keys(vars).sort(), `${skin}/${mode}`).toEqual(reference);
      for (const [name, value] of Object.entries(vars)) {
        expect(name.startsWith('--v2-'), name).toBe(true);
        expect(value.trim(), `${skin}/${mode} ${name}`).not.toBe('');
      }
    }
  });

  it('parses every colour token', () => {
    for (const { skin, mode } of combos) {
      for (const [key, value] of Object.entries(V2_SKINS[skin][mode].color)) {
        expect(parseColor(value), `${skin}/${mode} ${key}=${value}`).toBeDefined();
      }
    }
  });

  it('keeps text legible on its surfaces (WCAG AA for body and status text)', () => {
    for (const { skin, mode } of combos) {
      const c = V2_SKINS[skin][mode].color;
      for (const surface of [c.surface, c.panel, c.bg]) {
        expect(contrastRatio(c.ink, surface), `${skin}/${mode} ink`).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.ink2, surface), `${skin}/${mode} ink2`).toBeGreaterThanOrEqual(4.5);
        // ink3 also carries 11–12px metadata/count labels, so it needs normal-text AA.
        expect(contrastRatio(c.ink3, surface), `${skin}/${mode} ink3 on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // Tertiary text must remain visually weaker than secondary text in both modes.
        expect(contrastRatio(c.ink2, surface), `${skin}/${mode} ink2 vs ink3`)
          .toBeGreaterThan(contrastRatio(c.ink3, surface));
      }
      expect(contrastRatio(c.onPrimary, c.primary), `${skin}/${mode} primary button`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.onIsland, c.island), `${skin}/${mode} island`).toBeGreaterThanOrEqual(7);
      for (const tone of V2_STATUS_TONES) {
        const fg = c[tone];
        const soft = c[`${tone}Soft`];
        expect(contrastRatio(fg, soft, c.surface), `${skin}/${mode} ${tone} on soft`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(fg, c.surface), `${skin}/${mode} ${tone} on surface`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the attention tone distinct from progress and failure', () => {
    for (const { skin, mode } of combos) {
      const c = V2_SKINS[skin][mode].color;
      expect(new Set([c.run, c.you, c.block, c.done, c.rework]).size, `${skin}/${mode}`).toBe(5);
    }
  });

  it('degrades unrecognised status values to unknown', () => {
    expect(toV2StatusTone('run')).toBe('run');
    expect(toV2StatusTone('merged')).toBe('unknown');
    expect(toV2StatusTone(undefined)).toBe('unknown');
  });

  it('only references token variables from the Tailwind theme that the tokens define', () => {
    const defined = new Set(Object.keys(v2CssVariables('paper', 'light')));
    const config = readFileSync(new URL('../../tailwind.config.js', import.meta.url), 'utf8');
    const referenced = config.match(/--v2-[a-z0-9-]+/g) ?? [];
    expect(referenced.length).toBeGreaterThan(20);
    for (const name of referenced) expect(defined.has(name), name).toBe(true);
  });

  describe('typography and whitespace baseline (#105)', () => {
    it('writes a serif stack that starts with the bundled face and never falls to SimSun for CJK', () => {
      for (const id of V2_SKIN_IDS) {
        const serif = v2CssVariables(id, 'light')['--v2-font-serif'];
        expect(serif.startsWith('"Source Serif 4"'), id).toBe(true);
        expect(serif, id).not.toMatch(/SimSun|NSimSun|宋体/);
        expect(serif, id).toContain('Microsoft YaHei UI');
        expect(serif.endsWith('serif'), id).toBe(true);
      }
    });

    it('sets the reading size, page and section whitespace on every skin', () => {
      for (const id of V2_SKIN_IDS) {
        const vars = v2CssVariables(id, 'light');
        expect(vars['--v2-text-reading'], id).toBe('16px');
        expect(parseInt(vars['--v2-space-page'], 10), id).toBeGreaterThanOrEqual(40);
        expect(parseInt(vars['--v2-space-section'], 10), id).toBeGreaterThanOrEqual(40);
        expect(parseInt(vars['--v2-space-card'], 10), id).toBeGreaterThanOrEqual(22);
      }
    });

    it('ships the font file and its licence next to the stylesheet that loads it', () => {
      const css = readFileSync(new URL('../ui/v2/fonts.css', import.meta.url), 'utf8');
      const file = css.match(/url\("([^"]+\.woff2)"\)/)?.[1];
      expect(file).toBeTruthy();
      expect(() => readFileSync(new URL(file!, new URL('../ui/v2/fonts.css', import.meta.url)))).not.toThrow();
      expect(readFileSync(new URL('../assets/fonts/source-serif-4/OFL.txt', import.meta.url), 'utf8')).toContain('SIL Open Font License');
    });
  });
});
