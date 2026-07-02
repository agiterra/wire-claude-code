#!/usr/bin/env bun
/**
 * SessionStart:compact reconnect watchdog.
 *
 * The wire inbound SSE lives inside the stdio MCP server process. Claude Code
 * does NOT auto-respawn stdio MCP servers, so if that process dies (or its SSE
 * goes stale) around a context compaction, the agent goes wire-deaf until a
 * manual /plugin — historically ~11h of silent deafness.
 *
 * This hook runs at every SessionStart (matched to compact/resume/startup) and
 * repairs what it can, client-side:
 *
 *   - MCP process ALIVE  → send SIGHUP to force a fresh SSE + broker backlog
 *     replay (the server installs a SIGHUP handler in wire-tools ≥ the
 *     sse-reconnect-watchdog build; we ONLY signal a process whose session file
 *     advertises the "sighup-reconnect" cap, so we can never kill an older
 *     server whose default SIGHUP action is terminate).
 *
 *   - MCP process DEAD   → a stdio server cannot be respawned from here. Surface
 *     it LOUDLY via SessionStart additionalContext so the agent/operator learns
 *     immediately (and can /plugin) instead of discovering it hours later.
 *
 * Never throws: a hook crash must not block the session. All errors are logged
 * to stderr with full detail; the process always exits 0.
 *
 * Env: AGENT_ID (required to locate session files), CLAUDE_CODE_SESSION_ID
 * (matches the cc_session recorded by the MCP server), HOME.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export type SessionInfo = {
  agentId?: string;
  sessionId?: string;
  ccSessionId?: string;
  pid?: number;
  url?: string;
  caps?: string[];
  /** Absolute path of the session file this came from (for logs). */
  _path?: string;
};

export type WatchdogPlan = {
  /** pids to SIGHUP (alive + advertises sighup-reconnect). */
  signal: number[];
  /** pids that are dead — unrecoverable without /plugin. */
  dead: number[];
  /** alive but NOT advertising the cap — left untouched (skew-safe). */
  skippedNoCap: number[];
};

/**
 * Decide what to do for the sessions belonging to THIS cc session. Pure so it
 * is unit-testable without touching the filesystem or real processes.
 *
 * @param sessions   parsed session files for this AGENT_ID
 * @param ccSessionId the current CLAUDE_CODE_SESSION_ID (undefined ⇒ match all)
 * @param isAlive    liveness probe for a pid (injected for testing)
 */
export function planActions(
  sessions: SessionInfo[],
  ccSessionId: string | undefined,
  isAlive: (pid: number) => boolean,
): WatchdogPlan {
  const plan: WatchdogPlan = { signal: [], dead: [], skippedNoCap: [] };
  // Prefer sessions matching our cc session; if none match (e.g. the id wasn't
  // recorded), fall back to every session file for this agent.
  const matched = ccSessionId
    ? sessions.filter((s) => s.ccSessionId === ccSessionId)
    : sessions;
  const targets = matched.length > 0 ? matched : sessions;

  for (const s of targets) {
    if (typeof s.pid !== "number") continue;
    if (!isAlive(s.pid)) {
      plan.dead.push(s.pid);
    } else if (s.caps?.includes("sighup-reconnect")) {
      plan.signal.push(s.pid);
    } else {
      plan.skippedNoCap.push(s.pid);
    }
  }
  return plan;
}

function pidAlive(pid: number): boolean {
  try {
    // Signal 0 = existence/permission probe, does not deliver a signal.
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    // ESRCH = no such process (dead). EPERM = alive but not ours (treat alive).
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function readSessions(sessionDir: string, agentId: string): SessionInfo[] {
  let files: string[];
  try {
    files = readdirSync(sessionDir).filter(
      (f) => f.startsWith(`${agentId}.`) && f.endsWith(".json"),
    );
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const f of files) {
    const path = join(sessionDir, f);
    try {
      const info = JSON.parse(readFileSync(path, "utf-8")) as SessionInfo;
      info._path = path;
      out.push(info);
    } catch (e) {
      console.error(`[wire-watchdog] failed to parse ${path}: ${e}`);
    }
  }
  return out;
}

function main(): void {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    console.error("[wire-watchdog] no AGENT_ID — nothing to check");
    return;
  }
  const ccSessionId = process.env.CLAUDE_CODE_SESSION_ID || undefined;
  const home = process.env.HOME ?? "/tmp";
  const sessionDir = join(home, ".wire", "sessions");

  const sessions = readSessions(sessionDir, agentId);
  if (sessions.length === 0) {
    // No session file at all: either the MCP never connected this session yet
    // (startup — normal, it connects a couple seconds in) or it died and its
    // file was cleaned up. Don't cry wolf on startup; just log.
    console.error(`[wire-watchdog] no session files for ${agentId} in ${sessionDir}`);
    return;
  }

  const plan = planActions(sessions, ccSessionId, pidAlive);

  for (const pid of plan.signal) {
    try {
      process.kill(pid, "SIGHUP");
      console.error(`[wire-watchdog] SIGHUP → pid ${pid} (force reconnect)`);
    } catch (e) {
      console.error(`[wire-watchdog] SIGHUP to pid ${pid} failed: ${e}`);
      plan.dead.push(pid); // couldn't signal ⇒ treat as down for the notice
    }
  }
  for (const pid of plan.skippedNoCap) {
    console.error(`[wire-watchdog] pid ${pid} lacks sighup-reconnect cap — not signaling (skew-safe)`);
  }

  if (plan.dead.length > 0) {
    console.error(`[wire-watchdog] wire MCP DOWN (pids ${plan.dead.join(", ")}) — emitting /plugin notice`);
    // SessionStart hooks can inject context the agent sees this turn.
    const additionalContext =
      "⚠️ Wire inbound is DOWN: the `wire` plugin's MCP server is not running " +
      `(pid(s) ${plan.dead.join(", ")} exited, likely at compaction). Inbound Wire ` +
      "messages are NOT being received right now. Claude Code does not auto-respawn " +
      "stdio MCP servers — run `/plugin` (or `/mcp`) to restart the wire plugin. " +
      "The broker has queued the backlog; it replays on reconnect (nothing lost).";
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }),
    );
  }
}

// Only run main when executed directly (not when imported by the test).
if (import.meta.main) {
  try {
    main();
  } catch (e) {
    // Never let a watchdog crash block the session.
    console.error(`[wire-watchdog] fatal (ignored): ${e instanceof Error ? e.stack : e}`);
  }
}
