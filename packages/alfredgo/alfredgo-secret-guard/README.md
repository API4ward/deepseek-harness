---
description: "AlfredGo plugin that lets the agent use the user's credentials through AgentSecret approvals while the model sees only credential references."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-secret-guard

English | [中文](README.zh.md)

## Summary

This AlfredGo plugin connects the agent to [AgentSecret](https://github.com/API4ward/AgentSecret), which keeps the user's credentials on an approver and asks the user before each use. While the plugin is loaded, a credential that appears in a tool result reaches the model as `{{secretref:<alias>}}` after the user approves, and is withheld otherwise. The `secret_write_file` tool writes a file whose references become the real values after approval. The `secret_guard` MCP server offers the operations AgentSecret performs itself, and tool calls that name AgentSecret's state are refused. The model and the session log contain references, never the values.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Prepare AgentSecret

Install AgentSecret on the machine that runs AlfredGo, then pair a relay, an injector, and an approver as its [split deployment guide](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md) describes. Store credentials on the approver, keep the approver running, and start the injector beside AlfredGo with `agentsecret injector serve`. The plugin refuses to load while the injector does not answer.

### Add it to a profile

```yaml
- id: alfredgo-secret-guard
  name: '@deepseek-ai/dsh-alfredgo-secret-guard'
  config:
    agentsecret: /opt/agentsecret/.venv/bin/agentsecret
    secretGuard: /opt/agentsecret/.venv/bin/secret-guard
    project: alfredgo
    tokenDir: /home/alice/.local/share/alfredgo/secret-guard
```

| Field | Default | Meaning |
|---|---|---|
| `agentsecret` | required | Path of the `agentsecret` command; the plugin runs `agentsecret injector task-create` at load and `agentsecret injector revoke task` at unload |
| `secretGuard` | required | Path of the `secret-guard` command that runs the MCP bridge |
| `injectorUrl` | `http://127.0.0.1:8765` | Agent API origin of the running injector |
| `injectorState` | `~/.local/share/agentsecret/injector` | Injector state directory; passed as `--state` and refused to tool calls |
| `project` | required | Project name of the task; approval rules on the approver match it |
| `tokenDir` | required | Directory for the task-token file, created with mode 0700 and refused to tool calls |
| `approvalWaitMs` | `110000` | Longest wait for the user's answer to one approval, just under an AgentSecret request lifetime |
| `protect` | `[]` | Further paths that tool calls must not name |

### What the user sees

Each time a tool result contains a stored credential, the approver shows the tool, its target, and the credential alias, and asks whether the content may reach the agent with references. Each `secret_write_file` call shows the target file and asks whether the references may become credentials. Answers, automatic approval modes, and returned copies or mock values follow the approver's own settings. A denied or unanswered result reaches the model as a withheld notice; a denied write fails without touching the file.

### What can go wrong

- **The injector stops** — every text result is withheld, because no text can be shown to be credential-free, and `secret_write_file` fails. Restart `agentsecret injector serve`.
- **The approver is not running** — approvals expire after about two minutes and the content is withheld.
- **A credential is encoded** — AgentSecret matches exact bytes only; base64, URL encoding, or a split value passes unchanged.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) probes the injector, creates one task through the trusted command, and reads its token from a fresh file in `tokenDir`; an effect revokes the task and deletes the file when the plugin unloads. While an MCP manager runs, `ctx.inject(['mcpManager'])` registers the `secret_guard` stdio server for the plugin's lifetime. A system-prompt section with `interpolate: false` carries the guidance, because it shows the literal reference syntax.

A `tools/post-execute` listener, prepended so that it sees the final content of every other listener, sends the text blocks to the injector's `/scan` ([`src/reveal.ts`](src/reveal.ts)). On a hit it asks `/hook` for a `reveal` approval and polls `/status`; approved hits become references at their UTF-8 byte ranges, and other texts holding a hit become the withheld notice. Results of the plugin's own tools are not scanned. A `tools/pre-execute` listener ([`src/protect.ts`](src/protect.ts)) denies calls whose argument strings contain a protected path or a trusted AgentSecret command name.

