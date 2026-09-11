# 海外做市控制台部署

2026-09-11 部署至 https://console.xianluobi.com ，VIKHOST 185.225.226.95。同日从旧服务器 `120.55.62.13` 完成正式迁移。

## 运行方式

- 前端为 `market-maker-console/dist/client` 生产静态文件；同源 `/api/` 由 Nginx 转发至本机 8788，SSE 禁止代理缓冲。
- 独立系统用户 `siam-console`、systemd 服务 `siam-console.service`，开机启动及故障重启。
- 代码 `/opt/siam-console/releases/20260911-live-release`；`/opt/siam-console/current` 指向该版本。
- 环境 `/etc/siam-console.env`，权限 600；数据库 `/var/lib/siam-console/maker.sqlite`。
- Node 24.21.0，复用服务器 `/opt/node`；安装根目录锁定依赖和 vendored bigint-buffer，不执行安装脚本。
- Nginx `/etc/nginx/sites-available/siam-console`；DNS `console A 185.225.226.95`，TTL 10800。
- Let's Encrypt HTTPS，首次证书到期 2026-12-10；certbot.timer 自动续期。
- 主站 xianluobi.com 的质押体验产品仍使用独立服务和数据库。

## 数据与操作范围

生产实例为 `MAKER_MODE=live`，保持未暂停并通过执行就绪检查。管理员令牌只存在于 root 所有、权限 600 的 `/etc/siam-console.env`，不进入仓库；服务器没有助记词、私钥或 keypair。交易仍采用服务端生成意图、外部签名、服务端校验后广播的边界。

旧站 SQLite 账本通过在线 `VACUUM INTO` 一致性快照迁入；切换时校验结果为 `integrity_check=ok`，包含 12 张表和 43,103 条历史快照。旧服务器的两个 AutoTrade 容器已停止并移除，原目录移至仅用户可访问的 `/home/ttp/retired/agent-trade-20260911-2049`，可在回滚获准时恢复。旧服务器上 root 所有的 Tengine 虚拟主机配置仍是无内容、无后端的惰性条目，需由该服务器管理员账户清理。

主 RPC 使用 PublicNode；全量持币索引使用 Solana 官方公共 RPC。迁移后实测全量扫描成功，433 owners / 434 正余额 Token Accounts，覆盖供应量 100%。公共 RPC 后续可能限流，接口会保留最近成功数据并标注 stale；无生产 SLA。盈利仅代表本实例已索引主池交易窗口内的估计值，不是全历史盈亏。活动索引是近期主池轮询，不保证全链所有代币操作无遗漏。

设置 `MAKER_TRUST_LOOPBACK_PROXY=true` 后，只信任本机代理覆盖的单个有效 X-Forwarded-For IP，避免所有访客共用一个限流桶。公网后端端口不开放，Nginx 覆盖请求传入的转发头。

## 验证与运维

- 后端 38 项测试、前端 6 项测试、生产构建和依赖缓解检查通过。
- 新实例健康状态 `ready`，`live`、`paused=false`、`executionReady=true`；快照、持币地址、活动及流动性已获得主网数据。
- 数据库在服务重启后保留；初始一致性备份 `/var/backups/siam-console/initial-deployment.sqlite`，仅为同机备份。
- 观察版切换前的环境和数据库保存在 `/var/backups/siam-console/pre-live-migration-20260911/`。

```sh
systemctl status siam-console nginx
journalctl -u siam-console -n 100 --no-pager
curl http://127.0.0.1:8788/api/health
sqlite3 /var/lib/siam-console/maker.sqlite 'PRAGMA integrity_check;'
certbot renew --cert-name console.xianluobi.com --dry-run --no-random-sleep-on-renew
```

更新前测试并构建，只传白名单代码/产物到新 release；安装根依赖时使用 `npm ci --omit=dev --ignore-scripts`。保留数据库和环境文件，切换 current 后重启；不要直接打包整个工作目录或迁入钱包目录。
