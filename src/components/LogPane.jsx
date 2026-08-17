import React, {
  useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { parseAnsi, segmentStyle, stripAnsi } from '../ansi.js';
import { logStore } from '../logStore.js';

const ROW_HEIGHT = 18;
const OVERSCAN = 24;
const BOTTOM_SLACK = 24; // px of slop that still counts as "at the bottom"

function Row({ line }) {
  const segments = parseAnsi(line.text);
  return (
    <div className={`log-row log-${line.stream}`}>
      {segments.map((seg, i) => (
        <span key={i} style={segmentStyle(seg.style)}>{seg.text}</span>
      ))}
      {line.text === '' ? ' ' : null}
    </div>
  );
}

export default function LogPane({ appId, appName, status, onDetach, detached = false }) {
  const lines = useSyncExternalStore(
    logStore.subscribe,
    useCallback(() => logStore.get(appId), [appId])
  );

  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [copied, setCopied] = useState(false);

  useEffect(() => { logStore.ensureLoaded(appId); }, [appId]);

  // Reset stickiness when switching apps.
  useEffect(() => {
    stickRef.current = true;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [appId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    // Auto-scroll only while already parked at the bottom, so reading
    // scrollback is never yanked away by new output.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const stick = distance <= BOTTOM_SLACK;
    stickRef.current = stick;
    setAtBottom(stick);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAtBottom(true);
    el.scrollTop = el.scrollHeight;
  };

  const copyAll = async () => {
    await window.kai.copy(lines.map((l) => stripAnsi(l.text)).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const total = lines.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const slice = lines.slice(start, end);

  return (
    <section className="log-pane">
      <header className="log-toolbar">
        <div className="log-title">
          <span className={`dot dot-${status?.status || 'stopped'}`} />
          <strong>{appName}</strong>
          <span className="muted">{total.toLocaleString()} lines</span>
        </div>
        <div className="log-actions">
          {!atBottom && (
            <button className="btn ghost" onClick={jumpToBottom} title="Jump to newest output">
              Jump to bottom
            </button>
          )}
          <button className="btn ghost" onClick={copyAll}>{copied ? 'Copied' : 'Copy all'}</button>
          <button className="btn ghost" onClick={() => logStore.clear(appId)}>Clear</button>
          {!detached && (
            <button className="btn ghost" onClick={onDetach} title="Open these logs in their own window">
              Detach
            </button>
          )}
        </div>
      </header>

      <div className="log-scroll" ref={scrollRef} onScroll={handleScroll}>
        {total === 0 ? (
          <div className="log-empty">No output yet. Press Start to run this app.</div>
        ) : (
          <div className="log-spacer" style={{ height: total * ROW_HEIGHT }}>
            <div className="log-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {slice.map((line) => (
                <Row key={line.seq} line={line} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
