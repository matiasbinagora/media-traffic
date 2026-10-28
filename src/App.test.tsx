import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { App } from './App';

const limits = {
  supportedFormats: ['.mp4', '.mov', '.webm'],
  maxUploadBytes: 3 * 1024 * 1024,
  maxUploadMegabytes: 3,
  durationLimitSeconds: null,
  fieldName: 'video',
};

const job = {
  id: '4b5f34a5-0c0a-4ef8-a811-66a28d650012',
  originalName: 'intersection.mp4',
  status: 'completed',
  upload: { status: 'completed', sizeBytes: 256, sha256: 'abc' },
  preview: { status: 'completed', contentType: 'video/mp4', url: '/api/videos/4b5f34a5-0c0a-4ef8-a811-66a28d650012/preview' },
  source: { sizeBytes: 256, sha256: 'abc', media: { width: 640, height: 360 } },
  derivative: { media: { width: 640, height: 360 } },
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:01.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('video upload experience', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(limits)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the file formats and size returned by the server', async () => {
    render(<App />);
    expect(await screen.findByText('Formats')).toBeInTheDocument();
    expect(screen.getByText('MP4, MOV, WEBM')).toBeInTheDocument();
    expect(screen.getByText('3 MB')).toBeInTheDocument();
    expect(screen.getByText(/no configured limit/)).toBeInTheDocument();
  });

  it('rejects an unsupported file locally and leaves the upload action unavailable', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText(/Choose a video to upload/);
    fireEvent.change(input, { target: { files: [new File(['video'], 'traffic.avi', { type: 'video/x-msvideo' })] } });
    expect(screen.getByText('Choose an MP4, MOV, or WebM video.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload video/i })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uploads, polls, and plays a preview while stating that analysis has not started', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(limits))
      .mockResolvedValueOnce(jsonResponse({ ...job, status: 'processing', preview: { ...job.preview, status: 'processing' } }, 201))
      .mockResolvedValueOnce(jsonResponse(job));
    render(<App />);

    const input = await screen.findByLabelText(/Choose a video to upload/);
    await user.upload(input, new File(['small video'], 'intersection.mp4', { type: 'video/mp4' }));
    await user.click(screen.getByRole('button', { name: /upload video/i }));

    expect(await screen.findByText('Preparing your preview')).toBeInTheDocument();
    expect(await screen.findByText('Preview ready', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Traffic analysis is a separate step below.')).toBeInTheDocument();
    expect(screen.getByLabelText('Video for scene configuration')).toHaveAttribute('src', job.preview.url);
    expect(fetchMock).toHaveBeenCalledWith('/api/videos', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/videos/${job.id}`, expect.anything());
  });

  it('shows the server validation error and keeps a retry path', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(limits))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INVALID_MEDIA', message: 'The uploaded file is not a readable video. Export it again.' } }, 422));
    render(<App />);
    const input = await screen.findByLabelText(/Choose a video to upload/);
    await user.upload(input, new File(['bad data'], 'broken.mov', { type: 'video/quicktime' }));
    await user.click(screen.getByRole('button', { name: /upload video/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The uploaded file is not a readable video. Export it again.');
    expect(screen.getByRole('button', { name: 'Retry upload' })).toBeEnabled();
  });

  it('explains preview conversion failure and lets the user choose another file', async () => {
    const user = userEvent.setup();
    const failedJob = { ...job, status: 'failed', preview: { ...job.preview, status: 'failed' }, error: { code: 'MEDIA_TOOL_UNAVAILABLE', message: 'FFmpeg is unavailable. Install FFmpeg and retry.' } };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(limits))
      .mockResolvedValueOnce(jsonResponse({ ...failedJob, status: 'processing', preview: { ...job.preview, status: 'processing' }, error: undefined }, 201))
      .mockResolvedValueOnce(jsonResponse(failedJob));
    render(<App />);
    const input = await screen.findByLabelText(/Choose a video to upload/);
    await user.upload(input, new File(['video'], 'traffic.webm', { type: 'video/webm' }));
    await user.click(screen.getByRole('button', { name: /upload video/i }));
    expect(await screen.findByText('Preview could not be prepared', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Your uploaded source is preserved. Try another MP4, MOV, or WebM export.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose another video' })).toBeInTheDocument();
  });

  it('surfaces upload limit loading failures with a retry action', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network is unavailable'))
      .mockResolvedValueOnce(jsonResponse(limits));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network is unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('3 MB')).toBeInTheDocument());
  });

  it.each(['malformed stored run IDs', 'run ID write failure'] as const)(
    'shows the server-accepted analysis run after %s', async storageFailure => {
      const user = userEvent.setup();
      let savedConfiguration: Record<string, unknown> | null = null;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('scene-canvas') ? {
          x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450, toJSON: () => ({}),
        } as DOMRect : {
          x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
        } as DOMRect;
      });

      const configuration = (body: string) => {
        savedConfiguration = JSON.parse(body) as Record<string, unknown>;
        return jsonResponse(savedConfiguration);
      };
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/uploads/limits') return jsonResponse(limits);
        if (url === '/api/videos' && init?.method === 'POST') return jsonResponse(job, 201);
        if (url.endsWith('/configurations') && init?.method === 'POST') return configuration(String(init.body));
        if (url.endsWith('/analysis-runs') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { configurationId: string };
          return jsonResponse({
            schemaVersion: 2,
            id: 'accepted-run-1',
            videoId: job.id,
            status: 'queued',
            analysisStarted: true,
            configurationSnapshot: { ...savedConfiguration, id: body.configurationId },
            createdAt: '2026-10-20T12:02:00.000Z',
            updatedAt: '2026-10-20T12:02:00.000Z',
            provenance: {
              source: { videoId: job.id, sha256: 'abc', path: 'uploaded-original', durationSeconds: 10, width: 640, height: 360 },
              detector: { family: 'YOLO26', weights: 'test.pt', runtime: 'Ultralytics', device: 'cpu' },
              tracker: { name: 'ByteTrack', configFile: 'server/inference/bytetrack.yaml' },
              sampling: { strategy: 'every-decoded-frame', framesPerSample: 1, timestampSource: 'ffprobe.best_effort_timestamp_time' },
              thresholds: { confidence: 0.25, imageSize: 640, classFilter: { id: 2, name: 'car' } },
            },
          }, 202);
        }
        throw new Error(`Unexpected request: ${init?.method || 'GET'} ${url}`);
      });

      const runIdsKey = `media-traffic.analysis-run-ids:${job.id}`;
      if (storageFailure === 'malformed stored run IDs') {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
          if (key === runIdsKey) return '{';
          return null;
        });
      } else {
        const originalSetItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
          if (key === runIdsKey) throw new DOMException('Storage is unavailable', 'QuotaExceededError');
          originalSetItem.call(this, key, value);
        });
      }

      render(<App />);
      const uploadInput = await screen.findByLabelText(/Choose a video to upload/);
      await user.upload(uploadInput, new File(['video'], 'intersection.mp4', { type: 'video/mp4' }));
      await user.click(screen.getByRole('button', { name: /upload video/i }));

      const surface = await screen.findByRole('application', { name: 'Scene geometry editor' });
      const draw = async (tool: string, start: [number, number], end: [number, number]) => {
        await user.click(screen.getByRole('button', { name: tool }));
        fireEvent.pointerDown(surface, { clientX: start[0], clientY: start[1], pointerId: 1 });
        fireEvent.pointerUp(surface, { clientX: end[0], clientY: end[1], pointerId: 1 });
      };
      await draw('Draw vehicle region', [80, 45], [720, 405]);
      await draw('Draw stop line', [160, 270], [640, 270]);
      await draw('Draw signal region', [640, 45], [760, 135]);
      await user.selectOptions(screen.getByLabelText('Crossing direction'), 'top-to-bottom');
      await user.selectOptions(screen.getByLabelText('Governing signal'), 'traffic-signal-1');
      await user.click(await screen.findByRole('button', { name: 'Save scene configuration' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start traffic analysis' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Start traffic analysis' }));

      expect(await screen.findByText('Analysis queued')).toBeInTheDocument();
      expect(screen.getByText('Run accepted-run-1')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(vi.mocked(fetch).mock.calls.filter(([url, options]) => String(url).endsWith('/analysis-runs') && options?.method === 'POST')).toHaveLength(1);
    },
  );
});
