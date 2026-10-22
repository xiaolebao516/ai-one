import { useState } from 'react';
import { parseDispatchSnapshot } from '../../../dispatch/parse';
import type { DispatchSnapshot } from '../../../dispatch/types';
import { host } from '../../../host';
import { Button, Notice } from '..';
import { DispatchReceipts } from '../DispatchReceipts';

const stamp = '2026-10-22T10:00:00Z';
const DEMO: DispatchSnapshot = {
  events: (['running', 'completed', 'timeout', 'request_mismatch', 'recovered'] as const).map((status, i) => ({ id: `demo-${i}`, taskId: `task_20261022_10000${i}_gpt-pro-consult${status === 'recovered' ? '-recovered' : ''}`, status, sessionKey: 'demo-session', requestId: status === 'recovered' ? undefined : String(i + 1).repeat(32), createdAt: stamp, updatedAt: stamp, issue: '#80' })),
  slots: [{ id: 1, port: 9333, state: 'claimed', browserState: 'unprobed', task: '#80', sessionKey: 'demo-session' }, { id: 2, port: 9334, state: 'idle', browserState: 'unprobed' }],
  warnings: [],
};

export function DispatchGallery() {
  const [snapshot, setSnapshot] = useState(DEMO);
  const [source, setSource] = useState<'demo' | 'local'>('demo');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const desktop = host.app.isDesktop();
  const load = async () => {
    setLoading(true);
    setError(false);
    // Clear stale demo/local records before a new read, so a failure cannot look current.
    setSnapshot({ events: [], slots: [], warnings: [] });
    setSource('local');
    try {
      setSnapshot(parseDispatchSnapshot(await host.dispatch.snapshot(path)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col gap-v2-md">
      <form className="flex flex-wrap items-end gap-v2-sm" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-v2-meta text-v2-ink-2">派工所在的本机仓库目录
          <input className="rounded-v2-sm border border-v2-line bg-v2-surface px-v2-md py-v2-sm text-v2-body text-v2-ink" value={path} onChange={(event) => setPath(event.target.value)} placeholder="仓库的绝对路径" disabled={loading || !desktop} />
        </label>
        <Button type="submit" loading={loading} disabled={!desktop || !path.trim() || loading} disabledReason={!desktop ? '真实数据仅在桌面应用中可读' : undefined}>读取本机记录</Button>
        <Button type="button" disabled={loading} onClick={() => { setSnapshot(DEMO); setSource('demo'); setError(false); }}>显示演示</Button>
      </form>
      {!desktop ? <p className="m-0 text-v2-meta text-v2-ink-2">浏览器预览显示演示数据；桌面画廊可读取本机元数据。</p> : null}
      {error ? <Notice tone="block" title="读取失败">请检查仓库绝对路径和本机文件权限，再重新读取。</Notice> : null}
      {loading ? <p role="status" className="m-0 text-v2-meta text-v2-ink-2">正在读取本机元数据…</p> : <DispatchReceipts snapshot={snapshot} source={source} />}
    </div>
  );
}
