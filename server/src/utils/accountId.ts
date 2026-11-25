import { HttpError } from './input.ts';

const steamBase = 76561197960265728n;
export function parseAccountId(input: unknown): number {
  const invalid = () => new HttpError(400, '请输入有效的 Steam32、Steam64 或选手主页链接');
  if (typeof input !== 'string' && !(typeof input === 'number' && Number.isSafeInteger(input)))
    throw invalid();
  let value = String(input).trim();
  let profile = false;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw invalid();
    }
    const match = /^\/players\/(\d{1,10})\/?$/.exec(url.pathname);
    if (
      !/^(www\.)?(opendota|dotabuff)\.com$/.test(url.hostname) ||
      !match ||
      url.username ||
      url.password ||
      url.port
    )
      throw invalid();
    value = match[1];
    profile = true;
  }
  if (!/^\d{1,17}$/.test(value)) throw invalid();
  const raw = BigInt(value);
  const id = !profile && raw >= steamBase ? raw - steamBase : raw;
  if (id < 1n || id > 4294967295n) throw invalid();
  return Number(id);
}
