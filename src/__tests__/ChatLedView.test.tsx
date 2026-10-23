// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "../i18n/resolve";
import type { ChatLedRun, ForwardRecord, RunPhase } from "../workflow/chatLed/types";
import { ChatLedView, type ChatLedViewProps } from "../workbench/views/ChatLedView";

const roots: { root: Root; container: HTMLElement }[] = [];

const baseRun: ChatLedRun = {
  id: "run-1",
  goal: "Compare two approaches",
  coordinator: "chatgpt",
  available: ["claude"],
  roundLimit: 8,
  round: 1,
  phase: "coordinator-thinking",
  forwards: [],
  conversations: [],
  coordinatorReplies: [],
  createdAt: 1,
  updatedAt: 1,
};

const noop = () => {};

function makeRun(overrides: Partial<ChatLedRun> = {}): ChatLedRun {
  return { ...baseRun, ...overrides };
}

function makeProps(overrides: Partial<ChatLedViewProps> = {}): ChatLedViewProps {
  return {
    locale: "en",
    run: baseRun,
    providerLabels: { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" },
    cleanup: { plan: null, results: null, running: false },
    onPause: noop,
    onResume: noop,
    onStop: noop,
    onRemind: noop,
    onExtendLimit: noop,
    onTakeOver: noop,
    onExport: noop,
    onCleanup: noop,
    onClose: noop,
    ...overrides,
  };
}

async function renderView(overrides: Partial<ChatLedViewProps> = {}): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => {
    root.render(<ChatLedView {...makeProps(overrides)} />);
  });
  return container;
}

async function clickButton(container: ParentNode, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error("Could not find button: " + label);
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  for (const { root } of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
});

