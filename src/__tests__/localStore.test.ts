import { describe, expect, it } from 'vitest';
import { browserLocalStoreFs } from '../host/localStore';

describe('browser local store fallback', () => {
  it('persists valid JSON through the available browser or memory storage', async () => {
    await browserLocalStoreFs.write('flows', '{"schemaVersion":1}');
    await expect(browserLocalStoreFs.read('flows')).resolves.toMatchObject({
      status: 'ok',
      text: '{"schemaVersion":1}',
      backup: null,
    });
  });

  it('quarantines the current contents and makes the primary store missing', async () => {
    await browserLocalStoreFs.write('flows', '{"schemaVersion":1}');
    const backup = await browserLocalStoreFs.quarantine('flows');
    expect(backup).toContain('flows.json.bak-');
    await expect(browserLocalStoreFs.read('flows')).resolves.toMatchObject({ status: 'missing' });
  });

  it('rejects invalid JSON on write', async () => {
    await expect(browserLocalStoreFs.write('flows', '{')).rejects.toThrow('Invalid JSON');
  });
});
