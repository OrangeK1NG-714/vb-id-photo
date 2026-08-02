# id-photo-miniprogram 架构

## 产品与边界

- 产品是国内微信生态的一次性付费证件照工具：换底、克制精修、规格裁切和付费高清导出。
- 不改变五官，不承诺通过机构审核；MVP 不开放 MCP，也不改成订阅或纯前端产品。
- `miniprogram/app.js` 与三组 `Page` 是原生小程序入口；`server/index.js` 是 Node/Express 组合与生命周期入口。
- Node 服务保有 Sharp、人像分割、文件、订单和微信支付专用运行时；Go 目前只做代理和脱敏聚合。

## 目录职责

- **delivery**：`miniprogram/pages/`、WXML/WXSS 负责用户交互；`server/app.js` 负责 HTTP、上传、限流、鉴权和错误映射。
- **application**：`application/processOrder.js` 通过图像、订单和文件端口编排处理订单事务；`paymentService.js` 编排支付状态；`imageProcessor.js` 当前编排图像流水线；`cleanup.js` 编排隐私清理。
- **domain**：`sizes.js`、`faceCrop.js`、`validation.js` 及订单状态迁移规则；规则应保持纯函数并以后端为权威。
- **adapter**：`orderStore.js`、`fileStore.js`、`wxpay.js`、`faceDetector.js`、分割 HTTP/Sharp、`metricsReporter.js`。
- **composition**：`server/index.js` + `server/config.js` 创建并注入各服务；`miniprogram/config.js` 选择 develop/trial/release 地址。
- 前端 `utils/request.js` 只做传输适配，`utils/sizes.js` 是展示镜像而非导出权威。

## 依赖方向

- 允许方向为 `delivery -> application -> domain`；adapter 实现内层端口；composition 组装具体实现。
- 页面不持有支付可信状态、下载授权或供应商密钥；最终订单与导出尺寸只认服务端。
- application 不依赖 Express 请求/响应；领域规则不依赖 Sharp、SQLite、文件系统、微信或网络。
- 新接口先在 application 定义用例，再在 `server/app.js` 暴露；新供应商只作为可替换 adapter 接入。
- 尺寸、价格等跨端镜像必须有契约测试，禁止只改小程序或只改服务端。

## 禁止事项

- 不得加入瘦脸、大眼、改脸型、换表情或“保证过审”文案，不得恢复已砍掉的 MCP。
- 不得在小程序包中放支付、人像分割、对象存储或内部统计凭据。
- 不得在生产启用 mock 支付，或把未配置人像分割/检测的降级结果描述为真实验证。
- 不得在真实支付验收前删除 Node 实现或把支付编排迁走；真实支付、提审、上传、发布和凭据使用均需 Human 确认。

## 当前迁移热点

- `server/app.js`（约 286 行）仍混合安全中间件、支付/下载路由、运维接口和响应模型；处理订单编排与文件回滚已迁入独立应用用例，原子 rename 失败也会清除私密 `.tmp`。
- `pages/result/result.js`（约 246 行）混合订单恢复、支付轮询、下载与 UI 状态；应先抽页面级 application controller。
- `wxpay.js`（约 173 行）与 `imageProcessor.js`（约 166 行）应保持专用 adapter/流水线边界。
- `orderStore.js`（约 153 行）混合状态机与 SQLite；先抽纯迁移规则，再为存储定义端口。
- 迁移顺序：保持现有 smoke/API 契约，下一批抽支付确认与下载授权，再抽订单/规格领域规则并继续包装 Sharp/微信/文件/SQLite adapter。
- 只有真实支付与真实人像服务通过后，才评估将订单能力逐片迁入 Go；任何阶段都保留可回滚路径。

## 验证

- 服务端质量门禁：在 `server/` 运行 `npm run check`。
- 完整本地模拟链路：在 `server/` 显式开发配置后运行 `npm run smoke`。
- 小程序在微信开发者工具走通首页、编辑、结果、恢复和保存，并核对后端权威尺寸。
- mock、开发降级和本地 smoke 均不等于真实支付、人像服务或正式发布验收。
