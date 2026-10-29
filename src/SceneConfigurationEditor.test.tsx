import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { SceneConfigurationEditor, type SceneConfigurationSnapshot } from './SceneConfigurationEditor';
import type { AnalysisRunSnapshot } from './analysis-types';

const props = {
  videoId: 'video-1',
  videoUrl: '/api/videos/video-1/preview',
  sourceSha256: 'a'.repeat(64),
  sourceWidth: 1920,
  sourceHeight: 1080,
  previewWidth: 1920,
  previewHeight: 1080,
  onSave: vi.fn(async snapshot => snapshot),
};

const queuedRun: AnalysisRunSnapshot = {
  schemaVersion: 2,
  id: 'run-polling',
  videoId: props.videoId,
  status: 'queued',
  analysisStarted: true,
  configurationSnapshot: {
    schemaVersion: 1,
    id: 'config-polling',
    source: { videoId: props.videoId, sha256: props.sourceSha256, width: 1920, height: 1080 },
    geometry: {
      vehicleRegion: { x: 0, y: 0, width: 1, height: 1 },
      stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } },
      crossingDirection: 'top-to-bottom',
      signalRegion: { x: 0.7, y: 0.1, width: 0.1, height: 0.1 },
      signalAssociation: 'traffic-signal-1',
    },
    createdAt: '2026-10-20T12:00:00.000Z',
  },
  createdAt: '2026-10-20T12:01:00.000Z',
  updatedAt: '2026-10-20T12:01:00.000Z',
  provenance: {
    source: { videoId: props.videoId, sha256: props.sourceSha256, path: 'uploaded-original', durationSeconds: 10, width: 1920, height: 1080 },
    detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
    tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
    sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
    thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scene configuration editor', () => {
  it('identifies missing geometry and keeps run-record creation disabled', () => {
    render(<SceneConfigurationEditor {...props} />);
    expect(screen.getByRole('button', { name: 'Start traffic analysis' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Vehicle region');
    expect(screen.getByRole('alert')).toHaveTextContent('Stop line');
    expect(screen.getByRole('alert')).toHaveTextContent('Crossing direction');
    expect(screen.getByRole('alert')).toHaveTextContent('Signal region');
    expect(screen.getByRole('alert')).toHaveTextContent('Signal association');
  });

  it('keeps only one status poll active while queued runs remain pending', async () => {
    vi.useFakeTimers();
    const onRefreshAnalysisRun = vi.fn(() => new Promise<AnalysisRunSnapshot>(() => {}));
    const { rerender } = render(<SceneConfigurationEditor {...props} initialRuns={[queuedRun]} onRefreshAnalysisRun={onRefreshAnalysisRun} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onRefreshAnalysisRun).toHaveBeenCalledTimes(1);

    rerender(<SceneConfigurationEditor {...props} initialRuns={[{ ...queuedRun }]} onRefreshAnalysisRun={onRefreshAnalysisRun} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(onRefreshAnalysisRun).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shows the API phase while queued and updates it from the next status poll', async () => {
    vi.useFakeTimers();
    const onRefreshAnalysisRun = vi.fn()
      .mockResolvedValueOnce({ ...queuedRun, status: 'running', phase: 'preparation', updatedAt: '2026-10-20T12:01:01.000Z' })
      .mockResolvedValueOnce({ ...queuedRun, status: 'running', phase: 'car_tracking', updatedAt: '2026-10-20T12:01:02.000Z' });
    render(<SceneConfigurationEditor {...props} initialRuns={[{ ...queuedRun, phase: 'queued' }]} onRefreshAnalysisRun={onRefreshAnalysisRun} />);

    expect(screen.getByRole('status', { name: 'Analysis run status' })).toHaveTextContent('Queued');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('status', { name: 'Analysis run status' })).toHaveTextContent('Preparing analysis');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('status', { name: 'Analysis run status' })).toHaveTextContent('Tracking cars');
    vi.useRealTimers();
  });

  it('renders successful no-track and indeterminate-signal outcomes separately from failure', () => {
    const completedRun: AnalysisRunSnapshot = {
      ...queuedRun,
      id: 'run-empty-result',
      status: 'completed',
      phase: 'completed',
      provenance: {
        ...queuedRun.provenance,
        source: { ...queuedRun.provenance.source, syntheticSource: { status: 'not-identified', evidence: 'no-matching-manifest' } },
        detector: { ...queuedRun.provenance.detector, sha256: 'b'.repeat(64), runtimeVersion: '8.3.0', pythonVersion: '3.12.1', pytorchVersion: '2.7.0', inferenceSeconds: 0.42 },
        tracker: { ...queuedRun.provenance.tracker, configSha256: 'c'.repeat(64), config: { track_high_thresh: 0.25 } },
        sampling: { ...queuedRun.provenance.sampling, decodedFrameCount: 300 },
      },
      result: {
        frameWidth: 1920,
        frameHeight: 1080,
        sampledFrameCount: 300,
        tracks: [],
        possibleIdentitySwitches: [],
        signalTimeline: {
          stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 },
          observations: [],
          intervals: [{ state: 'unknown', startFrameIndex: 0, endFrameExclusive: 300, startSeconds: 0, endSeconds: 10, rationale: 'ambiguous_signal' }],
        },
      },
    };
    render(<SceneConfigurationEditor {...props} initialRuns={[completedRun]} />);

    expect(screen.getByRole('status', { name: 'Analysis run status' })).toHaveTextContent('Analysis complete');
    expect(screen.getByText('No vehicles were observed; no candidate crossing can be assessed from this run.')).toBeInTheDocument();
    expect(screen.getByText(/Signal state is indeterminate/)).toBeInTheDocument();
    expect(screen.getByText('Source is not identified as the synthetic demo.')).toBeInTheDocument();
    expect(screen.getByText(/YOLO26 · test\.pt/)).toBeInTheDocument();
    expect(screen.getByText(/300 decoded frames/)).toBeInTheDocument();
    expect(screen.getByText('Vehicle (x 0, y 0, width 1, height 1) · stop line (0.2, 0.6) to (0.8, 0.6) · signal (x 0.7, y 0.1, width 0.1, height 0.1)')).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('analysis failed');
  });

  it('supports keyboard drawing without a pointer or mouse', async () => {
    const user = userEvent.setup();
    render(<SceneConfigurationEditor {...props} />);
    await user.click(screen.getByRole('button', { name: 'Draw stop line' }));
    const surface = screen.getByRole('application', { name: 'Scene geometry editor' });
    surface.focus();
    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    fireEvent.keyDown(surface, { key: 'ArrowDown' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(screen.getByRole('alert')).not.toHaveTextContent('Stop line');
  });

  it('saves a versioned immutable snapshot and records analysis provenance without starting analysis', async () => {
    const user = userEvent.setup();
    const onCreateAnalysisRun = vi.fn(async (snapshot: SceneConfigurationSnapshot): Promise<AnalysisRunSnapshot> => ({
      schemaVersion: 2 as const,
      id: `run-${snapshot.id}`,
      videoId: props.videoId,
      status: 'queued' as const,
      analysisStarted: true as const,
      configurationSnapshot: snapshot,
      createdAt: '2026-10-20T12:01:00.000Z',
      updatedAt: '2026-10-20T12:01:00.000Z',
      provenance: {
        source: { videoId: props.videoId, sha256: props.sourceSha256, path: 'uploaded-original' as const, durationSeconds: 10, width: 1920, height: 1080 },
        detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
        tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
        sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
        thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      },
    }));
    render(<SceneConfigurationEditor {...props} onCreateAnalysisRun={onCreateAnalysisRun} />);
    const surface = screen.getByRole('application', { name: 'Scene geometry editor' });
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450,
      toJSON: () => ({}),
    } as DOMRect);

    await user.click(screen.getByRole('button', { name: 'Draw vehicle region' }));
    fireEvent.pointerDown(surface, { clientX: 80, clientY: 45, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 720, clientY: 405, pointerId: 1 });
    await user.click(screen.getByRole('button', { name: 'Draw stop line' }));
    fireEvent.pointerDown(surface, { clientX: 160, clientY: 270, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 640, clientY: 270, pointerId: 1 });
    await user.click(screen.getByRole('button', { name: 'Draw signal region' }));
    fireEvent.pointerDown(surface, { clientX: 640, clientY: 45, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 760, clientY: 135, pointerId: 1 });
    await user.selectOptions(screen.getByLabelText('Crossing direction'), 'top-to-bottom');
    await user.selectOptions(screen.getByLabelText('Governing signal'), 'traffic-signal-1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save scene configuration' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Save scene configuration' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    const snapshot = props.onSave.mock.calls[0][0];
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.source.sha256).toBe(props.sourceSha256);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.geometry.stopLine.start).toEqual({ x: 0.2, y: 0.6 });
    const createRunButton = screen.getByRole('button', { name: 'Start traffic analysis' });
    await waitFor(() => expect(createRunButton).toBeEnabled());
    await user.click(createRunButton);
    await waitFor(() => expect(onCreateAnalysisRun).toHaveBeenCalledWith(snapshot));
    expect(screen.getByRole('region', { name: 'Analysis run records' })).toHaveTextContent('Queued · Stage: Stage not reported by the server');
    expect(screen.getByRole('region', { name: 'Analysis run records' })).toHaveTextContent('YOLO26');
  });

  it('synchronizes observed boxes to preview time plus the source timestamp offset', () => {
    const completedRun: AnalysisRunSnapshot = {
      schemaVersion: 2,
      id: 'run-1',
      videoId: props.videoId,
      status: 'completed',
      analysisStarted: true,
      configurationSnapshot: {
        schemaVersion: 1,
        id: 'config-1',
        source: { videoId: props.videoId, sha256: props.sourceSha256, width: 1920, height: 1080 },
        geometry: {
          vehicleRegion: { x: 0, y: 0, width: 1, height: 1 },
          stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } },
          crossingDirection: 'top-to-bottom',
          signalRegion: { x: 0.7, y: 0.1, width: 0.1, height: 0.1 },
          signalAssociation: 'traffic-signal-1',
        },
        createdAt: '2026-10-20T12:00:00.000Z',
      },
      createdAt: '2026-10-20T12:01:00.000Z',
      updatedAt: '2026-10-20T12:01:02.000Z',
      provenance: {
        source: { videoId: props.videoId, sha256: props.sourceSha256, path: 'uploaded-original', durationSeconds: 10, width: 1920, height: 1080 },
        detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
        tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
        sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
        thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      },
      result: {
        frameWidth: 1920,
        frameHeight: 1080,
        sampledFrameCount: 1,
        possibleIdentitySwitches: [],
        tracks: [{
          trackId: 'car-7', firstSeenSeconds: 12.5, lastSeenSeconds: 12.5, gaps: [],
          observations: [{
            frameIndex: 25, timeSeconds: 12.5, frameWidth: 1920, frameHeight: 1080,
            box: { x: 100, y: 200, width: 300, height: 200 },
            normalizedBox: { x: 100 / 1920, y: 200 / 1080, width: 300 / 1920, height: 200 / 1080 },
            confidence: 0.9, state: 'observed',
          }],
        }],
        signalTimeline: {
          stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 },
          observations: [],
          intervals: [
            { state: 'red', startFrameIndex: 0, endFrameExclusive: 2, startSeconds: 12, endSeconds: 14, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [0, 1, 2] } },
            { state: 'unknown', startFrameIndex: 2, endFrameExclusive: 3, startSeconds: 14, endSeconds: 22, rationale: 'ambiguous_signal' },
          ],
        },
      },
    };
    render(<SceneConfigurationEditor {...props} initialRuns={[completedRun]} sourceTimeOffsetSeconds={12} />);
    const video = screen.getByLabelText('Video for scene configuration');
    let playbackTime = 0.5;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => playbackTime, set: value => { playbackTime = value; } });
    fireEvent.timeUpdate(video);
    expect(screen.getByTestId('traffic-analysis-overlay')).toHaveAttribute('aria-label', 'Traffic detections at 12.50 seconds');
    expect(screen.getByText(/1 observed vehicle at 12.50 s/)).toBeInTheDocument();
    const timelineRegion = screen.getByRole('region', { name: 'Inferred traffic signal timeline' });
    expect(within(timelineRegion).getByRole('status')).toHaveTextContent('Red · stable for three consecutive frames');
    const signalSlider = screen.getByRole('slider', { name: 'Signal timeline playback position' });
    expect(signalSlider).toHaveValue('0.5');
    fireEvent.change(signalSlider, { target: { value: '2.5' } });
    expect(video).toHaveProperty('currentTime', 2.5);
    expect(within(timelineRegion).getByRole('status')).toHaveTextContent('Unknown · ambiguous signal');
    expect(screen.getByTestId('traffic-analysis-overlay')).toHaveAttribute('aria-label', 'Traffic detections at 14.50 seconds');
  });

  it('surfaces a terminal inference failure separately from upload and preview success', () => {
    const failedRun: AnalysisRunSnapshot = {
      schemaVersion: 2,
      id: 'run-failed',
      videoId: props.videoId,
      status: 'failed',
      analysisStarted: true,
      configurationSnapshot: {
        schemaVersion: 1,
        id: 'config-failed',
        source: { videoId: props.videoId, sha256: props.sourceSha256, width: 1920, height: 1080 },
        geometry: {
          vehicleRegion: { x: 0, y: 0, width: 1, height: 1 },
          stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } },
          crossingDirection: 'top-to-bottom',
          signalRegion: { x: 0.7, y: 0.1, width: 0.1, height: 0.1 },
          signalAssociation: 'traffic-signal-1',
        },
        createdAt: '2026-10-20T12:00:00.000Z',
      },
      createdAt: '2026-10-20T12:01:00.000Z',
      updatedAt: '2026-10-20T12:01:02.000Z',
      provenance: {
        source: { videoId: props.videoId, sha256: props.sourceSha256, path: 'uploaded-original', durationSeconds: 10, width: 1920, height: 1080 },
        detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
        tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
        sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
        thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
      },
      error: { code: 'YOLO_INFERENCE_FAILED', message: 'The source could not be decoded by the model runtime.', stage: 'inference' },
    };
    render(<SceneConfigurationEditor {...props} initialRuns={[failedRun]} />);
    expect(within(screen.getByRole('region', { name: 'Analysis run records' })).getByRole('alert')).toHaveTextContent('Traffic analysis failed during inference. Verify the source video and qualified runtime, then start a new run.');
    expect(screen.getByText('ANALYSIS FAILED')).toBeInTheDocument();
    expect(screen.queryByTestId('traffic-analysis-overlay')).not.toBeInTheDocument();
  });

  it.each([
    ['Unix /opt path', 'ENOENT', "ENOENT: no such file or directory, open '/opt/private/model.pt'", '/opt/private/model.pt'],
    ['Windows drive path', 'ENOENT', 'ENOENT: cannot open C:\\Users\\operator\\private\\model.pt', 'C:\\Users\\operator'],
    ['UNC path', 'ENOENT', 'ENOENT: cannot open \\\\nas01\\models\\private\\model.pt', '\\\\nas01\\models'],
    ['runtime stderr', 'ENOENT', 'Runtime failed at /Users/operator/private/yolo.pt. stderr: ModuleNotFoundError', '/Users/operator/private'],
    ['unknown prototype-key error code', 'toString', 'untrusted server exception details', 'untrusted server exception details'],
  ])('replaces untrusted %s failure details with a safe actionable message', (_caseName, code, message, privateDetail) => {
    const failedRun: AnalysisRunSnapshot = {
      ...queuedRun,
      status: 'failed',
      phase: 'failed',
      error: { code, stage: 'preparation', message },
    };
    render(<SceneConfigurationEditor {...props} initialRuns={[failedRun]} />);

    const runHistory = screen.getByRole('region', { name: 'Analysis run records' });
    const failure = within(runHistory).getByRole('alert');
    expect(failure).toHaveTextContent('Analysis preparation failed. Check the qualified model checkpoint, Python runtime, and tracker configuration, then retry.');
    expect(failure).toHaveTextContent('ANALYSIS_FAILED');
    expect(runHistory).not.toHaveTextContent(privateDetail);
    expect(runHistory).not.toHaveTextContent('ENOENT');
    expect(runHistory).not.toHaveTextContent('ModuleNotFoundError');
    expect(screen.queryByTestId('traffic-analysis-overlay')).not.toBeInTheDocument();
  });
});
