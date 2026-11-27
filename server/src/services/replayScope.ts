// 比赛库中的赛事，以及能关联本地选手逐场记录的路人局，均可进入复盘。
export const replayScope = `(m.source='tournament' OR EXISTS (
  SELECT 1 FROM player_pub_matches pm WHERE pm.match_id=m.match_id))`;
