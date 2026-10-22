/** Keyboard model shared by Tabs and SegmentedControl (WAI-ARIA tabs / radio group). */

export interface RovingItem {
  id: string;
  disabled?: boolean;
}

/**
 * Next enabled item for an arrow / Home / End key, wrapping around; undefined for other keys or
 * when nothing else is selectable.
 */
export function nextRovingId(items: readonly RovingItem[], currentId: string, key: string): string | undefined {
  const enabled = items.filter((item) => !item.disabled);
  if (enabled.length === 0) return undefined;
  if (key === 'Home') return enabled[0].id;
  if (key === 'End') return enabled[enabled.length - 1].id;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return undefined;
  const start = items.findIndex((item) => item.id === currentId);
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (((start + step * offset) % items.length) + items.length) % items.length;
    const candidate = items[index];
    if (candidate && !candidate.disabled) return candidate.id === currentId ? undefined : candidate.id;
  }
  return undefined;
}

export function focusElementById(doc: Pick<Document, 'getElementById'> | null | undefined, id: string): void {
  const element = doc?.getElementById(id);
  if (element && typeof (element as HTMLElement).focus === 'function') (element as HTMLElement).focus();
}

export function tabDomId(idBase: string, id: string): string {
  return `${idBase}-tab-${id}`;
}

export function tabPanelDomId(idBase: string, id: string): string {
  return `${idBase}-panel-${id}`;
}

export function segmentDomId(idBase: string, value: string): string {
  return `${idBase}-opt-${value}`;
}
