# BPSystem REST API · 第一至第六阶段

以下路径相对于同源前缀 `/api`。生产默认地址为 `http://localhost:3001/api`。请求和响应使用 JSON，提交对象时设置 `Content-Type: application/json`。常规请求体上限 128 KiB，备份恢复上限 64 MiB。GET 返回 200，创建选手、战队或存档返回 201，删除成功返回 204 空响应。接口响应带 `Cache-Control: no-store`。

错误格式为 `{"error":"中文原因"}`。参数或数据错误为 400，记录缺失为 404，账号冲突或过期修订号为 409，超限为 413。上游响应异常或不可用通常为 502，长时间限流为 503。批量导入与同步应逐条检查 `results`。时间戳使用 UTC ISO 字符串，比赛开始时间为 Unix 秒，游戏时长和事件时间均以秒计。

## 系统、配置与英雄

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/health` | 返回 `ok, db, heroCount, timestamp`。 |
| GET | `/system/network` | 返回后端 `port, hostname, lanUrls[]`。开发网页向手机展示同一主机的 Vite 端口。 |
| GET | `/settings` | 返回 `patch, hasOpenDotaApiKey, maskedPreview, tournamentMatchWeight, pubRecentDays, playerPoolWeight`。 |
| PUT | `/settings` | 部分更新接口密钥、赛事局倍数、近期窗口或英雄池权重。密钥最多 512 字符，空串清除。新库默认 4 倍、60 天、0.18。兼容旧请求的赛事倍数 0–100，生效范围 0–8。窗口取整数 1–365，英雄池权重自动限制在 0.15–0.20。 |
| GET | `/heroes?q=` | 可按中英文名、内部名、简称搜索。数组项含 `id, name, localizedName, cnName, aliases, img, icon, portraitUrl, meta, primaryAttr, attackType, roles, typicalRoles, tags`。 |
| GET | `/items` | 按 ID 升序返回物品数组，每项含 `id, key, cnName, localizedName, imgUrl`。英雄及物品的全尺寸图片地址均指向 Steam CDN。 |
| POST | `/constants/sync` | 无需请求体。原子刷新英雄、物品、版本、7.42 起算边界及后续补丁 ID、职业赛分阵营和对位样本，返回 `{patch,sampledAt,synced,itemCount}`。 |
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
| POST | `/players/resync-patch` | 无需请求体。按本地 ID 逐人刷新所有选手。返回 `{results:[{playerId,success,isProfilePrivate?,error?}]}`，单个账号失败时保留其原统计并继续。 |
| GET | `/players/:id/analytics` | 返回 `playerId, isProfilePrivate, privacyHint, lastSyncedAt, recentForm, roleDistribution, sideSplits, heroPool`。近期表现含连胜败、平均 KDA/GPM/XPM。英雄池含赛事和路人分项、`weightedScore, threatScore, grade, source`。 |
| GET | `/teams` | 战队数组，每队含队伍资料、五个有序首发槽 `roster` 和替补 `subs`。 |
| POST | `/teams` | `name` 必填，可传 `tag,color,notes,members`。颜色为六位十六进制色值，返回新战队。 |
| PUT | `/teams/:id` | 部分更新资料，可同时全量替换 `members`，事务成功后返回战队。 |
| PUT | `/teams/:id/roster` | 传 `{"members":[{"slot":1,"playerId":3}]}` 全量替换，空数组清空。返回战队。 |
| POST | `/teams/:id/sync` | 逐人同步首发和替补，返回 `{results:[{playerId,success,isProfilePrivate?,error?}]}`。 |
| DELETE | `/teams/:id` | 删除战队预设和成员关联，选手资料保留。 |

每个槽位为 `{slot,player}`，空位的 player 为 null。槽位 1–5 为首发，6 及以上为替补。队内选手和槽位均须唯一。

近期状态、阵营胜率和分路分布按 7.42+ 逐场记录统计。英雄池每项新增 `patch742Games, patch742Wins, isPatch742Sample, patchPub, patchTournament`。前两项合计版本内路人和赛事，分项含场数、胜数和胜率。原 `pub` 与 `tournament` 留作历史明细。`weightedScore` 使用版本样本，旧记录最多贡献三分。

## 比赛库与解析任务

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| POST | `/matches/import` | `matchIds` 接受 ID、比赛链接或其数组，支持空白、逗号、分号分隔。可传 `tag`。返回 `{results:[{matchId,imported,updated?,hasParsed?,linkedPlayersCount?,error?}]}`。省略标签时重导保留原标签。 |
| GET | `/matches?tag=&q=` | 可按标签精确过滤，或搜索比赛 ID、队名、选手昵称、账号和标签。返回赛事数组，含 `matchId,tag,patch,startTime,duration,radiantWin,hasParsed,importedAt,radiantName,direName,playersCount,teamsCount,linkedPlayersCount,picksBans`。 |
| GET | `/matches/:matchId` | 返回摘要及 `players[]`、完整 `picksBans[]`、`telemetry:{obsCount,senCount,hasParsed}`。参赛者使用数据库字段名（如 `hero_id,player_slot,obs_log_json`），另含 `linkedPlayerId,linkedNickname` 和按装备栏顺序解析的 `items` 数组。空槽为 null，已收录物品含中英文名及图标地址。 |
| DELETE | `/matches/:matchId` | 删除比赛及其参赛者、禁选和录像数据。 |
| POST | `/matches/:matchId/request-parse` | 已导入的比赛，无需请求体。响应 `{matchId,jobId,status}`；`queued` 带上游任务编号（数字或字符串），`already_parsed` 的 jobId 为 null。 |
| GET | `/matches/:matchId/parse-status?jobId=` | jobId 必填，取提交返回的原值。响应 `{matchId,status,hasParsed,wardCount}`，wardCount 为本地两类原始守卫日志条数。 |

`pending` 表示仍在队列中，客户端可在 5 秒后再次查询。`completed` 表示本地已确认解析；上游任务刚完成时，接口会先刷新比赛并回填再返回。`failed` 表示上游报告失败或出队后仍取不到解析数据。连接或格式异常使用 HTTP 错误，恢复后可用原 jobId 再查。

## 录像分析

录像分析只使用已导入的赛事。先读取选手或参赛名单，再用同一个身份查询眼位与刷钱分布。

| 方法 | 路径 | 响应 |
| --- | --- | --- |
| GET | `/replays/players` | 已保存选手数组，每项含本地 `id`、`nickname`、偏好位置 `roles` 和已解析赛事数 `parsedMatchCount`。包括零场选手。 |
| GET | `/replays/players/:playerId/matches` | 该选手的所有已导入赛事，含待解析场次，按开赛时间、比赛编号降序。已有选手无比赛时返回空数组，选手不存在时返回 404。 |
| GET | `/replays/matches/:matchId/participants` | 同一比赛的参赛记录，按 `playerSlot` 排列。早期备份缺少参赛者时返回空数组，赛事不存在时返回 404。 |

两个参赛记录接口共用以下字段。

| 字段 | 含义 |
| --- | --- |
| `matchId, tag, startTime, duration, hasParsed` | 比赛编号、赛事标签、Unix 开赛时间（秒）、时长（秒）和解析状态。时间或时长缺失时为 null。 |
| `playerId, accountId, playerSlot, playerName` | 本地选手编号、游戏账号、当场槽位和显示名。未关联时 `playerId` 为 null，匿名时 `accountId` 为 null。 |
| `heroId, heroCnName, heroLocalizedName, heroPortraitUrl` | 当场英雄编号、中文名、本地化名和 Steam CDN 完整肖像地址。目录外的历史英雄显示编号与游戏封面。 |
| `side, win, resultKnown` | 当场阵营和该选手是否取胜。旧记录缺失胜方时 `resultKnown` 与 `win` 均为 false，界面显示「胜负未知」。 |
| `kills, deaths, assists, gpm, xpm` | 当场击杀、死亡、助攻和每分钟金钱、经验。保留零值，缺失时为 null。 |
| `obsCount, senCount` | 该选手全场可定位的假眼、真眼事件数，使用与本地热图相同的坐标和时间校验。 |

热图接口 `/replays/wards` 和 `/replays/farming` 接受以下可选条件，多个条件取交集。只传 `playerId=2` 聚合该选手的已解析赛事，追加 `matchId=101` 即查看他在该场的样本。未关联的参赛者使用 `matchId=101&accountId=220`，匿名参赛者使用 `matchId=101&playerSlot=0`。

| 参数 | 含义 |
| --- | --- |
| `matchId` | 比赛 ID，省略则可跨场。 |
| `teamId` | 本地战队 ID，只取当前首发及替补账号对应的人次。 |
| `playerId` | 本地选手 ID，按其游戏账号关联历史比赛。 |
| `accountId` | 参赛者的游戏账号，须同时传入 `matchId`。 |
| `playerSlot` | 匿名参赛者的槽位，须同时传入 `matchId`。天辉为 0–4，夜魇为 128–132。 |
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

可附加 `heroId` 与 `roleScope`。按选手、参赛账号或槽位查看时，位置范围默认 `all`，包含辅助位。其余查询沿用默认值 `cores`（仅核心位）。显式传入的位置范围优先。示例请求为 `/api/replays/farming?playerId=2&matchId=101&roleScope=all`。本地位置网格没有逐点时间，刷钱分布按整场位置权重计算。

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
| POST | `/bp/recommend` | 传 `{"sessionId":1}` 或完整／部分草稿，可带整数 `previewHeroId` 和 `rolePreference`。返回 `patch,currentStep,banRecommendations,pickRecommendations,composition,weights,preview,lineupAudit,scoutingCard,effectiveRoleMode,roleModes,bpAdvantage,laneForecast`。推荐仅查询本地数据。 |

英雄的 `primaryAttr` 为 str、agi、int、all。`meta` 包含 tier、baseWinrate、highMmrWinrate、pickRate、proContestedRate、proBanRate、sideBias、counts、sampledAt 和 patch。百分比标度为 0–100，缺少胜率或阵营样本时对应值为 null。

`composition.our`、`composition.enemy` 含 assignments、coveredRoles、missingRoles、scores、damageProfile、rangeBalance、warnings、strengths。scores 的六个键为 disable、frontline、burst、sustain、push、teamfight。每方每位英雄只占一个位置。预览返回候选、阵营、是否为禁用推演、fillsRole 和六项 delta。当前手结束或候选已使用时 preview 为 null。

推荐项含 heroId、cnName、localizedName、portraitUrl、primaryAttr、tier、score、suggestedRole、shortTags，以及 metaSummary、compositionFit、matchupDetails 和可选 playerFit。结构化内容也可通过 details 读取。机制判断的 deltaPct 为 null，有样本时为带符号的百分点。禁用项额外含 banCategory 和 whyBan。weights.pick 与 weights.ban 分别给出版本、阵容、对位、顺位策略、选手的实际权重。

| 六期字段 | 含义 |
| --- | --- |
| 请求 `rolePreference` | 省略为 `"auto"`，可传 `"support"`、`"core"` 或整数 1–5。例如 `{"sessionId":1,"rolePreference":4}`。非法值返回 400。 |
| `effectiveRoleMode` | 当前动作对应的 `{mode,label,description,targetRoles:number[]}`。切换到另一榜时，读取 `roleModes.pick` 或 `roleModes.ban` 获取相应策略。 |
| 推荐项 `roleGroup,roleLabel,playerContribution` | 跨核心、辅助的摇摆英雄为 `flex`，其余为 `core` 或 `support`。中文标签列出常见位置。贡献值为选手因素实际计入的推荐分。 |
| `composition.our.weaknesses[]` | `{id,severity,title,detail,fixHeroes[]}`。风险分为 `high` 和 `medium`。 |
| `composition.enemy.exploitableWeaknesses[]` | 同样的风险字段，`counterHeroes[]` 列出我方破阵人选。两类候选均含 `heroId,cnName,portraitUrl,role,reason`，最多三人，剔除双方已禁已选。整局结束时清空候选。 |
| `bpAdvantage` | `radiantWinProb,direWinProb` 为 30–70 的百分数，合计 100。`metaEdge,matchupEdge,compositionEdge,sideEdge` 为天辉视角的百分点，`summary` 按我方视角解读。 |
| `laneForecast[]` | 双方各选至少两人后输出优势路、中路、劣势路。每路含 `label,location,ourHeroes,enemyHeroes,score,verdict,partial`。任一侧该路尚未亮人时 score 为 null、verdict 为「待亮人」。英雄数组使用英雄 ID。 |

分阶段的排名、旧版折算和对线估算见[六期分析说明](phase-6-analyst-upgrade.md)。

更新存档、执行动作、撤销和重置时可提交整数 `revision` 实施并发检查。已完成的对局仍可撤销。阵容缺口、推荐因素及对手情报的字段含义见 [第三阶段文档](phase-3.md)。

## 备份与恢复

| 方法 | 路径 | 请求和响应 |
| --- | --- | --- |
| GET | `/backup/export` | 下载 JSON，含 `version:4`、`exportedAt` 和各业务表数组，文件名为 `BPSystem-YYYY-MM-DD.json`。 |
| POST | `/backup/import` | 接受版本 2、3、4。旧快照按原始逐场时间识别版本样本。事务内替换业务数据、保留本机密钥、清理请求缓存，返回 `{counts:{表名:行数}}`。错误快照整笔回滚。 |

快照包括 `settings, heroes, players, teams, team_members, matches, match_players, match_picks_bans, player_pub_heroes, player_pub_matches, draft_sessions, draft_actions, hero_matchups`。录像字段随比赛与参赛者一起备份。恢复时保留本机当前版本的英雄常量、物品及模型样本，补入历史备份独有的英雄记录。设置导出赛事倍数、英雄池权重和近期窗口。当前浏览器草稿和查询中的任务编号分别保存在浏览器本地存储和会话存储。
