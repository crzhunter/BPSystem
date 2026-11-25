import {
  cmOrder,
  currentStep,
  currentOrder,
  opposite,
  sideNames,
  type Side,
} from '../../server/src/data/cmOrder';
import type { Action, Draft } from '../../server/src/services/draftState';
import type { recommend } from '../../server/src/services/bpEngine';
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
export function initialRoom(): Room {
  try {
    const d = JSON.parse(localStorage.getItem('bp-live-v3') ?? 'null');
    if (
      d &&
      sides.includes(d.ourSide) &&
      sides.includes(d.firstPickSide) &&
      sides.every((s) => Array.isArray(d[slotsKey(s)]) && d[slotsKey(s)].length === 5) &&
      Array.isArray(d.actions) &&
      d.actions.length <= 24 &&
      d.actions.every((a: Action) => Number.isInteger(a.heroId))
    )
      return roomFrom({
        ...d,
        patch: !d.patch || /^\d+\.\dx$/.test(d.patch) ? blank().patch : d.patch,
      });
    const old = JSON.parse(localStorage.getItem('bp-prep-v1') ?? 'null');
    if (
      old &&
      sides.includes(old.our) &&
      sides.includes(old.first) &&
      sides.every((s) => old[s]?.slots?.length === 5)
    ) {
      const room = { ...blank(), ourSide: old.our, firstPickSide: old.first };
      for (const s of sides) {
        room[slotsKey(s)] = old[s].slots.map((n: number) => n || null);
        room[teamKey(s)] = old[s].team || null;
      }
      return room;
    }
  } catch {
    /* 本机草稿损坏时，服务器存档仍可从对局存档载入。 */
  }
  return blank();
}
export const actionLabel = (type: 'ban' | 'pick') => (type === 'ban' ? '禁人' : '选人');
export function stepLabel(step: ReturnType<typeof currentStep>) {
  return step.isCompleted
    ? '禁选完成'
    : (step.isOurTurn ? '我方' : '敌方') + actionLabel(step.actionType);
}
