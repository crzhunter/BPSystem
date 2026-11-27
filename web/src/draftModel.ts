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
export const setupKey = 'bp-setup-v5';
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
  const instant = false;
  try {
    const store = storage ?? window.localStorage;
    // 旧键可能来自自动装队的版本，无法区分用户选择。只恢复 v5 明确保存的配置。
    for (const key of ['bp-prep-v1', 'bp-live-v3', 'bp-setup-v4']) store.removeItem(key);
    const data = readSetup(store, setupKey);
    if (data && typeof data === 'object') {
      if (sides.includes(data.ourSide)) room.ourSide = data.ourSide;
      if (sides.includes(data.firstPickSide)) room.firstPickSide = data.firstPickSide;
      for (const side of sides) {
        const team = teamKey(side),
          slots = slotsKey(side);
        if (Number.isSafeInteger(data[team]) && data[team] > 0) room[team] = data[team];
        const ids = data[slots];
        if (
          Array.isArray(ids) &&
          ids.length === 5 &&
          ids.every((id) => id === null || (Number.isSafeInteger(id) && id > 0))
        )
          room[slots] = ids;
      }
    }
    // 恢复阵容时，按位置保留首次出现的选手，避免形成跨队重复的无效阵容。
    const seen = new Set<number>();
    for (const side of sides) {
      const slots = slotsKey(side);
      room[slots] = room[slots].map((id) => {
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return id;
      });
    }
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
