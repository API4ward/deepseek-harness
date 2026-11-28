---
description: "AlfredGo agent group page in the DHS client: groups, members, the graph of reporting lines, and the assignment activity list."
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-client-agent-group

English | [中文](README.zh.md)

## Summary

This browser plugin adds the **Groups** page to the DHS client. On it the user creates [agent groups](../alfredgo-agent-group/README.md), adds members, and sees and changes who reports to whom in a graph. A member can have several superiors and several subordinates; the page refuses a line that would form a cycle and names the members along it. The page also lists assignments and whether they were reported, and the conversation list marks conversations that belong to a group.

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

Load it with the group service and the group tools through [`alfredgo/overlays/agent-group.overlay.yml`](../../../alfredgo/overlays/agent-group.overlay.yml). **Groups** then appears in the sidebar navigation.

### Groups and members

Create a group with a name, then set its description and working directory under **Members**. Every member sees the description. Conversations created for members work in the group's directory, chosen from the registered workspaces.

**New member** creates a long-lived agent with a name, a role, and optionally an agent preset; its conversation is created the first time it is opened or receives an assignment. **Add an existing conversation** brings a conversation into the group with its history and directory. Archived conversations, subagent conversations, and conversations that already belong to a group are not offered. Each member row opens the member's conversation, edits its name and role, resets its conversation, or removes it. Removing a member or deleting the group leaves the conversations as ordinary conversations.

### Reporting lines

**Reporting lines** draws the members in layers: superiors above, subordinates below, lines between them. Members without a superior are marked **Entry**. There are two ways to edit:

- Drag from the dot under a member to another member; the first becomes the superior of the second.
- Select a member and tick its superiors and subordinates in the lists beside the graph.

Select a line and press **Delete this line**, or the Delete key, to remove it. A change that would form a cycle is refused at once, with the cycle spelled out, for example `qa → lead → dev → qa`. Changes are a draft until **Save reporting lines**; **Discard changes** returns to the saved lines. When someone else changed the group in the meantime, saving is refused, the latest version loads, and the change has to be applied again.

### Activity

**Activity** lists the group's assignments, newest first: who assigned to whom, the first line of the task, the time, and **Open** or **Reported**.

### Conversation list

A conversation that belongs to a group shows a people mark in the sidebar; its label names the group and the member.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/index.ts`](src/client/index.ts) mounts the `agentGroups` Remote namespace and registers the page on the `main` slot, its navigation entry on `sidebar.panellist`, and the mark on `sidebar.session.row.leading`. [`src/client/source.ts`](src/client/source.ts) follows the service's `watch` stream, which sends a complete snapshot after every change, and turns refusals into localized messages; it reconnects when the stream ends.

[`src/client/RelationGraph.tsx`](src/client/RelationGraph.tsx) draws member boxes as HTML over an SVG layer of lines; [`src/client/layout.ts`](src/client/layout.ts) places each member one layer below its lowest superior. [`src/client/edges.ts`](src/client/edges.ts) holds the draft edits and a cycle check for immediate feedback. The Host checks every saved set again and decides; the browser bundle cannot import Host code, so the check exists on both sides.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Group service](../alfredgo-agent-group/README.md) — storage, rules, and delivery.
- [Group tools](../alfredgo-tool-agent-group/README.md) — what members' models can do.
- [Client UI slots](../../client/ui-slots/README.md) — the slots this page registers on.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [group service](../alfredgo-agent-group/README.md#model-experience), which delivers the notices that adding or removing an existing conversation causes.

#### KV Cache effect

No direct effect; the group service and the group tools document theirs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The graph has no zoom or free placement; a large group scrolls, and lines between distant layers can cross member boxes.
- Dragging a line needs a pointer. Keyboard and touch users edit lines through the lists beside the graph.
- The activity list shows the first line of each task only; the full task and report are in the members' conversations.
- The page and its registration in the client have unit tests over fakes; no test boots the whole client with it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/group-page.client.spec.tsx` renders the page in jsdom with the English dictionary; `tests/source.client.spec.ts` drives the snapshot source over a fake Remote; `tests/edges.client.spec.ts` covers the draft edits and the layout. The design is recorded in `alfredgo/designs/AG-3-agent-group.md`.

</details>
