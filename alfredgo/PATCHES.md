# 上游文件修改台账

AlfredGo 应尽量通过新增文件（独立包、bundle、profile、cordis.yml overlay、插件）实现定制。确实需要修改上游已有文件时，必须在本表登记一行，并在代码中就近加注释标记 `ALFREDGO:`，以便同步上游时快速定位和重放改动。

同步上游出现冲突时，先查本表：不在本表中的文件一律以上游版本为准；在本表中的文件按“改动要点”重新应用最小改动。改动被上游吸收或不再需要时，删除对应行。

| 上游文件 | 看板 ID | 改动要点 | 为什么不能用扩展点实现 | 是否计划回馈上游 |
|:--|:--|:--|:--|:--|
| `tsconfig.host.json` | AG-2 | `references` 加入 `./packages/alfredgo/alfredgo-secret-guard` 和 `./packages/alfredgo/alfredgo-secret-approver` | 新包必须登记到恰好一个编译聚合，仓库没有按目录自动发现 | 否（AlfredGo 专有包） |
| `tsconfig.client.json` | AG-2 | `references` 加入 `./packages/alfredgo/alfredgo-client-secret-approver` | 客户端包必须登记到客户端编译聚合 | 否（AlfredGo 专有包） |
| `scripts/gen-cordis-catalog.ts` | AG-2 | `SERVICE_PAGE` 把 `secretApprover` 归到 `credentials.md`；`TYPE_LINK_EXEMPTIONS` 加入 `ApproverHostInfo`、`RelayCall`、`RelayReply`，文档归属 `packages/alfredgo/alfredgo-secret-approver/README.md` | 生成器要求每个服务方法引用的类型都登记文档归属，表在上游脚本里 | 否（AlfredGo 专有包） |
| `scripts/gen-doc-graphs.ts` | AG-2 | `SERVICE_ROLES` 加入 `secretApprover`（service，消费方 `alfredgo-client-secret-approver`） | 生成器要求每个服务都有角色分类，表在上游脚本里 | 否（AlfredGo 专有包） |
| `scripts/verify-package-readme-model-experience.ts` | AG-2 | `SENTENCE_MODEL_EXPERIENCE` 加入两个审批端包（`kind: 'none'`） | README 简短的模型体验写法需要在上游脚本里登记 | 否（AlfredGo 专有包） |
| `scripts/product-package-policy.ts` | AG-2 | `PRODUCT_PACKAGE_POLICY` 把三个 AlfredGo 包登记为 `optional` | 叠加配置加载的插件不在默认运行时里，需要在上游策略表登记 | 否（AlfredGo 专有包） |
| `docs/capability-seams.md`、`docs/capability-seams.zh.md`、`docs/capability-seams.i18n.yaml` | AG-2 | `secretApprover` 服务的图节点和表格行；中文页手工同步 | 生成的英文页和手工同步的中文页 | 否 |
| `tsconfig.base.json`、`pnpm-lock.yaml`、生成的目录文件（`docs/config-catalog*.md`、`docs/event-producer-consumer*.md`、`docs/module-graph*.md`、`docs/subsystems/credentials*.md` 的生成段、`dsh-doc` 包列表、`cordis-client-runner` 的 `slot-catalog.ts`、`tool-cordis` 的 `api-catalog.ts`） | AG-2 | 生成器为新包加入的条目 | 生成文件；同步上游时取上游版本后重新运行 `pnpm install`、`pnpm run gen-tsconfig-paths` 和对应生成器 | 否 |
| `tsconfig.host.json` | AG-3 | `references` 加入 `./packages/alfredgo/alfredgo-agent-group` 和 `./packages/alfredgo/alfredgo-tool-agent-group` | 新包必须登记到恰好一个编译聚合，仓库没有按目录自动发现 | 否（AlfredGo 专有包） |
| `tsconfig.client.json` | AG-3 | `references` 加入 `./packages/alfredgo/alfredgo-client-agent-group` | 客户端包必须登记到客户端编译聚合 | 否（AlfredGo 专有包） |
| `scripts/gen-cordis-catalog.ts` | AG-3 | `SERVICE_PAGE` 把 `agentGroups` 归到 `agent-team.md`；`TYPE_LINK_EXEMPTIONS` 加入 14 个 `AgentGroup*` 类型，文档归属 `packages/alfredgo/alfredgo-agent-group/README.md`。改动处有 `ALFREDGO:` 注释 | 生成器要求每个服务和服务方法引用的类型都登记文档归属，表在上游脚本里 | 否（AlfredGo 专有包） |
| `scripts/gen-doc-graphs.ts` | AG-3 | `SERVICE_ROLES` 加入 `agentGroups`（service，消费方 `alfredgo-tool-agent-group` 和 `alfredgo-client-agent-group`）。改动处有 `ALFREDGO:` 注释 | 生成器要求每个服务都有角色分类，表在上游脚本里 | 否（AlfredGo 专有包） |
| `scripts/verify-package-readme-model-experience.ts` | AG-3 | `SENTENCE_MODEL_EXPERIENCE` 加入 `alfredgo-client-agent-group`（`kind: 'indirect'`）。改动处有 `ALFREDGO:` 注释 | README 简短的模型体验写法需要在上游脚本里登记 | 否（AlfredGo 专有包） |
| `scripts/product-package-policy.ts` | AG-3 | `PRODUCT_PACKAGE_POLICY` 把三个组群包登记为 `optional`。改动处有 `ALFREDGO:` 注释 | 叠加配置加载的插件不在默认运行时里，需要在上游策略表登记 | 否（AlfredGo 专有包） |
| `docs/capability-seams.md`、`docs/capability-seams.zh.md`、`docs/capability-seams.i18n.yaml` | AG-3 | `agentGroups` 服务的图节点和表格行；中文页手工同步 | 生成的英文页和手工同步的中文页 | 否 |
| `tsconfig.base.json`、`pnpm-lock.yaml`、生成的目录文件（`docs/config-catalog*.md`、`docs/module-graph*.md`、`docs/subsystems/agent-team*.md` 的生成段、`dsh-doc` 包列表、`cordis-client-runner` 的 `slot-catalog.ts`、`tool-cordis` 的 `api-catalog.ts`） | AG-3 | 生成器为三个组群包加入的条目 | 生成文件；同步上游时取上游版本后重新运行 `pnpm install`、`pnpm run gen-tsconfig-paths` 和对应生成器 | 否 |
| `docs/persistence-catalog*.md`、`docs/persistence-catalog.i18n.yaml`、`docs/persistence-schema.json`（另新增 `docs/persistence-changes/2026-11-28-agent-group-message-source.*`） | AG-3 | 消息来源联合类型新增 `agent-group`（分派、汇报、成员变动通知），按上游规定登记持久化类型变更，决定为 `same-version` | 写入会话日志的消息必须带来源；来源类型目录和变更记录是上游要求的登记 | 否（AlfredGo 专有）。同步上游时目录取上游版本后运行 `pnpm run gen-persistence-catalog`；若上游新增了变更记录，按 `docs/cookbook/reviewing-persistence-type-changes.md` 的“Update an unaccepted record”用 `--update` 刷新本记录 |
