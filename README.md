# 工时统计模块

项目核算与工时审批系统，用于项目工时填报、项目块审批、项目/员工主数据维护、权限配置和经营数据看板。

## 常用入口

| 类型 | 文档 |
| --- | --- |
| 产品规格 | [PRD.md](PRD.md) |
| 产品定位 | [docs/product/PRODUCT.md](docs/product/PRODUCT.md) |
| 用户说明 | [docs/product/USER_GUIDE.md](docs/product/USER_GUIDE.md) |
| 设计系统 | [DESIGN.md](DESIGN.md) |
| 云端发布与运维 | [docs/ops/RELEASE_RUNBOOK.md](docs/ops/RELEASE_RUNBOOK.md) |
| NAS / 本地部署补充 | [docs/ops/NAS_DEPLOYMENT.md](docs/ops/NAS_DEPLOYMENT.md) |
| 账号安全检查 | [docs/ops/ACCOUNT_SECURITY_RUNBOOK.md](docs/ops/ACCOUNT_SECURITY_RUNBOOK.md) |
| 审批与数据库架构整理 | [docs/architecture/APPROVAL_ARCHITECTURE.md](docs/architecture/APPROVAL_ARCHITECTURE.md) |

## 代码结构

| 路径 | 说明 |
| --- | --- |
| `frontend/` | React + TypeScript + Vite 前端 |
| `frontend/src/` | 页面、组件、hooks、API wrapper 与类型 |
| `supabase-psa/` | Supabase 运行栈、SQL migrations 与权限清单 |
| `deploy/` | 云端部署、备份、检查脚本 |
| `ops/` | 运维配置，例如反向代理 profile |
| `scripts/` | 数据库审计、冒烟测试和辅助脚本 |

## 日常开发

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
```

发布前至少运行：

```powershell
git diff --check
npm --prefix frontend run build
```

审批、函数权限或数据库迁移相关改动，还需要按 [docs/ops/RELEASE_RUNBOOK.md](docs/ops/RELEASE_RUNBOOK.md) 运行对应 SQL 检查和冒烟测试。

## 文档约定

根目录只保留项目入口和少数长期权威文档。过程计划、旧部署说明和历史审计记录统一放在 [docs/archive](docs/archive)。新文档优先放入：

- `docs/product/`
- `docs/ops/`
- `docs/architecture/`

`frontend/src/**/README.md` 是代码旁模块地图，保留在对应模块目录中。
