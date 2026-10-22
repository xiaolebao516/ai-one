import type { ReactNode } from 'react';
import { Badge, Card } from '../../ui/v2';

/** Honest placeholder for a page whose parts are still being built (Spec #79 v2). */
export function PlannedView({ title, body, badge, action }: { title: string; body: string; badge: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[720px] gap-v2-lg p-v2-page">
      <header className="flex flex-wrap items-center gap-v2-sm">
        <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{title}</h1>
        <Badge tone="unknown">{badge}</Badge>
      </header>
      <Card className="grid gap-v2-md">
        <p className="text-v2-body text-v2-ink-2">{body}</p>
        {action ? <div>{action}</div> : null}
      </Card>
    </div>
  );
}
