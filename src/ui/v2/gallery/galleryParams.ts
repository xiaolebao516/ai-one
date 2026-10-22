import { V2_DEFAULT_SKIN, isV2SkinId, type V2Mode, type V2SkinId } from '../tokens';

/** Gallery view options, mirrored in the URL (`?skin=mist&mode=dark&compare=1`) so views can be linked and screenshotted. */
export interface GalleryParams {
  skin: V2SkinId;
  mode: V2Mode;
  compare: boolean;
}

export function readGalleryParams(search: string): GalleryParams {
  const params = new URLSearchParams(search);
  const skin = params.get('skin');
  return {
    skin: isV2SkinId(skin) ? skin : V2_DEFAULT_SKIN,
    mode: params.get('mode') === 'dark' ? 'dark' : 'light',
    compare: params.get('compare') === '1',
  };
}

export function writeGalleryParams(value: GalleryParams): string {
  const params = new URLSearchParams();
  if (value.skin !== V2_DEFAULT_SKIN) params.set('skin', value.skin);
  if (value.mode === 'dark') params.set('mode', 'dark');
  if (value.compare) params.set('compare', '1');
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Token names whose values differ between two skins in one mode: the whole difference between the schemes. */
export function tokenDifferences(a: Record<string, string>, b: Record<string, string>): Array<{ name: string; a: string; b: string }> {
  return Object.keys(a)
    .filter((name) => a[name] !== b[name])
    .map((name) => ({ name, a: a[name], b: b[name] }));
}
