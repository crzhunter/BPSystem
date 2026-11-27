export type Player = {
  id: number;
  accountId: number;
  nickname: string;
  alias: string;
  rankTier: number | null;
  leaderboardRank: number | null;
  primaryRole: number | null;
  styleTags: string[];
  roles: number[];
  notes: string;
  lastSyncedAt: string | null;
};
export type Member = { slot: number; player: Player | null };
export type Team = {
  id: number;
  name: string;
  tag: string;
  color: string;
  notes: string;
  roster: Member[];
  subs: Member[];
};
export type Hero = {
  id: number;
  name: string;
  cnName: string;
  localizedName: string;
  aliases: string[];
  portraitUrl: string;
  img: string;
  primaryAttr: string;
  typicalRoles: number[];
};
export type Settings = {
  patch: string;
  hasOpenDotaApiKey: boolean;
  maskedPreview: string;
  tournamentMatchWeight: number;
  pubRecentDays: number;
};
export type Network = { port: number; hostname: string; lanUrls: string[] };
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method,
      signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接服务，请检查局域网连接');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '服务暂时无法响应');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const positions = ['核心位', '中单位', '劣单位', '游走位', '辅助位'];
export type Notify = (message: string, error?: boolean) => void;
export function failure(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试';
}
