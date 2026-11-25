export type Side = 'radiant' | 'dire';
export type ActionType = 'ban' | 'pick';
export const opposite = (side: Side): Side => (side === 'radiant' ? 'dire' : 'radiant');
export const sideNames = { radiant: '天辉', dire: '夜魇' };
export const currentOrder = '7.42-standard';
export type OrderVersion = 'classic' | typeof currentOrder;
const rounds: [number, ActionType, string][] = [
  [1, 'ban', 'FFSSFSS'],
  [1, 'pick', 'FS'],
  [2, 'ban', 'FFS'],
  [2, 'pick', 'SFFSSF'],
  [3, 'ban', 'FSFS'],
  [3, 'pick', 'FS'],
];
export function cmOrder(firstPickSide: Side, version: OrderVersion = currentOrder) {
  let step = 0;
  return rounds.flatMap(([phase, actionType, order]) =>
    [
      ...(version === 'classic' && actionType === 'ban' && phase !== 2
        ? phase === 1
          ? 'FSSFSSF'
          : 'FSSF'
        : order),
    ].map((team) => ({
      step: ++step,
      phase,
      actionType,
      isFirstPickTeam: team === 'F',
      side: team === 'F' ? firstPickSide : opposite(firstPickSide),
    })),
  );
}
export function currentStep(
  first: Side,
  our: Side,
  count: number,
  version: OrderVersion = currentOrder,
) {
  const order = cmOrder(first, version);
  const step = order[Math.min(count, order.length - 1)];
  return {
    ...step,
    isOurTurn: count < order.length && step.side === our,
    isCompleted: count === order.length,
  };
}
