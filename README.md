# CF-XUI Helper

一键部署 3x-ui + Cloudflare Worker 订阅生成器，支持 VLESS/Trojan/VMess。

## 功能

- **3x-ui 节点管理** — 自动在 3x-ui 数据库创建 VLESS/Trojan/VMess 入站节点
- **Cloudflare 配置** — DNS A 记录、SSL Flexible、Origin Rules 路径转发
- **Worker 订阅生成** — 自动部署 Cloudflare Worker 并提供订阅链接
- **KV 节点管理** — 可选创建 KV namespace，自定义节点列表（域名或IP）
- **一键卸载** — 清理所有配置，恢复到部署前状态

## 前置要求

- VPS 已安装 **3x-ui**（x-ui）
- 拥有 **Cloudflare 账号** 和 **Global API Key**
- 域名已添加到 Cloudflare（DNS 由 Cloudflare 管理）

## 使用方法

### 安装

```bash
# 下载脚本
wget https://raw.githubusercontent.com/weiw0923/cf-xui-helper/main/deploy.py

# 运行（需要 root 权限）
sudo python3 deploy.py
```

按照提示输入：

1. **模式** — 回车默认安装，输入 `2` 为卸载
2. **绑定域名** — 你的域名（已在 Cloudflare 中）
3. **Cloudflare 邮箱** — 你的 CF 账号邮箱
4. **Cloudflare Global API Key** — 在 CF Dashboard 获取
5. **协议** — 逗号分隔，如 `1,2,3` 或 `vless,trojan`，留空全部
6. **Worker 名称** — 回车默认 `cf-xui-sub`
7. **是否创建 KV** — `Y` 创建 KV namespace 并绑定（推荐）

### 卸载

```bash
sudo python3 deploy.py
# 输入 2，然后输入 CF 邮箱和 API Key 即可自动清理
```

## 生成的订阅链接

部署完成后会输出类似这样的订阅链接：

```
VLESS 订阅: https://cf-xui-sub.xxx.workers.dev/{UUID}/sub?domain=your.com&epd=yes&ev=yes&dkby=yes&path=/xxxx-vl
```

支持的客户端输出格式（通过 `&target=` 参数）：
- `base64` — 默认，通用
- `clash` — Clash Meta 配置
- `surge` — Surge 配置
- `quantumult` — Quantumult X 配置

### 自定义节点列表（KV）

如果创建了 KV 绑定，可以在 Cloudflare Dashboard 中：

1. 进入 **Workers & Pages** → **KV**
2. 找到 `cf-xui-sub-kv`（或你自定义的名称）
3. 编辑 key `nodes` 的值
4. 每行一个域名或 IP 地址

支持格式：
```
your-cdn.example.com
1.2.3.4
5.6.7.8:8443
```

不配置 KV 也没关系，Worker 会使用内置的默认节点列表。

## 架构

```
用户 → Cloudflare CDN (443)
         ├── Origin Rules → VPS 随机端口 → 3x-ui (VLESS/Trojan/VMess)
         └── Worker 路由 → /{UUID}/sub → 订阅链接
```

## 注意事项

- 脚本需要 root 权限（操作 3x-ui 数据库和 systemctl）
- Cloudflare API Key 建议使用后及时回收权限
- 卸载时会删除所有由本脚本创建的配置，不影响其他手动配置
- 支持多协议混合，每个协议使用独立端口和路径
