# 上游文件修改台账

AlfredGo 应尽量通过新增文件（独立包、bundle、profile、cordis.yml overlay、插件）实现定制。确实需要修改上游已有文件时，必须在本表登记一行，并在代码中就近加注释标记 `ALFREDGO:`，以便同步上游时快速定位和重放改动。

同步上游出现冲突时，先查本表：不在本表中的文件一律以上游版本为准；在本表中的文件按“改动要点”重新应用最小改动。改动被上游吸收或不再需要时，删除对应行。

| 上游文件 | 看板 ID | 改动要点 | 为什么不能用扩展点实现 | 是否计划回馈上游 |
|:--|:--|:--|:--|:--|
| `tsconfig.host.json` | AG-2 | `references` 加入 `./packages/alfredgo/alfredgo-secret-guard` | 新包必须登记到恰好一个编译聚合，仓库没有按目录自动发现 | 否（AlfredGo 专有包） |
| `tsconfig.base.json`、`pnpm-lock.yaml`、生成的目录文件（`docs/config-catalog*.md`、`docs/event-producer-consumer*.md`、`dsh-doc` 包列表） | AG-2 | 生成器为新包加入的条目 | 生成文件；同步上游时取上游版本后重新运行 `pnpm install`、`pnpm run gen-tsconfig-paths` 和对应生成器 | 否 |
