import { useState, useRef, useCallback, useEffect } from 'react';

// ── 类型 ──────────────────────────────────────────────
interface Ticket {
  reds: number[];
  blue: number;
}

interface CompoundTicket {
  reds: number[];
  blues: number[];
}

interface TicketRecord {
  attempt: number;
  ticket: Ticket;
}

type Speed = 'slow' | 'medium' | 'fast' | 'ultra';

// ── 常量 ──────────────────────────────────────────────
const RED_MAX = 33;
const RED_COUNT = 6;
const BLUE_MAX = 16;
const PRICE_PER_BET = 2;
const HISTORY_LIMIT = 30;
const TOTAL_COMBINATIONS = 17_721_088; // C(33,6) * 16

const SPEED_CONFIG: Record<Speed, { label: string; desc: string }> = {
  slow:   { label: '慢速', desc: '每次1注，看清每一注' },
  medium: { label: '中速', desc: '~50万次/秒' },
  fast:   { label: '快速', desc: '~200万次/秒' },
  ultra:  { label: '极速', desc: '全速冲刺' },
};

const SPEED_BUDGET: Record<Speed, number> = {
  slow: 0,
  medium: 30,
  fast: 60,
  ultra: 120,
};

const SPEED_DELAY: Record<Speed, number> = {
  slow: 250,
  medium: 0,
  fast: 0,
  ultra: 0,
};

