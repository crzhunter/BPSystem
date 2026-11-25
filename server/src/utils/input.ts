export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HttpError(400, message);
}
export function stringValue(value: unknown, label: string, max: number, required = false) {
  check(typeof value === 'string', label + '须为文本');
  const result = value.trim();
  check(result.length <= max && (!required || result.length > 0), label + '为空或超过长度限制');
  return result;
}
export function integer(value: unknown, min: number, max: number, label: string): number {
  check(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    label + '超出有效范围',
  );
  return value;
}
