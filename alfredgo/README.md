# AlfredGo

AlfredGo 是基于上游 DeepSeek Harness（下称 DHS）制作的特殊版本 agent 客户端。本目录只存放 AlfredGo 自有的流程文档、脚本和台账；上游 DHS 从不修改这个目录，因此它不会在同步上游时产生冲突。

| 文件 | 用途 |
|:--|:--|
| [docs/development-process.md](docs/development-process.md) | 开发流程：上游同步、分支策略、特性生命周期、看板与 GitHub 的同步 |
| [PATCHES.md](PATCHES.md) | 对上游文件的修改台账，每次同步上游时据此处理冲突 |
| [scripts/sync-upstream.sh](scripts/sync-upstream.sh) | 创建上游同步分支并合并上游的辅助脚本 |

仓库其余部分的约定（`AGENTS.md`、`docs/`、各包 README）仍以上游为准；AlfredGo 新增的代码同样遵守这些约定，以便必要时把通用改动回馈上游。
