import { startBridgePull } from '../bridge/pull';
import { runWorkflow, type RunWorkflowParams } from '../workflow';
import { prepareProviderPage } from '../workflow/chatLed/env';
import type { AIProvider } from '../../shared/types';

/** The standalone workbench needs the same title/pull transport as the classic UI.
 * Park hidden pages so their DOM bridge can report live status and full replies. */
export async function runDiscussionWorkflow(params: RunWorkflowParams, participants: readonly AIProvider[]) {
  const disconnect = await startBridgePull();
  try {
    for (const provider of participants) {
      await prepareProviderPage(provider);
    }
    return await runWorkflow(params);
  } finally {
    disconnect();
  }
}
