import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { SceneConfigurationEditor, type SceneConfigurationSnapshot } from './SceneConfigurationEditor';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('scene configuration editor', () => {
  it('identifies missing geometry and keeps run-record creation disabled', () => {
    render(<SceneConfigurationEditor {...props} />);
    expect(screen.getByRole('button', { name: 'Create analysis run record' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Vehicle region');
    expect(screen.getByRole('alert')).toHaveTextContent('Stop line');
    expect(screen.getByRole('alert')).toHaveTextContent('Crossing direction');
    expect(screen.getByRole('alert')).toHaveTextContent('Signal region');
    expect(screen.getByRole('alert')).toHaveTextContent('Signal association');
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
    const onCreateAnalysisRun = vi.fn(async (snapshot: SceneConfigurationSnapshot) => ({
      schemaVersion: 1 as const,
      id: `run-${snapshot.id}`,
      videoId: props.videoId,
      status: 'not_started' as const,
      analysisStarted: false as const,
      configurationSnapshot: snapshot,
      createdAt: '2026-10-20T12:01:00.000Z',
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
    const createRunButton = screen.getByRole('button', { name: 'Create analysis run record' });
    await waitFor(() => expect(createRunButton).toBeEnabled());
    await user.click(createRunButton);
    await waitFor(() => expect(onCreateAnalysisRun).toHaveBeenCalledWith(snapshot));
    expect(screen.getByRole('region', { name: 'Analysis run records' })).toHaveTextContent('not started · analysis not started');
    expect(screen.queryByRole('button', { name: 'Start analysis' })).not.toBeInTheDocument();
  });
});
