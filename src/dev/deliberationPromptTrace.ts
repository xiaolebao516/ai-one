// Development-only audit evidence. The workflow starts it automatically; no storage or logging.
import { AI_PROVIDERS } from '../../shared/constants';
import { host } from '../host';
import { deliberationGraph } from '../workflow/graph/deliberationGraph';
import { promptBuilders } from '../workflow/graph/registries';
import {
  prependResponseLanguagePolicy,
  responseLanguagePolicyFromPrompt,
} from '../workflow/responseLanguage';
import { getCurrentSnapshot } from '../workflow/snapshot/recorder';
import type { ExecutionSnapshot } from '../workflow/snapshot/types';

interface AuditPromptEvidence {
  templateMatched: boolean;
  promptChars: number;
  languagePolicyPresent: boolean;
  questionBlockPresent: true | null;
  round?: number;
  prompt?: string;
}

interface AuditSendEvidence extends AuditPromptEvidence {
  dispatch: 'requested' | 'dispatched' | 'failed';
}

// Rebuild with the actual in-memory inputs first. Only an exact match permits
// returning a second rendering with placeholders; never slice or replace private text.
export function redactDeliberationAuditPrompt(snapshot: ExecutionSnapshot, text: string): AuditPromptEvidence {
  const openingTag = text.match(/^<response-language-policy[^\n]*>/)?.[0];
  const policy = responseLanguagePolicyFromPrompt(openingTag);
  const evidence: AuditPromptEvidence = {
    templateMatched: false,
    promptChars: text.length,
    languagePolicyPresent: policy !== undefined,
    questionBlockPresent: null,
  };
  if (snapshot.graphId !== 'deliberation' || snapshot.graphVersion !== deliberationGraph.version) return evidence;
  const question = snapshot.userQuestion;
  if (question.kind !== 'inline' || typeof question.text !== 'string') return evidence;

  for (const round of [1, 2, 3]) {
    const nodeIds = [...(round === 1 ? ['first', 'second'] : []), `round${round}_first`, `round${round}_second`];
    const history = nodeIds.map((nodeId) => {
      const step = snapshot.steps.find((candidate) => candidate.nodeId === nodeId);
      if (!step?.provider || step.status !== 'done' || step.outputRef.kind !== 'inline' || typeof step.outputRef.text !== 'string') return undefined;
      const provider = AI_PROVIDERS[step.provider];
      if (!provider) return undefined;
      return { name: provider.name, round: nodeId.startsWith('round') ? round : undefined, text: step.outputRef.text };
    });
    if (history.some((item) => item === undefined)) continue;
    const replies = history.filter((item) => item !== undefined);
    const render = (userQuestion: string, items: typeof replies) => prependResponseLanguagePolicy(
      promptBuilders['deliberation.audit']([round, userQuestion, items], { graph: deliberationGraph }), policy, question.text,
    );
    if (render(question.text, replies) !== text) continue;
    return {
      ...evidence,
      templateMatched: true,
      questionBlockPresent: true,
      round,
      prompt: render('[REDACTED original user question]', replies.map((item) => ({ ...item, text: '[REDACTED participant reply]' }))),
    };
  }
  return evidence;
}

let activeTrace: ReturnType<typeof installTrace> | undefined;
let lastEvidence: AuditSendEvidence[] = [];

export function readDeliberationAuditTrace(): AuditSendEvidence[] {
  return activeTrace?.read() ?? lastEvidence.map((entry) => ({ ...entry }));
}

export function startDeliberationAuditTrace() {
  if (!import.meta.env.DEV) throw new Error('Prompt tracing is available only in development.');
  return activeTrace ??= installTrace();
}

function installTrace() {
  lastEvidence = [];
  const originalSend = host.provider.send;
  const entries: AuditSendEvidence[] = [];
  let snapshotId: string | undefined;
  const send: typeof originalSend = async (provider, text) => {
    const snapshot = getCurrentSnapshot();
    let entry: AuditSendEvidence | undefined;
    if (snapshot?.graphId === 'deliberation' && snapshot.roleMap.auditor === provider) {
      if (snapshotId !== snapshot.snapshotId) entries.length = 0;
      snapshotId = snapshot.snapshotId;
      try {
        entry = { ...redactDeliberationAuditPrompt(snapshot, text), dispatch: 'requested' };
        entries.push(entry);
        if (entries.length > 3) entries.shift();
      } catch {
        // Diagnostics must never interfere with sending or expose exception text.
      }
    }
    try {
      await originalSend(provider, text);
      if (entry) entry.dispatch = 'dispatched';
    } catch (error) {
      if (entry) entry.dispatch = 'failed';
      throw error;
    }
  };
  host.provider.send = send;
  const handle = {
    // Only sanitized strings and metadata leave this module. No storage or logging.
    read: () => entries.map((entry) => ({ ...entry })),
    clear: () => {
      if (activeTrace !== handle) return;
      entries.length = 0;
      lastEvidence = [];
      snapshotId = undefined;
    },
    stop: () => {
      if (host.provider.send === send) host.provider.send = originalSend;
      if (activeTrace === handle) {
        lastEvidence = handle.read();
        activeTrace = undefined;
      }
    },
  };
  return handle;
}
