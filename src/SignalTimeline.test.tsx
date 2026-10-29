import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SignalTimeline } from './SignalTimeline';
import type { SignalTimeline as SignalTimelineData } from './analysis-types';

const timeline: SignalTimelineData = {
  stabilityRule: { method: 'consecutive-decoded-frames', requiredFrames: 3 },
  observations: [],
  intervals: [
    { state: 'red', startFrameIndex: 0, endFrameExclusive: 3, startSeconds: 0, endSeconds: 1, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [0, 1, 2] } },
    { state: 'unknown', startFrameIndex: 3, endFrameExclusive: 5, startSeconds: 1, endSeconds: 2, rationale: 'ambiguous_signal' },
    { state: 'unknown', startFrameIndex: 5, endFrameExclusive: 6, startSeconds: 2, endSeconds: 3, rationale: 'no_readable_signal' },
    { state: 'green', startFrameIndex: 6, endFrameExclusive: 9, startSeconds: 3, endSeconds: 5, rationale: 'stable_for_three_consecutive_frames', transitionEvidence: { supportingFrameIndices: [6, 7, 8] } },
  ],
};

afterEach(cleanup);

describe('signal timeline', () => {
  it('selects the interval beginning exactly at a state boundary', () => {
    const { rerender } = render(<SignalTimeline timeline={timeline} playbackTimeSeconds={0.99} sourceTimeOffsetSeconds={0} durationSeconds={5} onSeek={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Red · stable for three consecutive frames');

    rerender(<SignalTimeline timeline={timeline} playbackTimeSeconds={1} sourceTimeOffsetSeconds={0} durationSeconds={5} onSeek={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown · ambiguous signal');
  });

  it('keeps ambiguous and unreadable unknown intervals distinct in the timeline and interval list', () => {
    const { container } = render(<SignalTimeline timeline={timeline} playbackTimeSeconds={2.5} sourceTimeOffsetSeconds={0} durationSeconds={5} onSeek={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown · no readable signal');
    expect(screen.getByRole('list', { name: 'Signal intervals' })).toHaveTextContent('0:01.00–0:02.00: Unknown · ambiguous signal');
    expect(screen.getByRole('list', { name: 'Signal intervals' })).toHaveTextContent('0:02.00–0:03.00: Unknown · no readable signal');
    expect(container.querySelector('[data-rationale="ambiguous_signal"]')).toHaveClass('signal-timeline-unknown-ambiguous_signal');
    expect(container.querySelector('[data-rationale="no_readable_signal"]')).toHaveClass('signal-timeline-segment-unknown');
    expect(container.querySelector('[data-rationale="no_readable_signal"]')).toHaveClass('signal-timeline-unknown-no_readable_signal');
    expect(screen.getByRole('slider', { name: 'Signal timeline playback position' })).toHaveAttribute('aria-valuetext', '0:02.50 · Unknown · no readable signal');
  });

  it('seeks to selected playback positions and clamps the displayed position to the source duration', () => {
    const onSeek = vi.fn();
    render(<SignalTimeline timeline={timeline} playbackTimeSeconds={6} sourceTimeOffsetSeconds={0} durationSeconds={5} onSeek={onSeek} />);
    const slider = screen.getByRole('slider', { name: 'Signal timeline playback position' });
    expect(slider).toHaveValue('5');
    fireEvent.change(slider, { target: { value: '3.25' } });
    expect(onSeek).toHaveBeenCalledWith(3.25);
  });

  it('maps source timestamps with a non-zero start offset onto preview playback time', () => {
    const offsetTimeline: SignalTimelineData = {
      ...timeline,
      intervals: timeline.intervals.map(interval => ({ ...interval, startSeconds: interval.startSeconds + 12, endSeconds: interval.endSeconds + 12 })),
    };
    const { container } = render(<SignalTimeline timeline={offsetTimeline} playbackTimeSeconds={1.5} sourceTimeOffsetSeconds={12} durationSeconds={5} onSeek={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown · ambiguous signal');
    expect(screen.getByRole('slider', { name: 'Signal timeline playback position' })).toHaveValue('1.5');
    expect(container.querySelector('[data-start-seconds="13"]')).toHaveStyle({ left: '20%', width: '20%' });
  });
});
