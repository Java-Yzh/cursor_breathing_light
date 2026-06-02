import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './breathing.css';

type ActivityState = 'idle' | 'thinking' | 'coding';

interface StatePayload {
  state: ActivityState;
  updated_at: number;
  source: string;
}

declare global {
  interface Window {
    breathingLight: {
      getState: () => Promise<StatePayload>;
      onStateUpdate: (cb: (payload: StatePayload) => void) => () => void;
      getPinned: () => Promise<boolean>;
      setPinned: (pinned: boolean) => Promise<boolean>;
      onPinUpdate: (cb: (pinned: boolean) => void) => () => void;
      getScale: () => Promise<number>;
      setScale: (scale: number) => Promise<number>;
      onScaleUpdate: (cb: (scale: number) => void) => () => void;
      hidePopup: () => Promise<void>;
      getFullscreen: () => Promise<boolean>;
      toggleFullscreen: () => Promise<boolean>;
      onFullscreenUpdate: (cb: (fullscreen: boolean) => void) => () => void;
    };
  }
}

const LIGHTS = [
  { id: 'idle' as const, color: 'green', label: '空闲' },
  { id: 'thinking' as const, color: 'yellow', label: '思考' },
  { id: 'coding' as const, color: 'red', label: '编码' },
];

const STATUS_LABELS: Record<ActivityState, string> = {
  idle: '空闲',
  thinking: '思考中',
  coding: '写代码',
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.1;

function App() {
  const [state, setState] = useState<ActivityState>('idle');
  const [pinned, setPinned] = useState(false);
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    window.breathingLight.getState().then((p) => setState(p.state));
    window.breathingLight.getPinned().then(setPinned);
    window.breathingLight.getScale().then(setScale);
    window.breathingLight.getFullscreen().then(setFullscreen);
    const offState = window.breathingLight.onStateUpdate((p) => setState(p.state));
    const offPin = window.breathingLight.onPinUpdate(setPinned);
    const offScale = window.breathingLight.onScaleUpdate(setScale);
    const offFs = window.breathingLight.onFullscreenUpdate(setFullscreen);
    return () => {
      offState();
      offPin();
      offScale();
      offFs();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('is-fullscreen', fullscreen);
  }, [fullscreen]);

  const changeScale = (delta: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((scale + delta) * 10) / 10));
    window.breathingLight.setScale(next);
  };

  const panelStyle = fullscreen ? undefined : { zoom: scale };

  return (
    <div
      className={`panel ${fullscreen ? 'panel--fullscreen' : ''}`}
      style={panelStyle}
    >
      <div className="toolbar">
        <span className="toolbar-title">Cursor 呼吸灯</span>
        <div className="toolbar-actions">
          <div className="scale-controls" title="整体缩放">
            <button
              type="button"
              className="btn btn-scale"
              onClick={() => changeScale(-SCALE_STEP)}
              disabled={fullscreen || scale <= MIN_SCALE}
              aria-label="缩小"
            >
              −
            </button>
            <span className="scale-label">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              className="btn btn-scale"
              onClick={() => changeScale(SCALE_STEP)}
              disabled={fullscreen || scale >= MAX_SCALE}
              aria-label="放大"
            >
              +
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-fullscreen ${fullscreen ? 'btn-fullscreen--on' : ''}`}
            onClick={() => window.breathingLight.toggleFullscreen()}
            title={fullscreen ? '退出全屏' : '全屏'}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
            aria-pressed={fullscreen}
          >
            ⛶
          </button>
          <button
            type="button"
            className={`btn btn-pin ${pinned ? 'btn-pin--on' : ''}`}
            onClick={() => window.breathingLight.setPinned(!pinned)}
            title={pinned ? '已固定（点击取消）' : '固定到屏幕'}
            aria-label={pinned ? '取消固定' : '固定到屏幕'}
            aria-pressed={pinned}
          >
            📌
          </button>
          <button
            type="button"
            className="btn btn-close"
            onClick={() => window.breathingLight.hidePopup()}
            title="关闭"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      </div>

      <div className="traffic-light" role="group" aria-label="Cursor 状态灯">
        {LIGHTS.map((light) => (
          <div key={light.id} className="light-slot">
            <div
              className={`bulb bulb--${light.color} ${state === light.id ? 'bulb--on' : ''}`}
              aria-label={light.label}
              aria-current={state === light.id}
            />
            <span className={`slot-label ${state === light.id ? 'slot-label--on' : ''}`}>
              {light.label}
            </span>
          </div>
        ))}
      </div>
      <span className="status">{STATUS_LABELS[state]}</span>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
