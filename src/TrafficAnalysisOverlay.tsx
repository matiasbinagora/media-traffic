import { useMemo } from 'react';
import type { TrafficAnalysisResult } from './analysis-types';
import type { PlayerRect } from './scene-geometry';

type Props = {
  result: TrafficAnalysisResult;
  sourceTimeSeconds: number;
  width: number;
  height: number;
  frame: PlayerRect;
};

function nearestObservationTime(result: TrafficAnalysisResult): number {
  const times = [...new Set(result.tracks.flatMap(track => track.observations.map(observation => observation.timeSeconds)))].sort((a, b) => a - b);
  const intervals = times.slice(1).map((time, index) => time - times[index]).filter(interval => Number.isFinite(interval) && interval > 0);
  // Keep a sampled box visible only around its recorded timestamp. This window is
  // inferred from the actual output cadence, never used to synthesize a box.
  return intervals.length ? Math.min(0.05, Math.min(...intervals) / 2) : 0.025;
}

export function TrafficAnalysisOverlay({ result, sourceTimeSeconds, width, height, frame }: Props) {
  const { active, paths, gapCount } = useMemo(() => {
    const tolerance = nearestObservationTime(result);
    const observations = result.tracks.flatMap(track => track.observations.map(observation => ({ track, observation })));
    const active = observations.filter(({ observation }) => Math.abs(observation.timeSeconds - sourceTimeSeconds) <= tolerance);
    const paths = result.tracks.map(track => {
      const gapPairs = new Set(track.gaps.map(gap => `${gap.afterFrameIndex}:${gap.beforeFrameIndex}`));
      const segments: Array<[number, number, number, number]> = [];
      for (let index = 1; index < track.observations.length; index += 1) {
        const previous = track.observations[index - 1];
        const current = track.observations[index];
        if (!gapPairs.has(`${previous.frameIndex}:${current.frameIndex}`) && current.timeSeconds <= sourceTimeSeconds) {
          segments.push([
            previous.normalizedBox.x + previous.normalizedBox.width / 2,
            previous.normalizedBox.y + previous.normalizedBox.height / 2,
            current.normalizedBox.x + current.normalizedBox.width / 2,
            current.normalizedBox.y + current.normalizedBox.height / 2,
          ]);
        }
      }
      return { trackId: track.trackId, segments, gaps: track.gaps };
    });
    return { active, paths, gapCount: result.tracks.reduce((count, track) => count + track.gaps.length, 0) };
  }, [result, sourceTimeSeconds]);

  return (
    <div className="traffic-analysis-layer" role="region" aria-label="Detected vehicles and trajectories">
      <svg
        className="traffic-analysis-overlay"
        viewBox={`0 0 ${width || 1} ${height || 1}`}
        role="group"
        aria-label={`Traffic detections at ${sourceTimeSeconds.toFixed(2)} seconds`}
        data-testid="traffic-analysis-overlay"
      >
        {paths.flatMap(track => track.segments.map(([x1, y1, x2, y2], index) => (
          <line
            key={`${track.trackId}-trajectory-${index}`}
            data-track-id={track.trackId}
            data-overlay-kind="trajectory"
            x1={frame.left + x1 * frame.width}
            y1={frame.top + y1 * frame.height}
            x2={frame.left + x2 * frame.width}
            y2={frame.top + y2 * frame.height}
            stroke="#7ce4b3"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )))}
        {active.map(({ track, observation }) => {
          const box = observation.normalizedBox;
          return (
            <g key={`${track.trackId}-${observation.frameIndex}`} data-track-id={track.trackId} data-overlay-kind="observation">
              <rect
              x={frame.left + box.x * frame.width}
              y={frame.top + box.y * frame.height}
              width={box.width * frame.width}
              height={box.height * frame.height}
                fill="rgba(25, 185, 120, 0.08)"
                stroke="#45e6a4"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <text x={frame.left + box.x * frame.width} y={Math.max(frame.top + 15, frame.top + box.y * frame.height - 5)} className="track-label">
                {`Track ${track.trackId} · ${(observation.confidence * 100).toFixed(0)}%`}
              </text>
            </g>
          );
        })}
        <title>{`${active.length} observed vehicles; ${gapCount} tracking gaps. Boxes are shown only near recorded observation times.`}</title>
      </svg>
      <p className="traffic-overlay-status" role="status">
        {active.length ? `${active.length} observed vehicle${active.length === 1 ? '' : 's'} at ${sourceTimeSeconds.toFixed(2)} s` : 'No recorded car observation at this playback time.'}
        {' '}Boxes use recorded observations only; no positions are interpolated.
      </p>
      {gapCount > 0 && <ul className="traffic-gap-list" aria-label="Tracking gaps and identity uncertainty">
        {paths.flatMap(track => track.gaps.map(gap => (
          <li key={`${track.trackId}-${gap.afterFrameIndex}-${gap.beforeFrameIndex}`}>
            Track {track.trackId}: {gap.missingFrameCount} frame{gap.missingFrameCount === 1 ? '' : 's'} unobserved from {gap.startSeconds.toFixed(2)} to {gap.endSeconds.toFixed(2)} s; identity continuity unverified.
          </li>
        )))}
      </ul>}
      {result.possibleIdentitySwitches.length > 0 && <ul className="traffic-gap-list" aria-label="Possible identity switches; continuity unverified">
        {result.possibleIdentitySwitches.map((link, index) => (
          <li key={`${link.fromTrackId}-${link.toTrackId}-${link.fromFrameIndex}-${index}`}>
            Possible identity change from Track {link.fromTrackId} at {link.fromTimeSeconds.toFixed(2)} s to Track {link.toTrackId} at {link.toTimeSeconds.toFixed(2)} s; {link.spatialEvidence} evidence. Identity continuity is unverified, and the track IDs remain separate.
          </li>
        ))}
      </ul>}
    </div>
  );
}
