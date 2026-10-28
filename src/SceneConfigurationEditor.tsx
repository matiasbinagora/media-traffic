import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisRunSnapshot } from './analysis-types';
import { TrafficAnalysisOverlay } from './TrafficAnalysisOverlay';
import {
  getContainedVideoRect,
  isValidSceneGeometry,
  toMediaPoint,
  toPlayerPoint,
  type NormalizedPoint,
  type NormalizedRegion,
  type PlayerRect,
  type SceneGeometry,
} from './scene-geometry';

export type SceneConfigurationSnapshot = Readonly<{
  schemaVersion: 1;
  id: string;
  source: Readonly<{ videoId: string; sha256: string; width: number; height: number }>;
  geometry: Readonly<SceneGeometry>;
  createdAt: string;
}>;

export type { AnalysisRunSnapshot } from './analysis-types';

type DrawMode = 'vehicleRegion' | 'stopLine' | 'signalRegion';
type Props = {
  videoId: string;
  videoUrl: string;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  onSave?: (snapshot: SceneConfigurationSnapshot) => Promise<SceneConfigurationSnapshot>;
  initialRuns?: AnalysisRunSnapshot[];
  onCreateAnalysisRun?: (snapshot: SceneConfigurationSnapshot) => Promise<AnalysisRunSnapshot>;
  onRefreshAnalysisRun?: (runId: string) => Promise<AnalysisRunSnapshot>;
  sourceTimeOffsetSeconds?: number;
};

const emptyGeometry: SceneGeometry = {
  vehicleRegion: null,
  stopLine: null,
  crossingDirection: null,
  signalRegion: null,
  signalAssociation: '',
};

function freezeSnapshot(value: SceneConfigurationSnapshot): SceneConfigurationSnapshot {
  Object.freeze(value.source);
  Object.freeze(value.geometry.vehicleRegion);
  Object.freeze(value.geometry.stopLine?.start);
  Object.freeze(value.geometry.stopLine?.end);
  Object.freeze(value.geometry.stopLine);
  Object.freeze(value.geometry.signalRegion);
  Object.freeze(value.geometry);
  return Object.freeze(value);
}

