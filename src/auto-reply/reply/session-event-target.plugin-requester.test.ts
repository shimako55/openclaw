import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// mock-isolation: This test covers requester admission, not agent-deletion journal state.
vi.mock("../../agents/agent-lifecycle-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/agent-lifecycle-registry.js")>()),
  prepareAgentDeletionBlocked: () => () => false,
}));
import { setRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import { getCommandOwnerAuthority } from "../command-owner-authority.js";
import { buildSessionEventContext } from "./session-event-context.js";
import {
  captureSessionEventTargetForHost,
  prepareSessionEventTargetForHost,
  readSessionEventTargetRequesterOwner,
} from "./session-event-target.js";

const store = mkdtempSync(join(tmpdir(), "openclaw-plugin-requester-"));
const agentId = "main";
const sessionKey = "agent:main:main";

function config() {
  return {
    commands: { ownerAllowFrom: ["slack:U123"] },
    session: { store },
  };
}

function channelRequester(senderId: string) {
  return {
    requester: {
      kind: "channel" as const,
      requester: { version: 1 as const, channel: "slack", accountId: "default", senderId },
    },
  };
}

async function admittedTarget(senderId: string) {
  const target = await captureSessionEventTargetForHost(agentId, sessionKey, {
    requesterOwner: channelRequester(senderId),
  });
  const lease = await prepareSessionEventTargetForHost(target);
  return { target, lease };
}

beforeEach(() => {
  setRuntimeConfigSnapshot(config());
});

afterEach(() => {
  setRuntimeConfigSnapshot({});
});

afterAll(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("plugin session event requester authority", () => {
  it("admits a natively verified channel owner for a plugin-sourced turn", async () => {
    const { target, lease } = await admittedTarget("U123");
    try {
      expect(readSessionEventTargetRequesterOwner(target)?.owner).toBe(true);
      const ctx = buildSessionEventContext({
        cfg: config(),
        agentId,
        sessionKey,
        text: "Slack interaction: button clicked",
        options: { source: "plugin" },
        occurrenceId: "button-1",
        deliveryContext: { channel: "slack", accountId: "default", to: "channel:C1" },
        target,
        assertCurrent() {},
      });
      expect(getCommandOwnerAuthority(ctx)).toBeDefined();
    } finally {
      lease.release();
    }
  });

  it("does not admit a verified non-owner sender", async () => {
    const { target, lease } = await admittedTarget("U999");
    try {
      expect(readSessionEventTargetRequesterOwner(target)?.owner).toBe(false);
      const ctx = buildSessionEventContext({
        cfg: config(),
        agentId,
        sessionKey,
        text: "Slack interaction: button clicked",
        options: { source: "plugin" },
        occurrenceId: "button-2",
        target,
        assertCurrent() {},
      });
      expect(getCommandOwnerAuthority(ctx)).toBeUndefined();
    } finally {
      lease.release();
    }
  });
});
