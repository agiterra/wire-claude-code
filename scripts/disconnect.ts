#!/usr/bin/env bun
/**
 * Disconnect this agent's session from The Wire.
 * Called by SessionEnd hook — reads the session file written by the MCP server
 * and disconnects only that specific session.
 *
 * Env: AGENT_ID, AGENT_PRIVATE_KEY
 */

import { readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { createAuthJwt, importPrivateKey } from "@agiterra/wire-tools/crypto";

const agentId = process.env.AGENT_ID;
if (!agentId) {
  console.error("[wire] disconnect: no AGENT_ID set");
  process.exit(0);
}

const rawKey = process.env.AGENT_PRIVATE_KEY;
if (!rawKey) {
  console.error("[wire] disconnect: no private key in env");
  process.exit(0);
}

const privateKey = await importPrivateKey(rawKey);

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

    const body = JSON.stringify({ session_id: sessionId });
    const token = await createAuthJwt(privateKey, agentId, body);

    const res = await fetch(`${url}/agents/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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
