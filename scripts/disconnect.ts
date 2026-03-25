#!/usr/bin/env bun
/**
 * Disconnect this agent's session from The Wire.
 * Called by SessionEnd hook — reads the session file written by the MCP server
 * and disconnects only that specific session.
 *
 * Env: WIRE_AGENT_ID
 */

import { readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { loadOrCreateKey, signBody } from "@agiterra/wire-tools/crypto";

const agentId = process.env.WIRE_AGENT_ID;
if (!agentId) {
  console.error("[wire] disconnect: no WIRE_AGENT_ID set");
  process.exit(0);
}

const sessionDir = join(process.env.HOME ?? "/tmp", ".wire", "sessions");

// Find session files for this agent
let files: string[];
try {
  files = readdirSync(sessionDir).filter((f) => f.startsWith(`${agentId}.`) && f.endsWith(".json"));
} catch {
  console.error("[wire] disconnect: no session files");
  process.exit(0);
}

for (const file of files) {
  const path = join(sessionDir, file);
  try {
    const info = JSON.parse(readFileSync(path, "utf-8"));
    const { sessionId, url } = info;

    if (!sessionId || !url) continue;

    const kp = await loadOrCreateKey(agentId);
    const body = JSON.stringify({ agent_id: agentId, session_id: sessionId });
    const sig = await signBody(kp.privateKey, body);

    const res = await fetch(`${url}/agents/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wire-Signature": sig,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      console.error(`[wire] disconnected session ${sessionId}`);
    } else {
      console.error(`[wire] disconnect ${sessionId}: ${res.status}`);
    }

    unlinkSync(path);
  } catch (e) {
    console.error(`[wire] disconnect error for ${file}: ${e}`);
    try { unlinkSync(path); } catch {}
  }
}