describe("ChatLedView phase status", () => {
  it("renders every phase with a readable label", async () => {
    const phases: { phase: RunPhase; label: string }[] = [
      { phase: "idle", label: "Not started" },
      { phase: "coordinator-thinking", label: "Coordinator thinking" },
      { phase: "forwarding", label: "Forwarding" },
      { phase: "paused", label: "Paused" },
      { phase: "awaiting-user", label: "Needs you" },
      { phase: "finished", label: "Completed" },
      { phase: "stopped", label: "Stopped" },
    ];

    for (const entry of phases) {
      const container = await renderView({ run: makeRun({ phase: entry.phase }) });
      expect(container.textContent).toContain(entry.label);
    }
  });

  it("shows the localized protocol violation and the raw coordinator reply", async () => {
    const onRemind = vi.fn();
    const onTakeOver = vi.fn();
    const onStop = vi.fn();
    const rawReply = "This is the complete original coordinator reply.";
    const container = await renderView({
      run: makeRun({
        phase: "awaiting-user",
        stop: {
          type: "protocol-violation",
          violation: { kind: "violation", code: "invalid-json", detail: "Invalid JSON" },
          rawReply,
        },
      }),
      onRemind,
      onTakeOver,
      onStop,
    });

    expect(container.textContent).toContain("The instruction block is not valid JSON.");
    const rawDetails = Array.from(container.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.includes("original reply"),
    );
    expect(rawDetails).toBeDefined();
    expect(rawDetails?.open).toBe(false);
    rawDetails!.open = true;
    expect(rawDetails?.textContent).toContain(rawReply);

    await clickButton(container, "Ask coordinator to resend");
    await clickButton(container, "Take over in browser");
    await clickButton(container, "Stop");
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(onTakeOver).toHaveBeenCalledWith("chatgpt");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("offers four more rounds at the round limit", async () => {
    const onExtendLimit = vi.fn();
    const onStop = vi.fn();
    const container = await renderView({
      run: makeRun({ phase: "awaiting-user", stop: { type: "round-limit", limit: 8 } }),
      onExtendLimit,
      onStop,
    });

    expect(container.textContent).toContain("Round limit reached");
    await clickButton(container, "Give it 4 more rounds");
    await clickButton(container, "Stop");
    expect(onExtendLimit).toHaveBeenCalledWith(4);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows provider failures with retry and stop actions", async () => {
    const onRemind = vi.fn();
    const onStop = vi.fn();
    const container = await renderView({
      run: makeRun({
        phase: "awaiting-user",
        stop: { type: "provider-failure", provider: "claude", error: "Connection lost" },
      }),
      onRemind,
      onStop,
    });

    expect(container.textContent).toContain("Connection lost");
    await clickButton(container, "Prompt / retry");
    await clickButton(container, "Stop");
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows pause only while running and resume only while paused", async () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const running = await renderView({ run: makeRun({ phase: "forwarding" }), onPause, onResume });
    expect(Array.from(running.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Pause")).toBe(true);
    expect(Array.from(running.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Resume")).toBe(false);
    await clickButton(running, "Pause");

    const paused = await renderView({ run: makeRun({ phase: "paused" }), onPause, onResume });
    await clickButton(paused, "Resume");
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);

    for (const phase of ["finished", "stopped"] as const) {
      const terminal = await renderView({ run: makeRun({ phase }) });
      expect(Array.from(terminal.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Pause")).toBe(false);
      expect(Array.from(terminal.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Resume")).toBe(false);
    }
  });
});

describe("ChatLedView timeline and cleanup", () => {
  it("expands to show the complete forwarded message, full reply, and coordinator reply", async () => {
    const fullReply = "REPLY_START " + "complete reply segment ".repeat(30) + " REPLY_END";
    const forward: ForwardRecord = {
      id: "r1-claude",
      round: 1,
      from: "chatgpt",
      to: "claude",
      message: "Forward this exact message",
      messageChars: 27,
      status: "done",
      reply: fullReply,
      replyChars: fullReply.length,
    };
    const container = await renderView({
      run: makeRun({
        forwards: [forward],
        coordinatorReplies: [{ round: 1, text: "COORDINATOR_REPLY_END", at: 100 }],
      }),
    });

    const replyDetails = Array.from(container.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.includes("Full reply"),
    );
    expect(replyDetails).toBeDefined();
    expect(replyDetails?.open).toBe(false);
    replyDetails!.open = true;
    const replyPre = replyDetails?.querySelector("pre");
    expect(replyPre?.textContent).toBe(fullReply);
    expect(replyPre?.textContent).toContain("REPLY_END");

    const messageDetails = Array.from(container.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.includes("Forwarded message"),
    );
    expect(messageDetails).toBeDefined();
    messageDetails!.open = true;
    expect(messageDetails?.textContent).toContain("Forward this exact message");

    const coordinatorDetails = Array.from(container.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.includes("Coordinator reply"),
    );
    expect(coordinatorDetails).toBeDefined();
    coordinatorDetails!.open = true;
    expect(coordinatorDetails?.textContent).toContain("COORDINATOR_REPLY_END");
  });

  it("marks delete as irreversible and manual cleanup as requiring the user", async () => {
    const container = await renderView({
      run: makeRun({ phase: "finished", doneSummary: "Completed." }),
      cleanup: {
        plan: [
          {
            provider: "claude",
            url: "https://claude.ai/chat/example",
            title: "Run conversation",
            action: "delete",
            irreversible: true,
            reason: "Created by this run",
          },
          {
            provider: "gemini",
            url: "https://gemini.google.com/app",
            action: "manual",
            irreversible: false,
            reason: "No supported cleanup action",
          },
        ],
        results: null,
        running: false,
      },
    });

    expect(container.textContent).toContain("Delete — irreversible");
    expect(container.textContent).toContain("Manual cleanup required");
    expect(container.textContent).toContain("Run conversation");
  });

  it("calls cleanup only after the user clicks the cleanup button", async () => {
    const onCleanup = vi.fn();
    const container = await renderView({
      run: makeRun({ phase: "finished" }),
      cleanup: {
        plan: [
          {
            provider: "claude",
            url: "https://claude.ai/chat/example",
            action: "delete",
            irreversible: true,
            reason: "Created by this run",
          },
        ],
        results: null,
        running: false,
      },
      exportedPath: "ai-one-chat-led-run.md",
      onCleanup,
    });

    expect(onCleanup).not.toHaveBeenCalled();
    await clickButton(container, "Clean up");
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps cleanup disabled until the forwarding log was exported", async () => {
    const onCleanup = vi.fn();
    const container = await renderView({
      run: makeRun({ phase: "finished" }),
      cleanup: {
        plan: [
          {
            provider: "chatgpt",
            url: "https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174000",
            action: "delete",
            irreversible: true,
            reason: "Created by this run",
          },
        ],
        results: null,
        running: false,
      },
      onCleanup,
    });
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Clean up"),
    );
    expect(button?.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      button?.click();
    });
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("disables cleanup while a cleanup operation is running", async () => {
    const onCleanup = vi.fn();
    const container = await renderView({
      run: makeRun({ phase: "finished" }),
      cleanup: {
        plan: [],
        results: null,
        running: true,
      },
      onCleanup,
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Cleaning up") === true,
    );
    expect(button?.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      button?.click();
    });
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("renders cleanup outcomes and enables close after results arrive", async () => {
    const onClose = vi.fn();
    const container = await renderView({
      run: makeRun({ phase: "stopped" }),
      cleanup: {
        plan: [],
        results: [
          { provider: "claude", url: "https://claude.ai/chat/example", outcome: "deleted", note: "Confirmed absent from the list" },
          { provider: "gemini", outcome: "manual", note: "Please remove it manually" },
        ],
        running: false,
      },
      onClose,
    });

    expect(container.textContent).toContain("Deleted");
    expect(container.textContent).toContain("Manual cleanup required");
    expect(container.textContent).toContain("Please remove it manually");
    await clickButton(container, "Mark closed");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the timeline and safety copy in English and Simplified Chinese without exposing keys", async () => {
    const locales: { locale: Locale; expectedTimeline: string; expectedSafety: string }[] = [
      {
        locale: "en",
        expectedTimeline: "Forwarding timeline",
        expectedSafety: "Whether the coordinator follows the protocol depends on the model.",
      },
      {
        locale: "zh-CN",
        expectedTimeline: "转发时间线",
        expectedSafety: "协调者是否遵守协议取决于模型",
      },
    ];

    for (const entry of locales) {
      const container = await renderView({ locale: entry.locale });
      expect(container.textContent).toContain(entry.expectedTimeline);
      expect(container.textContent).toContain(entry.expectedSafety);
      expect(container.textContent).not.toContain("chatLed");
    }
  });
});
