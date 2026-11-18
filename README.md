# one-tool

基于 Tauri 2、Rust、TypeScript 和 Vite 的桌面开发工具箱，包含接口请求、代码工具（MyBatis SQL 还原、文件比对与代码生成）、JSON 转换和下载。

## 更新

桌面版启动后会自动检查新版本。发现新版本时，点击右上角的更新按钮即可下载安装并重启；也可以手动点击“检查更新”。

## 下载

桌面版「下载」页面内置 HTTP/HTTPS 直链下载，无需安装或启动 aria2。填写下载链接后通过系统文件夹窗口选择保存位置，可查看下载中、已暂停、已完成和失败的任务，并暂停或继续。下载时先写入同名 `.part` 文件，完成后改为正式文件名。服务器支持 Range、提供文件大小及 ETag 或 Last-Modified，且文件至少 1 MB 时，使用 4 个连接分段下载；文件达到 16 MB 时使用 8 个连接；否则使用单连接。实际速度仍受服务器、网络和磁盘限制。若服务器提供 ETag 或 Last-Modified，继续下载时会尝试按 Range 续传；否则从头重新下载，避免拼接不同版本的文件。

当前不支持浏览器开发模式、BT 或磁力链接。任务列表仅保留在本次应用运行期间；退出后 `.part` 文件仍在目录中，但重新打开时不会自动恢复任务。从受限的开发终端启动时，程序仍受该终端的文件系统权限限制；正常安装运行时可选择系统允许写入的任意目录。

## 接口请求

- 「＋ 新建请求」会重置为一个空白 GET 请求，清除当前 URL、参数、请求头、Cookie、请求体和旧响应，并将光标放到 URL 输入框；当前环境和历史记录保留。

