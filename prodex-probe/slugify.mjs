const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;

export function slugify(input, maxLength = 40) {
  if (typeof input !== 'string') return 'untitled';

  const normalized = input.normalize('NFC').trim().toLowerCase();
  let result = '';
  let pendingSeparator = false;
  let inWord = false;

  for (const char of normalized) {
    if (LETTER_OR_NUMBER.test(char)) {
      if (pendingSeparator && result) result += '-';
      result += char;
      pendingSeparator = false;
      inWord = true;
      continue;
    }

    if (MARK.test(char) && inWord) {
      result += char;
      continue;
    }

    if (result) pendingSeparator = true;
    inWord = false;
  }

  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 40;
  const characters = Array.from(result);

  if (characters.length > limit) {
    result = characters.slice(0, limit).join('').replace(/-+$/g, '');
  }

  return result || 'untitled';
}
