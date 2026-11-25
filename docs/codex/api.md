# BPSystem REST API · 第一至第四阶段

以下路径相对于同源前缀 `/api`。生产默认地址为 `http://localhost:3001/api`。请求和响应使用 JSON，提交对象时设置 `Content-Type: application/json`。常规请求体上限 128 KiB，备份恢复上限 64 MiB。GET 返回 200，创建选手、战队或存档返回 201，删除成功返回 204 空响应。接口响应带 `Cache-Control: no-store`。

错误格式为 `{"error":"中文原因"}`。参数或数据错误为 400，记录缺失为 404，账号冲突或过期修订号为 409，超限为 413。上游响应异常或不可用通常为 502，长时间限流为 503。批量导入与同步应逐条检查 `results`。时间戳使用 UTC ISO 字符串，比赛开始时间为 Unix 秒，游戏时长和事件时间均以秒计。

## 系统、配置与英雄

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/health` | 返回 `ok, db, heroCount, timestamp`。 |
| GET | `/system/network` | 返回后端 `port, hostname, lanUrls[]`。开发网页向手机展示同一主机的 Vite 端口。 |
| GET | `/settings` | 返回 `hasOpenDotaApiKey, maskedPreview, tournamentMatchWeight, pubRecentDays`。 |
| PUT | `/settings` | 部分更新 `opendotaApiKey`（最多 512 字符，空串清除）、`tournamentMatchWeight`（0–100）、`pubRecentDays`（整数 1–365），返回更新后的设置。新库默认 4 倍、60 天。 |
| GET | `/heroes?q=` | 可按中英文名、内部名、简称搜索。数组项含 `id, name, localizedName, cnName, aliases, img, icon, primaryAttr, attackType, roles, typicalRoles, tags`。 |
| POST | `/heroes/sync` | 无必填字段，更新本地英雄资料，返回 `{synced,heroCount}`。 |
| POST | `/heroes/matchups/sync` | `{"heroIds":[1,2]}` 同步指定英雄对位。空数组跳过，省略则请求全库。返回 `{requested,synced,results:[{heroId,count,error?}]}`，遇上游错误停止该批次。 |

## 选手、战队与战绩

选手输入 `accountInput` 或 `accountId` 支持 Steam32、Steam64、OpenDota/Dotabuff 主页。Steam64 建议使用字符串。选手响应含本地 `id`、游戏 `accountId`、`nickname, roles, notes, steamName, avatarUrl, isProfilePrivate, lastSyncedAt`。

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/players` | 选手数组，按本地 ID 升序。 |
| POST | `/players` | 账号必填，可传 `nickname, roles, notes`。位置为 1–5 的数组，返回新选手。 |
| PUT | `/players/:id` | 部分更新创建字段，返回选手。换绑账号会清除原账号的路人样本和同步状态。 |
| DELETE | `/players/:id` | 删除选手并释放相应阵容位置。 |
| POST | `/players/:id/sync` | 同步公开资料、路人英雄与逐场战绩，返回 `{player,analytics}`。 |
| GET | `/players/:id/analytics` | 返回 `playerId, isProfilePrivate, privacyHint, lastSyncedAt, recentForm, roleDistribution, sideSplits, heroPool`。近期表现含连胜败、平均 KDA/GPM/XPM。英雄池含赛事和路人分项、`weightedScore, threatScore, grade, source`。 |
| GET | `/teams` | 战队数组，每队含队伍资料、五个有序首发槽 `roster` 和替补 `subs`。 |
| POST | `/teams` | `name` 必填，可传 `tag,color,notes,members`。颜色为六位十六进制色值，返回新战队。 |
| PUT | `/teams/:id` | 部分更新资料，可同时全量替换 `members`，事务成功后返回战队。 |
| PUT | `/teams/:id/roster` | 传 `{"members":[{"slot":1,"playerId":3}]}` 全量替换，空数组清空。返回战队。 |
| POST | `/teams/:id/sync` | 逐人同步首发和替补，返回 `{results:[{playerId,success,isProfilePrivate?,error?}]}`。 |
| DELETE | `/teams/:id` | 删除战队预设和成员关联，选手资料保留。 |

