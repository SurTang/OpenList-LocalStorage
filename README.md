# 文件服务器（OpenList 改造版）

一个只跑在 Windows 上、面向本地与内网存储的 Web 文件浏览器 / 共享服务器。

本项目由 [OpenList](https://github.com/OpenListTeam/OpenList) 源码改造而来：保留其成熟的文件抽象层与接口，砍掉所有依赖公网的云盘驱动与附加模块。

前端为纯静态单页应用（`public/dist`，零构建、零 CDN、零外部依赖），并非原版前端的搬运。界面与交互按本项目要求重新设计，但**工具栏、本地设置、批量操作、预览播放器这几块的功能清单与交互逻辑参考了官方 [OpenList-Frontend](https://github.com/OpenListTeam/OpenList-Frontend) 的对应模块**（List / Grid / LocalSettings / Toolbar / Artplayer 预览 / open-with），再按纯静态方式重写实现：不需要 Node 构建、不引入 monaco / artplayer 等大体积依赖，因此 exe 仍然只有 58MB。

---

## 功能一览

- **存储驱动**：本地磁盘、SMB 共享、FTP、SFTP（全部为本地可实现的协议，无任何外网依赖）
- **文件浏览**：列表 / 网格两种布局、点表头排序、面包屑、搜索、分页、文件计数
- **本地设置**（仅存浏览器）：默认布局、每页数量、排序、网格项目大小、文件名过长方式、文件计数、常显复选框、文本预览字号与换行
- **批量操作**：多选、移动、复制、删除、服务端流式打包下载（支持文件、文件夹、空目录）、批量重命名（正则替换 / 统一序号）、聚合移动、移除空文件夹
- **上传**：全屏拖拽（含文件夹）、实时进度 / 速度 / **剩余时间**、可切换「直接上传 / 后台任务」
- **在线预览**：图片（缩放 / 旋转 / 全屏）、音频 / 视频（自建控制条：进度、倍速、音量、静音、循环、画中画、全屏、视频截图）、PDF、Word、PowerPoint、Excel、Markdown、代码与纯文本；全部在浏览器本地解析，不加载 CDN 或外部服务
- **字幕与歌词**：视频自动读取同名 `.vtt` / `.srt` 字幕，音频自动读取同名 `.lrc` 歌词并逐行高亮
- **首页图片视图**：一键切换图片墙，递归汇总各存储中的图片，点击直接预览
- **下载加速**：单文件 ≥ 8MB 自动启用多线程 Range 下载，显示进度、线程数与速度，可取消；服务端保持流式传输
- **调用本机播放器**：预览页「外部播放器」可按 PotPlayer / VLC / mpv / IINA 的 URL 协议直接唤起，或复制直链
- **分享与链接**：直链复制、本地生成二维码、外部播放器打开
- **分享**：生成带提取码与有效期的分享链接，访客可直接下载
- **多用户**：管理员 / 普通用户 / 访客三种角色，权限按位控制；支持两步验证（2FA）
- **访客模式**：开启后未登录也能直接进入首页浏览；首页是否显示登录入口可配置
- **找回密码**：登录页「忘记密码」+ 一次性重置码；命令行可强制重置任意用户密码
- **界面**：全新设计的简体中文界面，零外部 CDN，图标与预览资源全部本地内置

## 本版本相对原项目的改动

| 类别 | 说明 |
| --- | --- |
| UI | 自研纯静态前端，仅简体中文；工具栏、本地设置、批量操作、播放器按官方前端的对应模块对齐功能与交互后重写 |
| 登录 | 新增「记住密码」（本机保存）、「忘记密码」与一次性重置码；恢复两步验证（2FA）设置入口 |
| 首页 | 左上角「首页」回首页，右上角「管理」进后台（未登录显示「登录」，访客模式下受配置控制），中部为存储列表，无存储时给出引导按钮 |
| 管理页 | 左上角「首页」回首页、「管理」回管理页，右上角「账号」「退出登录」 |
| 设置 | 保留「站点 / 样式 / 预览 / 全局 / 索引 / 流量 / FTP·SFTP」分类；图标、站点图标、主题色、主页图标、分享图标、音频封面默认使用本地资源；OCR 使用本机 Windows OCR |
| 已删除 | 媒体库、离线下载、种子 / 传输种子、单点登录（SSO）、LDAP、对象存储（S3）、WebAuthn、FFmpeg 转码、Emby / Subsonic 协议、全部云盘驱动 |
| 任务 | 只保留上传、复制、移动、解压、解压上传 |

## 快速开始

1. 把 `openlist.exe` 放到任意目录（例如 `D:\fileserver\`）；
2. 双击 `start.cmd`，或直接执行：

```bat
openlist.exe server --data .\data
```

3. 浏览器打开 <http://127.0.0.1:5245>，首次访问会进入**初始化向导**，创建管理员账号即可。

> `start.cmd` 内部为纯 ASCII 输出，且不切换控制台代码页（`chcp`）。这是刻意为之：
> 批处理文件若以 UTF-8 保存中文、再配合 `chcp 65001`，cmd.exe 会按 ANSI 解析并在切页后错位，
> 出现 `'xxx' 不是内部或外部命令` 这类报错。若你拿到的是旧版脚本，直接替换为当前 `start.cmd` 即可，
> 或跳过脚本直接执行 `openlist.exe server --data .\data`。

> 默认端口 5245、数据目录 `.\data`。端口可用 `--data` 之外的参数或环境变量调整：
>
> ```bat
> set OPENLIST_HTTP_PORT=8080
> set OPENLIST_ADDR=0.0.0.0
> openlist.exe server --data .\data
> ```

### 命令行

```bat
:: 显示管理员信息与可用命令
openlist.exe admin

:: 重置任意用户的密码（不需要登录，适合忘记密码时救急）
openlist.exe admin reset-password -u admin -p 新密码

:: 生成一次性重置码（15 分钟有效，供用户在登录页「忘记密码」中使用）
openlist.exe admin reset-code -u zhangsan

:: 重置管理员为随机密码
openlist.exe admin random
```

## 部署方式

### 1. 单文件 exe

最简单：`openlist.exe server --data .\data`。适合本机或内网小范围使用。

### 2. IIS

1. 安装 IIS，勾选「CGI」功能；
2. 安装 [HttpPlatformHandler v1.2](https://www.iis.net/downloads/microsoft/httpplatformhandler)；
3. 把 `openlist.exe` 与 `deploy/iis/web.config` 放到同一个站点目录（`web.config` 改名为 `web.config`）；
4. 在 IIS 中新建站点指向该目录，应用池选择「无托管代码」。

`web.config` 会把 IIS 分配的随机端口通过 `OPENLIST_HTTP_PORT` 传给程序，程序只监听 `127.0.0.1`，外部访问统一走 IIS。已放宽上传体积限制，如仍受限请在 IIS 管理器中调整「请求筛选 → 最大允许内容长度」。

### 3. Node.js

把 `openlist.exe` 与 `deploy/node/` 下的 `server.js`、`package.json` 放同一目录：

```bat
node server.js
:: 或
npm start

:: 自定义
set PORT=8080
set HOST=127.0.0.1
set DATA=.\data
node server.js
```

启动器会守护 exe：进程异常退出自动重启，收到 SIGINT/SIGTERM 时优雅停止，并打印 `http://127.0.0.1:<port>`。可直接交给 PM2、nssm 或 Windows 计划任务托管。

## 自动构建与发布

推 tag 即触发 GitHub Actions（Windows runner）编译并发布 Release：

```bat
git tag v4.0.1
git push local v4.0.1
```

流程：`go build` → 启动 exe 跑 `/ping` 冒烟测试 → 打包 → 上传 Release。产物：

- `OpenList-LocalStorage_<tag>_windows-amd64.zip`：exe + `start.cmd` + IIS/Node 部署文件 + 文档
- `openlist.exe`：程序本体
- `SHA256SUMS.txt`：校验和

也可在 Actions 页面手动 `Run workflow`，只产出 artifact 不发布 Release。

## 功能规格

完整功能描述见 [docs/FEATURES.md](docs/FEATURES.md)：角色与权限位、登录与两步验证、文件浏览与批量操作、上传、预览、分享、管理后台、存储驱动字段、任务系统、命令行、接口概览、非功能需求与已知限制，附录含 75 项设置全表。

## 目录结构

```
openlist.exe          单文件可执行程序（前端资源已内嵌）
data/                 运行时生成：config.json、data.db、日志、临时文件
deploy/iis/web.config IIS 部署配置
deploy/node/          Node.js 守护启动器
deploy/start.cmd      Windows 双击启动脚本
```

## 添加存储

登录后台 →「存储管理」→「新建存储」，按驱动填写：

- **本地存储**：根目录路径（如 `D:\share`），可配置目录大小显示、缩略图、回收站等
- **SMB**：`\\server\share` 形式的主机与共享名、账号密码
- **FTP / SFTP**：主机、端口、账号、密码、根路径

保存后首页即出现对应存储卡片。

## 关于 OCR

「预览 → 图片 → 识别文字」调用的是**本机离线 OCR**：

- Windows：使用系统自带的 `Windows.Media.Ocr`（需在「设置 → 时间和语言 → 语言」中安装中文语言包）；
- 其他平台或想换引擎：设置环境变量 `OPENLIST_OCR_CMD`，程序会把图片路径作为最后一个参数传给该命令，取标准输出作为识别结果。

接口地址在「设置 → 全局 → OCR 接口」中，默认 `/api/public/ocr`，不会访问任何互联网服务。

## 许可

本项目基于 [OpenList](https://github.com/OpenListTeam/OpenList) 修改，遵循原项目的 **GNU Affero General Public License v3.0（AGPL-3.0）**，完整文本见根目录 `LICENSE`。

按 AGPL-3.0 要求：若你通过网络向他人提供本程序的服务，需要向使用者提供对应的完整源码。
