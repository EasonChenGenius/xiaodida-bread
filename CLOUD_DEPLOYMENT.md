# 校递达 V0.9.0 云托管历史说明

> 本文记录 2026-11-06 的 CloudBase、微信小程序和容器适配方案，不是 2026-11-08 阿里云原生 Node.js＋MySQL＋systemd 网站试用的部署说明。当前状态及待验收项请阅读 [阿里云受限试用部署](ALIYUN_TRIAL_DEPLOYMENT.md)。两套环境变量、身份模式和发布流程不得混用。

2026-11-06。本版完成代码适配和本地验证，尚未部署、连接真实 MySQL、验证真实微信身份或完成真机验收。

## 已准备的内容

- Node 24 容器，默认监听 0.0.0.0:8080，读取平台 PORT；GET /healthz 会检查数据库可用性。
- MySQL mysql2 驱动和锁定依赖。连接现有业务库，创建 InnoDB app_state 表，不创建库、不修改账号或系统配置。
- 每次请求读取数据库；写入使用 SELECT FOR UPDATE、修订号与事务。小范围试用使用单行 JSON 快照，保留现有领域规则；写操作串行化，大规模多商家运营前需拆分表、增加审计与容量验证。
- 登录会话仅保存 token 哈希，8小时过期，重新登录撤销旧会话；重启与多实例共享数据库后继续识别，退出立即撤销。
- 小程序支持 wx.cloud.callContainer。日常本机 config.js 继续使用 localhost；构建出的独立小程序目录采用云配置、正式 AppID、开启域名检查。
- 新空云库仅初始化44款商品和分类，不导入本机客户、订单、绑定关系或会话；过敏原仍为待补充。
- 订阅通知在订单提交后尝试；不确定的发送结果不自动重发。若记录停在 sending，须人工核对，不能按已送达处理。站内通知始终保留。

## 部署前由本人在后台核实

交接提供的目标是环境 prod-d5gtomp65b7b0a7f3、服务 express-h9fr、业务库 xiaodida。它们尚未在本轮通过后台重新核验，不能把示例 Express 服务正常视为本系统已部署。

1. 确认当前小程序为 wx320e88ba073a356b，并有现有云环境的调用权限。开发者工具旧窗口参数仍曾显示测试 AppID，应以项目详情核对并重新导入发布目录。
2. 确认 xiaodida 已存在；核对实际内网地址、费用、配额和数据库备份计划。维持公网数据库访问关闭。部署前保留现有线上版本和云数据库快照。
3. 在后台使用受限业务账号。运行时自动建 app_state 表需要本业务库 CREATE、SELECT、INSERT、UPDATE 权限，不能因此直接使用或公开数据库管理员账号。若权限范围需要变化，由本人确认。
4. 确认实际服务容器端口为8080，或将 PORT 设置成服务约定端口；配置健康检查 /healthz。保持现有实例与费用配置，不自动升级套餐。

## 私密环境变量

仅本人在云托管后台填写，不放在代码、发布包或聊天：

- NODE_ENV=production、BREAD_AUTH_MODE=wechat、BREAD_STORE=mysql、BREAD_HOST=0.0.0.0、PORT=8080。
- MYSQL_HOST、MYSQL_PORT=3306、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE=xiaodida。
- WECHAT_APP_ID=wx320e88ba073a356b、WECHAT_APP_SECRET。
- 已核验且不同的 WECHAT_MERCHANT_OPENID、WECHAT_COURIER_OPENID。
- WECHAT_ALLOW_UNASSIGNED_OPERATORS=false；订阅模板未获批时不填 WECHAT_DELIVERY_TEMPLATES，只提供站内消息。

## 受控核验管理人员身份

先在正确 AppID 的开发者工具中通过 wx.login 取得本人新鲜 code，在本机终端运行 npm run identity:inspect。脚本从私密后端环境读取 AppID/AppSecret，通过标准输入读取 code，只把 OpenID 写入 data/operator-identity.json（0600权限，不覆盖），不自动授权任何账号。分别为商家和配送员指定不同输出文件。本人核对后在云托管后端配置允许名单，再首次登录。

不要在未配置允许名单时让未来商家先按客户注册；现有客户身份升级和管理人员替换需要受控迁移，本版会拒绝隐式升级。WECHAT_ALLOW_UNASSIGNED_OPERATORS=true 只用于明确的身份核验阶段，首次登录仍是客户，不能通过正式发布检查。

## 构建与部署

运行 npm ci --ignore-scripts、npm test、npm run build:release。输出目录中：

- backend/：上传到现有服务的容器源码，Dockerfile位于此目录；不上传整个原项目。
- miniprogram/：用微信开发者工具作为独立项目导入的云端版本；没有本机私有工具配置。
- MANIFEST.json：文件清单与SHA-256，标注 prepared-not-deployed。

在上传前再次核对 config.js 的环境和服务名。按现有服务后台支持的源码构建方式部署 backend/；配置上面的私密变量并核对端口和回退版本。部署步骤不等于公开发布小程序。更改费用、协议、权限或正式发布需本人核实。

## 验收证据

1. /healthz 返回 service=xiaodida、version=0.9.0、mode=wechat、storage=mysql；业务接口 /api/config 返回 version=0.9.0。不能仅检查模板欢迎页。
2. 两个客户、商家和配送员使用真实微信登录；核对角色隔离，客户不能伪造角色。
3. 绑定确认→多款建单→备货→取货→送达→签收→可选评价；取消确认不推进，异常冻结并留下处理记录。
4. 重新部署后订单、登录态仍可用；重复建单只生成一单。真实MySQL多实例并发、连接失败和回滚另行验收；本地模拟MySQL测试不是云数据库验收。
5. 在隔离恢复库完成数据库恢复、字段与记录数核对；不得用正式库演练覆盖恢复。
6. 真机弱网、前后台切换、会话过期、重新登录、消息拒绝订阅与发送失败。手机不能使用电脑 localhost。
7. 核对备案、服务类目、隐私、联系渠道、体验成员和审核结果，先设体验版。当前服务无线上支付。

官方参考（本轮核验）：https://docs.cloudbase.net/run/develop/access/mini 与 https://docs.cloudbase.net/run/quick-start/introduce 。callContainer 的环境关联和服务权限仍须按实际后台核验。

## 当前阻断

电脑控制工具在云托管网址终止了浏览器自动操作，不能绕过限制。因此本轮尚未核验该控制台中的库、服务版本、费用、权限和环境变量。真实MySQL、容器构建、真实微信登录、真机和微信发布均需要后续实测。
