# 后端部署说明

## 发布前输入

- 一个已备案/可用于小程序请求域名的 HTTPS 域名，例如 `https://photo.example.com`。
- 微信小程序 AppID/Secret、微信支付商户号、API v3 密钥、商户私钥、平台证书和通知地址。
- 国内人像分割服务地址与密钥。未配置时生产进程会拒绝启动。
- 至少 32 字节随机 `DOWNLOAD_SECRET`。

完整变量见 `server/.env.example`。生产必须设置 `NODE_ENV=production`、`ALLOW_MOCK_PAYMENTS=false`，且 `PUBLIC_BASE_URL` 与微信支付通知地址都使用 HTTPS。

## 容器运行

```bash
docker build -t id-photo-server:local server
docker run --rm -p 3000:3000 \
  --env-file /secure/path/id-photo.env \
  -v id-photo-data:/app/data \
  -v id-photo-storage:/app/storage \
  -v /secure/path/cert:/app/cert:ro \
  id-photo-server:local
```

`/app/data` 保存 `orders.sqlite`，`/app/storage` 保存两小时内的预览和付费文件，两者都必须挂载持久卷。证书目录只读挂载，不能打进镜像或提交 Git。

## 反向代理

- 将公网 HTTPS 转发到容器 `3000` 端口。
- 请求体上限至少 `12 MB`，高于服务端默认 `10 MB` 文件限制。
- 不缓存 `/api/**`；预览文件最多短时缓存，受保护文件由带令牌的 API 返回并设置 `no-store`。
- 将 `/health` 配为健康检查，正常响应为 `{"ok":true,"database":"ok","storage":"ok"}`。

## 运维

- 日志重点关注 `INTERNAL_ERROR`、`PAY_NOTIFY_INVALID`、`PAY_NOTIFY_MISMATCH`、`cleanup`。
- 每日备份 `/app/data/orders.sqlite` 及其 WAL 文件；恢复时先停止容器，再整体恢复数据库文件。
- 图片按默认两小时策略自动删除，不应纳入长期备份。
- 升级前保留上一镜像标签；健康检查或真实支付回归失败时，切回上一镜像并保持同一数据卷。

## 验证顺序

1. `cd server && npm run check`
2. `cd server && npm run smoke`（只验证显式开发 mock，不代表真实支付）
3. 生产环境启动后检查 `/health`
4. 使用真实人像测试抠图、单人脸/多人脸边界和头部裁切
5. 使用微信支付沙箱/小额真实订单验证下单、回调、重启恢复和重复回调
