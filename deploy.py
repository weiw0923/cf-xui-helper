#!/usr/bin/env python3
"""
CF-XUI 一键部署脚本
功能：
  1. 在 3x-ui 中创建节点（VLESS/Trojan/VMess）
  2. 配置 Cloudflare DNS（A记录）、SSL、Origin Rules
  3. 部署 Cloudflare Worker 订阅生成器
  4. 创建 KV namespace 并绑定到 Worker
"""

import ipaddress
import json
import os
import random
import sqlite3
import subprocess
import sys
import uuid
from getpass import getpass
from typing import Any, Dict, List, Optional, Set
from urllib import error, parse, request


# ============================================================
# 常量
# ============================================================
DB_PATH = "/etc/x-ui/x-ui.db"
STATE_PATH = "/etc/x-ui/cf_auto_state.json"
CF_API_BASE = "https://api.cloudflare.com/client/v4"
PORT_MIN = 10000
PORT_MAX = 60000
PROTOCOL_ORDER = ["vless", "trojan", "vmess"]
PROTOCOL_SUFFIX = {"vless": "vl", "trojan": "tr", "vmess": "vm"}
PROTOCOL_LABEL = {"vless": "VLESS", "trojan": "TROJAN", "vmess": "VMESS"}
PROTOCOL_QUERY_FLAG = {"vless": "ev", "trojan": "et", "vmess": "evm"}
MANAGED_RULE_PREFIX = "3x-ui-auto "

# Worker JS 源码 — 部署时从同目录 _worker.js 读取
def get_worker_js(user_uuid: str = "", domain: str = "") -> str:
    """获取 _worker.js 内容，优先本地文件，其次从 GitHub 下载
       并注入 UUID 和域名到代码常量中"""
    local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_worker.js")
    if os.path.exists(local_path):
        with open(local_path, "r", encoding="utf-8") as f:
            js = f.read()
    # 本地没有则从 GitHub 下载
    else:
        try:
            with request.urlopen("https://raw.githubusercontent.com/weiw0923/cf-xui-helper/main/_worker.js", timeout=15) as resp:
                js = resp.read().decode("utf-8")
        except Exception:
            exit_error("无法获取 _worker.js，请确保该文件与 deploy.py 在同一目录")

    # 注入 UUID 和域名到 _worker.js 常量中
    if user_uuid:
        js = js.replace('const SUB_UUID = "";', f'const SUB_UUID = "{user_uuid}";')
    if domain:
        js = js.replace('const SUB_DOMAIN = "";', f'const SUB_DOMAIN = "{domain}";')
    return js


# ============================================================
# 辅助函数
# ============================================================
def exit_error(message: str) -> None:
    print(message)
    sys.exit(1)


def call_json_api(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    data: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
    exit_on_http_error: bool = True,
):
    payload = None
    if data is not None:
        payload = json.dumps(data).encode("utf-8")
    req = request.Request(url=url, data=payload, headers=headers or {}, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        if exit_on_http_error:
            print(body)
            sys.exit(1)
        if body:
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"success": False, "errors": [{"message": body}]}
        return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}
    except error.URLError as e:
        exit_error(f"网络错误: {e}")
    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}


def call_cf_api(
    method: str,
    endpoint: str,
    headers: Dict[str, str],
    data: Optional[Dict[str, Any]] = None,
):
    result = call_json_api(method=method, url=f"{CF_API_BASE}{endpoint}", headers=headers, data=data)
    if not result.get("success", False):
        errors = result.get("errors") or [{"message": "Cloudflare API 未知错误"}]
        print(json.dumps(errors, ensure_ascii=False))
        sys.exit(1)
    return result.get("result")


def get_public_ipv4() -> str:
    providers = [
        "https://api.ipify.org",
        "https://ipv4.icanhazip.com",
        "https://ifconfig.me/ip",
    ]
    for url in providers:
        try:
            with request.urlopen(url, timeout=8) as resp:
                ip_text = resp.read().decode("utf-8").strip()
            ipaddress.IPv4Address(ip_text)
            return ip_text
        except Exception:
            continue
    exit_error("获取公网 IPv4 失败")


