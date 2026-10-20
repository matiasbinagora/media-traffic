import { useCallback, useEffect, useRef, useState } from 'react';
import { SceneConfigurationEditor, type AnalysisRunSnapshot, type SceneConfigurationSnapshot } from './SceneConfigurationEditor';

type UploadLimits = {
  supportedFormats: string[];
  maxUploadBytes: number;
  maxUploadMegabytes: number;
  durationLimitSeconds: number | null;
  fieldName: string;
};

type UploadJob = {
  id: string;
  originalName: string;
  status: 'processing' | 'completed' | 'failed';
  upload: { status: 'completed'; sizeBytes: number; sha256: string };
  preview: { status: 'processing' | 'completed' | 'failed'; contentType: string; url: string };
  source?: { sizeBytes: number; sha256: string; media: { width: number; height: number } };
  derivative?: { media: { width: number; height: number } };
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
};

type ApiError = { error?: { code?: string; message?: string; details?: { invalidFields?: string[] } } };

const lastVideoStorageKey = 'media-traffic.last-video-id';
const runIdsStoragePrefix = 'media-traffic.analysis-run-ids:';

const pollingIntervalMs = 1000;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function fileExtension(filename: string): string {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

function errorMessage(payload: ApiError, fallback: string): string {
  const message = payload.error?.message?.trim() || fallback;
  if (payload.error?.code !== 'SCENE_CONFIGURATION_INVALID' || !payload.error.details?.invalidFields?.length) return message;
  const labels: Record<string, string> = {
    vehicleRegion: 'vehicle region', stopLine: 'stop line', crossingDirection: 'crossing direction',
    signalRegion: 'signal region', signalAssociation: 'signal association',
  };
  const fields = payload.error.details.invalidFields.map(field => labels[field] || field);
  return `${message} Check: ${fields.join(', ')}.`;
}

async function readApiError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as ApiError;
  return new Error(errorMessage(payload, fallback));
}