DHS freezes tool arguments before execution and records them, so a listener cannot fill a reference into another tool's input. [`src/write-tool.ts`](src/write-tool.ts) therefore owns the fill: it asks for a `fill` approval, takes the values once through `/take`, and writes through `ctx.fs` in the agent's working directory. Its arguments and result hold only references. [`src/injector.ts`](src/injector.ts) is the HTTP client; it refuses redirects and reports an unreachable injector separately from a refusal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [AlfredGo packages](../README.md) — the group this plugin belongs to.
- [Tool pipeline](../../core/tools/README.md) — `tools/pre-execute` and `tools/post-execute` semantics.
- [MCP manager](../../mcp/mcp-manager/README.md) — registration lifetime of plugin servers.
- [AgentSecret split deployment](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md) — approver, relay, injector, and the approval protocol.

-----

<a id="model-experience"></a>
## Model Experience

### Credential guidance

#### What the model sees

While the plugin is loaded, the system prompt contains the text below at the MCP server order.

##### Guidance text

```markdown
The user's credentials are managed by AgentSecret, and the user approves each use on their approver. Text that held a credential reaches you with `{{secretref:<alias>}}` in its place. To put a credential into a file, call `secret_write_file` with the reference in `content`; the file receives the real value after approval. Use the `mcp__secret_guard__*` tools for operations AgentSecret performs itself. Never ask the user to paste a credential into the conversation.
```

#### Token effect

The fixed guidance adds about 100 tokens to every request while the plugin is loaded.

#### KV Cache effect

The guidance is prefix-stable: it changes only when the plugin loads or unloads.

### The secret_write_file tool

#### What the model sees

The tool `secret_write_file` with parameters `file_path` and `content`, described as writing a UTF-8 file whose `{{secretref:<alias>}}` references receive the real values after approval. A successful result reads `Created <path> with the credentials for <aliases> filled in. Reading the file shows references again.` with `Updated` for an existing file.

#### Token effect

The tool definition adds about 120 tokens to every request; each result is one sentence.

#### KV Cache effect

The definition is prefix-stable while the plugin is loaded; results append.

### Tool results with credentials

#### What the model sees

A text block that holds an approved credential arrives with `{{secretref:<alias>}}` at each occurrence. A text block whose credential was not released arrives as `[AgentSecret: this text contains a credential of the user and was withheld (<reason>). Do not try to read it another way.]`. A call that names AgentSecret state fails with `AgentSecret: blocked (<what>). Credential state and task tokens are off limits to tools; use the mcp__secret_guard__* tools or secret_write_file instead. Do not retry with a different spelling.`

#### Token effect

A reference is usually a few tokens longer than the credential it replaces; a withheld notice replaces the whole text block.

#### KV Cache effect

Replacements happen before the result is appended, so they do not change earlier request tokens.

### The secret_guard MCP server

#### What the model sees

While an MCP manager runs, the AgentSecret server's instructions and its `mcp__secret_guard__*` tools appear as the [MCP client](../../mcp/mcp-client/README.md#model-experience) documents.

#### Token effect

AgentSecret defines the tool set and instructions; three tools are offered at the time of writing.

#### KV Cache effect

The server's instructions and tools appear when it connects and disappear when the plugin unloads.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only `secret_write_file` fills references. Other tools, such as shell commands and browser forms, receive the literal reference text, because DHS does not let a listener rewrite tool arguments.
- Only text blocks are scanned. Image blocks, `meta` presentation data, and contexts a tool defers are not, and a downstream listener that replaces a result's `value` is passed through unchanged. `meta` never reaches the model, but it is stored in the session log and shown in the client; for example, the `read` tool's line preview keeps a credential the model saw as a reference.
- A tool's live output stream, such as shell output in the client, shows credentials to the user before the scan; the model sees the scanned result.
- The protection of AgentSecret state matches strings in tool arguments. A process that builds a path at run time, or any process running as the same OS user outside the agent, is not stopped.
- An approval request's summary contains the tool's arguments, which the relay forwards to the approver.
- The approval interface is AgentSecret's own approver; the AlfredGo client does not show approvals yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/plugin.spec.ts` runs the plugin over the real tool pipeline and local filesystem with a fake injector agent API and a fake trusted command. The design and gate decisions are recorded in the AlfredGo board card AG-2 and `alfredgo/designs/AG-2-secret-manager.md`.

</details>
