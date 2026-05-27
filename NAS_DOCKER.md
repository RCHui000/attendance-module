# 考勤统计模块 NAS 部署说明

## 访问地址

```text
http://192.168.2.100:8767
```

## NAS 部署目录

```text
/vol1/@team/个人工作文件/惠若超/attendance-module
```

## Docker Compose

已准备 `Dockerfile`、`docker-compose.yml` 和 `.dockerignore`。Docker 权限恢复后，在 NAS 执行：

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
docker compose up -d --build
```

容器名：

```text
attendance-module
```

持久化数据库：

```text
./data/attendance_demo.sqlite3
```

## 当前临时运行方式

当前 SSH 用户暂时没有 `/var/run/docker.sock` 访问权限，`sudo` 需要密码，因此 Docker 尚未启动。为了先给局域网用户反馈迭代，NAS 上已用项目内 `.venv` 临时运行：

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
nohup env ATTENDANCE_HOST=0.0.0.0 ATTENDANCE_PORT=8767 ATTENDANCE_DB_PATH=/vol1/@team/个人工作文件/惠若超/attendance-module/data/attendance_demo.sqlite3 .venv/bin/python app.py > attendance-module.log 2>&1 &
```

查看进程：

```bash
ps aux | grep -F 'attendance-module' | grep -v grep
```

查看日志：

```bash
tail -50 /vol1/@team/个人工作文件/惠若超/attendance-module/attendance-module.log
```

切换到 Docker 前，先停止临时进程：

```bash
pkill -f '/vol1/@team/个人工作文件/惠若超/attendance-module/.venv/bin/python app.py'
```

## Docker 权限待处理

当前现象：

```text
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

需要 NAS 管理员将 SSH 用户加入 `docker` 组，或开放可用的 sudo/Container Manager 权限后再执行 compose 启动。
