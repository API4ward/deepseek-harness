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
