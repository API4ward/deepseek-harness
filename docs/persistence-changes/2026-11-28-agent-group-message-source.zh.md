---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-28-agent-group-message-source

[English](2026-11-28-agent-group-message-source.md) | 中文

## 概述

新增 `agent-group` 消息来源，用于 AlfredGo 组群服务写入成员会话的分派、汇报和成员变动通知。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有消息的来源和含义不变。组群消息是普通的用户角色文本消息；它的来源新增 `agent-group` 类型，分派和汇报使用 `relay` 形式，加入和退出组群使用 `notice` 形式。新的读取方从来源恢复组群、分派和发送方的 id。没有组群插件的读取方保留这个未知的来源类型（所有读取消息来源的代码都会放行未知类型），并读取文本，文本里用文字写明了发送方、组群和分派编号。组群和分派状态保存在 `agent_group` 存储域，不在会话日志里，所以没有读取方从这些消息推导状态。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/alfredgo/alfredgo-agent-group packages/alfredgo/alfredgo-tool-agent-group：27 个测试通过，其中包括重新打开已保存的成员会话并在事件中找到 `agent-group` relay 来源。

<a id="dev-note"></a>
## 开发备注

无。
