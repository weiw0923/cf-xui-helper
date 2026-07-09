// Cloudflare Worker - 简化版优选工具
// 节点来源：KV 存储 + 原生地址

// 默认配置
let ev = true;    // 启用VLESS协议
let et = false;   // 启用Trojan协议
let vm = false;   // 启用VMess协议
let scu = 'https://url.v1.mk/sub';  // 订阅转换地址
let enableECH = false;
let customDNS = 'https://dns.joeyblog.eu.org/joeyblog';
let customECHDomain = 'cloudflare-ech.com';

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
// 部署配置（通过 Worker 环境变量 SUB_UUID / SUB_DOMAIN 设置）
const SUB_UUID = ""; // 在 Worker 环境变量 SUB_UUID 中设置
const SUB_DOMAIN = ""; // 在 Worker 环境变量 SUB_DOMAIN 中设置

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
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
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
                if (echConfig) {
                    wsParams.set('alpn', 'h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
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
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
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
                if (echConfig) {
                    wsParams.set('alpn', 'h2,http/1.1');
                    wsParams.set('ech', echConfig);
                }
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
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/', echConfig = null) {
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
                if (echConfig) {
                    vmessConfig.alpn = "h2,http/1.1";
                    vmessConfig.ech = echConfig;
                }
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
async function handleSubscriptionRequest(request, user, customDomain, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, echConfig, epdEnabled, env) {
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
            finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (etEnabled) {
            finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
        if (vmEnabled) {
            finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath, echConfig));
        }
    }

    // 原生地址
    const nativeList = [{ ip: workerDomain, name: '原生地址' }];
    await addNodesFromList(nativeList);

    // 自定义KV节点
    if (epdEnabled) {
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

        let type, server, port, tls, path, host, sni;
        let uuid = '', password = '', alterId = '0', cipher = 'auto';

        if (link.startsWith('vless://')) {
            type = 'vless';
            server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
            port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
            uuid = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
            tls = link.includes('security=tls');
            path = decodeURIComponent(link.match(/path=([^&#]+)/)?.[1] || '/');
            host = link.match(/host=([^&#]+)/)?.[1] || '';
            sni = link.match(/sni=([^&#]+)/)?.[1] || '';
        } else if (link.startsWith('trojan://')) {
            type = 'trojan';
            server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
            port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
            password = link.match(/trojan:\/\/([^@]+)@/)?.[1] || '';
            tls = link.includes('security=tls');
            path = decodeURIComponent(link.match(/path=([^&#]+)/)?.[1] || '/');
            host = link.match(/host=([^&#]+)/)?.[1] || '';
            sni = link.match(/sni=([^&#]+)/)?.[1] || '';
        } else if (link.startsWith('vmess://')) {
            type = 'vmess';
            const b64 = link.slice('vmess://'.length);
            let json = {};
            try {
                const decoded = decodeURIComponent(atob(b64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
                json = JSON.parse(decoded);
            } catch (e) {}
            server = json.add || '';
            port = json.port ? String(json.port) : '443';
            uuid = json.id || '';
            alterId = json.aid != null ? String(json.aid) : '0';
            cipher = json.scy || 'auto';
            tls = json.tls === 'tls';
            path = decodeURIComponent(json.path || '/');
            host = json.host || '';
            sni = json.sni || '';
        } else {
            return; // 未知协议跳过
        }

        yaml += `  - name: ${name}\n`;
        yaml += `    type: ${type}\n`;
        yaml += `    server: ${server}\n`;
        yaml += `    port: ${port}\n`;
        if (type === 'vless' || type === 'vmess') {
            yaml += `    uuid: ${uuid}\n`;
        }
        if (type === 'trojan') {
            yaml += `    password: ${password}\n`;
        }
        if (type === 'vmess') {
            yaml += `    alterId: ${alterId}\n`;
            yaml += `    cipher: ${cipher}\n`;
        }
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
        const server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
        const port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
        const username = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
        const tls = link.includes('security=tls');
        const path = decodeURIComponent(link.match(/path=([^&#]+)/)?.[1] || '/');
        const host = link.match(/host=([^&#]+)/)?.[1] || '';
        config += `${name} = vless, ${server}, ${port}, username=${username}, tls=${tls}, ws=true, ws-path=${path}, ws-headers=Host:${host}\n`;
    });
    config += '\n[Proxy Group]\nPROXY = select, ' + links.map((_, i) => decodeURIComponent(links[i].split('#')[1] || `节点${i + 1}`)).join(', ') + '\n';
    return config;
}

// 生成主页
function generateHomePage(scuValue, env) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    const subUuid = env?.SUB_UUID || "";
    const subDomain = env?.SUB_DOMAIN || "";
    // 部署信息卡片（避免模板引用未定义变量导致 ReferenceError）
    const infoCards = subDomain
        ? `<div class="card"><div class="info-row"><div class="info-label">域名</div><div class="info-value code">${subDomain}</div></div><div class="info-row"><div class="info-label">UUID</div><div class="info-value code">${subUuid}</div></div></div>`
        : '';
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
        .info-row { display: flex; padding: 12px 0; border-bottom: 0.5px solid rgba(0,0,0,0.06); font-size: 15px; line-height: 1.5; }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #86868b; font-weight: 500; flex-shrink: 0; width: 80px; }
        .info-value { color: #1d1d1f; word-break: break-all; flex: 1; }
        .info-value.code { font-family: monospace; font-size: 13px; background: rgba(142,142,147,0.1); padding: 4px 8px; border-radius: 6px; }
        .copy-btn { margin-left: 8px; padding: 2px 8px; font-size: 12px; color: #007AFF; background: rgba(0,122,255,0.1); border: none; border-radius: 6px; cursor: pointer; white-space: nowrap; }
        .form-group { margin-bottom: 24px; }
        .form-group:last-child { margin-bottom: 0; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; color: #86868b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-group input {
            width: 100%; padding: 14px 16px; font-size: 17px; font-weight: 400; color: #1d1d1f;
            background: rgba(142,142,147,0.12); border: 2px solid transparent; border-radius: 12px;
            outline: none; transition: all 0.2s ease; -webkit-appearance: none;
        }
        .form-group input:focus {
            background: rgba(142,142,147,0.16); border-color: #007AFF; transform: scale(1.005);
        }
        .form-group input::placeholder { color: #86868b; }
        .list-item {
            display: flex; align-items: center; justify-content: space-between; padding: 16px 0;
            min-height: 52px; cursor: pointer; border-bottom: 0.5px solid rgba(0,0,0,0.08);
        }
        .list-item:last-child { border-bottom: none; }
        .list-item:active { background: rgba(142,142,147,0.08); margin: 0 -28px; padding-left: 28px; padding-right: 28px; }
        .list-item-label { font-size: 17px; font-weight: 400; color: #1d1d1f; flex: 1; }
        .list-item-desc { font-size: 13px; color: #86868b; margin-top: 4px; }
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
        .short-path-url {
            font-family: monospace; font-size: 12px; color: #007aff; word-break: break-all;
            padding: 6px 12px; margin-bottom: 8px; background: rgba(0,122,255,0.08); border-radius: 8px;
            cursor: pointer; display: none; line-height: 1.5;
        }
        .short-path-url:active { background: rgba(0,122,255,0.2); }
        .section-label { font-size: 13px; font-weight: 600; color: #86868b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 16px; }
        .node-count { font-size: 12px; color: #86868b; padding: 8px 0 4px; }
        .node-items {
            max-height: 240px; overflow-y: auto; font-size: 13px; font-family: monospace;
            background: rgba(142,142,147,0.06); border-radius: 10px; padding: 8px 12px;
        }
        .node-item { padding: 4px 0; border-bottom: 1px solid rgba(142,142,147,0.1); }
        .node-item:last-child { border-bottom: none; }
        .client-btn {
            padding: 12px 16px; font-size: 14px; font-weight: 500; color: #007AFF;
            background: rgba(0,122,255,0.1); border: 1px solid rgba(0,122,255,0.2);
            border-radius: 12px; cursor: pointer; transition: all 0.2s ease;
            -webkit-appearance: none; white-space: nowrap;
        }
        .client-btn:active { transform: scale(0.97); }
        .result-url {
            font-family: monospace; font-size: 12px; word-break: break-all;
            padding: 8px; background: #f5f5f5; border-radius: 4px;
        }
        @media (max-width: 480px) {
            .header h1 { font-size: 34px; }
            .client-btn { font-size: 12px; padding: 10px 12px; }
        }
        .footer { text-align: center; padding: 32px 20px; color: #86868b; font-size: 13px; }
        @media (prefers-color-scheme: dark) {
            body { background: linear-gradient(180deg,#000 0%,#1c1c1e 50%,#2c2c2e 100%); color: #f5f5f7; }
            .card { background: rgba(28,28,30,0.75); border: 0.5px solid rgba(255,255,255,0.12); }
            .form-group input { background: rgba(142,142,147,0.2); color: #f5f5f7; }
            .form-group input:focus { border-color: #5ac8fa; }
            .list-item { border-bottom-color: rgba(255,255,255,0.1); }
            .list-item-label { color: #f5f5f7; }
            .short-path-url { background: rgba(0,122,255,0.15)!important; color: #5ac8fa!important; }
            .node-items { background: rgba(255,255,255,0.06)!important; }
            .client-btn { background: rgba(0,122,255,0.15)!important; border-color: rgba(0,122,255,0.3)!important; color: #5ac8fa!important; }
            #nodeItems { background: rgba(255,255,255,0.06)!important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>订阅生成工具</h1>
            <p>部署完成，以下为配置信息</p>
        </div>

        ${infoCards}

        <div class="card">

            <!-- 1. 域名 + UUID 预填入 -->
            <div class="form-group">
                <label>域名</label>
                <input type="text" id="domain" placeholder="请输入您的域名" value="${subDomain}">
            </div>
            <div class="form-group">
                <label>UUID/Password</label>
                <input type="text" id="uuid" placeholder="请输入UUID或Password" value="${subUuid}">
            </div>
            </div>

            <!-- 2. 自定义KV节点（关闭时显示默认节点，打开时显示KV节点，有数量统计，可滚动） -->
            <div class="list-item" onclick="toggleSwitch('switchNodes')">
                <div><div class="list-item-label">自定义KV节点</div></div>
                <div class="switch active" id="switchNodes"></div>
            </div>
            <div id="kvNodeList">
                <div class="node-count">共 <span id="nodeCount">11</span> 个节点</div>
                <div class="node-items" id="nodeItems"></div>
            </div>

            <!-- 3. 4个短路径开关，每个下方显示短路径内容 -->
            <div class="section-label">短路径订阅</div>

            <div class="list-item" onclick="toggleSwitch('switchVL')">
                <div><div class="list-item-label">VLESS</div></div>
                <div class="switch active" id="switchVL"></div>
            </div>
            <div class="short-path-url" id="shortUrlVL" onclick="copyShortUrl('vl')">/vl</div>

            <div class="list-item" onclick="toggleSwitch('switchTJ')">
                <div><div class="list-item-label">Trojan</div></div>
                <div class="switch" id="switchTJ"></div>
            </div>
            <div class="short-path-url" id="shortUrlTJ" onclick="copyShortUrl('tr')">/tr</div>

            <div class="list-item" onclick="toggleSwitch('switchVM')">
                <div><div class="list-item-label">VMess</div></div>
                <div class="switch" id="switchVM"></div>
            </div>
            <div class="short-path-url" id="shortUrlVM" onclick="copyShortUrl('vm')">/vm</div>

            <div class="list-item" onclick="toggleSwitch('switchAll')">
                <div><div class="list-item-label">全部</div></div>
                <div class="switch" id="switchAll"></div>
            </div>
            <div class="short-path-url" id="shortUrlAll" onclick="copyShortUrl('all')">/all</div>

            <!-- 4. TLS + ECH -->
            <div class="list-item" onclick="toggleSwitch('switchTLS')" style="margin-top: 8px;">
                <div>
                    <div class="list-item-label">仅TLS节点</div>
                    <div class="list-item-desc">启用后只生成带TLS的节点</div>
                </div>
                <div class="switch" id="switchTLS"></div>
            </div>

            <div class="list-item" onclick="toggleSwitch('switchECH')">
                <div>
                    <div class="list-item-label">ECH (Encrypted Client Hello)</div>
                    <div class="list-item-desc">启用时自动仅TLS；需客户端支持</div>
                </div>
                <div class="switch" id="switchECH"></div>
            </div>
            <div class="form-group" id="echOptionsGroup" style="margin-top: 12px; display: none;">
                <label>ECH 自定义 DNS（可选）</label>
                <input type="text" id="customDNS" placeholder="例如: https://dns.joeyblog.eu.org/joeyblog" style="font-size: 14px;">
                <small style="display: block; margin-top: 6px; color: #86868b; font-size: 13px;">用于 ECH 配置查询的 DoH 地址</small>
                <label style="margin-top: 12px; display: block;">ECH 域名（可选）</label>
                <input type="text" id="customECHDomain" placeholder="例如: cloudflare-ech.com" style="font-size: 14px;">
            </div>

            <!-- 5. 客户端选择（最底部） -->
            <div class="form-group" style="margin-top: 24px;">
                <label>客户端选择</label>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 8px;">
                    <button type="button" class="client-btn" onclick="generateClientLink('clash','CLASH')">CLASH</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('clash','STASH')">STASH</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('surge','SURGE')">SURGE</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('sing-box','SING-BOX')">SING-BOX</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('loon','LOON')">LOON</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('quanx','QUANTUMULT X')" style="font-size: 13px;">QUANTUMULT X</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','V2RAY')">V2RAY</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','V2RAYNG')">V2RAYNG</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','NEKORAY')">NEKORAY</button>
                    <button type="button" class="client-btn" onclick="generateClientLink('v2ray','Shadowrocket')" style="font-size: 13px;">Shadowrocket</button>
                </div>
                <div class="result-url" id="clientSubscriptionUrl"></div>
            </div>

        </div>

        <div class="footer">
            <p>订阅生成工具</p>
        </div>
    </div>
    <script>
        let switches = { switchNodes: true, switchVL: true, switchTJ: false, switchVM: false, switchAll: false, switchTLS: false, switchECH: false };
        const SUB_CONVERTER_URL = "${scu}";
        const WORKER_ORIGIN = self.location.origin;

        // 切换开关
        function toggleSwitch(id) {
            const el = document.getElementById(id);
            switches[id] = !switches[id];
            el.classList.toggle('active');

            // 短路径开关：显示/隐藏对应的短路径URL
            if (id === 'switchVL' || id === 'switchTJ' || id === 'switchVM' || id === 'switchAll') {
                const urlMap = { switchVL: 'shortUrlVL', switchTJ: 'shortUrlTJ', switchVM: 'shortUrlVM', switchAll: 'shortUrlAll' };
                const urlEl = document.getElementById(urlMap[id]);
                if (urlEl) urlEl.style.display = switches[id] ? 'block' : 'none';
                // "全部"开关联动 VL/TJ/VM
                if (id === 'switchAll') {
                    const linked = ['switchVL','switchTJ','switchVM'];
                    linked.forEach(sid => {
                        const sel = document.getElementById(sid);
                        if (sel) {
                            const wasActive = switches[sid];
                            if (wasActive !== switches.switchAll) {
                                switches[sid] = switches.switchAll;
                                sel.classList.toggle('active', switches.switchAll);
                                const urlEl2 = document.getElementById(urlMap[sid]);
                                if (urlEl2) urlEl2.style.display = switches.switchAll ? 'block' : 'none';
                            }
                        }
                    });
                }
                return;
            }

            // ECH 联动
            if (id === 'switchECH') {
                const echOpt = document.getElementById('echOptionsGroup');
                if (echOpt) echOpt.style.display = switches.switchECH ? 'block' : 'none';
                if (switches.switchECH && !switches.switchTLS) {
                    switches.switchTLS = true;
                    const tlsEl = document.getElementById('switchTLS');
                    if (tlsEl) tlsEl.classList.add('active');
                }
            }
            // KV节点 开关：打开加载KV节点，关闭显示默认节点
            if (id === 'switchNodes') {
                if (switches.switchNodes) {
                    loadKVNodes();
                } else {
                    showDefaultNodes();
                }
            }
        }

        // 页面加载时初始化各开关状态
        document.addEventListener('DOMContentLoaded', function() {
            ['switchVL','switchTJ','switchVM','switchAll'].forEach(id => {
                const urlMap = { switchVL: 'shortUrlVL', switchTJ: 'shortUrlTJ', switchVM: 'shortUrlVM', switchAll: 'shortUrlAll' };
                const urlEl = document.getElementById(urlMap[id]);
                if (urlEl) urlEl.style.display = switches[id] ? 'block' : 'none';
            });
            // 开关打开则加载KV节点，否则显示默认节点
            if (switches.switchNodes) {
                loadKVNodes();
            } else {
                showDefaultNodes();
            }
        });

        // 复制短路径 URL
        function copyShortUrl(path) {
            const full = WORKER_ORIGIN + '/' + path;
            navigator.clipboard.writeText(full).then(() => alert('已复制: ' + full));
        }

        // 加载 KV 节点列表
        async function loadKVNodes() {
            try {
                const resp = await fetch('/api/nodes');
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                const nodes = data.nodes || [];
                renderNodeList(nodes);
            } catch (e) {
                showDefaultNodes();
            }
        }

        // 显示默认 11 个节点
        function showDefaultNodes() {
            const defaultList = [
                "cloudflare.182682.xyz", "freeyx.cloudflare88.eu.org", "bestcf.top",
                "cdn.2020111.xyz", "cf.0sm.com", "cf.090227.xyz",
                "cf.zhetengsha.eu.org", "cfip.1323123.xyz",
                "cloudflare-ip.mofashi.ltd", "cf.877771.xyz", "xn--b6gac.eu.org"
            ];
            renderNodeList(defaultList.map(n => ({ ip: n, name: n })));
        }

        function renderNodeList(nodes) {
            const countEl = document.getElementById('nodeCount');
            const itemsEl = document.getElementById('nodeItems');
            if (countEl) countEl.textContent = nodes.length;
            if (itemsEl) {
                if (nodes.length === 0) {
                    itemsEl.innerHTML = '<div style="color:#86868b;text-align:center;padding:8px;">暂无节点</div>';
                } else {
                    itemsEl.innerHTML = nodes.map(n => '<div class="node-item">' + escapeHtml(n.name || n.ip) + '</div>').join('');
                }
            }
        }

        function escapeHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
            if (!domain || !uuid) { alert('请先填写域名和UUID/Password'); return; }
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                alert('请至少开启一个短路径协议'); return;
            }

            const baseUrl = new URL(window.location.href).origin;
            const shortId = uuid.substring(0, 8);
            // 统计同时开启的协议数量
            const enabledProtos = [switches.switchVL, switches.switchTJ, switches.switchVM].filter(Boolean).length;

            let subUrl;
            if (enabledProtos > 1) {
                // 多协议同时开启：走 /all 短路由，内部为每个协议分别生成正确 path，避免非首选协议节点 WS 404
                subUrl = baseUrl + '/all';
            } else {
                // 单协议：使用该协议对应的 path
                let activePath = '/' + shortId + '-vl';
                if (!switches.switchVL && switches.switchTJ) activePath = '/' + shortId + '-tr';
                else if (!switches.switchVL && !switches.switchTJ && switches.switchVM) activePath = '/' + shortId + '-vm';
                subUrl = baseUrl + '/' + uuid + '/sub?domain=' + encodeURIComponent(domain)
                    + '&epd=' + (switches.switchNodes ? 'yes' : 'no')
                    + '&path=' + encodeURIComponent(activePath);
                if (switches.switchVL) subUrl += '&ev=yes';
                if (switches.switchTJ) subUrl += '&et=yes';
                if (switches.switchVM) subUrl += '&evm=yes';
            }
            if (switches.switchTLS) subUrl += '&dkby=yes';
            if (switches.switchECH) {
                subUrl += '&ech=yes';
                const dnsVal = document.getElementById('customDNS') && document.getElementById('customDNS').value.trim();
                if (dnsVal) subUrl += '&customDNS=' + encodeURIComponent(dnsVal);
                const domainVal = document.getElementById('customECHDomain') && document.getElementById('customECHDomain').value.trim();
                if (domainVal) subUrl += '&customECHDomain=' + encodeURIComponent(domainVal);
            }

            let finalUrl = subUrl;
            const urlEl = document.getElementById('clientSubscriptionUrl');

            if (clientType === 'v2ray') {
                urlEl.textContent = subUrl; urlEl.style.display = 'block';
                if (clientName === 'V2RAY') {
                    navigator.clipboard.writeText(subUrl).then(() => alert('V2RAY 订阅链接已复制'));
                } else if (clientName === 'V2RAYNG') {
                    tryOpenApp('v2rayng://install?url=' + encodeURIComponent(subUrl), () => {
                        navigator.clipboard.writeText(subUrl).then(() => alert('V2RAYNG 订阅链接已复制'));
                    });
                } else if (clientName === 'NEKORAY') {
                    tryOpenApp('nekoray://install-config?url=' + encodeURIComponent(subUrl), () => {
                        navigator.clipboard.writeText(subUrl).then(() => alert('NEKORAY 订阅链接已复制'));
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
            if (clientType === 'clash') {
                if (clientName === 'STASH') {
                    schemeUrl = 'stash://install?url=' + encodeURIComponent(finalUrl);
                } else {
                    schemeUrl = 'clash://install-config?url=' + encodeURIComponent(finalUrl);
                }
            }
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

// ============================================================
// 密码验证（页面式，密码从 env.PASSWORD 读取）
// ============================================================
function generateAuthPage(error = false) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>访问验证</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
            color: #1d1d1f; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .auth-card {
            background: rgba(255,255,255,0.8); backdrop-filter: blur(30px);
            border-radius: 24px; padding: 40px; max-width: 380px; width: 90%;
            box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05);
            border: 0.5px solid rgba(0,0,0,0.06); text-align: center;
        }
        .auth-card h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
        .auth-card p { font-size: 15px; color: #86868b; margin-bottom: 24px; }
        .auth-card input {
            width: 100%; padding: 14px 16px; font-size: 17px;
            background: rgba(142,142,147,0.12); border: 2px solid transparent; border-radius: 12px;
            outline: none; margin-bottom: 16px; text-align: center;
        }
        .auth-card input:focus { border-color: #007AFF; }
        .auth-card button {
            width: 100%; padding: 14px; font-size: 17px; font-weight: 600; color: #fff;
            background: #007AFF; border: none; border-radius: 14px; cursor: pointer;
        }
        .auth-card .error { color: #ff3b30; font-size: 14px; margin-top: 12px; ${error ? '' : 'display: none;'} }
        @media (prefers-color-scheme: dark) {
            body { background: linear-gradient(180deg,#000 0%,#1c1c1e 100%); color: #f5f5f7; }
            .auth-card { background: rgba(28,28,30,0.8); border-color: rgba(255,255,255,0.12); }
            .auth-card input { background: rgba(142,142,147,0.2); color: #f5f5f7; }
        }
    </style>
</head>
<body>
    <div class="auth-card">
        <h1>访问验证</h1>
        <p>请输入密码以访问订阅管理页面</p>
        <input type="password" id="password" placeholder="输入密码" onkeydown="if(event.key==='Enter')verify()">
        <button onclick="verify()">验证</button>
        <div class="error" id="errorMsg">密码错误，请重试</div>
    </div>
    <script>
        function verify() {
            const pwd = document.getElementById('password').value;
            if (!pwd) return;
            document.cookie = 'auth_token=' + encodeURIComponent(pwd) + '; path=/; max-age=86400; Secure; SameSite=Lax';
            window.location.reload();
        }
    </script>
</body>
</html>`;
}

function verifyAuth(request, env) {
    const password = env?.ACCESS_PASSWORD;
    if (!password) return null; // 未设置密码，不验证

    // 从 Cookie 读取 auth_token
    const cookies = request.headers.get('Cookie') || '';
    const match = cookies.match(/(?:^|;\s*)auth_token=([^;]*)/);
    if (match) {
        const token = decodeURIComponent(match[1]);
        if (token === password) return null; // 验证通过
        // Cookie 存在但密码错误 → 显示错误提示
        return new Response(generateAuthPage(true), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    return new Response(generateAuthPage(false), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

// 主处理函数
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 主页（静态页面）需要密码验证
        if (path === '/' || path === '') {
            const authResp = verifyAuth(request, env);
            if (authResp) return authResp;

            const scuValue = env?.scu || scu;
            return new Response(generateHomePage(scuValue, env), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // API: 获取 KV 节点列表
        if (path === '/api/nodes') {
            const authResp = verifyAuth(request, env);
            if (authResp) return authResp;
            const nodeList = await getCustomNodes(env);
            return new Response(JSON.stringify({ nodes: nodeList }), {
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        // 短路径跳转 — 硬编码，方便记忆
        // 使用前需在 Worker 环境变量中设置 SUB_UUID 和 SUB_DOMAIN
        const shortRoutes = {
            '/vl':  { ev: 'yes', et: 'no',  evm: 'no',  suffix: '-vl' },
            '/tr':  { ev: 'no',  et: 'yes', evm: 'no',  suffix: '-tr' },
            '/vm':  { ev: 'no',  et: 'no',  evm: 'yes', suffix: '-vm' },
            '/all': { ev: 'yes', et: 'yes', evm: 'yes' }, // /all 走独立分支，内部自定 suffix，此处无需 suffix
        };
        const shortRoute = shortRoutes[path];
        if (shortRoute) {
            const uuid = env?.SUB_UUID || SUB_UUID;
            const domain = env?.SUB_DOMAIN || SUB_DOMAIN;
            if (!uuid || !domain) {
                return new Response('请在 Worker 环境变量中设置 SUB_UUID 和 SUB_DOMAIN', { status: 500 });
            }
            const shortId = uuid.substring(0, 8);
            if (path === '/all') {
                const extraParams = new URLSearchParams();
                for (const [k, v] of url.searchParams) {
                    if (!["domain","ev","et","evm","path","epd","dkby"].includes(k)) {
                        extraParams.set(k, v);
                    }
                }
                const extraStr = extraParams.toString();
                const configs = [
                    { ev: 'yes', et: 'no',  evm: 'no',  suffix: '-vl' },
                    { ev: 'no',  et: 'yes', evm: 'no',  suffix: '-tr' },
                    { ev: 'no',  et: 'no',  evm: 'yes', suffix: '-vm' },
                ];
                let parts = [];
                for (const c of configs) {
                    const subPath = '/' + shortId + c.suffix;
                    let q = "domain=" + domain + "&epd=yes&ev=" + c.ev + "&et=" + c.et + "&evm=" + c.evm + "&dkby=yes&path=" + encodeURIComponent(subPath);
                    if (extraStr) q += "&" + extraStr;
                    const t = "/sub/" + uuid + "?" + q;
                    const fwd = new URL(t, url.origin);
                    const resp = await handleSubscriptionRequest(
                        new Request(fwd, request),
                        uuid, domain,
                        c.ev === 'yes', c.et === 'yes', c.evm === 'yes',
                        true, subPath, null, true, env
                    );
                    parts.push(await resp.text());
                }
                const target = url.searchParams.get('target') || 'base64';
                if (target === 'base64' || target === 'quanx' || target === 'quantumult') {
                    // 仅 base64/quanx target 各部分才是 base64 编码，可安全 atob 合并
                    const decoded = parts.map(function(p) { return atob(p); }).join(String.fromCharCode(10));
                    return new Response(btoa(decoded), {
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                }
                // clash/surge 等 target 各部分是 YAML 纯文本，直接拼接（允许重复 YAML 头，避免 atob 崩溃）
                const merged = parts.join(String.fromCharCode(10));
                const ct = (target === 'clash' || target === 'clashr') ? 'text/yaml; charset=utf-8' : 'text/plain; charset=utf-8';
                return new Response(merged, {
                    headers: { 'Content-Type': ct }
                });
            }
            const extraParams = new URLSearchParams();
            for (const [k, v] of url.searchParams) {
                if (!["domain","ev","et","evm","path","epd","dkby"].includes(k)) {
                    extraParams.set(k, v);
                }
            }
            const extraStr = extraParams.toString();
            const subPath = '/' + shortId + shortRoute.suffix;
            let query = "domain=" + domain + "&epd=yes&ev=" + shortRoute.ev + "&et=" + shortRoute.et + "&evm=" + shortRoute.evm + "&dkby=yes&path=" + encodeURIComponent(subPath);
            if (extraStr) query += "&" + extraStr;
            const target = "/sub/" + uuid + "?" + query;
            const forwarded = new URL(target, url.origin);
            return await handleSubscriptionRequest(
                new Request(forwarded, request),
                uuid, domain,
                shortRoute.ev === 'yes', shortRoute.et === 'yes', shortRoute.evm === 'yes',
                true, subPath, null, true, env
            );
        }

        // 订阅请求格式: /{UUID}/sub?domain=xxx&epd=yes
        const pathMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (pathMatch) {
            const uuid = pathMatch[1];
            const domain = url.searchParams.get('domain');
            if (!domain) {
                return new Response('缺少域名参数', { status: 400 });
            }

            const epdEnabled = url.searchParams.get('epd') !== 'no';
            const evEnabled = url.searchParams.get('ev') === 'yes' || (url.searchParams.get('ev') === null && ev);
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('evm') === 'yes';
            const disableNonTLS = url.searchParams.get('dkby') === 'yes';
            const echParam = url.searchParams.get('ech');
            const echEnabled = echParam === 'yes' || (echParam === null && enableECH);
            const customDNSParam = url.searchParams.get('customDNS') || customDNS;
            const customECHDomainParam = url.searchParams.get('customECHDomain') || customECHDomain;
            const echConfig = echEnabled ? `${customECHDomainParam}+${customDNSParam}` : null;
            const customPath = url.searchParams.get('path') || '/';

            return await handleSubscriptionRequest(request, uuid, domain, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath, echConfig, epdEnabled, env);
        }

        return new Response('Not Found', { status: 404 });
    }
};
