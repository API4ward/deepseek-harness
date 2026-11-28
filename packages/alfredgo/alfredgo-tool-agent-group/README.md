---
description: "AlfredGo agent group tools: a group member reads its reporting lines, assigns tasks to direct subordinates, and reports to the superior that assigned."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-tool-agent-group

English | [中文](README.zh.md)

## Summary

This plugin gives the model the tools of an [agent group](../alfredgo-agent-group/README.md). In a Session that is a group member, the model can read its position with `group_members`, give a task to a direct subordinate with `group_assign`, and answer an assignment with `group_report`. A guidance section in the system prompt explains the group. Sessions that are not members see neither the tools nor the guidance.

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

Load it next to the group service; it takes no configuration:

```yaml
- insert:
    - id: alfredgo-agent-group
      name: '@deepseek-ai/dsh-alfredgo-agent-group'
    - id: alfredgo-tool-agent-group
      name: '@deepseek-ai/dsh-alfredgo-tool-agent-group'
```

| Tool | Parameters | Result |
|---|---|---|
| `group_members` | none | JSON with `group`, `description`, `name`, `role`, `superiors`, `subordinates`, `received`, and `given`. Each neighbor has `name`, `role`, and `running`; each open assignment has `id`, `member`, and `summary`. |
| `group_assign` | `to`, `task` | `{"assignment_id":"<id>","delivered":true}` once the task reached the subordinate's Session. |
| `group_report` | `report`, optional `assignment_id` | `{"assignment_id":"<id>","delivered":true}` once the report reached the superior's Session. |

A refused call fails with the group service's message, which says what to do next: for example, an assignment to a member that is not a direct subordinate names the caller's subordinates, and a report without `assignment_id` while several are open lists the open ids.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) registers one system-prompt section and three tools. Each registration carries the condition `ctx.agentGroups.isMember(agent.id)`, so membership decides per request whether the model sees them; the condition also rejects a call from a Session that left its group between two requests. The tools pass the calling Session's id to `ctx.agentGroups`, which checks the reporting line itself. The section sits one position after the team policy section.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Group service](../alfredgo-agent-group/README.md) — the rules of assignment and report, and the messages they deliver.
- [Group page](../alfredgo-client-agent-group/README.md) — where the user edits members and reporting lines.
- [Tool pipeline](../../core/tools/README.md) — conditional tool registration.

-----

<a id="model-experience"></a>
## Model Experience

### Group guidance

#### What the model sees

While the Session is a group member, the system prompt contains the text below after the team policy position.

##### Guidance text

```markdown
This conversation is a member of an agent group that the user set up.

Members are long-lived agents joined by reporting lines the user defines and may change at any time. A member can have several superiors and several subordinates. Call group_members to see your role, your direct superiors, your direct subordinates, and your open assignments; call it again before assigning, because the lines may have changed.

Use group_assign to give a task to one of your direct subordinates. The call returns when the task reached that member, not when it is done; the member's report arrives later as a message in this conversation. Write each task so it can be done without this conversation's history. Do work yourself when no subordinate's role fits it.

When a superior assigns you a task, do it, then call group_report with the outcome: what you did, what you found, and anything left open. Report failure the same way. You cannot assign to or report to members that are not your direct subordinates or superiors.
```

#### Token effect

The fixed guidance adds about 230 tokens to every request of a member Session and nothing to other Sessions.

#### KV Cache effect

The guidance is prefix-stable while membership does not change. Joining or leaving a group adds or removes it, which changes the system prompt of that Session once.

### The group tools

#### What the model sees

While the Session is a group member, the tool list contains `group_members` (no parameters), `group_assign` (`to`, `task`), and `group_report` (`report`, optional `assignment_id`) with the results the table above lists. The reporting lines are not in the prompt; the model reads them through `group_members`, whose result reflects the lines at the time of the call.

#### Token effect

The three definitions add about 300 tokens to every request of a member Session. A `group_members` result grows with the number of direct neighbors and open assignments; the other two results are one short JSON object.

#### KV Cache effect

The definitions are prefix-stable while membership does not change; joining or leaving changes the tool list of that Session once. Editing reporting lines changes neither the prompt nor the tool list. Results append.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A member cannot see members that are not its direct superiors or subordinates, so it cannot ask the user to add a line to a specific distant member by name.
- `group_assign` does not wait for the report. A superior that needs the result in the same turn has to end the turn and continue when the report message arrives.
- The tools are not offered to subagents a member starts; only the member's own Session can assign and report.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/tools.spec.ts` runs the tools through the real agent loop with scripted model responses over the real group service. `tests/loader-composition.spec.ts` boots the group service and the tools from a `cordis.yml` through the Loader.

</details>