// ── 工具函数 ──────────────────────────────────────────
function sampleUnique(max: number, count: number): number[] {
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (max - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function generateTicket(): Ticket {
  const reds = sampleUnique(RED_MAX, RED_COUNT);
  const blue = Math.floor(Math.random() * BLUE_MAX) + 1;
  return { reds, blue };
}

function recordTicketNumbers(ticket: Ticket, reds: Set<number>, blues: Set<number>): void {
  ticket.reds.forEach((red) => reds.add(red));
  blues.add(ticket.blue);
}

function createCompoundSnapshot(reds: Set<number>, blues: Set<number>): CompoundTicket {
  return {
    reds: Array.from(reds).sort((a, b) => a - b),
    blues: Array.from(blues).sort((a, b) => a - b),
  };
}

function ticketCoveredBySelection(ticket: Ticket, reds: Set<number>, blues: Set<number>): boolean {
  return blues.has(ticket.blue) && ticket.reds.every((red) => reds.has(red));
}

function combination(n: number, k: number): number {
  if (n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

function calculateBetCount(redCount: number, blueCount: number): number {
  return combination(redCount, RED_COUNT) * blueCount;
}

function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}分${sec}秒`;
  const h = Math.floor(m / 60);
  return `${h}时${m % 60}分${sec}秒`;
}

// ── 球组件 ────────────────────────────────────────────
function Ball({
  number,
  type,
  selected,
  onClick,
  disabled,
  size = 'md',
}: {
  number: number;
  type: 'red' | 'blue';
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      className={`ball ball-${type} ball-${size}${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {String(number).padStart(2, '0')}
    </button>
  );
}

// ── 主应用 ────────────────────────────────────────────
export default function App() {
  // 选号状态
  const [selectedReds, setSelectedReds] = useState<Set<number>>(new Set());
  const [selectedBlues, setSelectedBlues] = useState<Set<number>>(new Set());

  // 模拟状态
  const [isRunning, setIsRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [ticketHistory, setTicketHistory] = useState<TicketRecord[]>([]);
  const [matched, setMatched] = useState(false);
  const [matchedTicket, setMatchedTicket] = useState<Ticket | null>(null);
  const [winningCompound, setWinningCompound] = useState<CompoundTicket | null>(null);
  const [speed, setSpeed] = useState<Speed>('fast');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tps, setTps] = useState(0);

  // 可变引用
  const attemptsRef = useRef(0);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const tpsTimeRef = useRef(0);
  const tpsCountRef = useRef(0);
  const selectedRedsRef = useRef<Set<number>>(new Set());
  const selectedBluesRef = useRef<Set<number>>(new Set());
  const randomRedsRef = useRef<Set<number>>(new Set());
  const randomBluesRef = useRef<Set<number>>(new Set());
  const speedRef = useRef<Speed>('fast');
  const stepRef = useRef<() => void>(() => {});

  // ── 选号 ──
  const toggleRed = useCallback((n: number) => {
    if (runningRef.current) return;
    setSelectedReds((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const selectBlue = useCallback((n: number) => {
    if (runningRef.current) return;
    setSelectedBlues((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const randomize = useCallback(() => {
    if (runningRef.current) return;
    const redCount = Math.max(selectedReds.size, RED_COUNT);
    const blueCount = Math.max(selectedBlues.size, 1);
    setSelectedReds(new Set(sampleUnique(RED_MAX, redCount)));
    setSelectedBlues(new Set(sampleUnique(BLUE_MAX, blueCount)));
  }, [selectedReds.size, selectedBlues.size]);

  const finish = useCallback((ticket: Ticket) => {
    const elapsed = performance.now() - startRef.current;
    runningRef.current = false;
    if (timerRef.current != null) {
      cancelAnimationFrame(timerRef.current);
      clearTimeout(timerRef.current);
    }
    setAttempts(attemptsRef.current);
    setElapsedMs(Math.round(elapsed));
    setTps(0);
    setMatchedTicket(ticket);
    setWinningCompound(createCompoundSnapshot(randomRedsRef.current, randomBluesRef.current));
    setMatched(true);
    setIsRunning(false);
    setCurrentTicket(ticket);
    setTicketHistory((prev) => [
      { attempt: attemptsRef.current, ticket },
      ...prev,
    ].slice(0, HISTORY_LIMIT));
  }, []);

  // ── 模拟核心 ──
  const step = useCallback(() => {
    if (!runningRef.current) return;
    const spd = speedRef.current;
    const budget = SPEED_BUDGET[spd];
    let last: Ticket | null = null;

    if (spd === 'slow') {
      attemptsRef.current++;
      last = generateTicket();
      recordTicketNumbers(last, randomRedsRef.current, randomBluesRef.current);
      if (ticketCoveredBySelection(last, selectedRedsRef.current, selectedBluesRef.current)) { finish(last); return; }
    } else {
      const t0 = performance.now();
      while (performance.now() - t0 < budget) {
        attemptsRef.current++;
        last = generateTicket();
        recordTicketNumbers(last, randomRedsRef.current, randomBluesRef.current);
        if (ticketCoveredBySelection(last, selectedRedsRef.current, selectedBluesRef.current)) { finish(last); return; }
      }
    }

    // 更新 TPS
    const now = performance.now();
    if (now - tpsTimeRef.current > 500) {
      setTps(Math.round((attemptsRef.current - tpsCountRef.current) / ((now - tpsTimeRef.current) / 1000)));
      tpsTimeRef.current = now;
      tpsCountRef.current = attemptsRef.current;
    }

    setAttempts(attemptsRef.current);
    setElapsedMs(Math.round(now - startRef.current));
    setWinningCompound(createCompoundSnapshot(randomRedsRef.current, randomBluesRef.current));
    if (last) {
      setCurrentTicket(last);
      setTicketHistory((prev) => [
        { attempt: attemptsRef.current, ticket: last },
        ...prev,
      ].slice(0, HISTORY_LIMIT));
    }

    if (spd === 'slow') {
      timerRef.current = window.setTimeout(() => stepRef.current(), SPEED_DELAY.slow);
    } else {
      timerRef.current = requestAnimationFrame(() => stepRef.current());
    }
  }, [finish]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const start = useCallback(() => {
    if (selectedReds.size < RED_COUNT || selectedBlues.size === 0) return;
    selectedRedsRef.current = new Set(selectedReds);
    selectedBluesRef.current = new Set(selectedBlues);
    randomRedsRef.current = new Set();
    randomBluesRef.current = new Set();
    attemptsRef.current = 0;
    startRef.current = performance.now();
    tpsTimeRef.current = performance.now();
    tpsCountRef.current = 0;
    speedRef.current = speed;

    setAttempts(0);
    setCurrentTicket(null);
    setTicketHistory([]);
    setMatched(false);
    setMatchedTicket(null);
    setWinningCompound(null);
    setElapsedMs(0);
    setTps(0);
    setIsRunning(true);
    runningRef.current = true;

    timerRef.current = requestAnimationFrame(step);
  }, [selectedReds, selectedBlues, speed, step]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current != null) {
      cancelAnimationFrame(timerRef.current);
      clearTimeout(timerRef.current);
    }
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setSelectedReds(new Set());
    setSelectedBlues(new Set());
    randomRedsRef.current = new Set();
    randomBluesRef.current = new Set();
    setAttempts(0);
    setCurrentTicket(null);
    setTicketHistory([]);
    setMatched(false);
    setMatchedTicket(null);
    setWinningCompound(null);
    setElapsedMs(0);
    setTps(0);
  }, [stop]);

  const rerun = useCallback(() => {
    setAttempts(0);
    setCurrentTicket(null);
    setTicketHistory([]);
    setMatched(false);
    setMatchedTicket(null);
    setWinningCompound(null);
    setElapsedMs(0);
    setTps(0);
    // 保持选号，重新开始
    setTimeout(() => {
      if (selectedReds.size >= RED_COUNT && selectedBlues.size > 0) {
        selectedRedsRef.current = new Set(selectedReds);
        selectedBluesRef.current = new Set(selectedBlues);
        randomRedsRef.current = new Set();
        randomBluesRef.current = new Set();
        attemptsRef.current = 0;
        startRef.current = performance.now();
        tpsTimeRef.current = performance.now();
        tpsCountRef.current = 0;
        speedRef.current = speed;
        setIsRunning(true);
        runningRef.current = true;
        timerRef.current = requestAnimationFrame(step);
      }
    }, 50);
  }, [selectedReds, selectedBlues, speed, step]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        cancelAnimationFrame(timerRef.current);
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // ── 派生状态 ──
  const betCount = calculateBetCount(selectedReds.size, selectedBlues.size);
  const expectedAttempts = betCount > 0 ? TOTAL_COMBINATIONS / betCount : TOTAL_COMBINATIONS;
  const canStart = betCount > 0 && !isRunning;
  const hasSelection = selectedReds.size > 0 || selectedBlues.size > 0;
  const sortedReds = Array.from(selectedReds).sort((a, b) => a - b);
  const sortedBlues = Array.from(selectedBlues).sort((a, b) => a - b);

  return (
    <div className="app">
      {/* 标题 */}
      <header className="header">
        <h1 className="title">双色球机选模拟器</h1>
        <p className="subtitle">
          设定开奖号码，看机选多少次才能中一等奖
          <span className="odds">（概率 1/{formatNum(TOTAL_COMBINATIONS)}）</span>
        </p>
      </header>

      <div className="content-layout">
      <main className="main">
        {/* ─── 选号区 ─── */}
        <section className="card">
          <div className="card-head">
            <h2>开奖号码</h2>
            <button className="btn-inline" onClick={randomize} disabled={isRunning} type="button">
              🎲 随机选号
            </button>
          </div>

          <div className="ball-group">
            <div className="group-label">红球 <span className="dim">（至少选 6 个，1-33）</span></div>
            <div className="ball-grid red-grid">
              {Array.from({ length: RED_MAX }, (_, i) => i + 1).map((n) => (
                <Ball key={n} number={n} type="red" selected={selectedReds.has(n)} onClick={() => toggleRed(n)} disabled={isRunning} />
              ))}
            </div>
          </div>

          <div className="ball-group">
            <div className="group-label">蓝球 <span className="dim">（至少选 1 个，1-16）</span></div>
            <div className="ball-grid blue-grid">
              {Array.from({ length: BLUE_MAX }, (_, i) => i + 1).map((n) => (
                <Ball key={n} number={n} type="blue" selected={selectedBlues.has(n)} onClick={() => selectBlue(n)} disabled={isRunning} />
              ))}
            </div>
          </div>

          {hasSelection && (
            <div className="selected-bar">
              <span className="dim">已选：</span>
              {sortedReds.map((n) => (
                <Ball key={`s${n}`} number={n} type="red" size="sm" />
              ))}
              {sortedBlues.map((n) => (
                <Ball key={`sb${n}`} number={n} type="blue" size="sm" />
              ))}
              {selectedReds.size < RED_COUNT && <span className="hint">还需 {RED_COUNT - selectedReds.size} 个红球</span>}
              {selectedReds.size >= RED_COUNT && selectedBlues.size === 0 && <span className="hint">还需选 1 个蓝球</span>}
              {betCount > 0 && (
                <span className="bet-summary">
                  {betCount === 1 ? '单式' : '复式'} · {formatNum(betCount)} 注 · ¥{formatNum(betCount * PRICE_PER_BET)}
                </span>
              )}
            </div>
          )}
        </section>

        {/* ─── 控制区 ─── */}
        <section className="card controls">
          <div className="speed-row">
            <span className="dim">速度：</span>
            {(Object.keys(SPEED_CONFIG) as Speed[]).map((s) => (
              <button
                key={s}
                className={`speed-btn${speed === s ? ' active' : ''}`}
                onClick={() => setSpeed(s)}
                disabled={isRunning}
                type="button"
              >
                {SPEED_CONFIG[s].label}
              </button>
            ))}
            <span className="speed-desc dim">{SPEED_CONFIG[speed].desc}</span>
          </div>
          <div className="btn-row">
            {!isRunning ? (
              <button className="btn btn-start" onClick={start} disabled={!canStart} type="button">
                ▶ 开始模拟
              </button>
            ) : (
              <button className="btn btn-stop" onClick={stop} type="button">
                ⏹ 停止
              </button>
            )}
            <button className="btn btn-reset" onClick={reset} disabled={isRunning} type="button">
              ↺ 重置
            </button>
          </div>
        </section>

        {/* ─── 模拟过程 ─── */}
        {(isRunning || attempts > 0) && !matched && (
          <section className="card sim-panel">
            <div className="stats">
              <div className="stat">
                <div className="stat-val">{formatNum(attempts)}</div>
                <div className="stat-lbl">已模拟次数</div>
              </div>
              <div className="stat">
                <div className="stat-val">{formatNum(tps)}</div>
                <div className="stat-lbl">次/秒</div>
              </div>
              <div className="stat">
                <div className="stat-val">{formatElapsed(elapsedMs)}</div>
                <div className="stat-lbl">耗时</div>
              </div>
              <div className="stat">
                <div className="stat-val">¥{formatNum(attempts * PRICE_PER_BET)}</div>
                <div className="stat-lbl">花费 (2元/注)</div>
              </div>
            </div>
            {currentTicket && (
              <div className="current-row">
                <span className="dim">当前机选：</span>
                <div className="current-balls">
                  {currentTicket.reds.map((n) => (
                    <Ball key={`c${n}`} number={n} type="red" size="sm" />
                  ))}
                  <Ball number={currentTicket.blue} type="blue" size="sm" />
                </div>
              </div>
            )}
          </section>
        )}

        {/* ─── 中奖结果 ─── */}
        {matched && matchedTicket && (
          <section className="card result-panel">
            <div className="celebrate">🎉 恭喜中奖！🎉</div>
            <div className="result-balls">
              {matchedTicket.reds.map((n) => (
                <Ball key={`r${n}`} number={n} type="red" size="lg" />
              ))}
              <Ball number={matchedTicket.blue} type="blue" size="lg" />
            </div>
            {winningCompound && (
              <div className="winning-compound">
                <div className="compound-title">中奖复式号码</div>
                <div className="compound-balls">
                  {winningCompound.reds.map((n) => (
                    <Ball key={`wr${n}`} number={n} type="red" size="sm" />
                  ))}
                  {winningCompound.blues.map((n) => (
                    <Ball key={`wb${n}`} number={n} type="blue" size="sm" />
                  ))}
                </div>
                <div className="dim">
                  共 {formatNum(calculateBetCount(winningCompound.reds.length, winningCompound.blues.length))} 注，
                  已汇总本轮随机出现过的全部红球和蓝球
                </div>
              </div>
            )}
            <div className="result-info">
              <p>总共模拟 <strong>{formatNum(attempts)}</strong> 次</p>
              <p>耗时 <strong>{formatElapsed(elapsedMs)}</strong></p>
              <p>花费 <strong>¥{formatNum(attempts * PRICE_PER_BET)}</strong></p>
              <p className="dim">
                当前复式共 {formatNum(betCount)} 注，理论期望 {formatNum(Math.round(expectedAttempts))} 次，
                实际为理论的 {(attempts / expectedAttempts).toFixed(2)} 倍
              </p>
            </div>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button className="btn btn-start" onClick={rerun} type="button">▶ 再来一次</button>
              <button className="btn btn-reset" onClick={reset} type="button">↺ 重新选号</button>
            </div>
          </section>
        )}
      </main>

      <aside className="card random-sidebar">
        <div className="card-head">
          <h2>随机号码记录</h2>
          <span className="dim">最近 {HISTORY_LIMIT} 条</span>
        </div>

        <div className="sidebar-current">
          <div className="sidebar-label">当前随机号码</div>
          {currentTicket ? (
            <div className="sidebar-balls">
              {currentTicket.reds.map((n) => (
                <Ball key={`side-current-red-${n}`} number={n} type="red" size="sm" />
              ))}
              <Ball number={currentTicket.blue} type="blue" size="sm" />
            </div>
          ) : (
            <div className="sidebar-empty">开始模拟后在这里显示</div>
          )}
        </div>

        <div className="sidebar-compound">
          <div className="sidebar-label">最终复式号码（实时）</div>
          {winningCompound ? (
            <>
              <div className="compound-section">
                <span className="compound-kind red-kind">红球 {winningCompound.reds.length}</span>
                <div className="sidebar-balls">
                  {winningCompound.reds.map((n) => (
                    <Ball key={`side-compound-red-${n}`} number={n} type="red" size="sm" />
                  ))}
                </div>
              </div>
              <div className="compound-section">
                <span className="compound-kind blue-kind">蓝球 {winningCompound.blues.length}</span>
                <div className="sidebar-balls">
                  {winningCompound.blues.map((n) => (
                    <Ball key={`side-compound-blue-${n}`} number={n} type="blue" size="sm" />
                  ))}
                </div>
              </div>
              <div className="compound-count">
                {formatNum(calculateBetCount(winningCompound.reds.length, winningCompound.blues.length))} 注
              </div>
            </>
          ) : (
            <div className="sidebar-empty">随机号码会实时加入这里</div>
          )}
        </div>

        <div className="history-list">
          {ticketHistory.map((record, index) => (
            <div
              className={`history-item${matched && index === 0 ? ' history-winner' : ''}`}
              key={`${record.attempt}-${record.ticket.reds.join('-')}-${record.ticket.blue}`}
            >
              <span className="history-index">#{formatNum(record.attempt)}</span>
              <div className="history-numbers">
                <span className="history-reds">
                  {record.ticket.reds.map((n) => String(n).padStart(2, '0')).join(' ')}
                </span>
                <span className="history-blue">{String(record.ticket.blue).padStart(2, '0')}</span>
              </div>
            </div>
          ))}
          {ticketHistory.length === 0 && (
            <div className="sidebar-empty history-empty">暂无随机记录</div>
          )}
        </div>
      </aside>
      </div>

      <footer className="footer">
        双色球一等奖概率 1/{formatNum(TOTAL_COMBINATIONS)} · 每注 2 元 · 纯属娱乐，请理性购彩
      </footer>
    </div>
  );
}
