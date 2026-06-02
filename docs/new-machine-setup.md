# 新电脑安装后如何让 Cursor 呼吸灯生效

本文档说明：在一台全新 Mac 上，仅安装 `Cursor 呼吸灯` 的 `.dmg` 后，如何完成剩余配置，让菜单栏灯能实时反映 Cursor Agent 状态。

---

## 结论（先看）

安装 `.dmg` 只会得到菜单栏应用本体。要真正监控 Cursor 状态，还需要：

1. 安装并登录 Cursor
2. 配置用户级 Hooks（`~/.cursor/hooks.json`）
3. 将 Hook 脚本放到 `~/.cursor/hooks/`
4. 启动菜单栏应用（并保持运行）

---

## 原理简述

监控链路如下：

```text
Cursor Agent 事件
  -> 触发用户级 Hooks
  -> Hook 脚本计算状态（idle / thinking / coding）
  -> 写 ~/.cursor/breathing-light/state.json
  -> POST 到 http://127.0.0.1:39281/state
  -> 菜单栏应用更新三灯显示
```

因此，如果只有 `.dmg` 应用但没有 Hooks，灯不会随 Agent 动态变化。

---

## 前置条件

- macOS（Intel 或 Apple Silicon）
- 已安装 Cursor，且能正常使用 Agent
- 已安装 Node.js 22+（Hook 脚本通过 `node --experimental-strip-types` 运行）

检查命令：

```bash
node -v
```

---

## 安装步骤（新电脑）

### 1) 安装并启动菜单栏应用

1. 双击 `.dmg`
2. 将 `Cursor 呼吸灯.app` 拖入 `Applications`
3. 从应用程序中启动一次，确认菜单栏出现图标

> 如遇“已损坏”或被系统拦截，先处理 Gatekeeper/隔离属性问题后再继续。

### 2) 准备 Hook 脚本（必须）

你有两种方式：

#### 方式 A（推荐）：用项目里的安装脚本一键部署

如果新电脑上有项目源码，执行：

```bash
cd /path/to/cursor_breathing_light
npm install
npm run install-hooks
```

它会自动完成：

- 复制 `hooks/update-state.ts` 到 `~/.cursor/hooks/breathing-light-update.ts`
- 生成 `~/.cursor/hooks/breathing-light-update.sh`
- 合并写入 `~/.cursor/hooks.json` 对应事件

#### 方式 B：仅有 `.dmg`、没有源码时手动部署

1. 创建目录：

```bash
mkdir -p ~/.cursor/hooks
mkdir -p ~/.cursor/breathing-light
```

2. 放置 `breathing-light-update.ts` 到：

```text
~/.cursor/hooks/breathing-light-update.ts
```

3. 创建包装脚本 `~/.cursor/hooks/breathing-light-update.sh`：

```bash
#!/usr/bin/env bash
exec node --experimental-strip-types "$HOME/.cursor/hooks/breathing-light-update.ts"
```

并赋权：

```bash
chmod +x ~/.cursor/hooks/breathing-light-update.sh
chmod +x ~/.cursor/hooks/breathing-light-update.ts
```

4. 编辑 `~/.cursor/hooks.json`，确保以下事件注册了该命令：

- `beforeSubmitPrompt`
- `sessionStart`
- `preToolUse`
- `postToolUse`
- `postToolUseFailure`
- `afterFileEdit`
- `afterAgentThought`
- `stop`
- `sessionEnd`

每个事件下应包含：

```json
{ "command": "./hooks/breathing-light-update.sh" }
```

> 注意：是用户级路径 `~/.cursor/hooks.json`，不是项目内文件。

### 3) 重启 Cursor（关键）

Hook 配置更新后，重启 Cursor，确保新 Hooks 被加载。

### 4) 启动菜单栏应用并保持运行

打开 `Cursor 呼吸灯.app`，确认菜单栏图标存在。应用会监听本地端口 `127.0.0.1:39281`，接收 Hook 上报。

---

## 验证是否生效

### A. 功能验证（最直观）

1. 在 Cursor 向 Agent 发送消息，黄灯亮（`thinking`）
2. 让 Agent 执行写文件工具，红灯亮（`coding`）
3. 一轮结束，绿灯亮（`idle`）

### B. 命令行验证

手动触发一次 Hook：

```bash
echo '{"hook_event_name":"beforeSubmitPrompt","conversation_id":"test"}' \
  | node --experimental-strip-types ~/.cursor/hooks/breathing-light-update.ts
```

查看状态文件：

```bash
cat ~/.cursor/breathing-light/state.json
```

若菜单栏应用正在运行，再查 HTTP：

```bash
curl -s http://127.0.0.1:39281/state
```

---

## 常见问题

### 1. 只装了 `.dmg`，灯一直不变

原因：未配置 Hooks。  
处理：按本文“步骤 2”部署 Hooks。

### 2. `node --experimental-strip-types` 报错

原因：Node 版本过低。  
处理：升级到 Node 22+。

### 3. Hook 似乎执行了，但菜单栏不更新

排查：

- 菜单栏 App 是否运行中
- 端口 `39281` 是否被占用
- `~/.cursor/breathing-light/state.json` 是否在更新

### 4. 多个会话并发时状态偶尔不准

当前实现是简化状态机，任一 `stop` / `sessionEnd` 会回 `idle`，并发场景会有近似误差。

---

## 建议的交付方式（给其他电脑）

如果你要分发给其他用户，建议不要只给 `.dmg`，而是给“安装包 + Hooks 安装脚本”组合：

1. `Cursor 呼吸灯.dmg`
2. `install-hooks.sh`（或一键安装脚本）
3. 一页简短说明：先装 App，再装 Hooks，再重启 Cursor

