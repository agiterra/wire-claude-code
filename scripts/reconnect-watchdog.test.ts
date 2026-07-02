import { describe, test, expect } from "bun:test";
import { planActions, type SessionInfo } from "./reconnect-watchdog";

const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

describe("planActions", () => {
  test("signals an alive process that advertises the sighup-reconnect cap", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", pid: 100, caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, "cc-1", alive([100]));
    expect(plan.signal).toEqual([100]);
    expect(plan.dead).toEqual([]);
    expect(plan.skippedNoCap).toEqual([]);
  });

  test("marks a dead process for the /plugin notice", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", pid: 100, caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, "cc-1", alive([]));
    expect(plan.dead).toEqual([100]);
    expect(plan.signal).toEqual([]);
  });

  test("never signals an alive process without the cap (version-skew safe)", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", pid: 100 }, // no caps
    ];
    const plan = planActions(sessions, "cc-1", alive([100]));
    expect(plan.signal).toEqual([]);
    expect(plan.skippedNoCap).toEqual([100]);
    expect(plan.dead).toEqual([]);
  });

  test("only targets sessions matching the current cc session", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", pid: 100, caps: ["sighup-reconnect"] },
      { agentId: "fondant", ccSessionId: "cc-2", pid: 200, caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, "cc-1", alive([100, 200]));
    expect(plan.signal).toEqual([100]);
  });

  test("falls back to all sessions when none match the cc session", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-old", pid: 300, caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, "cc-new", alive([300]));
    expect(plan.signal).toEqual([300]);
  });

  test("falls back to all sessions when cc session id is undefined", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", pid: 100, caps: ["sighup-reconnect"] },
      { agentId: "fondant", ccSessionId: "cc-2", pid: 200, caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, undefined, alive([100, 200]));
    expect(plan.signal.sort()).toEqual([100, 200]);
  });

  test("ignores session entries without a pid", () => {
    const sessions: SessionInfo[] = [
      { agentId: "fondant", ccSessionId: "cc-1", caps: ["sighup-reconnect"] },
    ];
    const plan = planActions(sessions, "cc-1", alive([]));
    expect(plan).toEqual({ signal: [], dead: [], skippedNoCap: [] });
  });
});
