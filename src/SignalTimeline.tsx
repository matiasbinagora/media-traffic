import type { SignalInterval, SignalTimeline as SignalTimelineData, SignalState } from './analysis-types';

type Props = {
  timeline: SignalTimelineData;
  playbackTimeSeconds: number;
  sourceTimeOffsetSeconds: number;
  durationSeconds: number;
  onSeek: (playbackTimeSeconds: number) => void;
};

const stateLabels: Record<SignalState, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  unknown: 'Unknown',
};

const rationaleLabels: Record<SignalInterval['rationale'], string> = {
  stable_for_three_consecutive_frames: 'stable for three consecutive frames',
  no_readable_signal: 'no readable signal',
  ambiguous_signal: 'ambiguous signal',
  signal_region_too_small: 'signal region too small',
  transition_not_stable: 'transition not stable',
};

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds - minutes * 60;
  return `${minutes}:${remainingSeconds.toFixed(2).padStart(5, '0')}`;
}

function intervalAtTime(intervals: SignalInterval[], sourceTimeSeconds: number): SignalInterval | undefined {
  return intervals.find(interval => sourceTimeSeconds >= interval.startSeconds && sourceTimeSeconds < interval.endSeconds);
}

function intervalDescription(interval: SignalInterval): string {
  return `${stateLabels[interval.state]} · ${rationaleLabels[interval.rationale]}`;
}

export function SignalTimeline({ timeline, playbackTimeSeconds, sourceTimeOffsetSeconds, durationSeconds, onSeek }: Props) {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const position = duration ? Math.min(duration, Math.max(0, playbackTimeSeconds)) : 0;
  const sourceTime = position + sourceTimeOffsetSeconds;
  const activeInterval = intervalAtTime(timeline.intervals, sourceTime);
  const activeDescription = activeInterval ? intervalDescription(activeInterval) : 'Unknown · no signal observation at this time';

  return (
    <section className="signal-timeline" aria-label="Inferred traffic signal timeline">
      <div className="signal-timeline-heading">
        <div>
          <p className="section-kicker">VIDEO-DERIVED EVIDENCE</p>
          <h3>Signal state</h3>
        </div>
        <p className={`signal-state-badge signal-state-${activeInterval?.state || 'unknown'}`} role="status" aria-live="polite">
          <strong>{activeDescription}</strong>
          <span>{formatTime(position)}</span>
        </p>
      </div>

      <div className="signal-timeline-control">
        <div className="signal-timeline-segments" aria-hidden="true">
          {timeline.intervals.map((interval, index) => {
            const left = duration ? Math.max(0, (interval.startSeconds - sourceTimeOffsetSeconds) / duration) * 100 : 0;
            const right = duration ? Math.min(1, (interval.endSeconds - sourceTimeOffsetSeconds) / duration) * 100 : 0;
            return (
              <span
                key={`${interval.startFrameIndex}-${interval.endFrameExclusive}-${index}`}
                className={`signal-timeline-segment signal-timeline-segment-${interval.state}${interval.state === 'unknown' ? ` signal-timeline-unknown-${interval.rationale}` : ''}`}
                style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
                data-start-seconds={interval.startSeconds}
                data-end-seconds={interval.endSeconds}
                data-state={interval.state}
                data-rationale={interval.rationale}
              />
            );
          })}
        </div>
        <input
          className="signal-timeline-slider"
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={position}
          disabled={!duration}
          aria-label="Signal timeline playback position"
          aria-valuetext={`${formatTime(position)} · ${activeDescription}`}
          onChange={event => onSeek(Number(event.currentTarget.value))}
        />
      </div>

      <div className="signal-timeline-labels" aria-hidden="true"><span>{formatTime(0)}</span><span>{formatTime(duration)}</span></div>
      <ul className="signal-interval-list" aria-label="Signal intervals">
        {timeline.intervals.map((interval, index) => (
          <li key={`${interval.startFrameIndex}-${interval.endFrameExclusive}-${index}`}>
            <span className={`signal-interval-swatch signal-interval-swatch-${interval.state}${interval.state === 'unknown' ? ` signal-interval-unknown-${interval.rationale}` : ''}`} aria-hidden="true" />
          <span>{formatTime(interval.startSeconds - sourceTimeOffsetSeconds)}–{formatTime(interval.endSeconds - sourceTimeOffsetSeconds)}: {intervalDescription(interval)}</span>
          </li>
        ))}
      </ul>
      <p className="signal-timeline-note">State changes follow the video playback position. Unknown intervals retain their reason; reference annotations are not used for inference.</p>
    </section>
  );
}
