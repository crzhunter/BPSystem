import { useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { api, failure, type Network, type Notify, type Settings } from './api';
import { PageIntro } from './Library';
export function SettingsView({
  heroCount,
  refresh,
  notify,
}: {
  heroCount: number;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [net, setNet] = useState<Network | null>(null);
  const [key, setKey] = useState(''),
    [weight, setWeight] = useState(''),
    [days, setDays] = useState(''),
    [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([api<Settings>('/settings'), api<Network>('/system/network')])
      .then(([s, n]) => {
        if (active) {
          setSettings(s);
          setNet(n);
          setWeight(String(s.tournamentMatchWeight));
          setDays(String(s.pubRecentDays));
          setLoadError('');
        }
      })
      .catch((e) => {
        if (active) setLoadError(failure(e));
      });
    return () => {
      active = false;
    };
  }, [retry]);
  async function save(fields: object, kind: string) {
    if (busy) return;
    setBusy(kind);
    try {
      const s = await api<Settings>('/settings', 'PUT', fields);
      setSettings(s);
      if (kind === 'key') setKey('');
      notify('设置已保存');
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy('');
    }
  }
  async function sync() {
    setBusy('sync');
    try {
      const r = await api<{ synced: number }>('/heroes/sync', 'POST');
      await refresh();
      notify('同步完成，已更新 ' + r.synced + ' 名英雄');
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy('');
    }
  }
  async function restore(file: File) {
    if (!confirm('用这份备份替换当前选手、战队、比赛、对局存档、英雄对位和分析设置？本机接口密钥会保留。')) return;
    setBusy('restore');
    try {
      let snapshot: unknown;
      try {
        snapshot = JSON.parse(await file.text());
      } catch {
        throw new Error('无法读取 JSON 备份，请检查文件格式');
      }
      const { counts } = await api<{ counts: Record<string, number> }>(
        '/backup/import',
        'POST',
        snapshot,
      );
      await refresh();
      setRetry((n) => n + 1);
      notify(
        '恢复完成，共 ' +
          counts.players +
          ' 名选手、' +
          counts.teams +
          ' 支战队、' +
          counts.matches +
          ' 场比赛',
      );
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageIntro title="系统设置" description="配置赛事分析参数、数据源与手机访问。" />
      {loadError && (
        <div className="notice">
          {loadError} <button onClick={() => setRetry((n) => n + 1)}>重新加载</button>
        </div>
      )}
      <div className="settings-grid">
        <section className="form-panel panel">
          <h2>
            <KeyRound />
            OpenDota 接口密钥
          </h2>
          <p className="hint">
            {settings?.hasOpenDotaApiKey
              ? '当前密钥 ' + settings.maskedPreview
              : '使用公共接口，也可添加密钥提高请求额度。'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save({ opendotaApiKey: key }, 'key');
            }}
          >
            <label>
              接口密钥
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="输入 OpenDota API Key"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={!settings?.hasOpenDotaApiKey || !!busy}
                className="subtle-button"
                onClick={() => save({ opendotaApiKey: '' }, 'key')}
              >
                清除密钥
              </button>
              <button disabled={!settings || !key.trim() || !!busy} className="primary">
                <Save size={14} />
                保存密钥
              </button>
            </div>
          </form>
        </section>
        <section className="form-panel panel">
          <h2>
            <SlidersHorizontal />
            分析默认值
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                { tournamentMatchWeight: Number(weight), pubRecentDays: Number(days) },
                'analysis',
              );
            }}
          >
            <div className="form-grid">
              <label>
                赛事对局权重（倍）
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  required
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </label>
              <label>
                近期路人范围（天）
                <input
                  type="number"
                  min="1"
                  max="365"
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
            </div>
            <div className="actions">
              <button className="primary" disabled={!settings || !!busy}>
                <Save size={14} />
                保存参数
              </button>
            </div>
          </form>
        </section>
        <section className="form-panel panel">
          <h2>
            <Database />
            英雄资料
          </h2>
          <p className="metric">
            {heroCount}
            <small>名英雄</small>
          </p>
          <p className="hint">更新 OpenDota 英雄资料，保留中文名与常用简称。</p>
          <button className="subtle-button" disabled={!!busy} onClick={sync}>
            <RefreshCw size={15} className={busy === 'sync' ? 'spin' : ''} />
            {busy === 'sync' ? '正在同步…' : '同步英雄库'}
          </button>
        </section>
        <section className="form-panel panel">
          <h2>
            <Wifi />
            手机局域网访问
          </h2>
          <p className="hint">手机连接同一 Wi-Fi，在浏览器中打开下列地址。</p>
          {net?.lanUrls.map((raw) => {
            const url = new URL(raw);
            if (import.meta.env.DEV) url.port = location.port;
            return (
              <a className="lan-link" key={raw} href={url.origin} target="_blank" rel="noreferrer">
                {url.origin}
                <ExternalLink size={15} />
              </a>
            );
          })}
          {net && !net.lanUrls.length && <p className="hint">尚未检测到局域网 IPv4 地址。</p>}
          {net && <small className="muted">主机 {net.hostname}</small>}
        </section>
        <section className="form-panel panel">
          <h2>
            <Database />
            数据备份与恢复
          </h2>
          <p className="hint">
            备份包含选手、阵容、比赛、对局存档、英雄资料、对位数据和分析设置。恢复将替换本机对应数据，接口密钥保留在当前服务器。
          </p>
          <div className="match-tools">
            <a className="subtle-button" href="/api/backup/export" download>
              导出 JSON 备份
            </a>
            <label className="subtle-button backup-picker">
              {busy === 'restore' ? '正在恢复…' : '导入 JSON 恢复'}
              <input
                type="file"
                accept=".json,application/json"
                disabled={!!busy}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (file) void restore(file);
                }}
              />
            </label>
          </div>
        </section>
      </div>
    </>
  );
}
