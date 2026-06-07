# MoeKoe Download

为 [MoeKoe Music](https://github.com/iAJue/MoeKoeMusic) 添加歌曲下载功能的插件。支持单曲下载和歌单批量下载。

## 功能

- **单曲下载** — 在播放器底部操作栏点击下载按钮，获取当前播放歌曲
- **歌单批量下载** — 在歌单/专辑/歌手页面点击「下载全部」，一键下载整个歌单
- **自动识别音质** — 根据当前音质设置下载对应品质（MP3 320kbps / FLAC / Hi-Res）
- **智能降级** — 高品质不可用时自动降级到低品质，确保不空跑
- **零对话框批量保存** — 使用 File System Access API，选一次目录后所有文件直接写入

## 安装

### 通过插件市场（推荐）

1. 打开 MoeKoe Music → 设置 → 插件管理
2. 点击「插件市场」→ 找到 **MoeKoe Download** → 安装

### 手动安装

1. 下载或 clone 本仓库
2. 将 `kugou-download` 文件夹复制到 MoeKoe Music 插件目录：
   - **Windows**: `%APPDATA%\MoeKoeMusic\extensions\`
   - **macOS**: `~/Library/Application Support/MoeKoeMusic/extensions/`
   - **Linux**: `~/.config/MoeKoeMusic/extensions/`
3. 重启 MoeKoe Music，或打开设置 → 插件管理 → 重新加载插件

## 使用方法

### 单曲下载

1. 播放任意歌曲
2. 点击播放器底部操作栏的 **下载按钮**（📥）
3. 等待音频缓冲完成 → 弹出保存对话框 → 选择位置保存

### 批量下载

1. 打开一个歌单、专辑或歌手页面
2. 点击歌曲列表右上角的 **「下载全部」** 按钮
3. 在弹出的目录选择器中选一个下载目录
4. 插件逐首下载并写入该目录，按钮显示实时进度：`3/20 歌曲名`
5. 下载中再次点击按钮可**暂停/继续**
6. 完成后如有失败歌曲，目录下会生成 `_下载失败_N首.txt` 记录原因

## 文件结构

```
kugou-download/
├── manifest.json      # Chrome Extension Manifest V3
├── content.js          # Content script：注入按钮 + 下载逻辑
├── hook.js             # 主世界 Hook：拦截网络请求获取音频直链 + FSA 写文件
└── icon.svg            # 插件图标
```

## 技术原理

| 组件 | 作用 |
|------|------|
| content script | 注入下载按钮到播放器界面，处理下载流程 |
| hook.js | 在页面主世界拦截 fetch/XHR，捕获 `/song/url` 响应获得音频直链；提供 File System Access API 写文件 |
| Chrome Extension MV3 | 通过 Electron 的 `session.loadExtension()` 加载，content script 绕过 CSP 限制 |

### 数据流

```
用户点击播放 → MoeKoeMusic 调 /song/url API → hook.js 拦截响应，保存直链
                                                                     ↓
用户点击下载 → content.js 读取直链 → fetch 音频 → Blob → postMessage 传主世界
                                                                     ↓
                         主世界通过 FileSystemFileHandle 写入选择的目录
```

## 兼容性

- 需要 **MoeKoe Music ≥ 1.6.2**
- 仅供个人学习使用

## 许可

GPL-2.0