function boundedRegion(a: NormalizedPoint, b: NormalizedPoint): NormalizedRegion {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function clampPoint(point: NormalizedPoint): NormalizedPoint {
  return { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
}

function pointToPercent(point: NormalizedPoint, frame: PlayerRect): NormalizedPoint {
  return toPlayerPoint(point, frame);
}

export function SceneConfigurationEditor({
  videoId,
  videoUrl,
  sourceSha256,
  sourceWidth,
  sourceHeight,
  previewWidth,
  previewHeight,
  onSave,
  initialRuns = [],
  onCreateAnalysisRun,
  onRefreshAnalysisRun,
  sourceTimeOffsetSeconds = 0,
}: Props) {
  const [geometry, setGeometry] = useState<SceneGeometry>(emptyGeometry);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [pendingPoint, setPendingPoint] = useState<NormalizedPoint | null>(null);
  const [keyboardPoint, setKeyboardPoint] = useState<NormalizedPoint>({ x: 0.5, y: 0.5 });
  const [snapshot, setSnapshot] = useState<SceneConfigurationSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRunSnapshot[]>(initialRuns);
  const [runStatusError, setRunStatusError] = useState('');
  const [previewTimeSeconds, setPreviewTimeSeconds] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const analysisRunsRef = useRef(analysisRuns);
  const refreshInFlightRef = useRef(false);
  analysisRunsRef.current = analysisRuns;
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const invalidFields = useMemo(() => isValidSceneGeometry(geometry), [geometry]);
  const readyToSave = invalidFields.length === 0 && Boolean(onSave) && !saving;
  const activeRun = analysisRuns.find(run => run.status === 'queued' || run.status === 'running');
  const hasActiveRun = Boolean(activeRun);
  const latestRun = analysisRuns[0];
  const completedRun = latestRun?.status === 'completed' && latestRun.result ? latestRun : null;
  const frame = useMemo(
    () => getContainedVideoRect(canvasSize.width, canvasSize.height, previewWidth, previewHeight),
    [canvasSize, previewWidth, previewHeight],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      dimensionsRef.current = { width: rect.width, height: rect.height };
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (initialRuns.length) {
      setAnalysisRuns(current => {
        const byId = new Map([...initialRuns, ...current].map(run => [run.id, run]));
        return [...byId.values()];
      });
    }
  }, [initialRuns]);

  useEffect(() => {
    if (!onRefreshAnalysisRun || !hasActiveRun) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const activeRuns = analysisRunsRef.current.filter(run => run.status === 'queued' || run.status === 'running');
      if (!activeRuns.length) return;
      if (refreshInFlightRef.current) {
        timer = window.setTimeout(() => void poll(), 1000);
        return;
      }

      refreshInFlightRef.current = true;
      try {
        const refreshedRuns = await Promise.all(activeRuns.map(run => onRefreshAnalysisRun(run.id)));
        if (cancelled) return;
        setRunStatusError('');
        setAnalysisRuns(current => {
          const refreshedById = new Map(refreshedRuns.map(run => [run.id, run]));
          return current.map(run => refreshedById.get(run.id) || run);
        });
      } catch (error) {
        if (!cancelled) setRunStatusError(error instanceof Error ? error.message : 'Analysis status could not be checked.');
      } finally {
        refreshInFlightRef.current = false;
        if (!cancelled && analysisRunsRef.current.some(run => run.status === 'queued' || run.status === 'running')) {
          timer = window.setTimeout(() => void poll(), 1000);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActiveRun, onRefreshAnalysisRun]);

  useEffect(() => {
    if (!isVideoPlaying) return;
    let animationFrame = 0;
    const syncPlaybackTime = () => {
      const video = videoRef.current;
      if (video) setPreviewTimeSeconds(current => current === video.currentTime ? current : video.currentTime);
      animationFrame = window.requestAnimationFrame(syncPlaybackTime);
    };
    animationFrame = window.requestAnimationFrame(syncPlaybackTime);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isVideoPlaying]);

  const updateRegion = (mode: 'vehicleRegion' | 'signalRegion', region: NormalizedRegion) => {
    setGeometry(current => ({ ...current, [mode]: region }));
    setSnapshot(null);
    setSaveError('');
  };

  const commitDraw = (mode: DrawMode, start: NormalizedPoint, end: NormalizedPoint) => {
    if (mode === 'stopLine') {
      setGeometry(current => ({ ...current, stopLine: { start, end } }));
    } else {
      updateRegion(mode, boundedRegion(start, end));
    }
    setPendingPoint(null);
    setSnapshot(null);
    setSaveError('');
  };

  const mapPointer = (event: React.PointerEvent<HTMLDivElement>): NormalizedPoint | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mediaFrame = getContainedVideoRect(rect.width, rect.height, previewWidth, previewHeight);
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (local.x < mediaFrame.left || local.x > mediaFrame.left + mediaFrame.width
      || local.y < mediaFrame.top || local.y > mediaFrame.top + mediaFrame.height) return null;
    return clampPoint(toMediaPoint(local, mediaFrame));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode) return;
    const point = mapPointer(event);
    if (!point) return;
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId);
    setPendingPoint(point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode || !pendingPoint) return;
    const point = mapPointer(event);
    if (!point) {
      setPendingPoint(null);
      return;
    }
    commitDraw(drawMode, pendingPoint, point);
  };

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!drawMode) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const movement = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (movement) {
      event.preventDefault();
      setKeyboardPoint(current => clampPoint({ x: current.x + movement.x, y: current.y + movement.y }));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (pendingPoint) commitDraw(drawMode, pendingPoint, keyboardPoint);
      else setPendingPoint(keyboardPoint);
    } else if (event.key === 'Escape') {
      setPendingPoint(null);
    }
  };

  const handleSave = async () => {
    if (!onSave || invalidFields.length || saving) return;
    setSaving(true);
    setSaveError('');
    const immutable = freezeSnapshot({
      schemaVersion: 1,
      id: globalThis.crypto.randomUUID(),
      source: { videoId, sha256: sourceSha256, width: sourceWidth, height: sourceHeight },
      geometry: structuredClone(geometry),
      createdAt: new Date().toISOString(),
    });
    try {
      const saved = freezeSnapshot(await onSave(immutable));
      setSnapshot(saved);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The scene configuration could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!snapshot || !onCreateAnalysisRun || invalidFields.length || startingAnalysis || activeRun) return;
    setStartingAnalysis(true);
    setAnalysisError('');
    try {
      const run = await onCreateAnalysisRun(snapshot);
      setAnalysisRuns(current => current.some(existing => existing.id === run.id) ? current : [run, ...current]);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Analysis could not be started. Try again.');
    } finally {
      setStartingAnalysis(false);
    }
  };

  const regionSvg = (region: NormalizedRegion | null, color: string, label: string) => {
    if (!region || frame.width <= 0) return null;
    const topLeft = pointToPercent({ x: region.x, y: region.y }, frame);
    return <rect data-geometry={label} x={topLeft.x} y={topLeft.y} width={region.width * frame.width} height={region.height * frame.height} fill={`${color}22`} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />;
  };

  const line = geometry.stopLine;
  const lineStart = line && frame.width > 0 ? pointToPercent(line.start, frame) : null;
  const lineEnd = line && frame.width > 0 ? pointToPercent(line.end, frame) : null;

  return (
    <section className="scene-editor" aria-labelledby="scene-heading">
      <div className="scene-heading">
        <div>
          <p className="section-kicker">STEP 2 · SCENE CONFIGURATION</p>
          <h2 id="scene-heading">Mark the movement</h2>
        </div>
        <span className="step-pill">ONE APPROACH</span>
      </div>
      <p className="scene-intro">Draw the vehicle area, the stop line, and the signal that governs this movement. Marks use normalized video coordinates and stay attached to the frame as the player changes size.</p>

      <div className="scene-player" style={{ aspectRatio: `${previewWidth} / ${previewHeight}` }}>
        <video
          ref={videoRef}
          className="scene-video"
          controls
          preload="metadata"
          src={videoUrl}
          aria-label="Video for scene configuration"
          onTimeUpdate={event => setPreviewTimeSeconds(event.currentTarget.currentTime)}
          onSeeked={event => setPreviewTimeSeconds(event.currentTarget.currentTime)}
          onPlay={() => setIsVideoPlaying(true)}
          onPause={() => setIsVideoPlaying(false)}
          onEnded={() => setIsVideoPlaying(false)}
        />
        <div
          ref={canvasRef}
          className={`scene-canvas${drawMode ? ' is-drawing' : ''}`}
          role="application"
          aria-label="Scene geometry editor"
          aria-describedby="scene-canvas-help scene-keyboard-help"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setPendingPoint(null)}
          onKeyDown={handleCanvasKeyDown}
        >
          <svg className="geometry-overlay" aria-hidden="true" viewBox={`0 0 ${canvasSize.width || 1} ${canvasSize.height || 1}`}>
            {regionSvg(geometry.vehicleRegion, '#31c982', 'vehicle-region')}
            {regionSvg(geometry.signalRegion, '#ffbb55', 'signal-region')}
            {lineStart && lineEnd && <line data-geometry="stop-line" x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} stroke="#ff5d5d" strokeWidth="4" vectorEffect="non-scaling-stroke" />}
            {drawMode && frame.width > 0 && <circle data-geometry="keyboard-cursor" {...pointToPercent(keyboardPoint, frame)} r="7" fill="#fff" stroke="#087c58" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
          </svg>
          {completedRun && <TrafficAnalysisOverlay
            result={completedRun.result!}
            sourceTimeSeconds={previewTimeSeconds + sourceTimeOffsetSeconds}
            width={canvasSize.width}
            height={canvasSize.height}
            frame={frame}
          />}
        </div>
      </div>
      <div className="preview-caption"><span>UPLOAD COMPLETE · PREVIEW READY</span><span>{latestRun ? `ANALYSIS ${latestRun.status.toUpperCase()}` : 'ANALYSIS NOT STARTED'}</span></div>
      <p id="scene-canvas-help" className="scene-canvas-help">Choose a mark, then drag over the video frame to draw it. Letterbox bars are excluded from geometry.</p>
      <p id="scene-keyboard-help" className="visually-hidden">Keyboard: focus the video editor, use arrow keys to move the drawing cursor, hold Shift to move farther, and press Enter twice to set the two points. Press Escape to cancel.</p>

      <div className="scene-tools" aria-label="Geometry tools">
        <button type="button" className={drawMode === 'vehicleRegion' ? 'is-selected' : ''} aria-pressed={drawMode === 'vehicleRegion'} onClick={() => setDrawMode('vehicleRegion')}>Draw vehicle region</button>
        <button type="button" className={drawMode === 'stopLine' ? 'is-selected' : ''} aria-pressed={drawMode === 'stopLine'} onClick={() => setDrawMode('stopLine')}>Draw stop line</button>
        <button type="button" className={drawMode === 'signalRegion' ? 'is-selected' : ''} aria-pressed={drawMode === 'signalRegion'} onClick={() => setDrawMode('signalRegion')}>Draw signal region</button>
      </div>

      <div className="scene-fields">
        <label>Crossing direction
          <select value={geometry.crossingDirection || ''} onChange={event => { setGeometry(current => ({ ...current, crossingDirection: (event.target.value || null) as SceneGeometry['crossingDirection'] })); setSnapshot(null); }}>
            <option value="">Select a direction</option>
            <option value="top-to-bottom">Top to bottom</option>
            <option value="bottom-to-top">Bottom to top</option>
            <option value="left-to-right">Left to right</option>
            <option value="right-to-left">Right to left</option>
          </select>
        </label>
        <label>Governing signal
          <select value={geometry.signalAssociation} onChange={event => { setGeometry(current => ({ ...current, signalAssociation: event.target.value })); setSnapshot(null); }}>
            <option value="">Select the signal for this movement</option>
            {geometry.signalRegion && <option value="traffic-signal-1">Signal region 1 · drawn on this video</option>}
          </select>
        </label>
      </div>

      {invalidFields.length > 0 && <div className="scene-validation" role="alert"><strong>Complete the required scene fields before saving or analyzing:</strong><ul>{invalidFields.map(field => <li key={field}>{({ vehicleRegion: 'Vehicle region', stopLine: 'Stop line', crossingDirection: 'Crossing direction', signalRegion: 'Signal region', signalAssociation: 'Signal association' } as const)[field as keyof SceneGeometry]}</li>)}</ul></div>}
      {saveError && <p className="scene-error" role="alert">{saveError}</p>}
      {analysisError && <p className="scene-error" role="alert">{analysisError}</p>}
      {runStatusError && <p className="scene-error" role="alert">{runStatusError}</p>}
      {!onSave && <p className="scene-service-note" role="status">Scene saving is unavailable until the configuration service is connected.</p>}
      {snapshot && <p className="scene-saved" role="status">Configuration snapshot {snapshot.id} saved · version {snapshot.schemaVersion}. Later edits will create a separate snapshot.</p>}
      {analysisRuns.length > 0 && <section className="scene-run-history" aria-label="Analysis run records">
        <h3>Saved run records</h3>
        <ul>{analysisRuns.map(run => <li key={run.id}>
          <strong>Run {run.id}</strong>
          <span>{run.status === 'queued' ? 'Analysis queued' : run.status === 'running' ? 'Analysis running' : run.status === 'completed' ? 'Analysis complete' : 'Analysis failed'}</span>
          <span>Configuration {run.configurationSnapshot.id}</span>
          {run.status === 'failed' && run.error && <span role="alert">{run.error.message}</span>}
          {run.status === 'completed' && run.result && <span>{run.result.sampledFrameCount} sampled frames · {run.result.tracks.length} vehicle tracks</span>}
          <details>
            <summary>Inspect run evidence and provenance</summary>
            <dl>
              <dt>Vehicle region</dt><dd>{JSON.stringify(run.configurationSnapshot.geometry.vehicleRegion)}</dd>
              <dt>Stop line</dt><dd>{JSON.stringify(run.configurationSnapshot.geometry.stopLine)}</dd>
              <dt>Crossing direction</dt><dd>{run.configurationSnapshot.geometry.crossingDirection}</dd>
              <dt>Signal region</dt><dd>{JSON.stringify(run.configurationSnapshot.geometry.signalRegion)}</dd>
              <dt>Governing signal</dt><dd>{run.configurationSnapshot.geometry.signalAssociation}</dd>
              <dt>Analysis provenance</dt><dd>{JSON.stringify(run.provenance)}</dd>
              {run.result && <><dt>Frame dimensions</dt><dd>{run.result.frameWidth} × {run.result.frameHeight}</dd></>}
            </dl>
          </details>
        </li>)}</ul>
      </section>}

      <div className="scene-actions">
        <button className="secondary-button" type="button" onClick={() => void handleSave()} disabled={!readyToSave}>{saving ? 'Saving…' : 'Save scene configuration'}</button>
        <button className="primary-button" type="button" onClick={() => void handleStartAnalysis()} disabled={!snapshot || invalidFields.length > 0 || !onCreateAnalysisRun || startingAnalysis || Boolean(activeRun)} aria-describedby="analysis-disabled-reason">{startingAnalysis ? 'Starting analysis…' : activeRun ? `Analysis ${activeRun.status}…` : 'Start traffic analysis'} <span aria-hidden="true">→</span></button>
      </div>
      <p id="analysis-disabled-reason" className="scene-service-note">Analysis uses the saved scene configuration and reports only observed detections. Gaps remain visible as uncertainty.</p>
    </section>
  );
}
