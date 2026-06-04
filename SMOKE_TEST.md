# Smoke Test

## 基础访问
- [ ] 首页可以打开
- [ ] 登录页面可以打开
- [ ] HTTP 可访问
- [ ] HTTPS 可访问
- [ ] HTTP 自动跳转 HTTPS
- [ ] 刷新 `/dashboard` 不返回 404
- [ ] 刷新 `/timesheet` 不返回 404
- [ ] `GET /healthz` 返回 `ok`
- [ ] `/auth/` 代理 GoTrue 正常
- [ ] `/rest/` 代理 PostgREST 正常
- [ ] `/realtime/` WebSocket 可连接

## 登录与会话
- [ ] admin 可以登录
- [ ] 普通用户可以登录
- [ ] 刷新页面不丢登录状态
- [ ] 退出登录后无法访问受保护页面
- [ ] 登录失败时错误提示正常

## 周表
- [ ] 普通用户可以打开“我的周表”
- [ ] 可以保存草稿
- [ ] 可以提交审批
- [ ] 周表项目行显示正常
- [ ] 加班记录可以填写

## 审批
- [ ] 审批流可以创建
- [ ] 审批人可以看到任务
- [ ] 项目负责人审批任务显示正常
- [ ] 部门汇总审批任务显示正常
- [ ] 审批可以通过
- [ ] 审批可以拒绝
- [ ] 拒绝意见可以查看

## 数据看板 / 报表
- [ ] Dashboard 总览可以渲染
- [ ] Dashboard 分析页可以渲染
- [ ] BI 项目视角可以切换
- [ ] BI 部门视角可以切换
- [ ] BI 人员视角可以切换
- [ ] 项目列表可以打开
- [ ] 项目明细可以打开
- [ ] 报表导出可以下载

## Realtime / Adaptive Approval Graph
- [ ] Realtime 连接正常
- [ ] 提交审批后审批中心自动刷新或可快速刷新看到
- [ ] Adaptive Approval Graph 相关结构数据正常生成
- [ ] 审批事件审计记录正常落库

## 兼容与运维
- [ ] 手机浏览器访问正常
- [ ] Nginx 日志可查看
- [ ] 应用容器日志可查看
- [ ] PostgREST 日志可查看
- [ ] GoTrue 日志可查看
- [ ] Realtime 日志可查看
- [ ] 数据库备份脚本可运行
- [ ] Playwright 生产冒烟测试可运行：

```bash
E2E_BASE_URL=https://your-domain.com npm --prefix frontend run test:e2e:prod
```
