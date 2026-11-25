# 第一阶段 · 赛事 BP 工作台

## 架构与启动

根目录使用 npm workspaces 管理 `server` 和 `web`。开发入口并行启动 Node 24 的 TypeScript 监听模式和 Vite。生产构建将后端输出到 `server/dist`、前端输出到 `web/dist`。运行编译后的后端即可从同源地址访问 SPA 和 REST API，未知 API 路径返回 JSON 404。

| 层 | 入口 | 职责 |
| --- | --- | --- |
| 服务 | `server/src/app.ts`、`index.ts` | 组装 Express、错误映射、监听、静态服务 |
| 存储 | `server/src/db/` | 使用 Node 内置 `DatabaseSync`、开启外键、按版本迁移 |
| 数据源 | `services/opendota.ts`、`data/` | 限流、重试、SQLite 缓存、英雄中英文和简称 |
| 身份解析 | `utils/accountId.ts` | 验证主页域名和路径，使用 BigInt 将 Steam64 转为正的无符号 32 位账号 |
| 页面 | `web/src/` | React 19、TypeScript、Tailwind CSS、桌面侧栏和移动底栏 |
| 安装与离线 | `web/public/manifest.webmanifest`、`web/sw.js`、`vite.config.ts` | 构建时收集应用资源，缓存当前版本页面，API 始终走网络 |

SQLite 使用 Node 内置实现。Rollup 使用 WebAssembly 发行包，Tailwind 使用 PostCSS 管线。esbuild 的独立可执行程序用于前端构建。

## 存储与迁移

数据库默认路径相对仓库根解析，开发和生产共用 `data/bpsystem.sqlite`。启动自动建目录并执行缺失的迁移。迁移版本与 DDL、初始数据在同一事务提交。时间戳使用 UTC ISO 字符串；比赛开始时间和时长使用整数秒。

| 表 | 关键字段和约束 |
| --- | --- |
| schema_migrations | version 主键、applied_at，记录已提交迁移 |
| settings | key 主键、value 和 updated_at；保存密钥、赛事权重与统计天数 |
| players | account_id 唯一，另存昵称、Steam 资料、位置 JSON、备注、隐私和同步时间 |
| teams | 队名、简称、颜色、备注和创建／修改时间 |
| team_members | 同队 slot 与 player_id 各自唯一；1–5 为首发，6 起为替补；删除队伍或选手级联清理 |
| heroes | OpenDota ID 主键、内部名、英文名、中文名、别名、主属性、攻击类型、职责与图片 |
| api_cache | 资源路径主键、响应 JSON、到期和写入时间 |
| draft_sessions | our_side、first_pick_side 各自限制为 radiant/dire；阵营战队引用删除置空，保存补丁、CM 顺序版本、准备状态和备注 |
| draft_actions | 每局 step_index 唯一且为 1–24；phase 为 1–3；记录 ban/pick、实际阵营、是否先选队、英雄、选手和可空的 1–5 号位 |
| matches | match_id 主键，区分赛事和天梯，保留标签、版本、比赛时间、胜方、解析状态和原始响应 |
| match_players | 每场 player_slot 唯一，保留匿名账号、side/is_radiant、draft_order/pick_order、KDA、经济、经验、分路、装备与视野数据 |
| match_picks_bans | 每场 order_index 唯一，保留实际阵营和可空的先选队标志；未知值用 NULL |
| hero_matchups | (hero_id, against_hero_id) 组成主键，存储场次、胜场和更新时间 |

阵营和先后选是两个维度。夜魇可以先选，天辉也可以后选。交换阵营时，两队的首发名单、我方身份和先选权一起移动。数据库预留正式禁选记录；第一阶段的对局室仅将备战快照保存在该浏览器的 localStorage，战队预设写入 SQLite。

## HTTP 接口

所有路径以 `/api` 开头。写操作使用 JSON 对象，删除成功返回 204，创建成功返回 201。参数错误、记录不存在、唯一约束冲突分别返回 400、404、409，并提供 `{"error":"中文原因"}`。

