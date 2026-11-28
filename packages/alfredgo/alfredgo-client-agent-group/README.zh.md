---
description: "DHS 客户端里的 AlfredGo 组群页面：组群、成员、隶属关系图和分派动态列表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-client-agent-group

[English](README.md) | 中文

## 概述

这个浏览器插件给 DHS 客户端增加**组群**页面。用户在这里创建[组群](../alfredgo-agent-group/README.zh.md)、添加成员，并在一张图里查看和修改谁向谁汇报。一个成员可以有多个上级和多个下级；会形成循环的关系会被页面拒绝，并指出循环经过的成员。页面还列出分派的任务以及是否已汇报，会话列表会标出属于组群的会话。

## 目录

- [使用这个包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

通过 [`alfredgo/overlays/agent-group.overlay.yml`](../../../alfredgo/overlays/agent-group.overlay.yml) 和组群服务、组群工具一起加载。之后侧边栏导航里会出现**组群**。

### 组群和成员

先用名称创建组群，再在**成员**里设置描述和工作目录。描述对每个成员可见。为成员创建的会话在组群的目录里工作，目录从已登记的工作区里选。

**新建成员**创建一个长期存在的 agent，需要名称、职责，可选 agent 预设；它的会话在第一次被打开或第一次收到分派时创建。**加入已有会话**把一个现有会话连同历史和目录拉进组群。已归档的会话、子 agent 的会话和已经属于某个组群的会话不会出现在选项里。每个成员行可以打开成员的会话、修改名称和职责、重置会话或移除成员。移除成员或删除组群后，会话保留为普通会话。

### 隶属关系

**隶属关系**把成员分层画出来：上级在上，下级在下，中间是连线。没有上级的成员标为**入口**。有两种修改方式：

- 从成员下方的圆点拖到另一个成员；前者成为后者的上级。
- 选中一个成员，在图旁边的列表里勾选它的上级和下级。

选中一条线后点**删除这条关系**或按 Delete 键即可删除。会形成循环的修改会立即被拒绝，并写出循环，例如 `qa → lead → dev → qa`。修改在点**保存关系**之前只是草稿；**撤销修改**回到已保存的关系。如果期间别人改过这个组群，保存会被拒绝，页面载入最新版本，需要重新修改一次。

### 活动

**活动**按时间倒序列出组群里的分派：谁分派给谁、任务的第一行、时间，以及**进行中**或**已汇报**。

### 会话列表

属于组群的会话在侧边栏里带一个人群标记，标记的说明写着组群和成员的名字。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节（点击展开）</summary>

[`src/client/index.ts`](src/client/index.ts) 挂载 Remote 命名空间 `agentGroups`，把页面注册到 `main` 插槽，导航入口注册到 `sidebar.panellist`，标记注册到 `sidebar.session.row.leading`。[`src/client/source.ts`](src/client/source.ts) 跟随服务的 `watch` 流（每次修改后发送一份完整快照），并把拒绝转成本地化的提示；流结束时它会重新连接。

[`src/client/RelationGraph.tsx`](src/client/RelationGraph.tsx) 用 HTML 画成员方框，下面是一层 SVG 连线；[`src/client/layout.ts`](src/client/layout.ts) 把每个成员放在它最低的上级的下一层。[`src/client/edges.ts`](src/client/edges.ts) 是草稿修改和用于即时提示的循环检查。Host 会再检查每次保存的关系并做最终判定；浏览器包不能导入 Host 代码，所以两边各有一份检查。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [组群服务](../alfredgo-agent-group/README.zh.md)：存储、规则和投递。
- [组群工具](../alfredgo-tool-agent-group/README.zh.md)：成员的模型能做什么。
- [客户端 UI 插槽](../../client/ui-slots/README.zh.md)：这个页面注册的插槽。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过[组群服务](../alfredgo-agent-group/README.zh.md#model-experience)：添加或移除已有会话时，由它投递通知。

#### KV Cache 影响

没有直接影响；组群服务和组群工具各自记录了它们的影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 关系图不能缩放，也不能自由摆放；成员多时只能滚动，跨多层的连线可能穿过成员方框。
- 拖线需要鼠标之类的指针设备。键盘和触屏用户通过图旁边的列表修改关系。
- 活动列表只显示每项任务的第一行；完整的任务和汇报在成员的会话里。
- 页面及其在客户端里的注册有基于替身的单元测试；还没有测试启动整个客户端来加载它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

`tests/group-page.client.spec.tsx` 在 jsdom 里用英文词典渲染页面；`tests/source.client.spec.ts` 让快照源对接替身 Remote；`tests/edges.client.spec.ts` 覆盖草稿修改和布局。设计记录在 `alfredgo/designs/AG-3-agent-group.md`。

</details>
