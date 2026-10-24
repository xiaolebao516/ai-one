import { createContext, useContext } from "react";
import type { Session } from "@agent-hud/protocol";

/** Where the Statistics window opens: a page, or one session's usage. */
export type StatsTarget = { tab?: "tokens" | "sessions"; sessionId?: string };

/** What the panel's session rows do through the HUD (Open's ScreenHUD and
 * HoverPanelView+Sessions): the HUD collapses before it hands over, and
 * reopens to say so when a return to the agent fails. */
export interface ListedSessions {
  /** Back to the session's agent, or its page where the client names no destination. */
  open(session: Session): Promise<boolean>;
  openStats(target: StatsTarget): void;
  /** The session whose return just failed. */
  failed: string | null;
}

export const ListedSessionsContext = createContext<ListedSessions | null>(null);
export const useListedSessions = () => useContext(ListedSessionsContext);
