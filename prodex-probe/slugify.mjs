export function slugify(input, maxLength = 40) {
  if (typeof input !== 'string') return 'untitled';

  let result = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 40;
  const characters = Array.from(result);

  if (characters.length > limit) {
    result = characters.slice(0, limit).join('').replace(/-+$/g, '');
  }

  return result || 'untitled';
}
