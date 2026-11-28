---
description: "AlfredGo agent groups: long-lived agents joined by an acyclic graph of reporting lines, with assignment and report delivery between their Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-agent-group

English | [中文](README.zh.md)

## Summary

This Host service keeps agent groups. A group holds long-lived members, each backed by one Session, and directed reporting lines between them. The lines form a graph without cycles: one member can have several superiors and several subordinates. A superior assigns a task to a direct subordinate, and the subordinate reports to the superior that assigned it. The service stores groups, checks every change, and delivers assignments and reports as messages into member Sessions. The [group tools](../alfredgo-tool-agent-group/README.md) expose assignment and reporting to the model, and the [group page](../alfredgo-client-agent-group/README.md) lets the user edit groups.

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

Load the three group packages in a profile with an overlay:

```yaml
- insert:
    - id: alfredgo-agent-group
      name: '@deepseek-ai/dsh-alfredgo-agent-group'
    - id: alfredgo-tool-agent-group
      name: '@deepseek-ai/dsh-alfredgo-tool-agent-group'
    - id: alfredgo-client-agent-group
      name: '@deepseek-ai/dsh-alfredgo-client-agent-group'
```

The repository keeps these rows in [`alfredgo/overlays/agent-group.overlay.yml`](../../../alfredgo/overlays/agent-group.overlay.yml); `pnpm dsh web --patch alfredgo/overlays/agent-group.overlay.yml` starts the Web client with groups.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxMembersPerGroup` | `50` | Members one group may hold. |
| `maxOpenAssignmentsPerMember` | `20` | Assignments one member may hold without a report; a further `assign` to it is refused. |
| `assignmentHistoryRecords` | `200` | Reported assignments kept per group for the activity list. |

### Members

A member is created inside the group or joins with an existing Session. A created member gets its Session the first time the user opens it or a superior assigns to it; the Session uses the group's working directory and the member's agent preset. An existing Session joins as it is, with its history and working directory. A Session can be a member of one group only. Archived Sessions and subagent Sessions cannot join.

Removing a member or the group leaves the Session as an ordinary Session. Resetting a member gives it a new empty Session and removes the assignments it received and has not reported.

### Reporting lines

`setEdges` replaces all lines of a group. It refuses a line from a member to itself, a line to an unknown member, and any set that contains a cycle; the refusal names the members along the cycle. The request carries the group revision the editor read, and a stale revision is refused with `conflict`.

### Assignment and report

`assign(sessionId, to, task)` accepts only a direct subordinate of the calling member. It stores the assignment, then delivers the task to the subordinate's Session: as a steering message while that Session runs a turn, otherwise as a message that starts a turn. `report(sessionId, report, assignmentId?)` delivers the report to the superior that gave the assignment, the same way, and marks the assignment reported. The user can also write to any member's Session directly.

### Service API

`ctx.agentGroups` offers `snapshot`, `watch`, `membershipOf`, `isMember`, `memberView`, `create`, `update`, `remove`, `addMember`, `attachSession`, `updateMember`, `removeMember`, `resetMemberSession`, `openMember`, `setEdges`, `assign`, and `report`. Refusals throw `AgentGroupError` with one of the codes in [`src/types.ts`](src/types.ts). The Remote namespace `agentGroups` carries the management methods and the `watch` stream. There `create`, `update`, and `remove` are named `createGroup`, `updateGroup`, and `removeGroup`, because every Remote namespace reserves `remove`. A refusal reaches the Client as `agent-group/refused` with the same code.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) is a `TypertRemoteService`. Every change and delivery runs on one FIFO chain, so two superiors assigning to the same subordinate at once are stored and delivered in order. Groups and assignments live in the storage domain `agent_group` ([`src/storage.ts`](src/storage.ts)); each group change increments its `revision`. [`src/graph.ts`](src/graph.ts) holds the cycle search. The `./client` export carries types only, because a browser bundle cannot import Host code; the group page keeps its own check for immediate feedback, and this service decides.

Delivery follows the Schedule service: the service resolves the member's Agent through `sessionController`, creating the Session of a created member on first use, appends a user message whose `source` is `{ kind: 'agent-group', form: 'relay', … }`, and flushes the Session log. Joining and leaving add a `notice` message to an existing Session so the model learns that the group tools appeared or disappeared. `watch` yields a complete snapshot after every change, so the Client needs no forwarded Host event.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Group tools](../alfredgo-tool-agent-group/README.md) — the model-facing tools and guidance.
- [Group page](../alfredgo-client-agent-group/README.md) — the settings page and the graph editor.
- [Schedule service](../../schedule/schedule/README.md) — the delivery pattern this service follows.

-----

<a id="model-experience"></a>
## Model Experience

### Assignment delivered to a subordinate

#### What the model sees

The subordinate's Session receives one user message: `Your superior "<name>" in group "<group>" assigned you a task (assignment <id>).`, then `You are member "<name>" of that group; your role: <role>` (the role part is left out for a member without one), then `When it is done or cannot be done, call group_report with assignment_id "<id>".`, a blank line, and the task text the superior wrote.

#### Token effect

One message per assignment, as long as the task text plus three fixed lines. It stays in the Session history.

#### KV Cache effect

Append-only: the message is added at the end of the subordinate's history and changes no earlier content.

### Report delivered to a superior

#### What the model sees

The superior's Session receives one user message: `Your subordinate "<name>" in group "<group>" reported on assignment <id> (<summary>).`, a blank line, and the report text.

#### Token effect

One message per report, as long as the report text plus one fixed line. It stays in the Session history.

#### KV Cache effect

Append-only: the message is added at the end of the superior's history, or joins the running turn as a steering message.

### Joining and leaving notice

#### What the model sees

An existing Session that joins a group receives `The user added this conversation to group "<group>" as member "<name>". Call group_members to see your superiors and subordinates.` A Session that leaves receives `The user removed this conversation from group "<group>". The group tools no longer apply here.` The message is added to the history and starts no turn.

#### Token effect

One short message per join or leave.

#### KV Cache effect

Append-only for the history. The member's tool list and system prompt change at the same moment through the [group tools](../alfredgo-tool-agent-group/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A report goes only to the superior that gave the assignment; other superiors of the member do not see it.
- The Web conversation shows an assignment or a report as the collapsed card it uses for every message a program delivered, without the names of the two members on the card.
- A member Session that is archived or deleted outside the group page stays a member; assigning or reporting to it fails with `delivery-failed`, and the message tells the model what the user must do.
- An assignment has no deadline or cancellation; a superior can only wait for the report or ask again.
- Groups are local to one Host; there is no export or sharing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The design and its review decisions are recorded in `alfredgo/designs/AG-3-agent-group.md`. `tests/harness.ts` builds the service over real Session, Agent, and storage services with a memory backend and a fake `sessionController`.

</details>
