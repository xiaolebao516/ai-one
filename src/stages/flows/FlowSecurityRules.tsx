import { Card, SectionHeader } from '../../ui/v2';
import type { FlowsText } from '../../workbench/views/flowsText';

export function FlowSecurityRules({ text }: { text: FlowsText }) {
  return (
    <section className="grid gap-v2-sm" aria-labelledby="flows-security-rules">
      <SectionHeader id="flows-security-rules" title={text.t('securityRules')} />
      <Card padding="sm">
        <ul className="grid gap-v2-xs text-v2-meta text-v2-ink-2">
          <li>• {text.t('ruleNoSelfAudit')}</li>
          <li>• {text.t('ruleFullHead')}</li>
          <li>• {text.t('ruleMerge')}</li>
          <li>• {text.t('ruleRecover')}</li>
        </ul>
      </Card>
    </section>
  );
}
