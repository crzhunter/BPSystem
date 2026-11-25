import { HttpError } from '../utils/input.ts';

export function upstream(condition: unknown): asserts condition {
  if (!condition) throw new HttpError(502, 'OpenDota 返回的战绩格式异常');
}
export function record(value: unknown): Record<string, unknown> {
  upstream(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
export function rows(value: unknown) {
  upstream(Array.isArray(value));
  return value.map(record);
}
export function numberField(value: unknown, min = 0): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  upstream(typeof n === 'number' && Number.isSafeInteger(n) && n >= min);
  return n;
}
export function optionalNumber(value: unknown) {
  return value == null ? null : numberField(value);
}
export function bit(value: unknown) {
  upstream(typeof value === 'boolean' || value === 0 || value === 1);
  return Number(value);
}
export function textField(value: unknown) {
  return typeof value === 'string' ? value : null;
}
export function faction(value: unknown) {
  const slot = numberField(value);
  upstream(slot < 256);
  return { slot, side: slot < 128 ? 'radiant' : 'dire', radiant: Number(slot < 128) };
}
