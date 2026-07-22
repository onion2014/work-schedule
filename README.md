# work-schedule

一款类 BusyCal 的桌面日历应用，支持任务进度追踪、需求接收时间/任务开始/任务结束三段时间管理、农历显示、重复事件（含农历循环）、多时段提醒、托盘提醒、数据备份与导出。

## 功能特性

### 📅 月历视图
- 周一为首的月历网格，直观展示全月日程
- 每日显示农历日期、节气、闰月标记
- 事件按需求接收日期定位到日历格子，显示标题和进度百分比
- 点击日期在侧边栏查看当日事件详情（接收时间、开始时间、结束时间、进度）
- 侧边栏可直接勾选完成，切换每个重复事件实例的完成状态

### 🌙 农历支持
- 基于 tyme4ts 的完整农历计算
- 显示农历月名、日名（如"正月"、"初一"）
- 节气标注（如"小暑"、"大暑"）
- 闰月识别与标记
- 干支年份、干支日、生肖显示
- 传统节日识别

### 🔁 重复事件
- 支持多种重复模式：每天、每周、每月、每年（公历）、每年（农历）
- 农历循环事件支持闰月处理（如"每年农历五月初五"端午节）
- 可设定结束条件：永不结束、指定日期结束、指定次数结束
- 每个重复实例可独立标记完成（不影响其他实例）
- 农历每月重复：类型定义已就绪，展开引擎待实现

### ⏰ 多时段提醒
- 每个事件可添加多个提醒（如"30分钟前"、"1天前"、"3天前"）
- 提醒时间选项：事件开始时、5分钟前、15分钟前、30分钟前、1小时前、2小时前、1天前、2天前、3天前
- 提醒相对任务开始时间触发（而非需求接收时间）
- 60 秒轮询检查，通过系统通知弹出提醒
- 提醒触发后自动标记，同日不重复触发

### ✅ 待办与进度管理
- 每个事件包含三段时间：需求接收时间、任务开始时间、任务结束时间
- 进度百分比（0-100%）实时跟踪任务完成度，步长 5%
- 进度 0% 显示"待办"标签，0-99% 显示"进行中"标签，100% 显示"已办"标签
- 日历格子中进度条以白色条纹显示完成比例
- 7 种预设颜色标记事件类别

### 📊 导出功能
- 按周或按月导出事件列表
- 生成结构化文本（待办/已办分类，含接收时间、开始时间、标题、进度）
- 一键复制到剪贴板，方便汇报

### 📌 任务栏与托盘提醒
- 窗口标题嵌入待办信息，任务栏按钮持续可见
- 每 5 秒自动滚动轮换：日期摘要 → 各条待办详情（开始时间 + 进度%）
- 窗口聚焦时自动刷新数据并停止闪烁

### 🔔 托盘图标
- 系统托盘图标，右键菜单支持"打开日历"和"退出"
- 有待办事项时图标闪烁提醒（微信式交替闪烁，500ms 切换）
- 窗口聚焦时自动停止闪烁
- 鼠标悬停托盘图标弹出浮窗，显示当日待办概览（开始时间、标题、进度、颜色标记）
- 点击浮窗即可打开/聚焦日历窗口（浮窗 hover 时微变色提示可点击）
- 浮窗防闪烁：内容注入后再显示，无空白白色闪烁
- 关闭窗口后应用在托盘继续运行，保持提醒功能

### 🔒 单实例运行
- 同一时间只允许运行一个日历实例
- 重复启动时自动聚焦已有窗口

### 💾 数据备份与迁移
- 自动分级备份：7 份日备份、4 份周备份、3 份月备份
- 启动 30 秒后执行首次备份，之后每 24 小时自动备份
- 备份失败后 1 小时自动重试
- WAL checkpoint + 完整性校验确保备份可靠
- 一键手动触发备份
- 支持从备份恢复数据（恢复前自动创建安全备份）
- JSON 格式导出/导入，支持三种冲突处理模式（合并覆盖、仅合并、全部替换）
- 导入兼容旧版本 v1 格式数据（自动将 startDate/startTime 映射为新字段）

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
work-schedule/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts           # 入口：窗口、托盘、闪烁、悬浮弹窗、任务栏滚动
│   │   ├── db.ts              # SQLite 数据库 CRUD + 旧 schema 迁移
│   │   ├── ipc-handlers.ts    # IPC 通信处理
│   │   ├── scheduler.ts       # 提醒调度器（60s 轮询）
│   │   └── backup.ts          # 分级备份系统 + JSON 导出/导入 + 备份恢复
│   ├── preload/            # 预加载脚本（contextBridge）
│   ├── renderer/            # Vue 3 渲染进程
│   │   ├── src/
│   │   │   ├── views/
│   │   │   │   └── CalendarView.vue   # 主日历视图 + 导出面板
│   │   │   ├── components/
│   │   │   │   ├── DayCell.vue          # 日期单元格
│   │   │   │   ├── EventEditor.vue      # 事件编辑器（含重复/提醒设置）
│   │   │   │   ├── BackupPanel.vue      # 备份面板（备份/恢复/导出/导入）
│   │   │   │   └── Toast.vue            # 通知提示
│   │   │   ├── styles/
│   │   │   │   └── main.css             # 全局样式 + CSS 变量
│   │   │   ├── App.vue                   # 应用根组件
│   │   │   └── main.ts                   # 渲染进程入口
│   ├── lib/                # 主进程 + 渲染进程共享代码
│   │   ├── types.ts            # TypeScript 类型定义
│   │   ├── recurrence.ts       # 重复事件展开引擎（公历 + 农历）
│   │   ├── lunar.ts            # 农历计算桥接（tyme4ts → LunarDisplay）
├── resources/              # 应用图标资源（icon.png + icon.ico）
├── scripts/                # 构建 & 打包脚本
│   ├── build.js                 # 两步构建（vite + electron-vite）
│   ├── dev-build.js             # 开发模式构建（容忍 renderer 失败）
│   ├── pack.js                  # 打包安装版（NSIS）
│   ├── pack-dir.js              # 打包免安装版
├── dist/                   # 打包输出
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

- **打包版**：数据库和备份文件位于程序 exe 旁边的 `data/` 和 `backups/` 目录
  - 数据库：`<exe所在目录>/data/timer.db`（SQLite WAL 模式）
  - 备份：`<exe所在目录>/backups/`
- **开发版**：数据库位于项目根目录的 `data/timer.db`，备份位于项目根目录的 `backups/`
- 旧版本数据（存放在 `%APPDATA%/work-schedule/` 下）会在首次运行时自动迁移到新路径
- 旧事件模型（startDate/startTime）会自动迁移为新模型（receivedDate/receivedTime + taskStartDate/taskStartTime + taskEndDate/taskEndTime + progress）

## 许可

MIT
