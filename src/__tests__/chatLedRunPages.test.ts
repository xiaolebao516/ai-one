import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hide: vi.fn(async () => undefined), park: vi.fn(async () => undefined) }));
vi.mock('../host', () => ({ host: { provider: { hide: mocks.hide, park: mocks.park } } }));

import { hideUnlessRunPage, setRunPages } from '../workflow/chatLed/runPages';

describe('pages a live run uses (#196)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRunPages([]);
  });

  it('parks a run page offscreen instead of hiding it, and hides every other page as before', async () => {
    setRunPages(['chatgpt', 'claude']);
    await hideUnlessRunPage('chatgpt');
    await hideUnlessRunPage('gemini');
    expect(mocks.park).toHaveBeenCalledWith('chatgpt', expect.objectContaining({ x: -10_000, y: -10_000 }));
    expect(mocks.hide).toHaveBeenCalledWith('gemini');
    expect(mocks.hide).not.toHaveBeenCalledWith('chatgpt');
  });

  it('hides again once the run no longer uses the page', async () => {
    setRunPages(['chatgpt']);
    setRunPages([]);
    await hideUnlessRunPage('chatgpt');
    expect(mocks.hide).toHaveBeenCalledWith('chatgpt');
    expect(mocks.park).not.toHaveBeenCalled();
  });
});