每个槽位为 `{slot,player}`，空位的 player 为 null。槽位 1–5 为首发，6 及以上为替补。队内选手和槽位均须唯一。英雄池评分、阵营胜率及赛事与路人的去重规则见 [第二阶段文档](phase-2.md)。

## 比赛库与解析任务

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| POST | `/matches/import` | `matchIds` 接受 ID、比赛链接或其数组，支持空白、逗号、分号分隔。可传 `tag`。返回 `{results:[{matchId,imported,updated?,hasParsed?,linkedPlayersCount?,error?}]}`。省略标签时重导保留原标签。 |
| GET | `/matches?tag=&q=` | 可按标签精确过滤，或搜索比赛 ID、队名、选手昵称、账号和标签。返回赛事数组，含 `matchId,tag,patch,startTime,duration,radiantWin,hasParsed,importedAt,radiantName,direName,playersCount,teamsCount,linkedPlayersCount,picksBans`。 |
| GET | `/matches/:matchId` | 返回摘要及 `players[]`、完整 `picksBans[]`、`telemetry:{obsCount,senCount,hasParsed}`。参赛者使用数据库字段名（如 `hero_id,player_slot,obs_log_json`），另含 `linkedPlayerId,linkedNickname`。 |
| DELETE | `/matches/:matchId` | 删除比赛及其参赛者、禁选和录像数据。 |
| POST | `/matches/:matchId/request-parse` | 已导入的比赛，无需请求体。响应 `{matchId,jobId,status}`；`queued` 带上游任务编号（数字或字符串），`already_parsed` 的 jobId 为 null。 |
| GET | `/matches/:matchId/parse-status?jobId=` | jobId 必填，取提交返回的原值。响应 `{matchId,status,hasParsed,wardCount}`，wardCount 为本地两类原始守卫日志条数。 |

`pending` 表示仍在队列中，客户端可在 5 秒后再次查询。`completed` 表示本地已确认解析；上游任务刚完成时，接口会先刷新比赛并回填再返回。`failed` 表示上游报告失败或出队后仍取不到解析数据。连接或格式异常使用 HTTP 错误，恢复后可用原 jobId 再查。

## 录像分析

两个 GET 接口都接受以下可选查询参数，多个条件取交集。

| 参数 | 含义 |
| --- | --- |
| `matchId` | 比赛 ID，省略则可跨场。 |
| `teamId` | 本地战队 ID，只取当前首发及替补账号对应的人次。 |
| `playerId` | 本地选手 ID，按其游戏账号关联历史比赛。 |
| `side` | `all`（默认）、`radiant`、`dire`，按该玩家当场阵营筛选。 |
| `tag` | 完整赛事标签，省略或空串表示全部。 |

### GET `/replays/wards`

`wardType` 取 `both`（默认）、`obs`（假眼）、`sen`（真眼）。`phase` 取 `all`（默认）、`early`、`mid`、`late`。0、600、1500 秒分别是三个分段的起点；负时间只进入全场。示例请求为 `/api/replays/wards?teamId=1&side=dire&wardType=sen&phase=mid`。

| 响应字段 | 内容 |
| --- | --- |
| `summary` | `{matchCount,parsedMatchCount,obsCount,senCount,radiantCount,direCount}`。场次按比赛去重，眼数按筛选后的可定位事件计。 |
| `points[]` | `{nx,ny,rawX,rawY,time,wardType,side,matchId,heroId,heroName,playerName,accountId}`。匿名账号为 null，时间单位为秒。 |
| `hotspots[]` | 最多五个 `{nx,ny,count,zone}`，按聚类内眼位数降序。 |
| `unparsedMatches[]` | 当前人员、比赛、阵营及标签范围内的待解析场次，每项为 `{matchId,tag}`。 |

