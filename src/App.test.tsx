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
    expect(screen.getByText('ANALYSIS NOT STARTED')).toBeInTheDocument();
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
});
