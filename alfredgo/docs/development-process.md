# AlfredGo 开发流程

本文是 AlfredGo 的开发流程参考：仓库与分支怎么组织，怎么从上游 DHS 同步，一个新特性从提出到发布要经过哪些关卡，以及 Notion 看板如何与 GitHub 保持同步。Notion 上的“开发流程”页面是本文的镜像，两者不一致时以本文为准。

## 目录

- [1. 仓库与远端](#1-仓库与远端)
- [2. 分支策略](#2-分支策略)
- [3. 保持定制改动隔离](#3-保持定制改动隔离)
- [4. 从上游 DHS 同步](#4-从上游-dhs-同步)
- [5. 特性生命周期](#5-特性生命周期)
- [6. 发布与版本号](#6-发布与版本号)
- [7. Notion 看板与 GitHub 同步](#7-notion-看板与-github-同步)
- [8. 待确认事项](#8-待确认事项)

## 1. 仓库与远端

| 远端 | 仓库 | 用途 |
|:--|:--|:--|
| `origin` | `API4ward/deepseek-harness` | AlfredGo 仓库，所有开发、评审和发布都在这里 |
| `upstream` | `deepseek-harness/deepseek-harness`（上游 DHS） | 只读，只用来 `fetch` 和合并，从不推送 |

首次配置（只需一次）：

```sh
UPSTREAM_REPO=deepseek-harness/deepseek-harness
git remote add upstream "https://github.com/${UPSTREAM_REPO}.git"
git remote set-url --push upstream DISABLED   # 防止误推上游
git config rerere.enabled true                # 记住冲突解法，下次同步自动复用
git fetch upstream --tags
```

如果上游仓库地址不同，改 `UPSTREAM_REPO` 即可；[sync-upstream.sh](../scripts/sync-upstream.sh) 也读取同名环境变量。

## 2. 分支策略

| 分支 | 来源 | 合入目标 | 合并方式 |
|:--|:--|:--|:--|
| `master` | AlfredGo 主线 = 上游 DHS + AlfredGo 定制 | — | 受保护，只通过 PR 合入 |
| `feat/AG-<编号>-<简述>` | `master` | `master` | Squash merge |
| `fix/AG-<编号>-<简述>` | `master` | `master` | Squash merge |
| `sync/upstream-<日期>` | `master` | `master` | **Merge commit，禁止 squash 和 rebase** |
| `release/<版本>` | `master` | 仅打 tag，必要时 cherry-pick 修复 | — |

规则：

- `AG-<编号>` 是 Notion 看板卡片的 ID。分支名、PR 标题都带上它，看板才能自动关联 PR（见第 7 节）。
- 同步 PR 必须保留上游提交的祖先关系。Squash 或 rebase 会让 Git 失去“哪些上游提交已合入”的记录，下次同步会把同样的冲突再来一遍。GitHub 仓库设置里需要同时允许 squash merge 和 merge commit。
- `master` 上不做 force-push；任何改写共享分支历史的操作需要先征得负责人同意。
- 上游仓库自带的 GitHub Actions 工作流（发布、桌面打包、自托管 runner 等）在 AlfredGo 仓库里大多不适用。在 GitHub 的 Actions 页面禁用不需要的工作流，而不是删除或修改工作流文件，这样不会产生同步冲突。

## 3. 保持定制改动隔离

同步是否轻松，取决于 AlfredGo 改了多少上游文件。DHS 是全插件架构（见 [docs/architecture.md](../../docs/architecture.md)），绝大多数定制都可以只新增文件来实现。按以下优先级选择实现方式：

1. **配置与组合**：新增 profile、bundle 或 `cordis.yml` overlay 来选择、配置和替换插件（机制见 [Profiles and bundles](../../docs/architecture.md#profiles-and-bundles)）。AlfredGo 的产品形态应当是“一个 AlfredGo profile + AlfredGo bundle”。
2. **新增插件或包**：新行为写成新插件，挂在已有扩展点上；包的命名与结构遵守根目录 `AGENTS.md` 的约定。
3. **上游通用改进**：如果缺的是一个通用扩展点或通用 bug 修复，优先向上游 DHS 提 PR，上游合并后随同步进来。
4. **直接修改上游文件**：最后手段。必须登记到 [PATCHES.md](../PATCHES.md)，在代码处加 `ALFREDGO:` 注释，改动保持最小，并在设计评审时说明为什么前三种方式不可行。

AlfredGo 自有的流程文档、脚本和台账放在仓库根目录的 `alfredgo/` 下，上游从不修改这里。

## 4. 从上游 DHS 同步

### 节奏

| 触发 | 做法 |
|:--|:--|
| 常规 | 每两周一次，同步到上游最近一个发布点（release tag 或 release 同步合并）；没有发布点时同步 `upstream/master` 当时的最新提交 |
| 上游安全修复或 AlfredGo 依赖的上游修复 | 随时单独同步 |
| 开始一个较大的特性之前 | 先同步，减少特性开发期间的漂移 |

每次同步在看板上建一张“上游同步”类型的卡片，走与特性相同的状态流转。

### 步骤

1. 在 `master` 最新状态下运行 `alfredgo/scripts/sync-upstream.sh [上游 ref]`。脚本会创建 `sync/upstream-<日期>` 分支、启用 rerere 并合并上游；它不会推送。
2. 解决冲突（见下文）。
3. 验证：`pnpm install`、`pnpm run typecheck`、`pnpm run build`，以及 AlfredGo 自己的验收检查（AlfredGo profile 能启动、AlfredGo 插件的测试和快照通过）。上游的完整测试矩阵由 CI 负责，本地按根目录 `AGENTS.md` 的“Run relevant checks locally”选择最小相关检查。
4. 推送并开 PR 到 `master`，PR 描述写明：同步的上游范围（起止 ref）、冲突文件与处理方式、上游的破坏性变更（查看上游 `docs/upgrade-guide/`）对 AlfredGo 的影响、`PATCHES.md` 的变化。
5. CI 通过、负责人评审后，用 **merge commit** 合并。

### 冲突处理

- 不在 `PATCHES.md` 中的文件：取上游版本。出现这类冲突通常说明台账漏登记了，处理完要补登。
- 在 `PATCHES.md` 中的文件：以上游版本为底，按台账重新应用 AlfredGo 的最小改动。
- `pnpm-lock.yaml`：不手工合并。取上游版本后运行 `pnpm install` 重新生成。
- 生成文件（catalog、snapshot 等）：取上游版本后重新运行对应生成器。
- 上游重构导致 AlfredGo 插件编译失败：在同步 PR 内修复 AlfredGo 代码，不要为了兼容而回退上游改动。
- 冲突规模超过半天工作量时：停下来，先在看板上开一张卡评估“把这处改动迁移到扩展点”或“回馈上游”，同步可以先跳过该段上游提交范围（合并较早的上游 ref），不要堆积长期冲突。

## 5. 特性生命周期

看板状态与关卡一一对应。每个关卡由负责人（目前是 Jian）做出明确决定，并把结论写在卡片上。

| 状态 | 进入条件（关卡） | 这一关决定什么 | 产出 |
|:--|:--|:--|:--|
| 提案 Proposed | 任何人提出想法 | — | 卡片：要解决的问题、目标用户、期望效果、优先级 |
| 方案设计 Design | **G1 立项**：负责人接受提案 | 做不做、优先级、范围边界（做什么、不做什么） | 指定负责人；必要时写设计文档 |
| 开发中 In dev | **G2 设计评审**通过 | 实现方式与扩展点、是否需要改上游文件（登记 `PATCHES.md`）、是否先向上游提 PR、对持久化数据和外部接口的影响、测试计划、验收标准 | 已评审的设计（卡片内或 `alfredgo/designs/AG-<编号>-<简述>.md`） |
| 测试中 Testing | **G3 代码评审**：PR 通过评审且 CI 通过 | 代码质量、测试覆盖、文档是否同步更新 | 合入 `master` 的 PR |
| 已完成 Done | **G4 验收**：在构建产物上按验收标准验证通过 | 是否达到设计时定下的验收标准，是否进入下一个版本 | 验收记录；随下一个版本发布 |

说明：

- 小改动（文案、明显 bug）可以在 G1 时由负责人决定跳过设计文档，直接进入开发，但仍要在卡片上写一句实现方式和验收标准。
- 设计文档至少包含：背景与目标、方案、涉及的扩展点或新增包、对上游文件的改动清单、测试计划（单元测试、快照测试、e2e）、验收标准、对后续上游同步的影响。
- 任一关卡未通过时，卡片退回上一状态，并在卡片上写明原因。
- 测试阶段发现的问题：小问题在原卡片上开修复 PR；独立问题新建“缺陷”类型卡片。

## 6. 发布与版本号

- 版本号格式：`<上游版本>-ag.<序号>`，例如基于上游 0.2.2 的第一个 AlfredGo 版本是 `0.2.2-ag.1`；同步到新的上游版本后序号从 1 重新开始。
- Git tag 使用 `alfredgo/v<版本号>`，例如 `alfredgo/v0.2.2-ag.1`，与上游 tag 不冲突。
- 发布前在 `release/<版本号>` 分支上做一次完整验收；发布后的紧急修复先合入 `master`，再 cherry-pick 到 release 分支。
- 打包、签名、分发渠道等具体发布方式在第一个需要发布的特性设计时确定，届时补充到本节。

## 7. Notion 看板与 GitHub 同步

看板是 Notion 中的“AlfredGo 开发看板”数据库，状态列为 提案 → 方案设计 → 开发中 → 测试中 → 已完成，属性包括类型（特性 / 上游同步 / 缺陷）、负责人、PR 链接和自动编号 ID（`AG-<编号>`）。

### 关联约定

- 每个 PR 都对应一张卡片；PR 标题以 ID 开头，例如 `AG-12: 支持 xxx`，分支名为 `feat/AG-12-xxx`。
- 卡片的 PR 链接属性填写 PR 地址。

### 状态同步规则

| GitHub 事件 | 看板变化 |
|:--|:--|
| 开出关联 PR（含草稿 PR） | 卡片移到“开发中”，填 PR 链接 |
| PR 合入 `master` | 卡片移到“测试中” |
| PR 关闭未合并 | 卡片退回“方案设计”，在卡片上写原因 |
| 验收通过 | 负责人手动移到“已完成” |

“已完成”和关卡 G1、G2 永远手动操作，因为它们是人的决定，不由 GitHub 事件触发。

### 同步方式

- **首选：Notion 自带的 GitHub 集成。** 在 Notion 中连接 GitHub 并授权 `API4ward/deepseek-harness` 后，可以给看板加一个“GitHub Pull Requests”属性，Notion 会按 PR 标题或分支名里的 `AG-<编号>` 自动关联 PR，并可配置“PR 开启 / 合并时更新状态”的自动化。这一步需要在 Notion 界面中由账号所有者完成授权。
- **备选：GitHub Action。** 若 Notion 集成不可用，可在仓库中新增一个监听 `pull_request` 事件的工作流，用 Notion API（仓库 secret `NOTION_TOKEN`）按上表更新卡片。工作流文件放在 `.github/workflows/alfredgo-*.yml`，属于 AlfredGo 新增文件，不影响上游同步。
- **过渡：由 Claude 维护。** 在上述自动化启用之前，由 Claude 在开 PR、合并 PR 时同步更新卡片。

## 8. 待确认事项

- 上游 DHS 的确切仓库地址：本文按 `deepseek-harness/deepseek-harness` 编写。
- AlfredGo 的产品形态（桌面端、Web、CLI 或 SDK），决定 AlfredGo profile 基于哪个上游 profile 构建。
- 发布渠道与签名方式（见第 6 节）。
