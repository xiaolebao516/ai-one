/** Copy text from a user click. Falls back to the legacy path because WebViews reject the async API when unfocused. */
export async function copyToClipboard(value: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    try {
      area.select();
      if (!document.execCommand('copy')) throw new Error('Copy command rejected');
    } finally { area.remove(); }
  }
}
