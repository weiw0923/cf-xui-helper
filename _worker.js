// Cloudflare Worker - 简化版优选工具
// 节点来源：KV 存储 + 原生地址

// 默认配置
let epd = true;   // 启用自定义KV节点
let ev = true;    // 启用VLESS协议
let et = false;   // 启用Trojan协议
let vm = false;   // 启用VMess协议
let scu = 'https://url.v1.mk/sub';  // 订阅转换地址

// 默认KV节点列表（KV 读取失败时的回退）
const defaultNodes = [
    { name: "cloudflare.182682.xyz", ip: "cloudflare.182682.xyz" },
    { ip: "freeyx.cloudflare88.eu.org" },
    { ip: "bestcf.top" },
    { ip: "cdn.2020111.xyz" },
    { ip: "cf.0sm.com" },
    { ip: "cf.090227.xyz" },
    { ip: "cf.zhetengsha.eu.org" },
    { ip: "cfip.1323123.xyz" },
    { ip: "cloudflare-ip.mofashi.ltd" },
    { ip: "cf.877771.xyz" },
    { ip: "xn--b6gac.eu.org" }
];

// 从 KV 读取节点列表，兼容 txt（每行一个）和 JSON 数组格式
async function getCustomNodes(env) {
    try {
        if (!env?.PD) return defaultNodes;
        const raw = await env.PD.get('nodes');
        if (!raw) return defaultNodes;

        // 尝试解析 JSON
        try {
            const json = JSON.parse(raw);
            if (Array.isArray(json)) {
                return json.map(d => {
                    if (typeof d === 'string') return { ip: d };
                    return d;
                });
            }
        } catch (e) {}

        // 当作纯文本处理：每行一个地址
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        return lines.map(addr => ({ ip: addr }));
    } catch (e) {
        return defaultNodes;
    }
}

// 生成VLESS链接
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';

    list.forEach(item => {
        let nodeName = item.name || item.ip;
        const safeIP = item.ip;

        let portsToGenerate = [];
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: false });
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeName}-${port}-WS-TLS`;
                const wsParams = new URLSearchParams({
                    encryption: 'none',
                    security: 'tls',
                    sni: workerDomain,
                    fp: 'chrome',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeName}-${port}-WS`;
                const wsParams = new URLSearchParams({
                    encryption: 'none',
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成Trojan链接
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const password = user;

    list.forEach(item => {
        let nodeName = item.name || item.ip;
        const safeIP = item.ip;

        let portsToGenerate = [];
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeName}-${port}-Trojan-WS-TLS`;
                const wsParams = new URLSearchParams({
                    security: 'tls',
                    sni: workerDomain,
                    fp: 'chrome',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeName}-${port}-Trojan-WS`;
                const wsParams = new URLSearchParams({
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成VMess链接
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        let nodeName = item.name || item.ip;
        const safeIP = item.ip;

        let portsToGenerate = [];
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const vmessConfig = {
                v: "2",
                ps: tls ? `${nodeName}-${port}-VMess-WS-TLS` : `${nodeName}-${port}-VMess-WS`,
                add: safeIP,
                port: port.toString(),
                id: user,
                aid: "0",
                scy: "auto",
                net: "ws",
                type: "none",
                host: workerDomain,
                path: wsPath,
                tls: tls ? "tls" : "none"
            };
            if (tls) {
                vmessConfig.sni = workerDomain;
                vmessConfig.fp = "chrome";
            }

            const jsonStr = JSON.stringify(vmessConfig);
            const vmessBase64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
            }));

            links.push(`vmess://${vmessBase64}`);
        });
    });
    return links;
}