def find_best_zone(domain: str, zones: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    input_domain = domain.strip(".").lower()
    best_match = None
    for zone in zones:
        zone_name = str(zone.get("name", "")).strip(".").lower()
        if not zone_name:
            continue
        if input_domain == zone_name or input_domain.endswith(f".{zone_name}"):
            if best_match is None or len(zone_name) > len(best_match["name"]):
                best_match = zone
    return best_match


def fetch_all_zones(headers: Dict[str, str]) -> List[Dict[str, Any]]:
    page = 1
    zones: List[Dict[str, Any]] = []
    while True:
        endpoint = f"/zones?per_page=100&page={page}"
        result = call_json_api("GET", f"{CF_API_BASE}{endpoint}", headers=headers)
        if not result.get("success", False):
            errors = result.get("errors") or [{"message": "获取 Zone 列表失败"}]
            print(json.dumps(errors, ensure_ascii=False))
            sys.exit(1)
        zones.extend(result.get("result", []))
        info = result.get("result_info") or {}
        total_pages = int(info.get("total_pages") or 1)
        if page >= total_pages:
            break
        page += 1
    return zones


# ============================================================
# Worker 部署函数
# ============================================================
def find_or_create_worker(headers: Dict[str, str], worker_name: str, user_uuid: str = "", domain: str = "", password: str = "") -> str:
    """查找或创建 Worker，返回 Worker 域名"""
    # 检查是否已存在
    result = call_json_api(
        "GET",
        f"{CF_API_BASE}/accounts/{get_account_id(headers)}/workers/scripts/{worker_name}",
        headers=headers,
        exit_on_http_error=False,
    )
    if result.get("success", False):
        print(f"  Worker '{worker_name}' 已存在，将更新代码")
    else:
        print(f"  正在创建 Worker '{worker_name}'...")

    # 上传 Worker 代码
    upload_worker(headers, worker_name, user_uuid, domain, password=password)
    worker_domain = f"{worker_name}.{get_worker_subdomain(headers)}"
    print(f"  Worker 部署完成: https://{worker_domain}")

    # 启用 workers.dev 子域名路由
    _enable_worker_route(headers, worker_name)

    return worker_domain


def _enable_worker_route(headers: Dict[str, str], worker_name: str) -> None:
    """启用 Worker 的 workers.dev 子域名路由"""
    account_id = get_account_id(headers)
    result = call_json_api(
        "POST",
        f"{CF_API_BASE}/accounts/{account_id}/workers/scripts/{worker_name}/subdomain",
        headers=headers,
        data={"enabled": True},
    )
    if result.get("success", False):
        print(f"  已启用 workers.dev 子域名路由")


def get_account_id(headers: Dict[str, str]) -> str:
    """获取 Cloudflare 账户 ID"""
    result = call_cf_api("GET", "/accounts", headers=headers)
    if not result:
        exit_error("无法获取 Cloudflare 账户信息")
    return str(result[0]["id"])


def get_worker_subdomain(headers: Dict[str, str]) -> str:
    """获取 workers.dev 子域名"""
    result = call_json_api(
        "GET",
        f"{CF_API_BASE}/accounts/{get_account_id(headers)}/workers/subdomain",
        headers=headers,
        exit_on_http_error=False,
    )
    if result.get("success", False):
        subdomain = result["result"].get("subdomain", "")
        if subdomain:
            return f"{subdomain}.workers.dev"
    # 尝试通过账户信息获取
    return "workers.dev"


def build_worker_bindings(password: str = "", kv_namespace_id: str = "") -> list:
    """构建 Worker 的 bindings 列表"""
    bindings: list = []
    if password:
        bindings.append({
            "name": "ACCESS_PASSWORD",
            "type": "secret_text",
            "text": password,
        })
    if kv_namespace_id:
        bindings.append({
            "name": "PD",
            "type": "kv_namespace",
            "namespace_id": kv_namespace_id,
        })
    return bindings


def upload_worker(headers: Dict[str, str], worker_name: str, user_uuid: str = "", domain: str = "", password: str = "") -> None:
    """上传 Worker 脚本"""
    account_id = get_account_id(headers)
    url = f"{CF_API_BASE}/accounts/{account_id}/workers/scripts/{worker_name}"

    # 准备 multipart 表单数据
    import io
    import mimetypes

    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"

    # Part 1: 元数据
    metadata = json.dumps({
        "main_module": "_worker.js",
        "bindings": build_worker_bindings(password=password),
    })

    # Part 2: JS 代码（注入 UUID 和域名）
    body_parts = []
    body_parts.append(f"--{boundary}\r\n")
    body_parts.append('Content-Disposition: form-data; name="metadata"\r\n')
    body_parts.append("Content-Type: application/json\r\n\r\n")
    body_parts.append(f"{metadata}\r\n")

    body_parts.append(f"--{boundary}\r\n")
    body_parts.append('Content-Disposition: form-data; name="_worker.js"; filename="_worker.js"\r\n')
    body_parts.append("Content-Type: application/javascript+module\r\n\r\n")
    body_parts.append(f"{get_worker_js(user_uuid, domain)}\r\n")

    body_parts.append(f"--{boundary}--\r\n")

    body = "".join(body_parts).encode("utf-8")

    # 自定义 headers
    upload_headers = dict(headers)
    upload_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    req = request.Request(url=url, data=body, headers=upload_headers, method="PUT")
    try:
        with request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if not result.get("success", False):
                errors = result.get("errors") or [{"message": "上传 Worker 失败"}]
                print(json.dumps(errors, ensure_ascii=False))
                sys.exit(1)
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(body)
        sys.exit(1)


def create_kv_namespace(headers: Dict[str, str], kv_name: str) -> str:
    """创建 KV namespace，返回 namespace ID"""
    account_id = get_account_id(headers)
    result = call_json_api(
        "POST",
        f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces",
        headers=headers,
        data={"title": kv_name},
        exit_on_http_error=False,
    )
    if not result.get("success", False):
        # 可能已存在，查找
        existing = call_json_api(
            "GET",
            f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces",
            headers=headers,
        )
        if existing:
            for ns in existing:
                if ns.get("title") == kv_name:
                    print(f"  KV namespace '{kv_name}' 已存在 (ID: {ns['id']})")
                    return str(ns["id"])
        exit_error("创建 KV namespace 失败")
    ns_id = str(result["result"]["id"])
    print(f"  已创建 KV namespace '{kv_name}' (ID: {ns_id})")
    return ns_id


def bind_kv_to_worker(headers: Dict[str, str], worker_name: str, kv_namespace_id: str, user_uuid: str = "", domain: str = "", password: str = "") -> None:
    """给 Worker 绑定 KV namespace 和密码"""
    account_id = get_account_id(headers)

    # 先获取当前 Worker 的绑定状态
    result = call_json_api(
        "GET",
        f"{CF_API_BASE}/accounts/{account_id}/workers/scripts/{worker_name}",
        headers=headers,
    )
    if not result:
        exit_error(f"获取 Worker '{worker_name}' 信息失败")

    # 重新上传 Worker 并带上绑定
    import io
    import mimetypes

    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"

    metadata = json.dumps({
        "main_module": "_worker.js",
        "bindings": build_worker_bindings(password=password, kv_namespace_id=kv_namespace_id),
    })

    body_parts = []
    body_parts.append(f"--{boundary}\r\n")
    body_parts.append('Content-Disposition: form-data; name="metadata"\r\n')
    body_parts.append("Content-Type: application/json\r\n\r\n")
    body_parts.append(f"{metadata}\r\n")

    body_parts.append(f"--{boundary}\r\n")
    body_parts.append('Content-Disposition: form-data; name="_worker.js"; filename="_worker.js"\r\n')
    body_parts.append("Content-Type: application/javascript+module\r\n\r\n")
    body_parts.append(f"{get_worker_js(user_uuid, domain)}\r\n")

    body_parts.append(f"--{boundary}--\r\n")

    body = "".join(body_parts).encode("utf-8")

    upload_headers = dict(headers)
    upload_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    url = f"{CF_API_BASE}/accounts/{account_id}/workers/scripts/{worker_name}"
    req = request.Request(url=url, data=body, headers=upload_headers, method="PUT")
    try:
        with request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if not result.get("success", False):
                errors = result.get("errors") or [{"message": "绑定 KV 到 Worker 失败"}]
                print(json.dumps(errors, ensure_ascii=False))
                sys.exit(1)
            print("  KV 绑定成功 (PD -> Worker)")
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(body)
        sys.exit(1)


def set_kv_value(headers: Dict[str, str], kv_namespace_id: str, key: str, value: str) -> None:
    """写入 KV 数据（纯文本，非 JSON）"""
    account_id = get_account_id(headers)
    encoded_key = parse.quote(key, safe='')

    # 使用 urllib 直接上传纯文本（不用 call_json_api，因为后者会 JSON 编码 body）
    url = f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces/{kv_namespace_id}/values/{encoded_key}"
    data = value.encode("utf-8")
    req = request.Request(url, data=data, method="PUT")
    req.add_header("X-Auth-Email", headers.get("X-Auth-Email", ""))
    req.add_header("X-Auth-Key", headers.get("X-Auth-Key", ""))
    req.add_header("Content-Type", "text/plain; charset=utf-8")

    try:
        with request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if not result.get("success", False):
                errors = result.get("errors") or [{"message": "写入 KV 失败"}]
                print(json.dumps(errors, ensure_ascii=False))
                sys.exit(1)
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(body)
        sys.exit(1)

    print(f"  KV 已写入 key='{key}'")


def delete_kv_namespace(headers: Dict[str, str], kv_namespace_id: str) -> None:
    """删除 KV namespace"""
    account_id = get_account_id(headers)
    call_json_api(
        "DELETE",
        f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces/{kv_namespace_id}",
        headers=headers,
    )


def delete_worker(headers: Dict[str, str], worker_name: str) -> None:
    """删除 Worker 脚本"""
    account_id = get_account_id(headers)
    result = call_json_api(
        "DELETE",
        f"{CF_API_BASE}/accounts/{account_id}/workers/scripts/{worker_name}",
        headers=headers,
        exit_on_http_error=False,
    )
    if result.get("success", False):
        print(f"  Worker '{worker_name}' 已删除")
    else:
        print(f"  Worker '{worker_name}' 不存在或无法删除")


# ============================================================
# DNS / SSL / Origin Rules 函数 (同原 xui_cf_deployer)
# ============================================================
def get_dns_record(zone_id: str, domain: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    q = parse.urlencode({"type": "A", "name": domain})
    existing = call_cf_api("GET", f"/zones/{zone_id}/dns_records?{q}", headers=headers)
    if existing:
        return existing[0]
    return None


def upsert_dns_record(zone_id: str, domain: str, ip: str, headers: Dict[str, str]) -> str:
    existing = get_dns_record(zone_id, domain, headers)
    payload = {"type": "A", "name": domain, "content": ip, "proxied": True, "ttl": 1}
    if existing:
        record_id = str(existing["id"])
        call_cf_api("PUT", f"/zones/{zone_id}/dns_records/{record_id}", headers=headers, data=payload)
        return record_id
    else:
        created = call_cf_api("POST", f"/zones/{zone_id}/dns_records", headers=headers, data=payload)
        return str(created["id"])


def get_ssl_mode(zone_id: str, headers: Dict[str, str]) -> str:
    result = call_cf_api("GET", f"/zones/{zone_id}/settings/ssl", headers=headers)
    value = str(result.get("value", "")).strip()
    if not value:
        exit_error("读取 Cloudflare SSL 模式失败")
    return value


def set_ssl_mode(zone_id: str, headers: Dict[str, str], mode: str) -> None:
    call_cf_api("PATCH", f"/zones/{zone_id}/settings/ssl", headers=headers, data={"value": mode})


def build_origin_rules(routes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rules = []
    for route in routes:
        rules.append({
            "description": f"{MANAGED_RULE_PREFIX}{route['protocol']} {route['path']}",
            "enabled": True,
            "expression": f'(http.request.uri.path eq "{route["path"]}")',
            "action": "route",
            "action_parameters": {"origin": {"port": route["port"]}},
        })
    return rules


def strip_managed_origin_rules(rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [r for r in rules if not str(r.get("description", "")).startswith(MANAGED_RULE_PREFIX)]


def get_origin_rules(zone_id: str, headers: Dict[str, str]) -> List[Dict[str, Any]]:
    result = call_json_api(
        "GET",
        f"{CF_API_BASE}/zones/{zone_id}/rulesets/phases/http_request_origin/entrypoint",
        headers=headers,
        exit_on_http_error=False,
    )
    if not result.get("success", False):
        return []
    ruleset = result.get("result") or {}
    rules = ruleset.get("rules")
    return rules if isinstance(rules, list) else []


def put_origin_rules(zone_id: str, headers: Dict[str, str], rules: List[Dict[str, Any]]) -> None:
    payload = {"rules": rules}
    call_cf_api(
        "PUT",
        f"/zones/{zone_id}/rulesets/phases/http_request_origin/entrypoint",
        headers=headers,
        data=payload,
    )


def apply_origin_rules(zone_id: str, headers: Dict[str, str], routes: List[Dict[str, Any]]) -> None:
    existing = get_origin_rules(zone_id, headers)
    next_rules = strip_managed_origin_rules(existing) + build_origin_rules(routes)
    put_origin_rules(zone_id, headers, next_rules)


# ============================================================
# 3x-ui 操作
# ============================================================
def protocol_settings(protocol: str, user_uuid: str) -> Dict[str, Any]:
    if protocol == "vless":
        return {"clients": [{"id": user_uuid, "flow": ""}], "decryption": "none", "fallbacks": []}
    if protocol == "trojan":
        return {"clients": [{"password": user_uuid, "flow": ""}], "fallbacks": []}
    if protocol == "vmess":
        return {"clients": [{"id": user_uuid, "alterId": 0}]}
    raise ValueError(f"不支持的协议: {protocol}")


def ws_stream_settings(path: str) -> Dict[str, Any]:
    return {
        "network": "ws",
        "security": "none",
        "wsSettings": {"path": path},
    }


def sniffing_settings() -> Dict[str, Any]:
    return {"enabled": True, "destOverride": ["http", "tls"], "metadataOnly": False, "routeOnly": False}


def allocate_settings() -> Dict[str, Any]:
    return {"strategy": "always", "refresh": 5, "concurrency": 3}


def load_existing_ports(conn: sqlite3.Connection) -> Set[int]:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT port FROM inbounds")
    except sqlite3.Error:
        return set()
    ports = set()
    for row in cursor.fetchall():
        try:
            ports.add(int(row[0]))
        except Exception:
            continue
    return ports


def random_ports(count: int, existing: Set[int]) -> List[int]:
    selected = set()
    while len(selected) < count:
        p = random.randint(PORT_MIN, PORT_MAX)
        if p in existing or p in selected:
            continue
        selected.add(p)
    return list(selected)


def parse_protocol_selection(raw: str) -> List[str]:
    text = raw.strip().lower()
    if not text:
        return list(PROTOCOL_ORDER)
    index_mapping = {"1": "vless", "2": "trojan", "3": "vmess"}
    name_mapping = {"vless": "vless", "trojan": "trojan", "vmess": "vmess"}
    selected: List[str] = []
    for token in text.replace(" ", "").split(","):
        if not token:
            continue
        protocol = index_mapping.get(token) or name_mapping.get(token)
        if protocol is None:
            exit_error(f"无效协议选项: {token}")
        if protocol not in selected:
            selected.append(protocol)
    if not selected:
        exit_error("至少选择一个协议")
    return selected


def parse_mode(raw: str) -> str:
    text = raw.strip().lower()
    if text in ("", "1", "install", "i", "安装"):
        return "install"
    if text in ("2", "uninstall", "u", "卸载"):
        return "uninstall"
    exit_error("无效模式，仅支持 1(安装) 或 2(卸载)")


def get_inbounds_schema(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(inbounds)")
    rows = cursor.fetchall()
    schema: List[Dict[str, Any]] = []
    for row in rows:
        schema.append({"name": row[1], "type": (row[2] or "").upper(), "notnull": bool(row[3]), "default": row[4], "pk": bool(row[5])})
    return schema


def load_template_inbound(conn: sqlite3.Connection) -> Dict[str, Any]:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM inbounds ORDER BY id LIMIT 1")
    row = cursor.fetchone()
    if row is None:
        return {}
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


def infer_default_value(col_type: str):
    if "INT" in col_type:
        return 0
    if "REAL" in col_type or "FLOA" in col_type or "DOUB" in col_type:
        return 0
    if "BLOB" in col_type:
        return b""
    return ""


def insert_inbounds(db_path: str, user_uuid: str, short_id: str, routes: List[Dict[str, Any]]) -> List[int]:
    try:
        conn = sqlite3.connect(db_path)
    except sqlite3.Error as e:
        exit_error(str(e))
    try:
        schema = get_inbounds_schema(conn)
        if not schema:
            exit_error("未找到 inbounds 表")
        template = load_template_inbound(conn)
        cursor = conn.cursor()
        inserted_ids: List[int] = []
        for route in routes:
            protocol = route["protocol"]
            row_data = dict(template)
            row_data.update({
                "user_id": 1, "enable": 1, "up": 0, "down": 0, "total": 0,
                "remark": f"{short_id}-{protocol}", "listen": "", "port": route["port"],
                "protocol": protocol,
                "settings": json.dumps(protocol_settings(protocol, user_uuid), separators=(",", ":")),
                "stream_settings": json.dumps(ws_stream_settings(route["path"]), separators=(",", ":")),
                "sniffing": json.dumps(sniffing_settings(), separators=(",", ":")),
                "allocate": json.dumps(allocate_settings(), separators=(",", ":")),
                "tag": f"{short_id}-{protocol}",
            })
            columns: List[str] = []
            values: List[Any] = []
            for col in schema:
                name = col["name"]
                if col["pk"]:
                    continue
                if name in row_data:
                    columns.append(name)
                    values.append(row_data[name])
                    continue
                if col["notnull"] and col["default"] is None:
                    columns.append(name)
                    values.append(infer_default_value(col["type"]))
            placeholders = ",".join(["?"] * len(columns))
            sql = f"INSERT INTO inbounds ({','.join(columns)}) VALUES ({placeholders})"
            cursor.execute(sql, values)
            inserted_ids.append(int(cursor.lastrowid))
        conn.commit()
        return inserted_ids
    except sqlite3.Error as e:
        print(str(e))
        sys.exit(1)
    finally:
        conn.close()


def delete_inbounds(db_path: str, inbound_ids: List[int], tags: List[str]) -> None:
    try:
        conn = sqlite3.connect(db_path)
    except sqlite3.Error as e:
        exit_error(str(e))
    try:
        cursor = conn.cursor()
        if inbound_ids:
            placeholders = ",".join(["?"] * len(inbound_ids))
            cursor.execute(f"DELETE FROM inbounds WHERE id IN ({placeholders})", inbound_ids)
        elif tags:
            placeholders = ",".join(["?"] * len(tags))
            cursor.execute(f"DELETE FROM inbounds WHERE tag IN ({placeholders})", tags)
        conn.commit()
    except sqlite3.Error as e:
        print(str(e))
        sys.exit(1)
    finally:
        conn.close()


def restart_xui() -> None:
    try:
        result = subprocess.run(["systemctl", "restart", "x-ui"], capture_output=True, text=True, check=True)
        if result.stderr.strip():
            print(result.stderr.strip())
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        stdout = (e.stdout or "").strip()
        if stderr:
            print(stderr)
        elif stdout:
            print(stdout)
        else:
            print(str(e))
        sys.exit(1)


# ============================================================
# 状态管理
# ============================================================
def load_last_state() -> Optional[Dict[str, Any]]:
    if not os.path.exists(STATE_PATH):
        return None
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        exit_error(f"读取上次配置失败: {e}")
    return data if isinstance(data, dict) else None


def save_last_state(state: Dict[str, Any]) -> None:
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.chmod(STATE_PATH, 0o600)
    except OSError as e:
        exit_error(f"保存上次配置失败: {e}")


def remove_last_state() -> None:
    try:
        if os.path.exists(STATE_PATH):
            os.remove(STATE_PATH)
    except OSError as e:
        exit_error(f"删除上次配置记录失败: {e}")


# ============================================================
# 卸载
# ============================================================
def restore_dns_record(zone_id: str, domain: str, headers: Dict[str, str], dns_backup: Optional[Dict[str, Any]], managed_dns_record_id: str) -> None:
    existed = bool((dns_backup or {}).get("existed"))
    record = (dns_backup or {}).get("record") or {}
    if existed:
        record_id = str(record.get("id", "")).strip()
        if not record_id:
            current = get_dns_record(zone_id, domain, headers)
            if current:
                record_id = str(current.get("id", "")).strip()
        if not record_id:
            return
        payload = {
            "type": record.get("type", "A"), "name": record.get("name", domain),
            "content": record.get("content", ""), "proxied": bool(record.get("proxied", False)),
            "ttl": int(record.get("ttl", 1)),
        }
        if not payload["content"]:
            return
        call_cf_api("PUT", f"/zones/{zone_id}/dns_records/{record_id}", headers=headers, data=payload)
        return
    record_id = managed_dns_record_id.strip()
    if not record_id:
        current = get_dns_record(zone_id, domain, headers)
        if current:
            record_id = str(current.get("id", "")).strip()
    if record_id:
        call_cf_api("DELETE", f"/zones/{zone_id}/dns_records/{record_id}", headers=headers)


def uninstall_last_config(state: Dict[str, Any], headers: Dict[str, str]) -> None:
    domain = str(state.get("domain", "")).strip()
    zone_id = str(state.get("zone_id", "")).strip()
    if not domain or not zone_id:
        exit_error("上次配置缺少 domain 或 zone_id，无法卸载")

    # 清理 Worker 和 KV
    worker_name = state.get("worker_name", "")
    kv_namespace_id = state.get("kv_namespace_id", "")
    if worker_name:
        print("  清理 Cloudflare Worker...")
        delete_worker(headers, worker_name)
    if kv_namespace_id:
        print("  清理 KV namespace...")
        delete_kv_namespace(headers, kv_namespace_id)

    # 清理 Origin Rules
    origin_backup = state.get("origin_rules_backup")
    if isinstance(origin_backup, list):
        put_origin_rules(zone_id, headers, origin_backup)
    else:
        current_rules = get_origin_rules(zone_id, headers)
        put_origin_rules(zone_id, headers, strip_managed_origin_rules(current_rules))

    # 恢复 SSL
    ssl_backup = str(state.get("ssl_backup", "")).strip()
    if ssl_backup:
        set_ssl_mode(zone_id, headers, ssl_backup)

    # 恢复 DNS
    restore_dns_record(zone_id, domain, headers, state.get("dns_backup"), str(state.get("managed_dns_record_id", "")))

    # 清理 3x-ui inbounds
    inbound_ids: List[int] = []
    for item in state.get("inbound_ids", []):
        try:
            inbound_ids.append(int(item))
        except Exception:
            continue
    tags = [str(x) for x in state.get("tags", []) if str(x).strip()]
    delete_inbounds(DB_PATH, inbound_ids, tags)
    restart_xui()


# ============================================================
# 主流程
# ============================================================
def main() -> None:
    mode = parse_mode(input("模式(1=安装, 2=卸载，回车=安装): "))
    last_state = load_last_state()

    if mode == "uninstall":
        if last_state is None:
            exit_error("未检测到上次配置，无法卸载")
        cf_email = input("Cloudflare 邮箱: ").strip()
        cf_key = getpass("Cloudflare Global API Key: ").strip()
        if not cf_email or not cf_key:
            exit_error("邮箱和 API Key 不能为空")
        headers = {"X-Auth-Email": cf_email, "X-Auth-Key": cf_key, "Content-Type": "application/json"}
        uninstall_last_config(last_state, headers)
        remove_last_state()
        print("卸载成功")
        return

    if last_state is not None:
        last_domain = str(last_state.get("domain", "未知域名"))
        exit_error(f"检测到上次配置({last_domain})，请先执行卸载")

    domain = input("绑定域名: ").strip()
    cf_email = input("Cloudflare 邮箱: ").strip()
    cf_key = getpass("Cloudflare Global API Key: ").strip()
    selected_protocols = parse_protocol_selection(
        input("创建协议(1=vless,2=trojan,3=vmess，逗号分隔，留空=全部): ")
    )

    # Worker 名称
    worker_name = input("Cloudflare Worker 名称(回车使用 cf-xui-sub): ").strip()
    if not worker_name:
        worker_name = "cf-xui-sub"

    # 是否创建 KV
    create_kv = input("是否创建 KV 绑定(用于自定义节点列表)? (Y/n): ").strip().lower()
    kv_opt_in = create_kv != "n"

    # 密码保护
    worker_password = input("设置 Worker 页面访问密码(回车=不设置密码): ").strip()

    if not domain or not cf_email or not cf_key or not selected_protocols:
        exit_error("域名、邮箱、API Key 和协议选项不能为空")

    user_uuid = str(uuid.uuid4())
    short_id = user_uuid[:8]

    # 3x-ui 创建节点
    print("\n[1/8] 配置 3x-ui 节点...")
    try:
        with sqlite3.connect(DB_PATH) as conn:
            existing_ports = load_existing_ports(conn)
    except sqlite3.Error as e:
        exit_error(str(e))

    ports = random_ports(len(selected_protocols), existing_ports)
    routes = []
    for i, protocol in enumerate(selected_protocols):
        routes.append({
            "protocol": protocol,
            "port": ports[i],
            "path": f"/{short_id}-{PROTOCOL_SUFFIX[protocol]}",
        })

    headers = {"X-Auth-Email": cf_email, "X-Auth-Key": cf_key, "Content-Type": "application/json"}

    print("[2/8] 获取 Cloudflare Zone 信息...")
    zones = fetch_all_zones(headers)
    zone = find_best_zone(domain, zones)
    if zone is None:
        exit_error(f"无法匹配该域名对应的 Zone: {domain}")
    zone_id = zone["id"]

    print("[3/8] 获取公网 IP...")
    public_ip = get_public_ipv4()

    print("[4/8] 备份 DNS / SSL / Origin Rules...")
    dns_before = get_dns_record(zone_id, domain, headers)
    ssl_before = get_ssl_mode(zone_id, headers)
    origin_rules_before = get_origin_rules(zone_id, headers)

    print("[5/8] 插入 3x-ui 数据库记录...")
    inbound_ids = insert_inbounds(DB_PATH, user_uuid=user_uuid, short_id=short_id, routes=routes)
    restart_xui()

    print("[6/8] 配置 Cloudflare DNS / SSL / Origin Rules...")
    managed_dns_record_id = upsert_dns_record(zone_id, domain, public_ip, headers)
    set_ssl_mode(zone_id, headers, "flexible")
    apply_origin_rules(zone_id, headers, routes)

    print("[7/8] 部署 Cloudflare Worker 订阅生成器...")
    worker_domain = find_or_create_worker(headers, worker_name, user_uuid, domain, password=worker_password)

    kv_namespace_id = ""
    if kv_opt_in:
        print("[7.1/8] 创建 KV namespace...")
        kv_name = f"{worker_name}-kv"
        kv_namespace_id = create_kv_namespace(headers, kv_name)
        print("[7.2/8] 绑定 KV 到 Worker...")
        bind_kv_to_worker(headers, worker_name, kv_namespace_id, user_uuid, domain, password=worker_password)
        # 写入初始节点列表（默认优选域名）
        default_kv_nodes = [
            "cloudflare.182682.xyz",
            "freeyx.cloudflare88.eu.org",
            "bestcf.top",
            "cdn.2020111.xyz",
            "cf.0sm.com",
            "cf.090227.xyz",
            "cf.zhetengsha.eu.org",
            "cfip.1323123.xyz",
            "cloudflare-ip.mofashi.ltd",
            "cf.877771.xyz",
            "xn--b6gac.eu.org",
        ]
        set_kv_value(headers, kv_namespace_id, "nodes", "\n".join(default_kv_nodes))

    # 保存状态
    print("[8/8] 保存状态...")
    state = {
        "version": 2,
        "domain": domain,
        "zone_id": zone_id,
        "uuid": user_uuid,
        "short_id": short_id,
        "routes": routes,
        "inbound_ids": inbound_ids,
        "tags": [f"{short_id}-{p}" for p in selected_protocols],
        "managed_dns_record_id": managed_dns_record_id,
        "dns_backup": {"existed": dns_before is not None, "record": dns_before},
        "ssl_backup": ssl_before,
        "origin_rules_backup": origin_rules_before,
        "worker_name": worker_name,
        "kv_namespace_id": kv_namespace_id,
    }
    save_last_state(state)

    # 输出订阅链接
    sub_base = f"https://{worker_domain}"
    print(f"\n{'='*50}")
    print(f"部署完成！")
    print(f"Worker 地址: https://{worker_domain}")
    print(f"订阅基础URL: {sub_base}")
    print(f"{'='*50}")

    for protocol in selected_protocols:
        params = {
            "domain": domain,
            "epd": "yes",
            "ev": "no",
            "et": "no",
            "evm": "no",
            "dkby": "yes",
        }
        params[PROTOCOL_QUERY_FLAG[protocol]] = "yes"
        params["path"] = next(r["path"] for r in routes if r["protocol"] == protocol)
        link = f"{sub_base}/{user_uuid}/sub?{parse.urlencode(params, safe='', quote_via=parse.quote)}"
        print(f"{PROTOCOL_LABEL[protocol]} 订阅: {link}")

    # 提示手动修改 KV 节点
    if kv_namespace_id:
        print(f"\n💡 提示: 你可以登录 Cloudflare Dashboard，在 KV 中找到 '{kv_name}'")
        print(f"   编辑 key 'nodes' 的值来添加/修改自定义节点列表（每行一个域名或IP）")


if __name__ == "__main__":
    main()