- JSON 响应默认提供可折叠的对象/数组视图，点击节点箭头可独立展开和折叠，支持全部展开、全部折叠及原文切换。折叠不影响复制完整响应，展示保留原始大整数与数字格式。非 JSON、空容器或层级过深的响应使用原文展示。
- 「请求预览」展示替换环境变量、合并 Cookie 后交给发送引擎的 URL、Headers、Body；可切换「上次发送」查看发送时的快照。Host、Content-Length 和 multipart boundary 等由引擎补充。
- 工具栏 cURL 按当前配置生成；预览内的复制按钮按正在预览的快照生成。导出命令适用于 Bash / Git Bash / WSL，不是 PowerShell 命令。
- Cookie 管理中点击「编辑」可修改名称、值、Path、有效期、Secure、HttpOnly 和「仅当前域名」。留空有效期按会话 Cookie 保存。同名不同 Path 的 Cookie 可共存，编辑时不会误删其他 Path 的项。
- 发送 Cookie 时检查域名、路径、有效期和 HTTPS；优先级为请求 Cookie 标签 > 手填 Cookie 请求头 > 域名 Cookie。响应中的 Max-Age 优先于 Expires，过期项会移除。旧数据中的普通域名默认仅匹配当前主机，带点域名默认包含子域名。
- Cookie 的基础匹配参考 [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265)。当前不包含公共后缀列表和完整浏览器 Cookie 策略；不作为浏览器 Cookie 引擎的替代。
- cURL 支持 JSON、raw、URL 编码表单和文本 form-data；支持引号及反斜杠。不支持文件上传或从文件读取请求体，遇到不支持的参数会明确报错。参数语义参考 [cURL 手册](https://curl.se/docs/manpage.html)。
- 桌面请求失败直接显示原始错误，不自动使用浏览器重发。Cookie 或历史记录保存失败单独提示，不覆盖已收到的响应。非法请求头明确报错。
- 浏览器模式支持文本表单和超时控制，但无法手填 Cookie 请求头或忽略 SSL；此类请求需使用桌面版。

接口工具回归测试：`node tests/http-client.test.mjs`、`node tests/http-query.test.mjs`。

## 文件比对

在侧栏「代码工具」中切换到「文件比对」，可选择两份文本文件，或直接粘贴两段代码。默认精确比较空格、缩进和内容，结果按两侧行号对齐，并突出修改行中的具体字符；可逐处跳转、交换左右、返回编辑。仅在本地读取和计算，不上传文件。单个文件最多 1 MB，比对内容最多 10000 行。CRLF、LF、CR 换行格式不同会单独提示。

## AI 助手

侧栏「AI 助手」已启用。桌面版可保存 DeepSeek、MiniMax 国内或 MiniMax 国际配置，填写模型名称和 API Key；Key 在 Windows 上经当前用户的数据保护机制加密存放、在 macOS 上保存在系统钥匙串，不会写进前端 localStorage。对话可以自由提问；当问题涉及已安装插件、MyBatis 日志、JSON/YAML/XML/CSV 转换或 MySQL 建表与代码生成时，助手可调用相应本地功能并解释结果。工具调用只读取或计算，不会自动改写原始 JSON、文件或业务系统数据。

对话文本及本地工具结果会发送给所选 AI 服务商。粘贴业务资料前请检查敏感信息。无 API Key 或网络连接时，原有本地工具仍可独立使用。当前对话仅保存在本次应用运行期间；未接入真实 API Key 的情况下无法验证第三方服务返回行为。

## 字段映射

在「JSON 转换」中选择「字段映射」，可为任意 JSON 创建、导入和导出字段名称映射，也可根据带注释的 Java 实体生成映射草稿。插件可以提供预置映射配置；基础版只包含通用映射功能。

## 插件

业务功能由单独的签名插件提供，主程序不内置业务规则。在侧栏「插件」中可导入多个插件，分别查看、更新或卸载。同一插件再次导入会更新该插件，不影响其他插件；签名或格式不正确时保留已安装版本。

## 本地开发

```sh
npm install
npm run dev          # 浏览器开发
npm run tauri:dev    # 桌面开发，需要 Rust / Tauri 构建环境
npm run build       # TypeScript 检查和前端构建
```

开发版使用独立的 Tauri 应用标识，并将 WebView2 数据放在 `src-tauri/target/debug/one-tool-dev-data`，避免与已安装版共用浏览器配置，也避免开发环境无法写入系统应用数据目录。若 Windows 提示 WebView2 `0x800700AA`，先关闭已打开的 One Tool 窗口，再重新运行 `npm run tauri:dev`。

## MySQL 代码生成

1. 打开侧栏「代码工具」并切换到「代码生成」，粘贴一条或多条 MySQL `CREATE TABLE` 语句。
2. 设置基础包名（默认 `com.example`）、完整 Entity 包名（默认 `com.example.entity`）、作者和需要去除的表名前缀。
3. 勾选生成文件，点击「解析并生成」。多表可通过下拉框切换，单独修改当前表类名后重新生成。
4. 选择文件预览、复制或下载；「导出 ZIP」包含所有表的所选文件，按 `src/main/java` 和 `src/main/resources/mapper` 组织目录。

基础包名和 Entity 包名独立配置，修改前者不会覆盖后者。包名、作者和前缀会保存在本地；修改输入后需要重新生成，才能复制或导出最新结果。

生成 MyBatis Plus 基础骨架：Entity 使用 Lombok Getter/Setter、Serializable 和表字段映射；Service 不加 I 前缀；Impl 实现相同名称的 Service；Mapper 自动导入 `@Mapper`；Controller 只包含 `@Controller` 和请求路径，XML 只包含 namespace。使用方项目需要自行配置 Lombok、MyBatis Plus 和 Mapper 扫描等依赖。

支持常见 MySQL 字符、数值、日期、JSON 和二进制类型，保留表及字段注释。`tinyint` 默认映射 Integer，`bit(1)` 映射 Boolean；无符号 bigint 映射 BigInteger。自增主键使用 `IdType.AUTO`，其他主键使用项目的默认 ID 策略。不支持联合主键和未知类型；输入仅接受 CREATE TABLE，导出前请移除其他 SQL。

生成器测试：

```sh
node tests/code-generator.test.mjs
```

## Windows 打包 EXE

在项目根目录执行。需要安装 Node.js、Rust 和 Visual Studio C++ 构建工具；首次打包可能需要联网下载构建依赖。

生成 EXE 安装包（NSIS）：

```powershell
npm.cmd install                          # 首次使用或依赖变化时执行
npm.cmd run tauri:build -- --bundles nsis
```

安装包输出目录：`src-tauri/target/release/bundle/nsis/`，文件通常以 `-setup.exe` 结尾。

只生成程序 EXE，跳过安装包制作：

```powershell
npm.cmd run tauri:build -- --no-bundle
```

程序输出：`src-tauri/target/release/app.exe`（当前 Rust 包名为 `app`）。运行目标机器需要 WebView2 运行环境，单独的 EXE 不包含该运行环境。

如果希望按当前配置同时生成支持的安装包（Windows 下包括 NSIS EXE 和 MSI）：

```powershell
npm.cmd run tauri:build
```

以上命令会自动先执行前端构建，不需要单独运行 `npm run build`。`npm run build` 本身只构建前端，不生成桌面 EXE。

## macOS 打包

在 Mac 上安装 Node.js、Rust 和 Xcode Command Line Tools 后，于项目根目录执行：

```sh
npm install
npm run tauri:build -- --bundles app,dmg
```

产物位于 `src-tauri/target/release/bundle/macos/` 和 `src-tauri/target/release/bundle/dmg/`。macOS 安装包由 GitHub Actions 构建，仍需在目标 Mac 上验证目录选择、Finder 打开目录、钥匙串读写与 AI 连接。
