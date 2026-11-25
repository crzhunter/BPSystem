export type Side = 'radiant' | 'dire';
export type ActionType = 'ban' | 'pick';
export const opposite = (side: Side): Side => (side === 'radiant' ? 'dire' : 'radiant');
export const sideNames = { radiant: '天辉', dire: '夜魇' };
const rounds: [number, ActionType, string][] = [
  [1, 'ban', 'FSSFSSF'],
  [1, 'pick', 'FS'],
  [2, 'ban', 'FFS'],
  [2, 'pick', 'SFFSSF'],
  [3, 'ban', 'FSSF'],
  [3, 'pick', 'FS'],
];
export function cmOrder(firstPickSide: Side) {
  let step = 0;
  return rounds.flatMap(([phase, actionType, order]) =>
    [...order].map((team) => ({
      step: ++step,
      phase,
      actionType,
      isFirstPickTeam: team === 'F',
      side: team === 'F' ? firstPickSide : opposite(firstPickSide),
    })),
  );
}
export function currentStep(first: Side, our: Side, count: number) {
  const order = cmOrder(first);
  const step = order[Math.min(count, order.length - 1)];
  return {
    ...step,
    isOurTurn: count < order.length && step.side === our,
    isCompleted: count === order.length,
  };
}
