import { attributes, cdn, statKeys, type Counts, type SideSample } from '../data/heroMeta.ts';
import { record, rows, numberField, upstream } from './odFields.ts';

export const feeds = {
  patch: '/constants/patch',
  heroes: '/constants/heroes',
  meta: '/heroStats',
  items: '/constants/items',
  vh: 'https://www.dota2.com/datafeed/herolist?language=schinese',
  vi: 'https://www.dota2.com/datafeed/itemlist?language=schinese',
};
type Inputs = Record<keyof typeof feeds, unknown>;
function valve(data: unknown, key: string) {
  return rows(record(record(record(data).result).data)[key]);
}
const zh = /[\u3400-\u9fff]/;
// 部分测试物品、历史物品及术士专属物品在官方简中清单中缺译。
const translations: Record<string, string> = {
  diffusal_blade_2: '净魂之刃（二级）',
  caster_rapier: '法术圣剑',
  super_blink: '超级闪烁匕首',
  greater_mango: '大魔法芒果',
  mechanical_arm: '机械臂',
  horizon: '地平线',
  bottomless_chalice: '无底圣杯',
  stone_of_recall: '召回之石',
  black_grimoire: '黑暗魔典（术士）',
  miniboss_minion_summoner: '魔方召唤号角',
  claszian_timepiece: '克拉兹计时器',
  berserkers_hood: '狂战士兜帽',
  nothl_sigil: '薄葬印记',
};
export function sideQuery(since: number) {
  // 补丁起点来自已校验的版本日期，仅统计职业及顶级联赛的队长模式。
  const sql = `SELECT pm.hero_id,
    COUNT(*) FILTER(WHERE pm.player_slot < 128)::int AS radiant_pick,
    COUNT(*) FILTER(WHERE pm.player_slot < 128 AND m.radiant_win)::int AS radiant_win,
    COUNT(*) FILTER(WHERE pm.player_slot >= 128)::int AS dire_pick,
    COUNT(*) FILTER(WHERE pm.player_slot >= 128 AND NOT m.radiant_win)::int AS dire_win
    FROM matches m JOIN leagues l USING(leagueid) JOIN player_matches pm USING(match_id)
    WHERE m.start_time >= ${since} AND m.game_mode=2 AND l.tier IN ('premium','professional') GROUP BY pm.hero_id`;
  return '/explorer?' + new URLSearchParams({ sql });
}
export function matchupQuery(since: number) {
  const sql = `SELECT a.hero_id,b.hero_id AS against,COUNT(*)::int AS games,
    COUNT(*) FILTER (WHERE (a.player_slot < 128) = m.radiant_win)::int AS wins
    FROM matches m JOIN leagues l USING(leagueid) JOIN player_matches a USING(match_id)
    JOIN player_matches b ON b.match_id=m.match_id AND ((a.player_slot < 128) <> (b.player_slot < 128))
    WHERE m.start_time >= ${since} AND m.game_mode=2 AND l.tier IN ('premium','professional')
    GROUP BY a.hero_id,b.hero_id ORDER BY a.hero_id,b.hero_id`;
  return '/explorer?' + new URLSearchParams({ sql });
}
export type MatchupSample = [heroId: number, againstId: number, games: number, wins: number];
export function matchupSamples(value: unknown) {
  return rows(record(value).rows).map((r): MatchupSample => {
    const games = numberField(r.games, 1),
      wins = numberField(r.wins);
    upstream(wins <= games && r.hero_id !== r.against);
    return [numberField(r.hero_id, 1), numberField(r.against, 1), games, wins];
  });
}
export function sideSamples(value: unknown) {
  const samples = new Map<number, SideSample>();
  for (const row of rows(record(value).rows)) {
    const read = (side: string) => ({
      games: numberField(row[side + '_pick']),
      wins: numberField(row[side + '_win']),
    });
    const radiant = read('radiant'),
      dire = read('dire');
    upstream(radiant.wins <= radiant.games && dire.wins <= dire.games);
    samples.set(numberField(row.hero_id, 1), { radiant, dire });
  }
  return samples;
}
export function parseConstants(input: Inputs) {
  const patches = rows(input.patch).sort((a, b) => numberField(b.id) - numberField(a.id));
  const patch = String(patches[0]?.name);
  upstream(/^\d+\.\d+[a-z]?$/.test(patch));
  const od = record(input.heroes),
    stats = new Map(rows(input.meta).map((h) => [h.id, h]));
  const heroes = valve(input.vh, 'heroes')
    .map((v) => {
      const id = numberField(v.id, 1),
        h = record(od[id]),
        m = record(stats.get(id));
      const name = String(v.name),
        primary_attr = attributes[numberField(v.primary_attr)];
      upstream(
        primary_attr &&
          h.name === name &&
          m.name === name &&
          /^npc_dota_hero_[a-z0-9_]+$/.test(name),
      );
      upstream(
        typeof v.name_loc === 'string' &&
          zh.test(v.name_loc) &&
          typeof h.localized_name === 'string',
      );
      upstream(
        (h.attack_type === 'Melee' || h.attack_type === 'Ranged') &&
          Array.isArray(h.roles) &&
          h.roles.every((r) => typeof r === 'string'),
      );
      const counts = Object.fromEntries(statKeys.map((k) => [k, numberField(m[k])])) as Counts;
      upstream(
        counts['7_win'] <= counts['7_pick'] &&
          counts['8_win'] <= counts['8_pick'] &&
          counts.pro_win <= counts.pro_pick,
      );
      return {
        id,
        name,
        cn_name: v.name_loc,
        localized_name: h.localized_name,
        primary_attr,
        attack_type: h.attack_type as string,
        roles: h.roles as string[],
        img: cdn + 'heroes/' + name.slice(14) + '.png',
        ...counts,
      };
    })
    .sort((a, b) => a.id - b.id);
  upstream(
    heroes.length >= 127 &&
      new Set(heroes.map((h) => h.id)).size === heroes.length &&
      attributes.every((a) => heroes.some((h) => h.primary_attr === a)),
  );
  const official = valve(input.vi, 'itemabilities'),
    odItems = record(input.items);
  const byId = new Map(official.map((v) => [numberField(v.id, 1), v]));
  const byKey = new Map(official.map((v) => [String(v.name).slice(5), v]));
  const legacy = new Map(
    Object.entries(odItems).map(([key, data]) => [
      numberField(record(data).id, 1),
      { key, data: record(data) },
    ]),
  );
  const items = [...new Set([...byId.keys(), ...legacy.keys()])]
    .sort((a, b) => a - b)
    .map((id) => {
      const v = byId.get(id),
        entry = legacy.get(id);
      const key = v ? String(v.name).replace(/^item_/, '') : entry!.key;
      upstream(/^[a-z0-9_]+$/.test(key));
      const recipe = key.startsWith('recipe_'),
        base = key.slice(7);
      const recipeBase = byKey.get(base)?.name_loc || translations[base];
      const cnName = zh.test(String(v?.name_loc))
        ? String(v!.name_loc).trim()
        : recipe && recipeBase
          ? '图纸（' + recipeBase + '）'
          : translations[key];
      upstream(cnName);
      const localizedName = String(
        v?.name_english_loc ||
          entry?.data.dname ||
          (recipe ? (byKey.get(base)?.name_english_loc || base) + ' Recipe' : key),
      );
      const icon = recipe
        ? 'recipe'
        : String(entry?.data.img ?? '').match(/\/items\/([\w]+)\.png/)?.[1] || key;
      return { id, key, cnName, localizedName, imgUrl: cdn + 'items/' + icon + '.png' };
    });
  upstream(
    official.length >= 500 &&
      Object.keys(odItems).length >= 500 &&
      items.some((i) => i.key === 'blink'),
  );
  const since = Math.floor(Date.parse(String(patches[0]?.date)) / 1000);
  upstream(Number.isSafeInteger(since) && since > 0);
  const floor = patches.find((p) => p.name === '7.42');
  upstream(floor);
  const id = numberField(floor.id, 1),
    startTime = Math.floor(Date.parse(String(floor.date)) / 1000);
  upstream(Number.isSafeInteger(startTime) && startTime > 0);
  const ids = patches.map((p) => numberField(p.id)).filter((n) => n >= id);
  upstream(new Set(ids).size === ids.length);
  const calendar = patches.map((p) => ({
    id: numberField(p.id),
    start: Math.floor(Date.parse(String(p.date)) / 1000),
  }));
  upstream(calendar.every((p) => Number.isSafeInteger(p.start) && p.start > 0));
  return {
    patch,
    heroes,
    items,
    since,
    scope: { id, startTime, ids, calendar, verifiedThrough: Math.floor(Date.now() / 1000) },
  };
}
export type Constants = {
  scope?: ReturnType<typeof parseConstants>['scope'];
  patch: string;
  matchups: MatchupSample[];
  items: ReturnType<typeof parseConstants>['items'];
  heroes: (ReturnType<typeof parseConstants>['heroes'][number] & { sideSample?: SideSample })[];
};
