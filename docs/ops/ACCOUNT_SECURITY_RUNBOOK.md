# 账号安全整理 Runbook

## 目标

上线前完成管理员账号收敛、弱密码清理、默认密码策略确认，避免生产系统暴露在“简单账号 + 简单密码”的风险下。

## 管理员账号盘点

上线前列出所有 `admin` 角色账号：

```sql
select
  e.id,
  e.name,
  e.employee_no,
  p.login_name,
  ur.role
from employees e
join user_roles ur on ur.employee_id = e.id
left join profiles p on p.employee_id = e.id
where ur.role = 'admin'
order by e.id;
```

重点检查：

- `admin`
- `鞠松松`
- 其他临时管理员或测试管理员

## 权限收敛

- [ ] 确认每个 admin 是否确实需要管理权限
- [ ] 不需要 admin 的账号降为 `manager` 或 `employee`
- [ ] 禁止共用管理员账号
- [ ] 管理员账号必须绑定真实责任人

## 密码策略

- [ ] 上线前重置全部管理员密码
- [ ] 禁止 `123456`、姓名拼音、手机号后 6 位等弱密码
- [ ] `DEFAULT_INITIAL_PASSWORD` 只用于新增员工首次登录
- [ ] 新增账号后要求线下交付初始密码并尽快修改
- [ ] 不在 Git、文档、聊天记录中记录真实密码

## 上线前操作建议

1. 用生产 `.env` 设置强 `DEFAULT_INITIAL_PASSWORD`。
2. 重置 admin 账号密码。
3. 使用管理员登录验证。
4. 创建一个普通测试员工账号。
5. 验证普通员工无法访问管理页面。
6. 验证离职/停用账号无法登录。

## 留痕

记录以下信息到运维私有文档，不提交 Git：

- 管理员账号清单
- 密码重置日期
- 操作人
- 测试账号用途
- 下次复查日期