// 生成订阅内容
async function handleSubscriptionRequest(request, user, customDomain, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, env) {
    const url = new URL(request.url);
    const finalLinks = [];
    const workerDomain = url.hostname;
    const nodeDomain = customDomain || url.hostname;
    const target = url.searchParams.get('target') || 'base64';
    const wsPath = customPath || '/';

    async function addNodesFromList(list) {
        const hasProtocol = evEnabled || etEnabled || vmEnabled;
        const useVL = hasProtocol ? evEnabled : true;

        if (useVL) {
            finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
        if (etEnabled) {
            finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
        if (vmEnabled) {
            finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
    }

    // 原生地址
    const nativeList = [{ ip: workerDomain, name: '原生地址' }];
    await addNodesFromList(nativeList);

    // 自定义KV节点
    if (epd) {
        const nodeList = await getCustomNodes(env);
        await addNodesFromList(nodeList);
    }

    if (finalLinks.length === 0) {
        const errorRemark = "所有节点获取失败";
        const errorLink = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=ws&host=error.com&path=%2F#${encodeURIComponent(errorRemark)}`;
        finalLinks.push(errorLink);
    }

    let subscriptionContent;
    let contentType = 'text/plain; charset=utf-8';

    switch (target.toLowerCase()) {
        case 'clash':
        case 'clashr':
            subscriptionContent = generateClashConfig(finalLinks);
            contentType = 'text/yaml; charset=utf-8';
            break;
        case 'surge':
        case 'surge2':
        case 'surge3':
        case 'surge4':
            subscriptionContent = generateSurgeConfig(finalLinks);
            break;
        case 'quantumult':
        case 'quanx':
            subscriptionContent = btoa(finalLinks.join('\n'));
            break;
        default:
            subscriptionContent = btoa(finalLinks.join('\n'));
    }

    return new Response(subscriptionContent, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
    });
}

// 生成Clash配置
function generateClashConfig(links) {
    let yaml = 'port: 7890\n';
    yaml += 'socks-port: 7891\n';
    yaml += 'allow-lan: false\n';
    yaml += 'mode: rule\n';
    yaml += 'log-level: info\n\n';
    yaml += 'proxies:\n';

    const proxyNames = [];
    links.forEach((link, index) => {
        const name = decodeURIComponent(link.split('#')[1] || `节点${index + 1}`);
        proxyNames.push(name);
        const server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
        const port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
        const uuid = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
        const tls = link.includes('security=tls');
        const path = link.match(/path=([^&#]+)/)?.[1] || '/';
        const host = link.match(/host=([^&#]+)/)?.[1] || '';
        const sni = link.match(/sni=([^&#]+)/)?.[1] || '';

        yaml += `  - name: ${name}\n`;
        yaml += `    type: vless\n`;
        yaml += `    server: ${server}\n`;
        yaml += `    port: ${port}\n`;
        yaml += `    uuid: ${uuid}\n`;
        yaml += `    tls: ${tls}\n`;
        yaml += `    network: ws\n`;
        yaml += `    ws-opts:\n`;
        yaml += `      path: ${path}\n`;
        yaml += `      headers:\n`;
        yaml += `        Host: ${host}\n`;
        if (sni) {
            yaml += `    servername: ${sni}\n`;
        }
    });

    yaml += '\nproxy-groups:\n';
    yaml += '  - name: PROXY\n';
    yaml += '    type: select\n';
    yaml += `    proxies: [${proxyNames.map(n => `'${n}'`).join(', ')}]\n`;
    yaml += '\nrules:\n';
    yaml += '  - DOMAIN-SUFFIX,local,DIRECT\n';
    yaml += '  - IP-CIDR,127.0.0.0/8,DIRECT\n';
    yaml += '  - GEOIP,CN,DIRECT\n';
    yaml += '  - MATCH,PROXY\n';

    return yaml;
}

// 生成Surge配置
function generateSurgeConfig(links) {
    let config = '[Proxy]\n';
    links.forEach(link => {
        const name = decodeURIComponent(link.split('#')[1] || '节点');
        config += `${name} = vless, ${link.match(/@([^:]+):(\d+)/)?.[1] || ''}, ${link.match(/@[^:]+:(\d+)/)?.[1] || '443'}, username=${link.match(/vless:\/\/([^@]+)@/)?.[1] || ''}, tls=${link.includes('security=tls')}, ws=true, ws-path=${link.match(/path=([^&#]+)/)?.[1] || '/'}, ws-headers=Host:${link.match(/host=([^&#]+)/)?.[1] || ''}\n`;
    });
    config += '\n[Proxy Group]\nPROXY = select, ' + links.map((_, i) => decodeURIComponent(links[i].split('#')[1] || `节点${i + 1}`)).join(', ') + '\n';
    return config;
}

// 生成主页
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>订阅生成工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 50%, #fafafa 100%);
            color: #1d1d1f; min-height: 100vh; overflow-x: hidden;
        }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 48px 20px 32px; }
        .header h1 { font-size: 40px; font-weight: 700; letter-spacing: -0.3px; color: #1d1d1f; margin-bottom: 8px; line-height: 1.1; }
        .header p { font-size: 17px; color: #86868b; font-weight: 400; line-height: 1.5; }
        .card {
            background: rgba(255,255,255,0.75); backdrop-filter: blur(30px) saturate(200%);
            border-radius: 24px; padding: 28px; margin-bottom: 20px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05);
            border: 0.5px solid rgba(0,0,0,0.06);
        }
        .form-group { margin-bottom: 24px; }
        .form-group:last-child { margin-bottom: 0; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; color: #86868b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-group input, .form-group textarea {
            width: 100%; padding: 14px 16px; font-size: 17px; font-weight: 400; color: #1d1d1f;
            background: rgba(142,142,147,0.12); border: 2px solid transparent; border-radius: 12px;
            outline: none; transition: all 0.2s ease; -webkit-appearance: none;
        }
        .form-group input:focus, .form-group textarea:focus {
            background: rgba(142,142,147,0.16); border-color: #007AFF; transform: scale(1.005);
        }
        .form-group input::placeholder, .form-group textarea::placeholder { color: #86868b; }
        .form-group small { display: block; margin-top: 8px; color: #86868b; font-size: 13px; line-height: 1.4; }
        .list-item {
            display: flex; align-items: center; justify-content: space-between; padding: 16px 0;
            min-height: 52px; cursor: pointer; border-bottom: 0.5px solid rgba(0,0,0,0.08);
        }
        .list-item:last-child { border-bottom: none; }
        .list-item:active { background: rgba(142,142,147,0.08); margin: 0 -28px; padding-left: 28px; padding-right: 28px; }
        .list-item-label { font-size: 17px; font-weight: 400; color: #1d1d1f; flex: 1; }
        .switch {
            position: relative; width: 51px; height: 31px; background: rgba(142,142,147,0.3);
            border-radius: 16px; transition: background 0.3s ease; cursor: pointer; flex-shrink: 0;
        }
        .switch.active { background: #34C759; }
        .switch::after {
            content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px;
            background: #fff; border-radius: 50%; transition: transform 0.3s ease;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1);
        }
        .switch.active::after { transform: translateX(20px); }
        .btn {
            width: 100%; padding: 16px; font-size: 17px; font-weight: 600; color: #fff;
            background: #007AFF; border: none; border-radius: 14px; cursor: pointer;
            transition: all 0.2s ease; margin-top: 8px; -webkit-appearance: none;
            box-shadow: 0 4px 12px rgba(0,122,255,0.25);
        }
        .btn:active { transform: scale(0.97); }
        .result-url {
            margin-top: 12px; padding: 12px; background: rgba(0,122,255,0.1); border-radius: 10px;
            font-size: 13px; color: #007aff; word-break: break-all; line-height: 1.5; display: none;
        }
        .client-btn {
            padding: 12px 16px; font-size: 14px; font-weight: 500; color: #007AFF;
            background: rgba(0,122,255,0.1); border: 1px solid rgba(0,122,255,0.2);
            border-radius: 12px; cursor: pointer; transition: all 0.2s ease;
            -webkit-appearance: none; white-space: nowrap;
        }
        .client-btn:active { transform: scale(0.97); }
        .checkbox-label {
            display: flex; align-items: center; cursor: pointer; font-size: 17px; font-weight: 400;
            padding: 8px 0; user-select: none;
        }
        .checkbox-label input[type="checkbox"] {
            margin-right: 12px; width: 22px; height: 22px; cursor: pointer; flex-shrink: 0;
            -webkit-appearance: checkbox; appearance: checkbox;
        }
        @media (max-width: 480px) {
            .header h1 { font-size: 34px; }
            .client-btn { font-size: 12px; padding: 10px 12px; }
        }
        .footer { text-align: center; padding: 32px 20px; color: #86868b; font-size: 13px; }
        .footer a { color: #007AFF; text-decoration: none; font-weight: 500; }
        @media (prefers-color-scheme: dark) {
            body { background: linear-gradient(180deg,#000 0%,#1c1c1e 50%,#2c2c2e 100%); color: #f5f5f7; }
            .card { background: rgba(28,28,30,0.75); border: 0.5px solid rgba(255,255,255,0.12); }
            .form-group input, .form-group textarea { background: rgba(142,142,147,0.2); color: #f5f5f7; }
            .form-group input:focus { border-color: #5ac8fa; }
            .list-item { border-bottom-color: rgba(255,255,255,0.1); }
            .list-item-label { color: #f5f5f7; }
            .client-btn { background: rgba(0,122,255,0.15)!important; border-color: rgba(0,122,255,0.3)!important; color: #5ac8fa!important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>订阅生成工具</h1>
            <p>一键生成订阅链接</p>
        </div>
        <div class="card">
            <div class="form-group">
                <label>域名</label>
                <input type="text" id="domain" placeholder="请输入您的域名">
            </div>
            <div class="form-group">
                <label>UUID/Password</label>
                <input type="text" id="uuid" placeholder="请输入UUID或Password">
            </div>
            <div class="form-group">
                <label>WebSocket路径（可选）</label>
                <input type="text" id="customPath" placeholder="留空则使用默认路径 /" value="/">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">自定义WebSocket路径，例如：/v2ray 或 /</small>
            </div>

            <div class="list-item" onclick="toggleSwitch('switchNodes')">
                <div>
                    <div class="list-item-label">自定义KV节点</div>
                </div>
                <div class="switch active" id="switchNodes"></div>
            </div>

            <div class="form-group" style="margin-top: 24px;">
                <label>协议选择</label>
                <div style="margin-top: 8px;">
                    <div class="list-item" onclick="toggleSwitch('switchVL')">
                        <div><div class="list-item-label">VLESS</div></div>
                        <div class="switch active" id="switchVL"></div>
                    </div>
                    <div class="list-item" onclick="toggleSwitch('switchTJ')">
                        <div><div class="list-item-label">Trojan</div></div>
                        <div class="switch" id="switchTJ"></div>
                    </div>
                    <div class="list-item" onclick="toggleSwitch('switchVM')">
                        <div><div class="list-item-label">VMess</div></div>
                        <div class="switch" id="switchVM"></div>
                    </div>
                </div>
            </div>

            <div class="form-group" style="margin-top: 24px;">
                <label>客户端选择</label>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 8px;">
                    <button type="button" class="client-btn" onclick="generateClientLink('clash','CLASH')">CLASH</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('surge','SURGE')">SURGE</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('sing-box','SING-BOX')">SING-BOX</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('loon','LOON')">LOON</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('quanx','QUANTUMULT X')" style="font-size: 13px;">QUANTUMULT X</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','V2RAYNG')">V2RAYNG</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','Shadowrocket')" style="font-size: 13px;">Shadowrocket</button>
                </div>
                <div class="result-url" id="clientSubscriptionUrl"></div>
            </div>

            <div class="list-item" onclick="toggleSwitch('switchTLS')" style="margin-top: 8px;">
                <div>
                    <div class="list-item-label">仅TLS节点</div>
                    <div class="list-item-description" style="font-size: 13px; color: #86868b; margin-top: 4px;">启用后只生成带TLS的节点</div>
                </div>
                <div class="switch" id="switchTLS"></div>
            </div>
        </div>
        <div class="footer">
            <p>订阅生成工具</p>
        </div>
    </div>
    <script>
        let switches = { switchNodes: true, switchVL: true, switchTJ: false, switchVM: false, switchTLS: false };
        const SUB_CONVERTER_URL = "${ scu }";

        function toggleSwitch(id) {
            const el = document.getElementById(id);
            switches[id] = !switches[id];
            el.classList.toggle('active');
        }

        function tryOpenApp(schemeUrl, fallback, timeout) {
            timeout = timeout || 2500;
            let opened = false, done = false, start = Date.now();
            const blur = () => { if (Date.now()-start<3000 && !done) opened = true; };
            const hide = () => { if (Date.now()-start<3000 && !done) opened = true; };
            window.addEventListener('blur', blur);
            document.addEventListener('visibilitychange', hide);
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none'; iframe.src = schemeUrl;
            document.body.appendChild(iframe);
            setTimeout(() => {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                window.removeEventListener('blur', blur);
                document.removeEventListener('visibilitychange', hide);
                if (!done) { done = true; if (!opened && fallback) fallback(); }
            }, timeout);
        }

        function generateClientLink(clientType, clientName) {
            const domain = document.getElementById('domain').value.trim();
            const uuid = document.getElementById('uuid').value.trim();
            const customPath = document.getElementById('customPath').value.trim() || '/';
            if (!domain || !uuid) { alert('请先填写域名和UUID/Password'); return; }
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                alert('请至少选择一个协议'); return;
            }

            const baseUrl = new URL(window.location.href).origin;
            let subUrl = baseUrl + '/' + uuid + '/sub?domain=' + encodeURIComponent(domain)
                + '&epd=' + (switches.switchNodes ? 'yes' : 'no');
            if (switches.switchVL) subUrl += '&ev=yes';
            if (switches.switchTJ) subUrl += '&et=yes';
            if (switches.switchVM) subUrl += '&evm=yes';
            if (switches.switchTLS) subUrl += '&dkby=yes';
            if (customPath && customPath !== '/') subUrl += '&path=' + encodeURIComponent(customPath);

            let finalUrl = subUrl;
            const urlEl = document.getElementById('clientSubscriptionUrl');

            if (clientType === 'v2ray') {
                urlEl.textContent = subUrl; urlEl.style.display = 'block';
                if (clientName === 'V2RAYNG') {
                    tryOpenApp('v2rayng://install?url=' + encodeURIComponent(subUrl), () => {
                        navigator.clipboard.writeText(subUrl).then(() => alert('V2RAYNG 订阅链接已复制'));
                    });
                } else if (clientName === 'Shadowrocket') {
                    tryOpenApp('shadowrocket://add/' + encodeURIComponent(subUrl), () => {
                        navigator.clipboard.writeText(subUrl).then(() => alert('Shadowrocket 订阅链接已复制'));
                    });
                }
                return;
            }

            finalUrl = SUB_CONVERTER_URL + '?target=' + clientType + '&url=' + encodeURIComponent(subUrl)
                + '&insert=false&emoji=true&list=false&xudp=false&udp=false&tfo=false&expand=true&scv=false&fdn=false&new_name=true';
            urlEl.textContent = finalUrl; urlEl.style.display = 'block';

            let schemeUrl = '';
            if (clientType === 'clash') schemeUrl = 'clash://install-config?url=' + encodeURIComponent(finalUrl);
            else if (clientType === 'surge') schemeUrl = 'surge:///install-config?url=' + encodeURIComponent(finalUrl);
            else if (clientType === 'sing-box') schemeUrl = 'sing-box://install-config?url=' + encodeURIComponent(finalUrl);
            else if (clientType === 'loon') schemeUrl = 'loon://install?url=' + encodeURIComponent(finalUrl);
            else if (clientType === 'quanx') schemeUrl = 'quantumult-x://install-config?url=' + encodeURIComponent(finalUrl);

            if (schemeUrl) {
                tryOpenApp(schemeUrl, () => {
                    navigator.clipboard.writeText(finalUrl).then(() => alert(clientName + ' 订阅链接已复制'));
                });
            } else {
                navigator.clipboard.writeText(finalUrl).then(() => alert(clientName + ' 订阅链接已复制'));
            }
        }
    </script>
</body>
</html>`;
}

// 主处理函数
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 主页
        if (path === '/' || path === '') {
            const scuValue = env?.scu || scu;
            return new Response(generateHomePage(scuValue), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // 订阅请求格式: /{UUID}/sub?domain=xxx&epd=yes
        const pathMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (pathMatch) {
            const uuid = pathMatch[1];
            const domain = url.searchParams.get('domain');
            if (!domain) {
                return new Response('缺少域名参数', { status: 400 });
            }

            epd = url.searchParams.get('epd') !== 'no';
            const evEnabled = url.searchParams.get('ev') === 'yes' || (url.searchParams.get('ev') === null && ev);
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('evm') === 'yes';
            const disableNonTLS = url.searchParams.get('dkby') === 'yes';
            const customPath = url.searchParams.get('path') || '/';

            return await handleSubscriptionRequest(request, uuid, domain, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, env);
        }

        return new Response('Not Found', { status: 404 });
    }
};
