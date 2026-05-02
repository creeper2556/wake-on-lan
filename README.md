# Wake-on-LAN

局域网唤醒管理工具。添加设备 → 一键唤醒。

## 功能

- 设备管理（添加 / 删除 / 唤醒）
- 局域网扫描发现设备（ping sweep + ARP）
- 多维度设备识别：MAC 厂商、mDNS、NetBIOS、UPnP、端口扫描
- 在线状态检测
- 挑战-响应登录鉴权

## Docker 部署

```bash
docker compose up -d
```

访问 `http://<你的IP>:3579`，默认 `admin / password`。登录后改 `data/auth.json`。

## 手动部署

```bash
# Node >= 20
npm ci
npm run build
npm start
```
