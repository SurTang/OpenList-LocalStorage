# OpenList-LocalStorage 功能规格说明书

> 版本：v4.1.0-local  
> 更新：2026-10-28  
> 适用：`dist/openlist.exe`（单文件）、IIS 站点、Node.js 托管  
> 许可证：AGPL-3.0（基于 [OpenList](https://github.com/OpenListTeam/OpenList) 改造）

---

## 1. 项目概述

### 1.1 定位

把原本面向多云盘的聚合程序，收敛成一个**只跑在 Windows、只服务本地与内网存储**的 Web 文件浏览器 / 共享服务器。删除所有依赖公网的驱动与附加模块，只保留能离线自洽运行的能力。

### 1.2 适用场景

- 单机或家用 NAS 式共享：把 `D:\share` 之类的本地目录通过浏览器共享给局域网
- 内网文件中转：SMB / FTP / SFTP 服务器统一入口
- 无外网环境的机房、工厂、实验室
- 需要单文件部署、不装运行时的场合

### 1.3 技术栈

| 层 | 实现 |
|---|---|
| 后端 | Go 1.27（`CGO_ENABLED=0`，纯静态二进制） |
| Web 框架 | Gin |
| 数据库 | SQLite（纯 Go 驱动 `glebarez/sqlite`），可选 MySQL |
| 前端 | 原生 JavaScript 单页应用，无框架、无构建、无 CDN |
| 资源 | 全部本地内嵌（`go:embed`），图标为内联 SVG sprite |
| 打包 | 前端 embed 进 exe，单文件约 58MB |

### 1.4 与上游 OpenList 的差异

**保留**

- 文件抽象层（`model.Obj` / `driver.Driver`）、存储挂载与虚拟路径
- WebDAV、FTP / SFTP 服务端（可关闭）
- 分享、任务队列、多用户与权限位
- 设置系统、搜索索引（内置数据库索引）

**移除（从代码根部删除，非隐藏）**

| 类别 | 移除内容 |
|---|---|
| 驱动 | 除 `local / smb / ftp / sftp` 外的全部云盘驱动（80+ 个） |
| 媒体 | 媒体库、Emby / Subsonic 协议、转码（FFmpeg）、图库 |
| 下载 | 离线下载（aria2 / qBittorrent / Transmission / BitComet）、种子生成与解析 |
| 认证 | 单点登录（SSO）、LDAP、WebAuthn（指纹 / 安全密钥） |
| 对象存储 | S3 兼容服务端 |
| 搜索 | bleve、Meilisearch 外部索引 |
| 其他 | 插件系统、消息中心、多语言切换 |

**新增**

- 登录页「记住密码」「忘记密码」（一次性重置码）
- 命令行 `admin reset-password` / `admin reset-code`
- 本地 OCR 接口（Windows 自带引擎）
- 本地二维码生成接口
- 全新纯静态前端（工具栏、本地设置、批量操作、自建播放器）
- 默认端口改为 **5245**

---

## 2. 系统架构

### 2.1 运行结构

```
浏览器 ──HTTP──> openlist.exe（Gin）
                    ├── 静态资源（embed 的 public/dist）
                    ├── REST API（/api/**）
                    ├── 直链下载（/d/**）
                    └── 存储驱动 ──> 本地磁盘 / SMB / FTP / SFTP
                    └── SQLite（data/data.db）
```

单进程同时承担 API、静态站点、文件流；无反向代理也能直接使用。

### 2.2 目录结构

```
openlist.exe                 单文件程序（前端已内嵌）
data/                        首次运行生成
  ├── config.json            配置（端口、数据库、日志、JWT 密钥等）
  ├── data.db                SQLite 数据库（表前缀 x_）
  ├── log/log.log            运行日志（50MB 轮转，保留 30 份 / 28 天）
  └── temp/                  临时文件（分片上传、解压中间产物）
start.cmd                    双击启动脚本（纯 ASCII，不切代码页）
web.config                   IIS + HttpPlatformHandler 配置
server.js / package.json     Node.js 守护启动器
docs/                        文档
```

### 2.3 部署形态

三种方式本质都是**启动同一个 exe**，区别只在「谁负责托管进程」：

| 方式 | 进程关系 | 适用 |
|---|---|---|
| 直接运行 / `start.cmd` | cmd → `openlist.exe` | 本机、临时使用 |
| IIS + HttpPlatformHandler | `w3wp.exe` → `openlist.exe` 子进程，端口由 `%HTTP_PLATFORM_PORT%` 注入，IIS 反向代理 | 已有 IIS、需要域名/HTTPS |
| Node.js `server.js` | `node` → `spawn(openlist.exe)`，带崩溃重启与健康检查 | 已有 Node 生态（PM2 / nssm） |

`openlist.exe` 不是 Windows 服务，如需开机自启可交给「任务计划程序」或 nssm 托管。

### 2.4 配置与环境变量

配置文件 `data/config.json`，首次启动自动生成；也可用环境变量覆盖（前缀 `OPENLIST_`，嵌套用 `_` 连接）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `OPENLIST_HTTP_PORT` | HTTP 端口 | `5245` |
| `OPENLIST_ADDR` | 监听地址 | `0.0.0.0` |
| `OPENLIST_HTTPS_PORT` | HTTPS 端口，`-1` 关闭 | `-1` |
| `OPENLIST_FORCE_HTTPS` | 强制跳转 HTTPS | `false` |
| `OPENLIST_JWT_SECRET` | JWT 密钥，留空自动生成 | 随机 16 位 |
| `OPENLIST_TOKEN_EXPIRES_IN` | 登录有效期（小时） | `48` |
| `OPENLIST_DATABASE_TYPE` | `sqlite3` / `mysql` | `sqlite3` |
| `OPENLIST_LOG_ENABLE` | 是否写文件日志 | `true` |
| `OPENLIST_MAX_CONNECTIONS` | 最大连接数，0 不限 | `0` |
| `OPENLIST_MAX_CONCURRENCY` | 最大并发下载数 | `64` |
| `OPENLIST_OCR_CMD` | 自定义 OCR 命令（图片路径作为最后一个参数） | 空，用系统 OCR |

命令行参数（作用于全局）：

```
--data <dir>        数据目录，默认 data
--config <file>     指定 config.json
--debug             调试模式
--log-std           日志输出到标准输出
--force-bin-dir     以 exe 所在目录作为数据目录
--no-prefix         关闭环境变量前缀
```

---

## 3. 角色与权限

### 3.1 三种角色

| 角色 | 值 | 说明 |
|---|---|---|
| 管理员 admin | 2 | 唯一，拥有全部权限，可进管理后台 |
| 访客 guest | 1 | 唯一，用于「访客模式」；`disabled=true` 即关闭访客访问 |
| 普通用户 | 0 | 由管理员创建，权限位控制可见与可操作范围 |

**访客模式**：`guest.disabled = false` 时，未登录访问直接以访客身份浏览（受权限位限制）。首页右上角是否显示「登录」入口由设置 `guest_login_entry` 控制。

### 3.2 权限位（`permission`，按位或）

| 位 | 权限 | 影响 |
|---|---|---|
| 0 | 查看隐藏文件 | 以 `.` 开头的文件/目录 |
| 1 | 免密码访问 | 直链可匿名访问 |
| 2 | 离线下载任务 | 本项目已移除该功能，位保留 |
| 3 | 新建目录 / 上传 | `mkdir`、`put` |
| 4 | 重命名 | `rename`、`batch_rename` |
| 5 | 移动 | `move`、`recursive_move` |
| 6 | 复制 | `copy` |
| 7 | 删除 | `remove`、`remove_empty_directory` |
| 8 | WebDAV 读 | `/dav` 读取 |
| 9 | WebDAV 写 | `/dav` 写入 |
| 10 | FTP/SFTP 登录读 | FTP/SFTP 服务端 |
| 11 | FTP/SFTP 写 | FTP/SFTP 服务端 |
| 12 | 读取压缩包 | 压缩包内浏览 |
| 13 | 解压 | `archive/decompress` |
| 14 | 创建分享 | `share/create` |
| 15 | 自定义分享 ID | 分享时指定短链 |

默认推荐值：访客 `0x71FF`（0-15 位中除 2 外基本全开）、普通用户按需组合。

### 3.3 权限校验位置

- 前端：按 `me.permission` 隐藏按钮（仅体验，不作为安全边界）
- 后端：`middlewares.Auth` 解析 token → 取出用户 → 各 handler 内校验具体位
- 存储级：挂载路径 `mount_path` 与用户 `base_path` 共同决定可见根目录

---

## 4. 功能需求

### 4.1 初始化向导

| 项 | 要求 |
|---|---|
| 触发条件 | 数据库中不存在管理员账号（`GET /api/public/init_status` 返回 `initialized=false`） |
| 界面 | 左侧品牌与特性介绍，右侧表单：管理员用户名、密码、站点名称 |
| 校验 | 用户名非空、密码 ≥ 4 位；系统已初始化时拒绝再次调用 |
| 结果 | 创建管理员（role=2，权限 `0x71FF`），写入站点名称，跳转登录页 |
| 异常 | 已初始化返回 400；密码过短返回 400 |

### 4.2 登录与会话

**基本登录**

- 用户名 + 密码，密码经 `SHA256(password + 固定盐)` 后再加盐哈希存储，库里不存明文
- 连续失败 5 次锁定该 IP 5 分钟（`TooManyAttempts`）
- 登录成功签发 JWT，有效期默认 48 小时；前端存 `localStorage.fs_token`，请求头 `Authorization: <token>`

**错误提示（必须中文化、不得泄露账号是否存在）**

| 场景 | 提示 |
|---|---|
| 用户名不存在 / 密码错误 | 用户名或密码错误 |
| 账号被停用 | 账号已被停用，请联系管理员 |
| 失败次数过多 | 登录失败次数过多，请稍后再试 |
| 需要两步验证 | 请输入两步验证码 |

**账号停用约束**

- 后端在密码校验通过后、2FA 之前检查 `user.disabled`，命中直接返回 403，**不签发 token**
- 前端拿到 token 后必须再请求一次 `GET /api/me` 确认可用；失败则清除本地 token、回填访客身份、提示真实错误
- 不允许出现「提示登录成功但进不去」的状态

**记住密码**

- 勾选后把用户名与密码经 XOR 混淆 + Base64 存 `localStorage.fs_remember`
- 仅本机便利功能，不作为安全存储；登录页明确提示「公用电脑请勿勾选」
- 取消勾选或登录失败不清除，用户退出登录时保留

**忘记密码（两种方式）**

1. **管理员生成重置码**（网页）：管理后台 → 用户 → 重置密码 → 生成 `XXXX-XXXX` 一次性码
2. **命令行**（服务器本机）：

```bat
openlist.exe admin reset-code -u <用户名>                  :: 生成重置码
openlist.exe admin reset-password -u <用户名> -p <新密码>   :: 直接改密码
```

用户侧：登录页「忘记密码？」→ 输入用户名 + 重置码 + 新密码 → `POST /api/auth/reset_password`。

约束：

- 重置码一次性，使用后立即失效；默认有效期 30 分钟
- 可由设置 `password_reset_enabled` 全局关闭自助重置（关闭后接口返回不可用）
- 重置成功后该用户旧 token 失效（`pwd_ts` 变更）

**两步验证（2FA）**

- 入口：登录后右上角「账号」→ 两步验证
- 开启：展示二维码（本地生成）+ 密钥文本 + 6 位验证码确认
- 关闭：`POST /api/auth/2fa/disable`
- 登录时若已开启，需额外提交 `otp_code`，错误提示「两步验证码不正确」

**会话退出**

- `GET /api/auth/logout`，前端清 token 并刷新为访客身份
- 退出后回登录页；若访客模式开启，登录页仍显示「以访客身份浏览」

### 4.3 首页

**顶栏**

| 位置 | 管理员 | 普通用户 | 访客 / 未登录 |
|---|---|---|---|
| 左 | 首页 | 首页 | 首页 |
| 右 | 管理 | 账号、退出登录 | 登录（受 `guest_login_entry` 控制） |

**主体**

- 中部展示已挂载的存储卡片：图标、显示名、驱动类型、点击进入
- 每个卡片可显示容量（若驱动支持目录大小统计）
- 未添加任何存储时展示空状态：说明文案 + 「去添加存储」按钮（管理员可见）
- 顶部可显示站点公告（`announcement`）
- Hero 操作区：「图片视图」（所有人）、「添加存储」「进入管理」（仅管理员）；图片视图详见 4.15

### 4.4 文件浏览

**布局**

- 列表视图：名称 / 大小 / 修改时间 / 操作
- 网格视图：卡片式，支持小 / 中 / 大三档尺寸
- 布局可临时切换，也可在本地设置里设默认值

**排序与分页**

- 点击表头「名称 / 大小 / 修改时间」排序，再次点击切换升降序，当前列显示 ↑↓
- 排序只作用于当前目录已加载数据（前端排序）
- 分页：每页 30 / 50 / 100 / 200 / 全部，页脚显示「共 x 项（x 个文件夹 · x 个文件）」
- 页脚计数可在本地设置关闭

**导航**

- 面包屑逐级点击返回，根节点显示站点名
- 支持分享路径 `/@s/<id>` 直接进入

**搜索**

- 工具栏放大镜 → 输入关键词 → `POST /api/fs/search`
- 依赖设置 `search_index`：`database`（内置索引）或 `none`
- 结果为扁平列表，点击跳到对应目录

**刷新**

- 工具栏刷新按钮触发 `refresh=true`，绕过缓存重新列目录

**空目录**

- 展示「此目录为空，可直接拖拽文件到页面任意位置上传」

### 4.5 单个文件操作

| 操作 | 入口 | 接口 | 说明 |
|---|---|---|---|
| 打开目录 | 点击行 | `fs/list` | |
| 预览文件 | 点击行 / 「预览」 | `fs/get` | 见 4.8 |
| 下载 | 「下载」/ 更多菜单 | `/d/<path>?sign=` | 浏览器直接下载 |
| 重命名 | 更多菜单 | `fs/rename` | 弹窗输入新名，空名/同名不提交 |
| 移动到… | 更多菜单 | `fs/move` | 目标目录不存在时自动创建 |
| 复制到… | 更多菜单 | `fs/copy` | |
| 删除 | 更多菜单 | `fs/remove` | 二次确认，提示不可撤销 |
| 创建分享 | 更多菜单 | `share/create` | |
| 直链 / 二维码 | 更多菜单 | `fs/get` + `public/qrcode` | |

### 4.6 批量操作

进入方式：工具栏「选择」按钮，或本地设置「总是显示复选框」。

| 操作 | 行为 |
|---|---|
| 全选本页 / 清空 | 仅作用于当前页 |
| 移动 | 对选中项逐个 `fs/move`，目标不存在则先 `mkdir` |
| 复制 | 同上 |
| 删除 | `fs/remove` 一次提交多个 name |
| **打包下载** | 服务端流式 ZIP（见 4.16） |
| **批量重命名** | 两种模式（见下） |
| 聚合移动 | 把多个目录的**内容**合并移动到目标目录，源目录保留为空 |
| 移除空文件夹 | 递归清理当前目录下所有空目录，需二次确认 |

**打包下载**

- 选中文件 / 文件夹后点击「打包下载」，服务端递归读取并直接写入 ZIP 响应流，浏览器原生保存
- 保留目录层级与空目录，UTF-8 文件名，自动下载 `<名称>_<日期>.zip`
- 全过程不把文件读入浏览器内存；细节、限制与开关见 4.16

**批量重命名**

1. 查找替换：支持正则，先「按正则预览」再应用
2. 统一序号：文件名前缀 + 起始序号 + 位数，保留原扩展名，按当前排序编号
3. 预览列表可直接手动改写单项
4. 提交 `POST /api/fs/batch_rename`，整体成功或失败

### 4.7 上传

**入口**

- 工具栏「上传」→ 选择文件（多选）
- 拖拽：**整个页面任意位置**都能接收，支持拖文件夹（递归读取目录树）

**方式**

| 方式 | 实现 | 特点 |
|---|---|---|
| 直接上传 | `PUT /api/fs/put`，`As-Task: false` | 页面关闭即中断 |
| 后台任务 | 同上，`As-Task: true` | 交给任务队列，关页面继续跑 |

**传输面板（右下角）**

- 标题：完成数 / 总数、失败数、总速度、**总剩余时间**
- 每项：文件名、进度条、速度、百分比、**剩余时间**、取消按钮
- 支持清除已完成、整体收起
- 并发 2 个文件同时上传

**其它**

- 同名文件默认覆盖（`Overwrite: true`）
- 分片上传：设置 `multipart_enabled`（默认开）+ `multipart_chunk_size`（默认 10MB）
- 服务端限速：`max_client_upload_speed` / `max_server_upload_speed`（KB/s，-1 不限）

### 4.8 预览

**类型判定**：优先用后端返回的 `type`（0 文件 / 1 目录 / 2 视频 / 3 音频 / 4 文本 / 5 图片），回退到扩展名。

| 类型 | 能力 |
|---|---|
| 图片 | 缩放（按钮 / 滚轮）、旋转 90°、全屏、OCR 识别文字、下载 |
| 视频 | 自建控制条：播放暂停、进度、时间、倍速（0.5-2x）、音量、静音、**截图**、**循环**、画中画、全屏；空格播放/暂停、左右键 ±5s；鼠标静止自动隐藏控制条；自动加载同名 `.vtt` / `.srt` 字幕 |
| 音频 | 本地封面、播放、进度、音量、静音、循环、倍速；自动加载同名 `.lrc` 歌词并逐行高亮滚动 |
| 文本 / 代码 | 等宽字体、字号可调（12-16px）、自动换行开关、超 1MB 截断提示；代码显示语言标签 |
| Markdown | 本地渲染标题、段落、加粗/斜体/删除线、行内代码、围栏代码块、列表、任务列表、引用、分割线、链接、管道表格；禁用原始 HTML 防 XSS |
| PDF | iframe 内嵌浏览器 PDF 阅读器（浏览器自带，不加载外部服务） |
| Word（.docx） | 浏览器本地解包 OOXML，渲染标题层级、段落、列表、表格与内嵌图片 |
| PowerPoint（.pptx） | 本地解析每页文本与图片，按幻灯片顺序纵向排列 |
| Excel（.xlsx） | 本地解析共享字符串与单元格，按工作表分页签展示（最多 500 行 × 100 列） |
| 其它 | 提示不支持预览 + 下载按钮 |

**本地预览的实现边界**

- 不依赖 CDN、第三方服务或服务端转换进程；`public/dist/assets/js/preview.js` 是唯一的解析入口
- Office 文件用浏览器原生 `DecompressionStream('deflate-raw')` 解开 OOXML 的 ZIP 容器，再用 `DOMParser` 解析 XML
- PDF 交给浏览器内置阅读器（Chrome / Edge 均自带），服务端只提供支持 Range 的文件流
- 字幕 / 歌词为同目录同名附属文件：`video.mp4` 对应 `video.vtt` 或 `video.srt`，`audio.mp3` 对应 `audio.lrc`；找不到时静默隐藏对应入口
- 旧版浏览器若不支持 `DecompressionStream`，Office 预览会给出明确提示，不影响下载

**底部操作栏**：文件大小 / 修改时间、识别文字（图片）、外部播放器（音视频）、链接 / 二维码、关闭、下载。

**外部播放器**（调用本机已安装程序）

| 项 | 协议 |
|---|---|
| 系统默认程序 | 新标签打开直链 |
| PotPlayer | `potplayer://<url>` |
| VLC | `vlc://<url>` |
| mpv | `mpv://<url>` |
| IINA（macOS） | `iina://weblink?url=<encoded>` |
| 复制直链 | 写入剪贴板 |

前提：本机已安装对应播放器并注册了 URL 协议；未安装时浏览器静默失败。

**链接 / 二维码**

- 展示带签名的直链（有效期由 `link_expiration` 控制，0 表示不过期）
- 二维码由服务端本地生成：`GET /api/public/qrcode?text=<url>&size=260`，不访问任何外部服务

**OCR**

- 接口 `POST /api/public/ocr`，可传 `path`（服务端文件）或 `multipart file`
- 默认调用 Windows 自带 `Windows.Media.Ocr`（需安装中文语言包）
- 可通过 `OPENLIST_OCR_CMD` 换成任意本地命令，图片路径作为最后一个参数，取标准输出
- 接口地址可在设置 `ocr_api` 中修改

### 4.9 分享

**创建**

- 单个文件或目录
- 可选：提取码、有效期（小时，0 为永久）、是否允许预览
- 需要权限位 14；自定义分享 ID 需要位 15

**分享页** `/@s/<id>`

- 有提取码时先显示输入框，验证通过后写入 `sessionStorage`
- 目录分享展示文件列表，可继续进入子目录
- 单文件分享展示文件卡片 + 下载按钮
- 分享内预览受 `share_preview` 控制，下载是否走服务端代理受 `share_force_proxy` 控制

**管理**

- 管理后台「分享」可查看全部分享、复制链接 / 二维码、启用禁用、删除

### 4.10 管理后台

入口：首页右上角「管理」（仅管理员）。顶栏左侧「首页 / 管理」，右侧「账号 / 退出登录」。

| 模块 | 功能 |
|---|---|
| 总览 | 存储数、用户数、分享数统计；快捷入口 |
| 存储 | 列表（挂载路径、驱动、状态、备注）、新建、编辑、启用/禁用、删除、排序、清缓存 |
| 用户 | 列表、新建、编辑（角色、权限位、禁用）、重置密码（生成重置码）、删除 |
| 任务 | 上传 / 复制 / 移动 / 解压任务列表，查看进度、取消、删除记录 |
| 分享 | 全部分享管理 |
| 设置 | 7 个分组，见 4.11 |
| 关于 | 项目说明、改动清单、上游引用与许可证 |

### 4.11 设置项

分组：站点 / 样式 / 预览 / 全局 / 索引 / 流量 / FTP·SFTP，共 75 项（含内部项）。完整清单见附录 A。

要点：

- 所有图标、封面、预览依赖默认指向本地资源（`/assets/images/*.svg`）
- 修改主题色即时生效（写入 CSS 变量）
- 设置值存 `x_setting_items` 表，`PUBLIC` 标记的项无需登录即可读（前端启动时拉取）

### 4.12 存储驱动

**本地存储 Local**

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| root_folder_path | string | - | 根目录绝对路径，如 `D:\share` |
| directory_size | bool | false | 统计目录大小（遍历，影响性能） |
| thumbnail | bool | true | 生成缩略图 |
| pdf_thumbnail | bool | false | PDF 首页缩略图（仅 macOS 有效） |
| thumb_cache_folder | string | 空 | 缩略图缓存目录 |
| thumb_concurrency | number | 16 | 缩略图并发数 |
| video_thumb_pos | string | 20% | 视频封面取帧位置（秒或百分比） |
| show_hidden | bool | true | 显示隐藏文件 |
| mkdir_perm | string | 777 | 新建目录权限 |
| recycle_bin_path | string | 空 | 回收站路径，空则永久删除 |

**SMB**

| 字段 | 必填 | 说明 |
|---|---|---|
| address | 是 | `192.168.1.10:445` |
| username / password | 是 / 否 | 域账号可写 `DOMAIN\user` |
| share_name | 是 | 共享名，如 `share` |
| root_folder_path | 否 | 共享内子路径 |

**FTP**

| 字段 | 必填 | 说明 |
|---|---|---|
| address | 是 | `host:21` |
| encoding | 是 | 文件名编码，通常 `GBK` 或 `UTF-8` |
| username / password | 是 | |
| cwd_list | 否 | 列目录前先切换目录（部分服务器需要） |
| root_folder_path | 否 | |

**SFTP**

| 字段 | 必填 | 说明 |
|---|---|---|
| address | 是 | `host:22` |
| username | 是 | |
| password | 否 | 与私钥二选一 |
| private_key | 否 | OpenSSH 格式私钥内容 |
| passphrase | 否 | 私钥密码 |
| ignore_symlink_error | 否 | 跳过无法读取的软链接 |
| root_folder_path | 否 | |

**通用存储字段**：挂载路径、排序、备注、缓存过期（秒）、Web 代理、WebDAV 策略、是否启用。

### 4.13 任务系统

| 任务类型 | 触发 | 说明 |
|---|---|---|
| 上传 | 上传时选「后台任务」 | 关闭页面继续，可在任务页查看 |
| 复制 | 跨存储复制 | 大目录自动转任务 |
| 移动 | 跨存储移动 | 同上 |
| 解压 | 压缩包解压 | 需权限位 13 |
| 解压上传 | 上传压缩包后自动解压 | |

任务落库 `x_task_items`，重启后可恢复（取决于配置）。并发 worker 默认 5，可在「设置 → 流量」调整。

### 4.14 命令行

```bat
openlist.exe server --data .\data           :: 前台启动
openlist.exe start                          :: 后台启动（Windows）
openlist.exe stop                           :: 停止
openlist.exe restart                        :: 重启
openlist.exe kill                           :: 强制结束
openlist.exe version                        :: 版本信息
openlist.exe admin random                   :: 生成随机密码
openlist.exe admin set -u admin -p <密码>    :: 设置密码
openlist.exe admin reset-code -u <用户名>    :: 生成一次性重置码
openlist.exe admin reset-password -u <用户名> -p <新密码>
openlist.exe admin token -u <用户名>         :: 生成长期 token
openlist.exe storage list                   :: 列出存储
openlist.exe storage disable <挂载路径>      :: 禁用存储
openlist.exe storage delete <id>            :: 删除存储
openlist.exe cancel2fa -u <用户名>           :: 关闭某用户 2FA
openlist.exe crypt                          :: 加解密工具
```

> 除 `server` 外，其余命令都需要 `--data` 指向正确的数据目录（默认 `data`）。

### 4.15 首页图片视图

首页 Hero 区的「图片视图」按钮会在原地切换为图片墙，不新增路由。

| 项 | 规则 |
|---|---|
| 数据来源 | 从根目录逐个存储递归扫描，最多访问 400 个目录、深度 10 层、展示 240 张图片 |
| 支持格式 | jpg / jpeg / png / gif / webp / bmp / svg / avif / ico |
| 缩略图 | 优先使用驱动生成的 `thumb`（本地驱动可开缩略图），没有则直接用原图签名地址 |
| 交互 | 自适应网格、懒加载；点击图片打开现有预览弹窗（缩放 / 旋转 / 全屏 / OCR） |
| 容错 | 单个目录无权限或读取失败会跳过，不影响其他存储；扫描过程显示进度 |
| 权限 | 完全复用 `fs/list` 的登录、密码与权限校验，前端不额外提升权限 |

### 4.16 打包下载与单文件加速

**服务端流式打包（文件 / 文件夹 / 多选）**

| 项 | 说明 |
|---|---|
| 入口 | 工具栏批量「打包下载」、文件菜单「打包下载此文件夹」 |
| 流程 | 前端 `POST /api/fs/package/ticket` 校验权限并取得一次性票据 → 浏览器顶层跳转 `GET /api/fs/package?ticket=…` → 服务端边读边写 ZIP |
| 票据 | 256 位随机、2 分钟有效、只用一次；不把登录 token 放进 URL |
| 内容 | 递归包含子目录与空目录，保留原文件名（UTF-8），同名根目录自动加 `_2` |
| 体积 | 不占浏览器内存，`Content-Disposition` 交给浏览器原生下载管理器 |
| 限制 | 单次最多 50000 个条目；动态 ZIP 不支持断点续传；任一目录读取失败会中止并报错，避免生成残缺包 |
| 开关 | 设置 `package_download`（默认开）；关闭后前端隐藏入口，后端票据接口同时拒绝 |

**单文件多线程下载**

| 项 | 说明 |
|---|---|
| 触发 | 文件 ≥ 8MB 且 ≤ 2GB 时走加速，其余走浏览器原生下载 |
| 实现 | 按 4MB / 8MB 分块，默认 `min(6, CPU-2)` 个并发 `Range` 请求，走同源 `/p/...?force&d=1` 代理 |
| 校验 | 每块必须返回 `206`，长度必须与请求区间一致；任一异常则自动回退普通下载 |
| 进度 | 弹窗显示已下载 / 总大小 / 百分比 / 线程数，可随时取消（`AbortController`） |
| 完整性 | 分块按序合并为 Blob 后保存，文件名与原文件一致 |
| 边界 | 服务端或存储不支持 Range 时回退；超过 2GB 交给原生下载，避免浏览器 Blob 上限 |

---

## 5. 接口概览

所有接口统一前缀 `/api`，响应格式：

```json
{ "code": 200, "message": "success", "data": {} }
```

`code != 200` 即失败；注意后端大量错误采用 **HTTP 200 + body.code** 的形式（如 401 未登录、402 需要 2FA、403 停用），客户端必须按 `code` 判断，不能只看 HTTP 状态。

鉴权：请求头 `Authorization: <token>`（登录接口返回的 token 原样放入，不加 `Bearer`）。

| 分组 | 前缀 | 鉴权 | 主要端点 |
|---|---|---|---|
| 公共 | `/api/public` | 无 | `GET/POST /settings`、`/init_status`、`POST /init/setup`、`POST /ocr`、`GET /qrcode`、`/archive_extensions` |
| 登录 | `/api` | 无 | `POST /auth/login`、`/auth/login/hash`、`GET /auth/reset_info`、`POST /auth/reset_password` |
| 当前用户 | `/api` | 登录 | `GET /me`、`POST /me/update`、`/me/sshkey/*`、`POST /auth/2fa/generate`、`/auth/2fa/verify`、`/auth/2fa/disable`、`GET /auth/logout` |
| 文件 | `/api/fs` | 登录或访客 | `POST /list`、`/get`、`/dirs`、`/search`、`/mkdir`、`/rename`、`/batch_rename`、`/regex_rename`、`/move`、`/recursive_move`、`/copy`、`/remove`、`/remove_empty_directory`、`PUT /put`、`PUT /form`、`/multipart/*`、`POST /link`、`/archive/decompress`、`/other` |
| 打包 | `/api/fs` | 票据 | `POST /package/ticket`（登录后取票据）、`GET /package?ticket=`（一次性，流式 ZIP，无需 Authorization） |
| 分享 | `/api/share` | 非访客 | `GET /list`、`/get`、`POST /create`、`/update`、`/delete`、`/enable`、`/disable` |
| 任务 | `/api/task` | 非访客 | 列表、取消、删除、重试 |
| 管理 | `/api/admin` | 管理员 | `meta`、`user`、`storage`、`driver`、`setting`、`task`、`index`、`archive`、`scan`、`message`（消息中心已无前端入口） |
| 直链 | `/d/<path>?sign=` | 签名 | 文件流，支持 Range；预览加 `&inline=1` 返回 `Content-Disposition: inline`（PDF 必需） |
| WebDAV | `/dav` | Basic Auth | 需权限位 8 / 9 |

**关键约定**

- `fs/list` 返回 `content[]`（`name`/`size`/`is_dir`/`modified`/`type`/`thumb`）、`total`、`write`
- `fs/get` 返回 `raw_url`（第三方直链，可能为空）、`sign`（本地签名）、`type`
- 上传：`PUT /api/fs/put`，文件路径放请求头 `File-Path`，`As-Task` 控制是否进任务队列，`Overwrite` 控制覆盖
- 打包：`package/ticket` 请求体 `{ items: [{ path, password }], name }`，返回 `{ ticket, expires_in }`；下载地址为 `GET api/fs/package?ticket=…`，响应 `application/zip`
- 加速下载：`/p/<path>?sign=…&force&d=1` 强制同源代理并保留 `Range`，返回 `206` + `Content-Range`
- 分享访问：`/@s/<share_id>`，提取码通过请求体 `password` 传递

---

## 6. 非功能需求

### 6.1 性能

| 项 | 设计 |
|---|---|
| 目录缓存 | 每个存储可设 `cache_expiration`（默认 30 秒），`fs/list` 带 `refresh=true` 可强制刷新 |
| 分页 | 前端分页；后端 `per_page` 上限 1000 |
| 并发 | 默认最大并发下载 64（`OPENLIST_MAX_CONCURRENCY`），可按机器调整 |
| 限速 | 客户端/服务端上下行四个维度独立限速（KB/s，-1 不限） |
| 大文件 | `/d/` 走流式输出，支持 Range（断点续传、拖动进度条） |
| 多线程下载 | 单文件 ≥ 8MB 时前端并发 2-6 个 Range 请求，同源代理，默认 4MB / 8MB 分块 |
| 服务端打包 | 边读存储边写 ZIP 响应流，不落临时文件、不进浏览器内存 |
| 缩略图 | 本地驱动可开启，独立并发数（默认 16）与缓存目录，避免阻塞列表 |

### 6.2 安全

| 面 | 措施 |
|---|---|
| 密码存储 | `SHA256(password + 固定盐)` 后再加 16 位随机盐哈希，数据库不存明文；改密后旧 token 因 `pwd_ts` 变化失效 |
| 会话 | JWT（HS256），默认 48 小时，密钥首次启动随机生成 |
| 登录防爆破 | 同 IP 连续失败 5 次锁定 5 分钟 |
| 停用账号 | 登录阶段直接拒绝，不签发 token |
| 权限 | 后端按权限位逐项校验；前端隐藏按钮仅作体验优化 |
| 路径 | 所有路径经 `utils.JoinBasePath` 规范化并限制在存储根目录内，防止 `../` 穿越 |
| 直链 | 默认全部签名（`sign_all=true`），签名含过期时间 |
| 上传 | 限制请求体大小；可配置允许的扩展名与忽略系统文件 |
| XSS | 前端所有动态文本经 `esc()` 转义；自定义 head/body 由管理员显式配置 |
| CSRF | 认证走 `Authorization` 头而非 Cookie，跨站表单无法自动携带 |
| 打包票据 | 256 位随机、2 分钟过期、一次性消费、不携带登录 token；生成前先逐项校验权限 |
| 本地预览 | Office / Markdown 全在浏览器内存中解析，文件不上传第三方；Markdown 禁用原始 HTML 并对链接做协议白名单 |
| 内联预览 | `inline=1` 仅对 PDF、图片、音视频扩展名生效；HTML / SVG / JS 等仍强制 `attachment`，防止同源脚本执行 |

### 6.3 兼容性

- 服务端：Windows 10 / 11 / Server 2016+，x64；不依赖 .NET、VC++ 运行库（纯静态 Go 二进制）
- 浏览器：Chrome / Edge 90+；Office 本地预览需要 `DecompressionStream('deflate-raw')`（Chrome / Edge 103+），其余预览不受影响
- 数据库：默认内嵌 SQLite（无需安装）；可切换 MySQL 5.7+
- 反向代理：IIS（HttpPlatformHandler / ARR）、Nginx、Caddy 均可；反向代理需保留 `Range` 请求头与 `Content-Range` 响应头，否则多线程下载自动回退

### 6.4 体积与依赖

| 项 | 数值 |
|---|---|
| exe | 约 58 MB（前端已内嵌，无外部文件） |
| 前端源码 | 257 KB（11 个文件，无构建步骤） |
| 运行时依赖 | 无（单一可执行文件） |
| 预览依赖 | 无外部库 / 无 CDN；Office、Markdown、字幕歌词均为自写解析 |
| 首次启动 | < 2 秒（创建数据库与配置） |

### 6.5 可维护性

- 前端零构建：改完 `public/dist` 下的文件直接 `go build` 即生效，不需要 Node
- 单一构建脚本：`deploy/build-win.ps1`
- CI：`push tag` 自动构建 + 冒烟测试 + 发布 Release

---

## 7. 已知限制

| 限制 | 说明 |
|---|---|
| 仅 Windows 产物 | 源码不含平台相关锁，但只提供 Windows x64 构建；其他平台需自行交叉编译 |
| 无媒体库 | 影像墙、播放列表、Emby / Subsonic 客户端接入均已移除 |
| 无离线下载 | 不含 aria2 / BT / 磁力链，工具栏也无入口 |
| 无多语言 | 仅简体中文，`i18n` 机制已去掉 |
| 打包下载占内存 | 保留浏览器端兜底实现（仅分享路径使用）；普通路径已改为服务端流式 ZIP，不受此限制 |
| 打包不能续传 | 动态 ZIP 不产生固定 `Content-Length`，下载中断需重新生成票据；单次最多 50000 个条目 |
| 多线程上限 | 仅 8MB-2GB 的文件启用；超过 2GB 交给浏览器原生下载，避免 Blob 内存上限 |
| Office 预览精度 | 只还原文本、标题、列表、基础表格与内嵌图片；不还原页眉页脚、分栏、图表、SmartArt、公式排版、动画与宏 |
| Excel 公式 | 显示工作簿中缓存的单元格值；不执行公式计算，未缓存结果的公式可能为空 |
| 图片视图范围 | 首页扫描最多 400 个目录 / 240 张图片，超大目录不会一次全部列出 |
| 字幕歌词 | 只读取同目录同名附属文件（.vtt / .srt / .lrc），不解析视频内嵌字幕轨，也不读取音频标签内嵌歌词 |
| 外部播放器 | 依赖本机已安装并注册 URL 协议（`potplayer://` 等），未安装时无提示 |
| OCR | 依赖系统已安装对应语言包；无语言包时返回空结果 |
| 非 Windows 服务 | exe 自身不是服务，开机自启需任务计划程序 / nssm |
| 搜索 | 内置数据库索引，非全文检索引擎，超大目录下搜索较慢 |
| 分享 | 无访问统计、无下载次数限制 |

---

## 附录

### A. 设置项全表

分组与默认值来自 `internal/bootstrap/data/setting.go`；「界面名称」为后台设置页展示的中文名。

**站点**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `version` | — | （空） | — |
| `site_title` | 站点名称 | 文件服务器 | 显示在浏览器标题与首页 |
| `announcement` | 站点公告 | 欢迎使用文件服务器。所有存储均位于本地网络，可自由浏览、上传与分享文件。 | 显示在首页顶部，可换行 |
| `pagination_type` | 分页方式 | pagination | all / pagination / load_more / auto_load_more |
| `default_page_size` | 每页数量 | 30 | 列表默认每页条数 |
| `allow_indexed` | 允许搜索引擎索引 | false | 关闭后 robots.txt 禁止抓取 |
| `allow_mounted` | 允许挂载 | true | 是否展示已挂载存储 |
| `robots_txt` | robots.txt | User-agent: * / Allow: / | 直接返回给爬虫的内容 |
| `guest_login_entry` | 访客可登录 | true | 访客模式下首页右上角是否显示登录入口 |
| `password_reset_enabled` | 允许自助找回密码 | true | 开启后可用管理员生成的重置码重置密码 |

**样式**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `logo` | 站点图标 | /assets/images/logo.svg | 顶部导航使用的图标，默认本地 SVG |
| `favicon` | 网站图标 | /assets/images/favicon.svg | 浏览器标签页图标 |
| `main_color` | 主题色 | #2563eb | 影响按钮、链接、首页背景等 |
| `home_icon` | 主页图标 | 🏠 | 首页按钮图标，可填本地路径或 emoji |
| `share_icon` | 分享图标 | 🎁 | 分享按钮图标 |
| `hide_storage_details` | 隐藏存储详情 | true | 访客看不到存储驱动与容量信息 |
| `hide_storage_details_in_manage_page` | 管理页隐藏存储详情 | true | 管理页列表不显示底层信息 |

**预览**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `text_types` | 文本类型 | txt,htm,html,xml,java,properties,sql,js,md,j… | 可预览的文本后缀 |
| `audio_types` | 音频类型 | mp3,flac,ogg,m4a,wav,opus,wma | 可预览的音频后缀 |
| `video_types` | 视频类型 | mp4,mkv,avi,mov,rmvb,webm,flv,m3u8 | 可预览的视频后缀 |
| `image_types` | 图片类型 | jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,a… | 可预览的图片后缀 |
| `proxy_types` | 代理类型 | m3u8,url | 需要服务端代理的后缀 |
| `proxy_ignore_headers` | 代理忽略请求头 | authorization,referer | 逗号分隔 |
| `external_previews` | 外部预览 | {} | JSON 配置，按后缀映射预览地址 |
| `audio_cover` | 音频封面 | /assets/images/audio-cover.svg | 默认使用本地内置封面 |
| `audio_autoplay` | 音频自动播放 | true | 打开预览即播放 |
| `video_autoplay` | 视频自动播放 | true | 打开预览即播放 |
| `preview_download_by_default` | 预览页默认下载 | false | 打开预览时直接下载 |
| `preview_archives_by_default` | 默认预览压缩包 | true | 进入压缩包内部浏览 |
| `share_preview_download_by_default` | 分享页默认下载 | true | 分享预览时直接下载 |
| `share_preview_archives_by_default` | 分享页默认预览压缩包 | false | 分享中直接进入压缩包 |
| `readme_autorender` | 自动渲染 README | true | 目录下 README 自动显示 |
| `filter_readme_scripts` | 过滤 README 脚本 | true | 移除 README 中的脚本 |
| `non_efs_zip_encoding` | 非 EFS ZIP 编码 | IBM437 | 解压非 UTF-8 文件名时使用 |

**全局**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `hide_files` | 隐藏文件规则 | /\\/README.md/i | 正则，命中则不显示 |
| `package_download` | 打包下载 | true | 允许多选打包为 zip |
| `customize_head` | 自定义 head | （空） | 插入到页面 head 的 HTML |
| `customize_body` | 自定义 body | （空） | 插入到页面 body 的 HTML |
| `link_expiration` | 直链有效期 | 0 | 小时，0 表示不过期 |
| `sign_all` | 全部链接签名 | true | 所有直链都需要签名 |
| `ocr_api` | OCR 接口 | /api/public/ocr | 默认使用内置本地 OCR，不访问外网 |
| `filename_char_mapping` | 文件名字符映射 | （空） | JSON，例如 {"/": "\|"} |
| `forward_direct_link_params` | 转发直链参数 | false | 下载时透传查询参数 |
| `ignore_direct_link_params` | 忽略的直链参数 | sign,openlist_ts,raw | 逗号分隔 |
| `share_preview` | 分享页预览 | true | 允许在分享页预览文件 |
| `share_archive_preview` | 分享页压缩包预览 | false | 允许查看压缩包内容 |
| `share_force_proxy` | 分享强制代理 | true | 分享下载走服务端中转 |
| `share_summary_content` | 分享文案模板 | {{creator}} 分享了 {{filename}}，来自 {{site_title… | 分享链接的默认描述 |
| `handle_hook_after_writing` | 写入后执行 Hook | false | 上传完成后触发外部命令 |
| `handle_hook_rate_limit` | Hook 频率限制 | 0 | 每分钟最多执行次数，0 不限 |
| `ignore_system_files` | 忽略系统文件 | false | 上传时跳过 .DS_Store、Thumbs.db 等 |
| `multipart_enabled` | 分片上传 | true | 大文件分片上传 |
| `multipart_chunk_size` | 分片大小(MB) | 10 | 需小于反向代理请求体上限 |

**索引**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `search_index` | 搜索索引 | database | database（内置数据库索引）或 none |
| `auto_update_index` | 自动更新索引 | false | 文件变化时更新索引 |
| `ignore_paths` | 索引忽略路径 | （空） | 每行一个 |
| `max_index_depth` | 索引最大深度 | 20 | 默认 20 |

**流量**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `upload_task_threads_num` | 上传并发 | （空） | 同时上传任务数 |
| `copy_task_threads_num` | 复制并发 | （空） | 同时复制任务数 |
| `move_task_threads_num` | 移动并发 | （空） | 同时移动任务数 |
| `decompress_download_task_threads_num` | 解压下载并发 | （空） | 解压时下载线程数 |
| `decompress_upload_task_threads_num` | 解压上传并发 | （空） | 解压后上传线程数 |
| `max_client_download_speed` | 客户端下载限速 | -1 | KB/s，-1 不限 |
| `max_client_upload_speed` | 客户端上传限速 | -1 | KB/s，-1 不限 |
| `max_server_download_speed` | 服务端下载限速 | -1 | KB/s，-1 不限 |
| `max_server_upload_speed` | 服务端上传限速 | -1 | KB/s，-1 不限 |

**FTP·SFTP**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ftp_public_host` | FTP 公网地址 | 127.0.0.1 | FTP 服务端返回给客户端的地址 |
| `ftp_pasv_port_map` | FTP 被动端口映射 | （空） | 格式见文档 |
| `ftp_mandatory_tls` | FTP 强制 TLS | false | 要求 FTPS |
| `ftp_implicit_tls` | FTP 隐式 TLS | false | 隐式 FTPS |
| `ftp_tls_private_key_path` | FTP TLS 私钥 | （空） | 证书私钥路径 |
| `ftp_tls_public_cert_path` | FTP TLS 证书 | （空） | 证书路径 |
| `sftp_disable_password_login` | SFTP 禁用密码登录 | false | 只允许公钥登录 |

**内部**

| 键 | 界面名称 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `token` | — | （空） | — |
| `index_progress` | — | {} | — |

### B. 默认可预览类型

| 类别 | 默认后缀 |
|---|---|
| 文本 | txt, htm, html, xml, java, properties, sql, js, md, json, conf, ini, vue, yaml, yml, go, py, sh, log |
| 音频 | mp3, flac, ogg, m4a, wav, opus, wma |
| 视频 | mp4, mkv, avi, mov, rmvb, webm, flv, m3u8 |
| 图片 | jpg, jpeg, png, gif, bmp, svg, ico, webp, avif, tiff, swf |
| 代理播放 | m3u8, url（由服务端中转，避免跨域） |

以上均可在「设置 → 预览」中增删。

前端另外内置 `docx / pptx / xlsx / md / markdown` 的本地解析分支，不依赖上述后端类型设置；`md` 在文本列表中，会优先走 Markdown 渲染。代码与纯文本共用文本预览，额外识别 `jsx / ts / tsx / cs / rs / php / rb / sql / toml / csv / bat / ps1` 等扩展名。

### C. 前端路由

| 路由 | 页面 |
|---|---|
| `#/login` | 登录（含忘记密码弹窗） |
| `#/home` | 首页：存储列表 |
| `#/browse?path=/xxx` | 文件浏览 |
| `#/admin` | 管理总览 |
| `#/admin/storage` | 存储管理 |
| `#/admin/users` | 用户管理 |
| `#/admin/tasks` | 任务管理 |
| `#/admin/shares` | 分享管理 |
| `#/admin/settings` | 设置（7 个分组） |
| `#/admin/about` | 关于 |
| `/@s/<id>` | 分享页（可带 `?pwd=`） |
| `/@s/<id>/<子路径>` | 分享内目录 |

### D. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v4.1.0-local | 2026-10-28 | 本地增强预览（PDF / docx / pptx / xlsx / Markdown / 代码 / 文本、视频 VTT·SRT 字幕、音频 LRC 歌词）；首页图片视图；服务端流式打包下载（一次性票据、递归目录与空目录）；单文件多线程 Range 下载与进度弹窗 |
| v4.0.0-local | 2026-10-27 | 首个本地化版本：驱动收敛为 local/smb/ftp/sftp；移除媒体库、离线下载、种子、SSO、LDAP、S3、转码、外部索引；前端重写为纯静态 SPA；新增忘记密码（重置码）、本地 OCR、本地二维码；默认端口 5245；提供 exe / IIS / Node 三种部署方式与 CI 自动发布 |
