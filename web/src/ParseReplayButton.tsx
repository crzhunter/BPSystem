import { useEffect, useRef, useState } from 'react';
import { api, failure } from './api';

/** 比赛库和录像页共享同一个任务编号，切页或刷新后继续查询。 */
export function ParseReplayButton({
  matchId,
  onParsed,
  label = '请求 OpenDota 解析',
}: {
  matchId: number;
  onParsed: () => void;
  label?: string;
}) {
  const key = 'bp.parse.' + matchId;
  const [job, setJob] = useState(() => sessionStorage.getItem(key));
  const [sending, setSending] = useState(false),
    [message, setMessage] = useState('');
  const [paused, setPaused] = useState(false);
  const onComplete = useRef(onParsed);
  onComplete.current = onParsed;
  useEffect(() => {
    if (!job || paused) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await api<{ status: 'pending' | 'completed' | 'failed' }>(
          '/matches/' + matchId + '/parse-status?jobId=' + encodeURIComponent(job!),
        );
        if (!active) return;
        if (data.status === 'pending') {
          setMessage('已排队，正在等待解析…');
          timer = setTimeout(poll, 5000);
        } else {
          sessionStorage.removeItem(key);
          setJob(null);
          if (data.status === 'completed') {
            setMessage('解析完成');
            onComplete.current();
          } else setMessage('未能取得解析数据，录像可能已过期。');
        }
      } catch (error) {
        if (active) {
          setPaused(true);
          setMessage(failure(error));
        }
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job, key, matchId, paused]);
  async function request() {
    if (job) {
      setMessage('正在查询…');
      setPaused(false);
      return;
    }
    setSending(true);
    setMessage('');
    try {
      const data = await api<{ status: string; jobId: number | string | null }>(
        '/matches/' + matchId + '/request-parse',
        'POST',
      );
      if (data.status === 'already_parsed') {
        onComplete.current();
        return;
      }
      sessionStorage.setItem(key, String(data.jobId));
      setJob(String(data.jobId));
      setMessage('已提交解析请求');
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setSending(false);
    }
  }
  return (
    <span className="parse-action">
      <button className="subtle-button" onClick={request} disabled={sending || (!!job && !paused)}>
        {sending ? '正在提交…' : paused ? '继续查询' : job ? '解析中' : label}
      </button>
      {message && <small role="status">{message}</small>}
    </span>
  );
}
