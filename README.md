# 会话清理（Session Cleaner）

DSH Web 界面插件：把本机所有会话按工作区分组列出，勾选后批量删除，释放磁盘空间。删除是「移入回收站」，7 天内可以恢复。

## 功能

- 左侧栏底部多一个「会话清理」图标，点击打开管理面板。
- 面板按工作区路径分组，显示会话标题、更新时间、大小、会话 ID，并标出「运行中 / 子会话 / 已归档 / 已置顶」。
- 支持全选、多选、单个删除。
- 删除 = 把会话目录改名移到 `<DSH_HOME>/session-cleaner/trash/<会话ID>/`，同时摘掉工作区记录。会话从列表消失，日志文件仍在回收站里。
- 面板底部的回收站列出已删除会话，可以逐个恢复或彻底删除；超过 7 天的条目在下次打开面板时自动清理。
- 「彻底删除」才真正从磁盘移除文件，不可撤销。
- 运行中的会话不能删除，勾选框会禁用：判断依据是 Agent 保留的会话，以及 `workspace/session-activity` 闸门报告的运行中回合、任务、定时任务。
- 还有子会话的会话不能直接删除；把父子会话一起勾选时会先删子会话再删父会话。
- 已失效的归档记录（会话文件早已不在）会在再次尝试删除时顺手清理。

## 原理

Host 半（`index.js`）在 Web 服务器上注册四个路由：

| 路由 | 作用 |
|---|---|
| `GET /session-cleaner/sessions` | 读取 `sessionPersistence.list()`、投影缓存里的标题、工作区注册表、活动闸门，外加回收站清单 |
| `POST /session-cleaner/delete` | 校验 ID → 拒绝运行中 / 有子会话 → 改名为回收站条目并写 `.json` 元数据 → `workspace.detachSession()`；记账失败就把文件改回来 |
| `POST /session-cleaner/restore` | 把目录改回原来的父目录 → `attachSession()`，并恢复归档 / 置顶状态 |
| `POST /session-cleaner/purge` | 删除回收站条目的文件（指定 ID 或 `{ all: true }`） |

Client 半（`client.js`）注册 `main` 面板和 `sidebar.panellist` 图标，只负责渲染与调用上述路由，选中超过 200 条时自动分批请求。

### 准入校验

插件注册的是自己的路径前缀，`webServer` 不会替它做鉴权（内核自己的 `/api` 路由是在 handler 里手动调 `connection.admit(req)` 的）。所以这里每个请求都过同一道闸：

1. 组合里存在 `connection` 服务时，直接用它的判定（含浏览器认证 cookie）；服务报错一律 503，不降级。
2. 没有该服务时走结构校验：Host 必须是回环地址、拒绝 `sec-fetch-site: cross-site`、`Origin`/`Referer` 必须与 Host 同源（桌面端 `dsh-app://app` 中继是唯一例外）。
3. 写接口的请求体必须是 `application/json` —— 这让浏览器先发预检，而预检会因为服务端没有 CORS 头而失败，堵住「任意网页跨站 POST 删会话」。

## 安装

```powershell
dsh plugin install <本目录>
```

或在插件管理里安装本目录。

## 注意

- 删除会同时移除会话记录和工作区登记；文件在回收站里保留 7 天。
- 彻底删除不可恢复。
- 投影缓存、搜索索引中的陈旧行会随会话缺失自然失效，不影响使用。
- 会话存储位置默认 `%DSH_HOME%\sessions`（未设置 `DSH_HOME` 时为 `~/.dsh/sessions`），面板底部会显示实际路径；回收站位于同级的 `session-cleaner/trash`。
