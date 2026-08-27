# Friends 注册登录版部署配置

朋友版默认使用服务器本地 SQLite 保存账号与 Session，并使用服务器持久目录保存每个账号的增量云备份。普通用户打开链接即可注册，不需要配置 Supabase，也不需要自行填写云存储密钥。

## 1. 公开源码

部署版本的对应源码发布在：

```text
https://github.com/afufu/float-friends
```

仓库必须保留 `LICENSE`、`NOTICE` 和原作者版权信息。每次部署修改后的版本前，应先将对应提交推送到公开仓库。

## 2. 服务端环境变量

Docker Compose 会把持久卷挂载到 `/data`。服务器 `.env` 至少配置：

```env
NEXT_PUBLIC_SOURCE_CODE_URL=https://github.com/afufu/float-friends
ACCOUNT_GATE_SECRET=<至少 32 字节的随机密钥>
NEXT_PUBLIC_OPEN_REGISTRATION=true
OPEN_REGISTRATION=true
FLOAT_BIND_ADDRESS=127.0.0.1
FLOAT_PORT=3100
```

可使用 `openssl rand -hex 32` 生成 `ACCOUNT_GATE_SECRET`。该密钥不得添加 `NEXT_PUBLIC_` 前缀，也不得提交到 Git。

容器内固定使用：

```env
ACCOUNT_SQLITE_PATH=/data/accounts/accounts.sqlite
ACCOUNT_STORAGE_ROOT=/data/storage
```

## 3. 注册与登录

- 用户名不存在时，“登录 / 注册”会创建账号并登录。
- 用户名已存在时，使用密码登录。
- 密码采用 PBKDF2-SHA256 加盐哈希保存。
- Session Token 只保存在 HttpOnly Cookie，服务端只保存 Token 哈希。
- 生产环境 Cookie 启用 `Secure`，必须通过 HTTPS 域名访问。

如需改回邀请码制，将 `NEXT_PUBLIC_OPEN_REGISTRATION` 和 `OPEN_REGISTRATION` 设为 `false`，再在 SQLite 的 `activation_codes` 表写入邀请码。

## 4. 账号云备份

- 登录账号会自动启用每小时增量备份，默认保留 3 个健康版本。
- 对象写入 `/data/storage/<accountId>/`，路径由服务端 Session 决定，浏览器不能指定其他账号。
- 新设备首次登录会自动检测并恢复最新健康备份。
- 同一浏览器切换账号时会先清理上一账号本地数据，再恢复当前账号备份。
- 数据管理页保留“立即备份”和“云端恢复”入口。

## 5. 并行部署

```bash
./scripts/deploy-friends.sh
```

部署使用独立目录 `/root/float-friends`、Compose 项目 `float-friends`、数据卷 `float-friends_float_data` 和宿主端口 `3100`。不会停止或覆盖 momo 的容器、PostgreSQL、静态目录或发布备份。

首次部署可由现有 Caddy 将 HTTPS 二级域名反向代理到 Docker 网络中的 `float-friends:3000`。

## 6. 验收

1. 未登录访问首页时只显示账号、密码和“登录 / 注册”。
2. 新用户名可以注册，已有用户名只能使用正确密码登录。
3. 退出后 Session 失效，账号存储 API 返回 401。
4. 账号 A 上传的对象，账号 B 无法列出或下载。
5. 非法路径和超过 41MB 的单个对象被拒绝。
6. 新浏览器登录同一账号可恢复云端数据。
7. “关于与声明”可以打开对应源码和 AGPL 许可证。
8. 部署前后 `https://sbtitest.asia/` 均保持健康。
