# CF-XUI Helper

一键部署 3x-ui + Cloudflare Worker 订阅生成器，支持 VLESS/Trojan/VMess。

## 功能

- **3x-ui 节点管理** — 自动在 3x-ui 数据库创建 VLESS/Trojan/VMess 入站节点（WebSocket，随机端口 10000-60000）
- **Cloudflare 配置** — DNS A 记录、SSL Flexible、Origin Rules 路径转发（按端口分发到各协议）
- **Worker 订阅生成** — 自动部署 Cloudflare Worker，提供 Web 交互页面和订阅链接
- **KV 自定义节点** — 可选创建 KV namespace，写入自定义 CDN 节点列表（域名或 IP，每行一个）
- **ECH 支持** — 可选的 Encrypted Client Hello 支持（需客户端支持）
- **多客户端支持** — Clash / STASH / Surge / Sing-box / Loon / Quantumult X / V2Ray / V2RayNG / Nekoray / Shadowrocket
- **一键卸载** — 清理所有配置（Worker、KV、DNS、SSL、Origin Rules、3x-ui 节点），恢复到部署前状态

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

## 订阅链接

部署完成后会输出类似这样的订阅链接：

```
VLESS 订阅: https://cf-xui-sub.xxx.workers.dev/{UUID}/sub?domain=your.com&epd=yes&ev=yes&dkby=yes&path=/xxxx-vl
```

### 短路径（方便记忆）

部署后需在 Cloudflare Worker 的 **环境变量** 中设置 `SUB_UUID` 和 `SUB_DOMAIN`，即可使用短路径：

| 路径 | 说明 |
|------|------|
| `/vl` | VLESS 订阅 |
| `/tr` | Trojan 订阅 |
| `/vm` | VMess 订阅 |
| `/all` | 全部协议（VLESS + Trojan + VMess） |

**环境变量设置：**

| 变量 | 值示例 | 说明 |
|------|--------|------|
| `SUB_UUID` | `c3d382af-5bf6-4f9e-95f6-6c8863828b10` | 你的 UUID |
| `SUB_DOMAIN` | `your.com` | 你的绑定域名 |

设置后即可使用简洁的订阅链接：

```
https://cf-xui-sub.xxx.workers.dev/vl
https://cf-xui-sub.xxx.workers.dev/tr
https://cf-xui-sub.xxx.workers.dev/vm
https://cf-xui-sub.xxx.workers.dev/all
```

> 不设置环境变量不影响原有 `/{UUID}/sub?domain=xxx` 格式的使用。

### 订阅参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `domain` | 你的绑定域名（必填） | `your.com` |
| `epd` | 启用自定义 KV 节点 | `yes` / `no` |
| `ev` | 启用 VLESS 协议 | `yes` / `no` |
| `et` | 启用 Trojan 协议 | `yes` / `no` |
| `evm` | 启用 VMess 协议 | `yes` / `no` |
| `dkby` | 仅 TLS 节点（禁用非 TLS） | `yes` / `no` |
| `ech` | 启用 ECH（Encrypted Client Hello） | `yes` / `no` |
| `customDNS` | ECH 自定义 DoH 地址 | `https://dns.example.com/dns-query` |
| `customECHDomain` | ECH 域名 | `cloudflare-ech.com` |
| `path` | 自定义 WebSocket 路径 | `/custom-path` |
| `target` | 客户端输出格式 | `base64` / `clash` / `surge` / `quantumult` |

### 支持的客户端格式（`target=` 参数）

| target | 客户端 |
|--------|--------|
| `base64` | 默认，通用订阅格式 |
| `clash` | Clash Meta / STASH |
| `surge` | Surge |
| `quantumult` | Quantumult X |

### Web 交互页面

直接访问 Worker 地址（如 `https://cf-xui-sub.xxx.workers.dev`）即可打开 Web 页面：

- 填写域名、UUID/Password、WebSocket 路径
- 开关自定义 KV 节点和协议（VLESS/Trojan/VMess）
- 选择客户端一键生成订阅链接（Clash / STASH / Surge / Sing-box / Loon / Quantumult X / V2Ray / V2RayNG / Nekoray / Shadowrocket）
- 支持 ECH 开关和自定义 DNS

## 自定义 KV 节点

如果创建了 KV 绑定，可以在 Cloudflare Dashboard 中：

1. 进入 **Workers & Pages** → **KV**
2. 找到 `cf-xui-sub-kv`（或你自定义的名称）
3. 编辑 key `nodes` 的值
4. 每行一个域名或 IP 地址

支持格式（纯文本，每行一个）：

```
your-cdn.example.com
1.2.3.4
5.6.7.8:8443
```

部署脚本会自动写入默认的优选域名列表。不创建 KV 也没关系，Worker 会使用内置的默认节点列表作为回退。

## Worker 内置默认节点

```
cloudflare.182682.xyz
freeyx.cloudflare88.eu.org
bestcf.top
cdn.2020111.xyz
cf.0sm.com
cf.090227.xyz
cf.zhetengsha.eu.org
cfip.1323123.xyz
cloudflare-ip.mofashi.ltd
cf.877771.xyz
xn--b6gac.eu.org
```

## 架构

```
用户 → Cloudflare CDN (443)
         ├── Origin Rules → VPS 随机端口 → 3x-ui (VLESS/Trojan/VMess)
         └── Worker 路由 → /{UUID}/sub → 订阅链接
                          → /          → Web 交互页面
```

## 注意事项

- 脚本需要 root 权限（操作 3x-ui 数据库和 systemctl）
- Cloudflare API Key 建议使用后及时回收权限
- 卸载时会删除所有由本脚本创建的配置，不影响其他手动配置
- 支持多协议混合，每个协议使用独立端口和路径
- 节点来源统一从 KV 读取（`epd` 参数控制），去掉了优选 IP / GitHub 优选 / IPv4/IPv6 / 运营商筛选
- 部署状态保存在 `/etc/x-ui/cf_auto_state.json`，再次运行前必须先卸载