export function App() {
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [limitsError, setLimitsError] = useState('');
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [statusError, setStatusError] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRunSnapshot[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredRunVideoRef = useRef('');

  const loadLimits = useCallback(async (signal?: AbortSignal) => {
    setLimitsLoading(true);
    setLimitsError('');
    try {
      const response = await fetch('/api/uploads/limits', { signal });
      if (!response.ok) throw await readApiError(response, 'Upload limits could not be loaded. Try again.');
      const value = await response.json() as UploadLimits;
      if (!Array.isArray(value.supportedFormats) || !Number.isFinite(value.maxUploadBytes) || !Number.isFinite(value.maxUploadMegabytes)) {
        throw new Error('The server returned invalid upload settings. Try again.');
      }
      setLimits(value);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLimitsError(error instanceof Error ? error.message : 'Upload limits could not be loaded. Try again.');
    } finally {
      if (!signal?.aborted) setLimitsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLimits(controller.signal);
    return () => controller.abort();
  }, [loadLimits]);

  const acceptFile = (nextFile: File | undefined) => {
    setFileError('');
    setUploadError('');
    setStatusError('');
    if (!nextFile) return;
    if (!limits) {
      setFileError('Upload settings are unavailable. Reload them before choosing a video.');
      return;
    }
    if (!limits.supportedFormats.map(format => format.toLowerCase()).includes(fileExtension(nextFile.name))) {
      setFile(null);
      setFileError('Choose an MP4, MOV, or WebM video.');
      return;
    }
    if (nextFile.size === 0) {
      setFile(null);
      setFileError('This file is empty. Choose a non-empty video and try again.');
      return;
    }
    if (nextFile.size > limits.maxUploadBytes) {
      setFile(null);
      setFileError(`This file is larger than the ${limits.maxUploadMegabytes} MB limit. Choose a smaller video and try again.`);
      return;
    }
    setFile(nextFile);
  };

  const uploadVideo = async () => {
    if (!file || !limits || isUploading) return;
    setIsUploading(true);
    setUploadError('');
    setStatusError('');
    setJob(null);
    const formData = new FormData();
    formData.append(limits.fieldName || 'video', file);
    try {
      const response = await fetch('/api/videos', { method: 'POST', body: formData });
      if (!response.ok) throw await readApiError(response, 'The video could not be uploaded. Check your connection and retry.');
      const accepted = await response.json() as UploadJob;
      setJob(accepted);
      setAnalysisRuns([]);
      restoredRunVideoRef.current = '';
      window.localStorage.setItem(lastVideoStorageKey, accepted.id);
      setFileError('');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The upload was interrupted. Check your connection and retry.');
    } finally {
      setIsUploading(false);
    }
  };

  const refreshJob = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/videos/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw await readApiError(response, 'The upload status could not be checked. Try again.');
    return await response.json() as UploadJob;
  }, []);

  const saveSceneConfiguration = async (snapshot: SceneConfigurationSnapshot) => {
    const response = await fetch(`/api/videos/${encodeURIComponent(snapshot.source.videoId)}/configurations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw await readApiError(response, 'The scene configuration could not be saved. Try again.');
    return await response.json() as SceneConfigurationSnapshot;
  };

  const createAnalysisRun = async (snapshot: SceneConfigurationSnapshot) => {
    const videoId = snapshot.source.videoId;
    const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/analysis-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configurationId: snapshot.id }),
    });
    if (!response.ok) throw await readApiError(response, 'The analysis run record could not be saved. Try again.');
    const created = await response.json() as AnalysisRunSnapshot;
    if (created.status !== 'not_started' || created.analysisStarted !== false || created.videoId !== videoId
      || created.configurationSnapshot?.id !== snapshot.id) {
      throw new Error('The server returned an invalid analysis run record.');
    }

    // The API has a detail read route but no collection route. Keep the IDs locally
    // and read each record back so a reload can restore the immutable evidence.
    const readBackResponse = await fetch(`/api/videos/${encodeURIComponent(videoId)}/analysis-runs/${encodeURIComponent(created.id)}`);
    if (!readBackResponse.ok) throw await readApiError(readBackResponse, 'The saved run record could not be reloaded.');
    const readBack = await readBackResponse.json() as AnalysisRunSnapshot;
    if (readBack.status !== 'not_started' || readBack.analysisStarted !== false || readBack.videoId !== videoId
      || readBack.configurationSnapshot?.id !== snapshot.id) {
      throw new Error('The reloaded run record does not match the saved configuration.');
    }
    const idsKey = `${runIdsStoragePrefix}${videoId}`;
    const previousIds = JSON.parse(window.localStorage.getItem(idsKey) || '[]') as unknown;
    const runIds = Array.isArray(previousIds) ? previousIds.filter((id): id is string => typeof id === 'string') : [];
    window.localStorage.setItem(idsKey, JSON.stringify([created.id, ...runIds.filter(id => id !== created.id)]));
    setAnalysisRuns(current => current.some(run => run.id === readBack.id) ? current : [readBack, ...current]);
    return readBack;
  };

  useEffect(() => {
    if (!job || job.status !== 'processing' || statusError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshJob(job.id, controller.signal)
        .then(nextJob => setJob(nextJob))
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setStatusError(error instanceof Error ? error.message : 'The upload status could not be checked. Try again.');
        });
    }, pollingIntervalMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [job, refreshJob, statusError]);

  useEffect(() => {
    if (!job || job.status !== 'completed' || restoredRunVideoRef.current === job.id) return;
    restoredRunVideoRef.current = job.id;
    let cancelled = false;
    const idsKey = `${runIdsStoragePrefix}${job.id}`;
    let storedIds: unknown;
    try { storedIds = JSON.parse(window.localStorage.getItem(idsKey) || '[]'); } catch { storedIds = []; }
    const runIds = Array.isArray(storedIds) ? storedIds.filter((id): id is string => typeof id === 'string') : [];
    void Promise.all(runIds.map(async runId => {
      const response = await fetch(`/api/videos/${encodeURIComponent(job.id)}/analysis-runs/${encodeURIComponent(runId)}`);
      if (!response.ok) return null;
      const run = await response.json() as AnalysisRunSnapshot;
      return run.videoId === job.id && run.status === 'not_started' && run.analysisStarted === false ? run : null;
    })).then(records => {
      if (!cancelled) setAnalysisRuns(records.filter((run): run is AnalysisRunSnapshot => run !== null));
    }).catch(() => {
      // The run history remains available through its persisted IDs on a later reload.
    });
    return () => { cancelled = true; };
  }, [job]);

  useEffect(() => {
    const rememberedVideoId = window.localStorage.getItem(lastVideoStorageKey);
    if (!rememberedVideoId) return;
    let cancelled = false;
    void refreshJob(rememberedVideoId).then(restoredJob => {
      if (!cancelled) setJob(restoredJob);
    }).catch(() => {
      if (!cancelled) window.localStorage.removeItem(lastVideoStorageKey);
    });
    return () => { cancelled = true; };
  }, [refreshJob]);

  const retryStatusCheck = async () => {
    if (!job || isCheckingStatus) return;
    setIsCheckingStatus(true);
    setStatusError('');
    try {
      setJob(await refreshJob(job.id));
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'The upload status could not be checked. Try again.');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const clearSelectedFile = () => {
    setFile(null);
    setFileError('');
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatList = limits?.supportedFormats.map(format => format.replace('.', '').toUpperCase()).join(', ');

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Media Traffic home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>MEDIA <strong>TRAFFIC</strong></span>
        </a>
        <span className="topbar-note"><span className="status-dot" /> DEMO WORKSPACE</span>
      </header>

      <div className="content" id="home">
        <div className="eyebrow"><span>01</span> VIDEO INTAKE</div>
        <h1>Start with a traffic video.</h1>
        <p className="intro">Upload a clip from a fixed camera. We’ll prepare a playable preview before you set up an analysis.</p>

        <section className="upload-panel" aria-labelledby="upload-heading">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">YOUR SOURCE FOOTAGE</p>
              <h2 id="upload-heading">Upload a video</h2>
            </div>
            <span className="step-pill">STEP 1 OF 3</span>
          </div>

          {limitsLoading && <p className="limits-message" role="status">Loading upload requirements…</p>}
          {limitsError && (
            <div className="inline-alert error-alert" role="alert">
              <span>{limitsError}</span>
              <button className="text-button" type="button" onClick={() => void loadLimits()}>Try again</button>
            </div>
          )}
          {limits && (
            <div className="requirements" aria-label="Upload requirements">
              <div><span className="requirement-icon" aria-hidden="true">↥</span><span>Formats <strong>{formatList}</strong></span></div>
              <div><span className="requirement-icon" aria-hidden="true">◷</span><span>Maximum size <strong>{limits.maxUploadMegabytes} MB</strong></span></div>
              <p>Video duration: {limits.durationLimitSeconds == null ? 'no configured limit' : `up to ${Math.floor(limits.durationLimitSeconds / 60)} minutes`}</p>
            </div>
          )}

          <div className={`file-picker${file ? ' has-file' : ''}`}>
            <input
              ref={fileInputRef}
              id="video-file"
              className="visually-hidden"
              type="file"
              accept={limits?.supportedFormats.join(',') || '.mp4,.mov,.webm'}
              disabled={!limits || isUploading}
              onChange={event => acceptFile(event.currentTarget.files?.[0])}
              aria-describedby="file-help file-feedback"
            />
            <label className="picker-label" htmlFor="video-file">
              <span className="upload-icon" aria-hidden="true">↑</span>
              <span className="picker-copy"><strong>{file ? file.name : 'Choose a video to upload'}</strong><span>{file ? formatBytes(file.size) : 'Browse files on your device'}</span></span>
              <span className="browse-button">Browse files</span>
            </label>
            <p id="file-help" className="picker-help">Select one video file from your device.</p>
          </div>
          <div id="file-feedback" className="feedback-slot" aria-live="polite">
            {fileError && <p className="field-error">{fileError}</p>}
          </div>

          {uploadError && (
            <div className="inline-alert error-alert" role="alert">
              <span>{uploadError}</span>
              <button className="text-button" type="button" onClick={() => void uploadVideo()} disabled={!file || isUploading}>Retry upload</button>
            </div>
          )}

          {isUploading && (
            <div className="progress-state" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span><strong>Uploading and validating your video</strong><small>This does not start traffic analysis.</small></span>
            </div>
          )}

          {job && (
            <div className={`job-card ${job.status === 'failed' ? 'job-failed' : ''}`} aria-live="polite">
              <div className="job-card-heading">
                <span className={`job-indicator ${job.status === 'completed' ? 'is-ready' : job.status === 'failed' ? 'is-failed' : ''}`} aria-hidden="true">{job.status === 'completed' ? '✓' : job.status === 'failed' ? '!' : <span className="spinner" />}</span>
                <div>
                  <strong>{job.status === 'completed' ? 'Preview ready' : job.status === 'failed' ? 'Preview could not be prepared' : 'Preparing your preview'}</strong>
                  <small>{job.originalName} · Upload saved</small>
                </div>
                {job.status === 'processing' && <span className="processing-label">PROCESSING</span>}
              </div>
              {statusError && (
                <div className="status-recovery" role="alert">
                  <span>{statusError}</span>
                  <button className="text-button" type="button" onClick={() => void retryStatusCheck()} disabled={isCheckingStatus}>{isCheckingStatus ? 'Checking…' : 'Check again'}</button>
                </div>
              )}
              {job.status === 'failed' && (
                <div className="failure-detail">
                  <p>{job.error?.message || 'The source video was saved, but its playable preview could not be created.'}</p>
                  <p>Your uploaded source is preserved. Try another MP4, MOV, or WebM export.</p>
                  <button className="secondary-button" type="button" onClick={() => { setJob(null); clearSelectedFile(); fileInputRef.current?.click(); }}>Choose another video</button>
                </div>
              )}
              {job.status === 'completed' && (
                <div className="preview-ready-note" role="status">
                  <span>UPLOAD COMPLETE · PREVIEW READY</span><strong>Analysis has not started.</strong>
                </div>
              )}
            </div>
          )}

          {job?.status === 'completed' && job.source && job.derivative && (
            <SceneConfigurationEditor
              videoId={job.id}
              videoUrl={job.preview.url}
              sourceSha256={job.source.sha256}
              sourceWidth={job.source.media.width}
              sourceHeight={job.source.media.height}
              previewWidth={job.derivative.media.width}
              previewHeight={job.derivative.media.height}
              initialRuns={analysisRuns}
              onSave={saveSceneConfiguration}
              onCreateAnalysisRun={createAnalysisRun}
            />
          )}

          <div className="panel-footer">
            <span className="privacy-note"><span aria-hidden="true">◈</span> Original video is preserved as the source.</span>
            <div className="footer-actions">
              {file && !isUploading && <button className="text-button" type="button" onClick={clearSelectedFile}>Remove file</button>}
              <button className="primary-button" type="button" disabled={!file || !limits || isUploading} onClick={() => void uploadVideo()}>
                {isUploading ? 'Uploading…' : 'Upload video'} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </section>

        <div className="next-step" aria-label="Next step">
          <span className="next-step-number">02</span>
          <span><strong>Set up the scene</strong><small>Define the camera view after your preview is ready</small></span>
          <span className="lock-mark" aria-label="Not available yet">⌑</span>
        </div>
        <p className="disclaimer">A playable preview confirms upload and conversion only. Traffic analysis is a separate step.</p>
      </div>
      <footer className="page-footer"><span>MEDIA TRAFFIC</span><span>VIDEO WORKSPACE · MVP</span></footer>
    </main>
  );
}

export { formatBytes };
