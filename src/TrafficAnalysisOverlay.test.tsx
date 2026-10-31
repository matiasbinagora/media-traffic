import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TrafficAnalysisOverlay } from './TrafficAnalysisOverlay';
import type { TrafficAnalysisResult } from './analysis-types';
import { getContainedVideoRect } from './scene-geometry';

const result: TrafficAnalysisResult = {
  frameWidth: 100,
  frameHeight: 100,
  sampledFrameCount: 4,
  tracks: [
    {
      trackId: 'car-1', firstSeenSeconds: 1, lastSeenSeconds: 2,
      observations: [
        { frameIndex: 10, timeSeconds: 1, frameWidth: 100, frameHeight: 100, box: { x: 10, y: 20, width: 20, height: 20 }, normalizedBox: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.91, state: 'observed' },
        { frameIndex: 11, timeSeconds: 1.1, frameWidth: 100, frameHeight: 100, box: { x: 12, y: 20, width: 20, height: 20 }, normalizedBox: { x: 0.12, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.89, state: 'observed' },
        { frameIndex: 14, timeSeconds: 1.4, frameWidth: 100, frameHeight: 100, box: { x: 18, y: 20, width: 20, height: 20 }, normalizedBox: { x: 0.18, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.81, state: 'observed' },
      ],
      gaps: [{ afterFrameIndex: 11, beforeFrameIndex: 14, missingFrameCount: 2, startSeconds: 1.1, endSeconds: 1.4, reason: 'not_observed', identityContinuity: 'unverified' }],
    },
    {
      trackId: 'car-2', firstSeenSeconds: 1, lastSeenSeconds: 1,
      observations: [
        { frameIndex: 10, timeSeconds: 1, frameWidth: 100, frameHeight: 100, box: { x: 60, y: 20, width: 20, height: 20 }, normalizedBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.86, state: 'observed' },
      ],
      gaps: [],
    },
    {
      trackId: 'car-3', firstSeenSeconds: 2.2, lastSeenSeconds: 2.2,
      observations: [
        { frameIndex: 22, timeSeconds: 2.2, frameWidth: 100, frameHeight: 100, box: { x: 35, y: 20, width: 20, height: 20 }, normalizedBox: { x: 0.35, y: 0.2, width: 0.2, height: 0.2 }, confidence: 0.82, state: 'observed' },
      ],
      gaps: [],
    },
  ],
  possibleIdentitySwitches: [{
    fromTrackId: 'car-1', toTrackId: 'car-3', fromFrameIndex: 20, toFrameIndex: 22,
    fromTimeSeconds: 2, toTimeSeconds: 2.2, spatialEvidence: 'nearby', identityContinuity: 'unverified',
  }],
};
const fullFrame = { left: 0, top: 0, width: 1000, height: 500 };

afterEach(cleanup);

describe('traffic analysis overlay', () => {
  it('shows concurrent observed boxes with stable IDs at the matching playback time', () => {
    render(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1} width={1000} height={500} frame={fullFrame} />);
    expect(screen.getByRole('region', { name: 'Detected vehicles and trajectories' })).toBeInTheDocument();
    expect(screen.getByTestId('traffic-analysis-overlay').querySelectorAll('[data-overlay-kind="observation"]')).toHaveLength(2);
    expect(screen.getByTestId('traffic-analysis-overlay')).toHaveAttribute('aria-label', 'Traffic detections at 1.00 seconds');
    expect(screen.getByText(/2 observed vehicles at 1.00 s/)).toBeInTheDocument();
  });

  it('does not repeat a box between recorded samples or bridge an explicit gap', () => {
    const { rerender } = render(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1.04} width={1000} height={500} frame={fullFrame} />);
    expect(screen.getByText(/2 observed vehicles at 1.04 s/)).toBeInTheDocument();
    expect(screen.getByTestId('traffic-analysis-overlay').querySelectorAll('[data-overlay-kind="observation"]')).toHaveLength(2);

    rerender(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1.25} width={1000} height={500} frame={fullFrame} />);
    expect(screen.getByText(/No recorded car observation at this playback time/)).toBeInTheDocument();
    expect(screen.getByTestId('traffic-analysis-overlay').querySelector('[data-overlay-kind="observation"]')).not.toBeInTheDocument();
    expect(screen.getByText(/2 frames unobserved from 1.10 to 1.40 s; identity continuity unverified/)).toBeInTheDocument();
    expect(screen.getByTestId('traffic-analysis-overlay').querySelectorAll('[data-overlay-kind="trajectory"]')).toHaveLength(1);
  });

  it('reveals a trajectory segment only after both actual observations have played', () => {
    const { rerender } = render(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1.05} width={1000} height={500} frame={fullFrame} />);
    expect(screen.getByTestId('traffic-analysis-overlay').querySelector('[data-overlay-kind="trajectory"]')).not.toBeInTheDocument();

    rerender(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1.1} width={1000} height={500} frame={fullFrame} />);
    const trajectory = screen.getByTestId('traffic-analysis-overlay').querySelector('[data-overlay-kind="trajectory"]');
    expect(trajectory).toHaveAttribute('data-track-id', 'car-1');
    expect(trajectory).toHaveAttribute('x1', '200');
    expect(trajectory).toHaveAttribute('x2', '220');
  });

  it('uses each track observation cadence instead of letting a faster track hide sparse observations', () => {
    const mixedCadence: TrafficAnalysisResult = {
      ...result,
      tracks: [
        ...result.tracks,
        {
          trackId: 'car-sparse', firstSeenSeconds: 4, lastSeenSeconds: 4.5,
          observations: [
            { frameIndex: 120, timeSeconds: 4, frameWidth: 100, frameHeight: 100, box: { x: 10, y: 40, width: 20, height: 20 }, normalizedBox: { x: 0.1, y: 0.4, width: 0.2, height: 0.2 }, confidence: 0.8, state: 'observed' },
            { frameIndex: 135, timeSeconds: 4.5, frameWidth: 100, frameHeight: 100, box: { x: 20, y: 40, width: 20, height: 20 }, normalizedBox: { x: 0.2, y: 0.4, width: 0.2, height: 0.2 }, confidence: 0.8, state: 'observed' },
          ],
          gaps: [],
        },
        {
          trackId: 'car-dense', firstSeenSeconds: 1.5, lastSeenSeconds: 1.566667,
          observations: [
            { frameIndex: 45, timeSeconds: 1.5, frameWidth: 100, frameHeight: 100, box: { x: 60, y: 40, width: 20, height: 20 }, normalizedBox: { x: 0.6, y: 0.4, width: 0.2, height: 0.2 }, confidence: 0.8, state: 'observed' },
            { frameIndex: 46, timeSeconds: 1.533333, frameWidth: 100, frameHeight: 100, box: { x: 61, y: 40, width: 20, height: 20 }, normalizedBox: { x: 0.61, y: 0.4, width: 0.2, height: 0.2 }, confidence: 0.8, state: 'observed' },
            { frameIndex: 47, timeSeconds: 1.566667, frameWidth: 100, frameHeight: 100, box: { x: 62, y: 40, width: 20, height: 20 }, normalizedBox: { x: 0.62, y: 0.4, width: 0.2, height: 0.2 }, confidence: 0.8, state: 'observed' },
          ],
          gaps: [],
        },
      ],
    };

    render(<TrafficAnalysisOverlay result={mixedCadence} sourceTimeSeconds={4.04} width={1000} height={500} frame={fullFrame} />);

    const overlay = screen.getByTestId('traffic-analysis-overlay');
    expect(overlay.querySelector('g[data-track-id="car-sparse"][data-overlay-kind="observation"]')).toBeInTheDocument();
    expect(overlay.querySelector('g[data-track-id="car-dense"][data-overlay-kind="observation"]')).not.toBeInTheDocument();
  });

  it('keeps boxes within the contained video frame when a wide player is height-constrained', () => {
    const frame = getContainedVideoRect(1200, 360, 1920, 1080);
    render(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={1} width={1200} height={360} frame={frame} />);
    const box = screen.getByTestId('traffic-analysis-overlay').querySelector('[data-overlay-kind="observation"] rect');
    expect(frame.left).toBeGreaterThan(0);
    expect(box).toHaveAttribute('x', String(frame.left + 0.1 * frame.width));
    expect(Number(box?.getAttribute('x'))).toBeGreaterThanOrEqual(frame.left);
    expect(Number(box?.getAttribute('x')) + Number(box?.getAttribute('width'))).toBeLessThanOrEqual(frame.left + frame.width);
  });

  it('reports an empty successful result without implying that analysis failed', () => {
    const emptyResult: TrafficAnalysisResult = { frameWidth: 100, frameHeight: 100, sampledFrameCount: 3, tracks: [], possibleIdentitySwitches: [] };
    render(<TrafficAnalysisOverlay result={emptyResult} sourceTimeSeconds={0.5} width={1000} height={500} frame={fullFrame} />);
    expect(screen.getByText(/No recorded car observation at this playback time/)).toBeInTheDocument();
    expect(screen.getByText(/Boxes use recorded observations only/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tracking gaps and identity uncertainty')).not.toBeInTheDocument();
  });

  it('surfaces possible identity switches as unverified links while keeping track IDs separate', () => {
    render(<TrafficAnalysisOverlay result={result} sourceTimeSeconds={2.2} width={1000} height={500} frame={fullFrame} />);

    expect(screen.getByRole('list', { name: 'Possible identity switches; continuity unverified' })).toHaveTextContent(
      'Possible identity change from Track car-1 at 2.00 s to Track car-3 at 2.20 s; nearby evidence. Identity continuity is unverified, and the track IDs remain separate.',
    );
    const overlay = screen.getByTestId('traffic-analysis-overlay');
    expect(overlay.querySelector('[data-overlay-kind="observation"]')).toHaveAttribute('data-track-id', 'car-3');
    expect(overlay.querySelectorAll('[data-overlay-kind="identity-switch"]')).toHaveLength(0);
    expect(result.tracks.map(track => track.trackId)).toContain('car-1');
    expect(result.tracks.map(track => track.trackId)).toContain('car-3');
  });
});
