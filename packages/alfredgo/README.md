---
description: "The AlfredGo group map: plugins that exist only in the AlfredGo edition of DeepSeek Harness and stay out of upstream files."
kind: "package-group"
---

# alfredgo/ — AlfredGo plugins

English | [中文](README.zh.md)

## Summary

This group holds plugins that belong to AlfredGo, the special edition of DeepSeek Harness, rather than to upstream. Each package attaches to existing extension points, so syncing upstream does not conflict with it. The development process, the board, and the ledger of upstream file changes live in the `alfredgo/` directory at the repository root.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`alfredgo-secret-guard/`](alfredgo-secret-guard/README.md) | Connects the agent to AgentSecret: credentials in tool results become references after approval, `secret_write_file` fills references into files, and the `secret_guard` MCP server offers AgentSecret's own operations | registers on `ctx.tools`, `ctx.systemPrompt`, and `ctx.mcpManager` |
| [`alfredgo-secret-approver/`](alfredgo-secret-approver/README.md) | Forwards the client approver's calls to the AgentSecret relay | provides the Remote namespace `secretApprover` |
| [`alfredgo-client-secret-approver/`](alfredgo-client-secret-approver/README.md) | Makes the DHS client an AgentSecret approver: device keys, encrypted credentials, injector pairing, and approval cards | registers on the client `settings.section` and `shell.overlay` slots |

-----

<a id="related-documentation"></a>
## Related documentation

- [AlfredGo development process](../../alfredgo/docs/development-process.md) — branches, upstream sync, and feature gates.
- [Tool pipeline](../core/tools/README.md) — the pre- and post-execution extension points the plugins use.
- [Credentials subsystem reference](../../docs/subsystems/credentials.md) — how DHS itself keeps secret values out of configuration; AgentSecret credentials stay outside it.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
