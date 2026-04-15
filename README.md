# wire-claude-code

Wire inbound adapter — connects to the Wire message broker via SSE and delivers channel events as MCP notifications.

## Prerequisites

- Wire server running (default: `localhost:9800`)
- Bun (https://bun.sh)

## Install

```
/plugin install agiterra/wire-claude-code
```

## Tools / Skills

**MCP tools:**
- `heartbeat_create` / `heartbeat_delete` / `heartbeat_list` — manage periodic liveness signals to the Wire broker
- `set_plan` — publish the current agent plan to the Wire channel

## Configuration

| Var | Default | Description |
|-----|---------|-------------|
| `WIRE_URL` | `http://localhost:9800` | Wire server base URL |
| `WIRE_CHANNEL` | — | Channel to subscribe to (required) |
| `AGENT_ID` | — | Agent identity for the connection |
| `AGENT_NAME` | same as `AGENT_ID` | Display name shown on the Wire dashboard |
| `AGENT_PRIVATE_KEY` | — | Ed25519 PKCS8 base64 private key for signing (required) |
| `AGENT_PLAN` | — | Initial plan published to the Wire dashboard at startup |
