import type { WorkflowPresetId } from '../../../shared/types';
import { brainstormGraph } from './brainstormGraph';
import { codingGraph } from './codingGraph';
import { consultGraph } from './consultGraph';
import { deliberationGraph } from './deliberationGraph';
import { debateGraph } from './debateGraph';
import { freeGraph } from './freeGraph';
import { roundtableGraph } from './roundtableGraph';
import type { WorkflowGraph } from './types';

export const workflowGraphs: Record<WorkflowPresetId, WorkflowGraph> = {
  brainstorm: brainstormGraph,
  free: freeGraph,
  debate: debateGraph,
  consult: consultGraph,
  deliberation: deliberationGraph,
  coding: codingGraph,
  roundtable: roundtableGraph,
};
