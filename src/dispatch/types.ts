export type DispatchStatus = 'running' | 'completed' | 'timeout' | 'request_mismatch' | 'recovered' | 'blocked' | 'preview' | 'unknown';
export interface DispatchEvent {
  id: string;
  taskId: string;
  sessionId?: string;
  sessionKey?: string;
  threadUrl?: string;
  requestId?: string;
  status: DispatchStatus;
  createdAt?: string;
  updatedAt?: string;
  issue?: string;
}
export interface DispatchSlot {
  id: number;
  port: number;
  state: 'idle' | 'claimed' | 'stale' | 'unknown';
  browserState: 'unprobed';
  pid?: number;
  task?: string;
  sessionKey?: string;
  threadUrl?: string;
  startedAt?: string;
}
export interface DispatchSnapshot {
  events: DispatchEvent[];
  slots: DispatchSlot[];
  warnings: string[];
}
