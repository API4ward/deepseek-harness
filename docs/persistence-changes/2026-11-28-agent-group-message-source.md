---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-28-agent-group-message-source

English | [中文](2026-11-28-agent-group-message-source.zh.md)

## Summary

Adds the `agent-group` message source for assignments, reports, and membership notices that the AlfredGo agent group service writes into member Sessions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-28-agent-group-message-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "cfbd5389f27f1027feb3a3d16678f8f57f12e3de0c0ce6c3009170fcc86e4be2"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "9ef19304f1f1f06596430db7936a7bc925d6132620ebd173f6de3ad002b0cea7"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "108f05a51577b8c256f7472a5d012d8a0a4c636cbd21e2c2d44728c2eee3ac60"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "5a770bd6f42f220efb43b39e09b6321d6f0981ab62d255021dfdc239d2578644"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages keep their source and meaning. A group message is an ordinary user-role message with text content; its source adds the `agent-group` kind with the `relay` form for an assignment or a report and the `notice` form for joining or leaving a group. A newer reader restores the group, assignment, and sender ids from the source. A reader without the group plugin keeps the unknown source kind, as every consumer of message sources falls through unknown kinds, and reads the text, which names the sender, the group, and the assignment in words. Groups and assignment state live in the `agent_group` storage domain, not in the Session log, so no reader derives state from these messages.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/alfredgo/alfredgo-agent-group packages/alfredgo/alfredgo-tool-agent-group: 27 tests passed, including a stored member Session whose reopened events contain the `agent-group` relay source.

<a id="dev-note"></a>
## Dev Note

None.