### GET `/replays/farming`

可附加 `heroId` 与 `roleScope`。位置范围默认 `cores`，传 `all` 包含全部位置。示例请求为 `/api/replays/farming?playerId=2&heroId=1&roleScope=all`。

| 响应字段 | 内容 |
| --- | --- |
| `summary` | `{matchCount,samplePlayers,avgGpm,avgXpm,totalWeight}`。只计贡献位置样本的场次和人次，两项平均值分别忽略缺失值，无样本为 null。 |
| `cells[]` | `{nx,ny,rawX,rawY,weight,intensity}`。同格累加，intensity 为相对本次峰值的 0–1 强度。 |
| `zoneBreakdown[]` | 六项 `{zone,weight,percentage}`，有样本时百分比合计为 100，空样本各区均为 0。 |

点与单元的 `nx,ny` 均在 [0,1]，左上为画布原点。默认适配器、核心位置回退规则、热点算法和战术分区详见 [第四阶段文档](phase-4.md)。

## 实时 BP 与存档

草稿字段包括 `title,notes,patch,ourSide,firstPickSide,radiantTeamId,direTeamId,radiantPlayerIds,direPlayerIds,actions`。阵营取 `radiant` 或 `dire`。每队最多五个选手 ID，空槽为 null。禁选操作提交 `heroId`，选人可附加 `assignedPlayerId` 和 1–5 的 `roleHint`。服务端根据先选方和 24 步顺序推导动作和阵营。

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/bp/sessions` | 存档列表含 `id,title,patch,status,notes,ourSide,firstPickSide,updatedAt,revision,actionCount`，最近更新优先。 |
| POST | `/bp/sessions` | 接受草稿字段，`{}` 创建空局。返回完整存档。 |
| GET | `/bp/sessions/:id` | 返回草稿字段及 `id,revision,updatedAt,status,timeline,currentStep`。 |
| PUT | `/bp/sessions/:id` | 部分更新，提供 actions 时完整替换动作，返回完整存档。 |
| POST | `/bp/sessions/:id/action` | 执行下一步。指定 `stepIndex` 或 `step` 可修正已执行步骤，返回完整存档。 |
| POST | `/bp/sessions/:id/undo` | 撤销最后一步，返回完整存档；空局返回 400。 |
| POST | `/bp/sessions/:id/reset` | 清空动作并保留对局资料和阵容，返回完整存档。 |
| DELETE | `/bp/sessions/:id` | 删除存档及动作。 |
| POST | `/bp/recommend` | 传 `{"sessionId":1}` 或完整／部分草稿，返回 `currentStep,banRecommendations,pickRecommendations,lineupAudit,scoutingCard`。推荐使用本地数据。 |

更新存档、执行动作、撤销和重置时可提交整数 `revision` 实施并发检查。已完成的对局仍可撤销。阵容缺口、推荐因素及对手情报的字段含义见 [第三阶段文档](phase-3.md)。

## 备份与恢复

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/backup/export` | 下载 JSON，含 `version:3`、`exportedAt` 和各业务表数组，文件名为 `BPSystem-YYYY-MM-DD.json`。 |
| POST | `/backup/import` | 提交完整版本 2 或 3 快照。事务内替换业务数据、保留本机密钥、清理请求缓存，返回 `{counts:{表名:行数}}`。错误快照整笔回滚。 |

快照包括 `settings, heroes, players, teams, team_members, matches, match_players, match_picks_bans, player_pub_heroes, player_pub_matches, draft_sessions, draft_actions, hero_matchups`。四期录像字段随比赛与参赛者一起备份。设置只导出赛事权重及近期窗口。当前浏览器草稿和查询中的任务编号分别保存在浏览器本地存储和会话存储。