| 方法 | 路径 | 输入或返回 |
| --- | --- | --- |
| GET | /health | ok、db、heroCount、timestamp |
| GET | /system/network | 后端 port、非回环 IPv4 lanUrls、hostname；开发页面展示 Vite 端口 |
| GET / PUT | /settings | 写入 opendotaApiKey、tournamentMatchWeight、pubRecentDays 中的任意项，返回 hasOpenDotaApiKey、maskedPreview 和数值设置 |
| GET | /heroes?q= | 按中文、简称、内部名或英文名筛选；省略 q 返回全库 |
| POST | /heroes/sync | 从 /heroStats 同步并按英雄 ID 更新，返回 synced 和 heroCount |
| GET / POST | /players | 列表／创建；支持 accountInput 或 accountId、nickname、roles、notes |
| PUT / DELETE | /players/:id | 更新指定字段／删除选手并清理战队位置 |
| GET / POST | /teams | 返回首发和替补／创建战队；字段为 name、tag、color、notes，可同时传入 members |
| PUT / DELETE | /teams/:id | 编辑或删除预设；可原子保存队伍资料与阵容 |
| PUT | /teams/:id/roster | 使用 members 全量替换首发与替补，支持清空 |

阵容请求示例：

```json
{"members":[{"slot":1,"playerId":12},{"slot":3,"playerId":18},{"slot":6,"playerId":25}]}
```

返回的 `roster` 总有五个顺序槽位，每项为 `{slot,player}`，空位的 player 为 null；`subs` 按实际槽位排序。选手或槽位重复、引用不存在时整笔修改回滚。选手可属于多个战队预设，对局室内同一选手仅能占一个位置。

## 数据源与默认值

- 英雄中文名来自 Valve 英雄清单，基础资料快照来自 OpenDota 常量；`heroAliases.ts` 补充中文简称与常用英文缩写。首次迁移写入快照，重启保留之后的同步结果。[Valve 中文英雄清单](https://www.dota2.com/datafeed/herolist?language=schinese) · [OpenDota 英雄常量](https://github.com/odota/dotaconstants/blob/master/build/heroes.json)
- 服务访问 `https://api.opendota.com/api`，设置页密钥优先于环境变量。密钥仅在服务端使用，查询设置仅返回掩码。公共／有密钥模式默认限制为每分钟 50／120 次，按滑动窗口约束实际请求（含重试）。429 和 5xx 最多尝试三次，同资源并发请求合并；有效响应默认缓存一小时。客户端构造参数可调整时间窗、额度和 TTL。[OpenDota API](https://docs.opendota.com/)
- 赛事权重初始为 2 倍，天梯统计范围为最近 30 天；允许保存 0–100 倍和 1–365 天。这两个参数在第一阶段提供持久化，后续评分服务可直接使用。
- 地图和英雄图像来自 Valve Dota 2 游戏素材。首页地图、阵营封面和常用英雄缩略图随应用分发，其余英雄肖像使用 Steam CDN。[Dota 2](https://www.dota2.com/)
- `默认版本顺序` 与 24 步约束按本项目要求预留，界面展示每方 7 个禁用槽与 5 个选取槽。实时顺序推进、评分和对手侦察归第三阶段。

## 验证入口

`npm run typecheck` 检查前后端，`npm test` 运行 Node 测试，`npm run build` 编译两个工作区。测试使用内存数据库、临时 HTTP 端口及可注入的 fetch，涵盖账号边界、迁移重入和约束、密钥与脱敏、缓存与重试、滑动限流、双向 CRUD、阵容原子替换及删除级联。

在 Node 24.15.0、npm 11.12.1 的 Windows 环境完成了 16 项自动化测试。另用 Edge 验证生产入口、选手编辑、五名首发与一名替补、战队导入、阵营交换及刷新恢复，并通过真实 OpenDota 接口同步了 127 名英雄。浏览器验收使用独立内存数据库。

在 375px 视口检查了四页底栏导航和页面宽度，并通过断网重载验证 PWA 缓存。局域网地址已从服务主机访问，实体手机连接与主屏幕安装尚未实测。
