import {
  cmOrder,
  currentStep,
  currentOrder,
  opposite,
  sideNames,
  type Side,
} from '../../server/src/data/cmOrder.ts';
import type { Action, Draft } from '../../server/src/services/draftState.ts';
import type { recommend } from '../../server/src/services/bpEngine.ts';
export { cmOrder, currentStep, opposite, sideNames, type Side, type Action };
export type Advice = ReturnType<typeof recommend>;
export type Room = Draft & { id?: number; revision?: number };
export const sides: Side[] = ['radiant', 'dire'];
export const slotsKey = (s: Side) => (s === 'radiant' ? 'radiantPlayerIds' : 'direPlayerIds');
export const teamKey = (s: Side) => (s === 'radiant' ? 'radiantTeamId' : 'direTeamId');
export const blank = (): Room => ({
  title: '未命名对局',
  notes: '',
  patch: '7.42',
  cmOrderVersion: currentOrder,
  ourSide: 'radiant',
  firstPickSide: 'radiant',
  radiantTeamId: null,
  direTeamId: null,
  radiantPlayerIds: Array(5).fill(null),
  direPlayerIds: Array(5).fill(null),
  actions: [],
});
export function roomFrom(data: Room): Room {
  // 仅保存动作输入；实际阵营随先选权推导，交换双方不会携带旧阵营字段。
  const {
    id,
    revision,
    title,
    notes,
    patch,
    ourSide,
    firstPickSide,
    radiantTeamId,
    direTeamId,
    radiantPlayerIds,
    direPlayerIds,
  } = data;
  return {
    id,
    revision,
    title,
    notes,
    patch,
    ourSide,
    firstPickSide,
    radiantTeamId,
    direTeamId,
    radiantPlayerIds,
    direPlayerIds,
    cmOrderVersion: data.cmOrderVersion ?? (data.actions.length ? 'classic' : currentOrder),
    actions: data.actions.map(({ heroId, assignedPlayerId, roleHint }) => ({
      heroId,
      assignedPlayerId,
      roleHint,
    })),
  };
}
export type SetupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const setupKey = 'bp-setup-v4';
export function setupOf(room: Room, instant: boolean) {
  const { ourSide, firstPickSide, radiantTeamId, direTeamId, radiantPlayerIds, direPlayerIds } =
    room;
  return {
    ourSide,
    firstPickSide,
    radiantTeamId,
    direTeamId,
    radiantPlayerIds,
    direPlayerIds,
    instant,
  };
}

function readSetup(storage: SetupStorage, key: string) {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
export function initialRoom(storage?: SetupStorage) {
  const room = blank();
  let instant = true;
  try {
    const store = storage ?? window.localStorage;
    // 按版本从旧到新逐字段迁移，未知字段与历史动作不会进入新键。
    for (const key of ['bp-prep-v1', 'bp-live-v3', setupKey]) {
      const data = readSetup(store, key);
      if (!data || typeof data !== 'object') continue;
      if (sides.includes(data.ourSide ?? data.our)) room.ourSide = data.ourSide ?? data.our;
      if (sides.includes(data.firstPickSide ?? data.first))
        room.firstPickSide = data.firstPickSide ?? data.first;
      for (const side of sides) {
        const team = teamKey(side),
          slots = slotsKey(side);
        const id = team in data ? data[team] : data[side]?.team;
        if (id === null || (Number.isSafeInteger(id) && id > 0)) room[team] = id;
        const ids = data[slots] ?? data[side]?.slots;
        if (
          Array.isArray(ids) &&
          ids.length === 5 &&
          ids.every((n) => n === null || (Number.isSafeInteger(n) && n >= 0))
        )
          room[slots] = ids.map((n) => n || null);
      }
      if (key === setupKey && typeof data.instant === 'boolean') instant = data.instant;
    }
    // 混用多个旧键时，按位置保留首次出现的选手，避免形成跨队重复的无效阵容。
    const seen = new Set<number>();
    for (const side of sides) {
      const slots = slotsKey(side);
      room[slots] = room[slots].map((id) => {
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return id;
      });
    }
    store.removeItem('bp-prep-v1');
    store.removeItem('bp-live-v3');
    store.setItem(setupKey, JSON.stringify(setupOf(room, instant)));
  } catch {
    // 禁用存储时仍允许在内存中开局。
  }
  return { ...room, instant };
}

type StartingTeam = { id: number; roster: { slot: number; player: { id: number } | null }[] };
export function seedDefaultTeams(room: Room, teams: StartingTeam[]): Room {
  if (
    !teams.length ||
    room.actions.length ||
    sides.some((s) => room[teamKey(s)] || room[slotsKey(s)].some((id) => id !== null))
  )
    return room;
  const next = { ...room };
  const used = new Set<number>();
  sides.forEach((side, i) => {
    const team = teams[i];
    if (!team) return;
    next[teamKey(side)] = team.id;
    next[slotsKey(side)] = Array.from({ length: 5 }, (_, j) => {
      const id = team.roster.find((m) => m.slot === j + 1)?.player?.id;
      if (!id || used.has(id)) return null;
      used.add(id);
      return id;
    });
  });
  return next;
}
export const actionLabel = (type: 'ban' | 'pick') => (type === 'ban' ? '禁人' : '选人');
export function stepLabel(step: ReturnType<typeof currentStep>) {
  return step.isCompleted
    ? '禁选完成'
    : (step.isOurTurn ? '我方' : '敌方') + actionLabel(step.actionType);
}
