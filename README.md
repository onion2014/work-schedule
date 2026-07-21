# work-schedule

一款类 BusyCal 的桌面日历应用，支持农历显示、重复事件（含农历循环）、多时段提醒、数据备份与导出。

## 功能特性

### 📅 月历视图
- 周一为首的月历网格，直观展示全月日程
- 每日显示农历日期、节气、闰月标记
- 点击日期在侧边栏查看当日事件详情

### 🌙 农历支持
- 基于 tyme4ts 的完整农历计算
- 显示农历月名、日名（如"正月"、"初一"）
- 节气标注（如"小暑"、"大暑"）
- 闰月识别与标记

### 🔁 重复事件
- 支持多种重复模式：每天、每周、每月、每年（公历）、每年（农历）
- 农历循环事件支持闰月处理（如"每年农历五月初五"端午节）
- 可设定结束条件：永不结束、指定日期结束、指定次数结束

### ⏰ 多时段提醒
- 每个事件可添加多个提醒（如"30分钟前"、"1天前"）
- 60 秒轮询检查，通过系统通知弹出提醒
- 提醒触发后自动标记，同日不重复触发

### ✅ 待办管理
- 事件可按日期标记完成/未完成
- 已完成事件显示删除线和"已办"标签
- 待办事件显示"待办"标签，一目了然

### 📊 导出功能
- 按周或按月导出事件列表
- 生成结构化文本（待办/已办分类，含日期、时间、标题）
- 一键复制到剪贴板，方便汇报

### 📌 任务栏提醒
- 窗口标题嵌入待办信息，任务栏按钮持续可见
- 每 5 秒自动滚动轮换：日期摘要 → 各条待办详情
- 窗口聚焦时自动刷新数据

### 💾 数据备份与迁移
- 自动分级备份：7 份日备份、4 份周备份、3 份月备份
- 一键手动触发备份
- 支持从备份恢复数据（恢复前自动创建安全备份）
- JSON 格式导出/导入，支持三种冲突处理模式（合并覆盖、仅合并、全部替换）

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 35 + Vue 3.5 |
| 构建 | electron-vite + vite（独立 renderer 构建） |
| 数据库 | better-sqlite3（SQLite，WAL 模式） |
| 农历 | tyme4ts |
| 日期 | dayjs |
| 状态 | Pinia 2.2 |

## 目录结构

```
timer/
├── src/
│   ├── main/          # Electron 主进程
│   │   ├── index.ts       # 入口：窗口、托盘、任务栏滚动
│   │   ├── db.ts          # SQLite 数据库 CRUD
│   │   ├── ipc-handlers.ts # IPC 通信处理
│   │   ├── scheduler.ts   # 提醒调度器
│   │   └── backup.ts      # 分级备份系统
│   ├── preload/        # 预加载脚本（contextBridge）
│   ├── renderer/        # Vue 3 渲染进程
│   │   ├── src/
│   │   │   ├── views/CalendarView.vue   # 主日历视图
│   │   │   ├── components/
│   │   │   │   ├── DayCell.vue          # 日期单元格
│   │   │   │   ├── EventEditor.vue      # 事件编辑器
│   │   │   │   ├── BackupPanel.vue      # 备份面板
│   │   │   │   ├── Toast.vue            # 通知提示
│   │   │   │   └── styles/main.css      # 全局样式 + CSS 变量
│   │   │   └── lib/           # 共享库
│   │   │       ├── types.ts        # TypeScript 类型定义
│   │   │       ├── recurrence.ts   # 重复事件展开引擎
│   │   │       ├── lunar.ts        # 农历计算桥接
│   ├── lib/            # 主进程 + 渲染进程共享代码
│   │   ├── types.ts
│   │   ├── recurrence.ts
│   │   ├── lunar.ts
├── resources/          # 应用图标资源
├── scripts/            # 构建 & 打包脚本
│   ├── build.js         # 两步构建（vite + electron-vite）
│   ├── dev-build.js     # 开发模式构建（容忍 renderer 失败）
│   ├── pack.js          # 打包安装版（NSIS）
│   ├── pack-dir.js      # 打包免安装版
├── dist/               # 打包输出
```

## 开发

### 安装依赖

```bash
npm install
```

> **fnm 用户注意**：如果使用 fnm 管理 Node 版本，直接运行 `npm` 可能报错。需要先执行 `eval "$(fnm env --shell bash)" && fnm use 22` 初始化环境，或直接用 node 执行 npm-cli.js：
> ```bash
> node node_modules/npm/bin/npm-cli.js install
> ```

### 启动开发模式

```bash
npm run dev
```

启动后自动：
1. 启动 Vite 开发服务器（端口 5173）
2. 构建 main + preload（electron-vite）
3. 启动 Electron 窗口加载开发服务器页面

> `electron-vite` 的 renderer 构建有一个已知 bug：不会正确应用 Vue 插件，导致 `.vue` 文件解析失败。开发模式下 renderer 由 Vite 开发服务器提供，electron-vite 的 renderer 构建失败会被 `dev-build.js` 自动容错处理。

### 仅启动渲染进程开发服务器

```bash
npm run dev:renderer
```

## 构建 & 打包

### 构建全部

```bash
npm run build
```

### 打包安装版（NSIS Setup.exe）

```bash
npm run pack
```

输出：`dist/work-schedule Setup 0.1.0.exe`

### 打包免安装版（便携目录）

```bash
npm run pack:dir
```

输出：`dist/win-unpacked/` 目录，双击 `work-schedule.exe` 直接使用。

### 两个版本同时打包

```bash
npm run build && npm run pack:dir && npm run pack
```

输出：
- `dist/work-schedule Setup 0.1.0.exe` — 安装版
- `dist/win-unpacked/` — 免安装便携版

## 数据存储

- 数据库文件位于 `%APPDATA%/work-schedule/data/timer.db`（SQLite WAL 模式）
- 备份文件位于同一目录下的 `backups/` 子目录
- 旧版本数据会自动迁移到新路径

## 许可

MIT
