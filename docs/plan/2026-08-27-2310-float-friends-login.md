# Float Friends 登录版计划

## 用户需求

- 将 Float 作为独立作品提供给朋友使用，不与闭源 momo/monoOS 代码融合。
- 启用账号登录，让朋友通过用户名、密码和首次激活码进入产品。
- 朋友版保留 Float 的 AGPL-3.0 许可证与对应源码入口。
- 最终部署需要可公开访问的域名、Supabase 账号数据库与服务端环境变量。

## 已确认事实

- 当前基线为 `afufu/ai-virtual-phone` 的 `main@66d8b6b218cce853ba11190afc95acbf3c648894`。
- 项目已经实现登录、首次激活、Session Cookie、退出、修改密码、账号停用和登录失败限流。
- 登录依赖 Supabase 的 `app_users`、`activation_codes`、`app_sessions` 等表以及服务端密钥。
- 登录目前是访问门禁。角色、聊天、设置和大部分创作数据仍以浏览器本地 IndexedDB/localStorage 为事实源。
- 不同朋友使用不同设备或浏览器 Profile 时数据天然隔离；同一浏览器切换账号不能保证数据隔离，也不提供跨设备恢复。

## 关键决策

1. 朋友版使用独立目录 `/Users/hello/Documents/float-friends`，保留上游 Git 历史，不修改 momo 仓库。
2. 本阶段不重写账号系统，直接启用现有 Supabase 账号门禁，以最小改动尽快获得可用版本。
3. `NEXT_PUBLIC_SELF_HOSTED_MODE=false` 是登录版硬要求。
4. `SUPABASE_SERVICE_ROLE_KEY`、`ACCOUNT_GATE_SECRET`、管理密钥和第三方 API Key 只能存在部署平台或本地 `.env.local`，不得提交到 Git。
5. 上线前必须保留 AGPL、版权声明、第三方 NOTICE，并向远程用户提供对应部署版本源码入口。
6. 不将当前本地存储描述为云同步或多账号隔离；后续若需要同设备多账号或跨设备同步，另立里程碑重构存储命名空间和云备份。

## 执行阶段

### 阶段 1：本地基线

- 安装依赖并完成生产构建。
- 校验 `.env.example`、账号 API、SQL 初始化脚本和登录页。
- 确认未配置 Supabase 时错误信息明确，不泄露服务端密钥。

### 阶段 2：登录环境

- 获取朋友版 Supabase 项目的 URL 与 `service_role` key。
- 执行 `docs/account-supabase.sql`。
- 生成独立 `ACCOUNT_GATE_SECRET`，配置朋友版环境变量。
- 创建首批一次性激活码并验证注册、登录、退出和改密码。

### 阶段 3：部署验收

- 在独立域名部署，不使用 momo 正式生产站点。
- 验证 HTTPS、Secure Cookie、登录限流和禁用账号。
- 用两个浏览器 Profile 验证两个账号可以分别登录。
- 明确提示本地数据仅保存在当前浏览器。
- 在界面或关于页提供 AGPL、NOTICE 和对应源码链接。

## 验收标准

- 未登录用户不能进入手机桌面。
- 新账号必须使用有效且未使用的激活码。
- 已激活账号可用用户名和密码再次登录。
- Session Cookie 为 HttpOnly，生产环境启用 Secure。
- 退出后服务端 Session 失效。
- 错误密码触发限流，停用账号无法登录。
- 不同设备或浏览器 Profile 的本地角色与聊天互不影响。
- 页面明确说明本地数据不会因登录自动跨设备同步。
- 对应部署版本源码可以由远程用户免费获取。

## 当前阻塞项

- 尚未提供朋友版 Supabase 项目凭据。
- 尚未确定部署平台和公开域名。

## 2026-08-27 执行记录

- 已建立独立稳定目录并保留上游 Git 历史。
- 已完成依赖安装、生产构建和 TypeScript 检查。
- 已在登录页增加本地数据与备份提示。
- 已在“关于与声明”增加对应版本源码和 AGPL 许可证入口。
- 已补充 `docs/friends-login-setup.md`，包含 Supabase 初始化、环境变量、邀请码和验收步骤。
- 已用桌面与 390px 手机视口验证登录页，未发现溢出或遮挡。
- 已验证“关于与声明”的源码与许可证链接可见且可访问。
- 全量 `npm run lint` 仍有上游既有错误；本次修改的两个 TSX 文件定向 lint 通过。
