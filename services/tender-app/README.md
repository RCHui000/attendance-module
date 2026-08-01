# 招标公告反爬强度探测 MVP

这是依据 `PRD.md` 拓展出的第一版 MVP，当前重点不是完整采集公告，而是先判断目标公告站点的反爬强度，为后续采集策略选型提供证据。

## 功能

- 配置公告源 URL
- 手动触发反爬探测
- 每天自动执行一次低频探测
- 记录探测历史到 SQLite
- 输出反爬强度等级、证据、建议策略
- 提供一个极简后台页面

## 合规边界

本 MVP 只访问公开页面，不登录、不识别验证码、不破解签名、不绕过限制。遇到 `403`、`429`、验证码、访问受限等信号时，只记录并建议暂停或人工确认。

## 启动

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

打开：

```text
http://127.0.0.1:8000
```

## API

### 触发探测

```http
POST /api/probes/run
Content-Type: application/json

{
  "name": "深圳公共资源交易中心-建设工程公告",
  "url": "https://www.szggzy.com/jygg/list.html?id=jsgc"
}
```

### 查看历史

```http
GET /api/probes
```

## 强度等级

- `low`: 普通 HTTP 客户端可稳定访问，未发现明显限制
- `medium`: 存在 UA/Cookie/JS 等轻度限制，建议降频并保留人工确认
- `high`: 出现访问拒绝、验证码、WAF 或明显动态渲染依赖
- `blocked`: 明确 `403`、`429` 或验证码拦截，应暂停自动采集
