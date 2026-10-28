import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UploadJob } from './media.js';
import { MediaError } from './media.js';

export type ScenePoint = { x: number; y: number };
export type SceneRegion = { x: number; y: number; width: number; height: number };
export type SceneGeometry = {
  vehicleRegion: SceneRegion;
  stopLine: { start: ScenePoint; end: ScenePoint };
  crossingDirection: 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left';
  signalRegion: SceneRegion;
  signalAssociation: string;
};
export type SceneConfigurationSnapshot = {
  schemaVersion: 1;
  id: string;
  source: { videoId: string; sha256: string; width: number; height: number };
  geometry: SceneGeometry;
  createdAt: string;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const directions = ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNormalizedPoint(value: unknown): value is ScenePoint {
  return isRecord(value)
    && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && value.x <= 1
    && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1;
}

function isNormalizedRegion(value: unknown): value is SceneRegion {
  return isRecord(value)
    && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0
    && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0
    && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0
    && typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0
    && value.x + value.width <= 1 && value.y + value.height <= 1;
}

export function invalidGeometryFields(value: unknown): string[] {
  const invalid: string[] = [];
  const geometry = isRecord(value) ? value : {};
  if (!isNormalizedRegion(geometry.vehicleRegion)) invalid.push('vehicleRegion');
  const line = geometry.stopLine;
  if (!isRecord(line) || !isNormalizedPoint(line.start) || !isNormalizedPoint(line.end)
    || (line.start.x === line.end.x && line.start.y === line.end.y)) invalid.push('stopLine');
  if (typeof geometry.crossingDirection !== 'string' || !directions.includes(geometry.crossingDirection as typeof directions[number])) invalid.push('crossingDirection');
  if (!isNormalizedRegion(geometry.signalRegion)) invalid.push('signalRegion');
  if (typeof geometry.signalAssociation !== 'string' || !geometry.signalAssociation.trim() || geometry.signalAssociation.length > 120) invalid.push('signalAssociation');
  return invalid;
}

function snapshotFromInput(value: unknown, videoId: string, upload: UploadJob): SceneConfigurationSnapshot {
  if (!isRecord(value)) throw new MediaError('INVALID_SCENE_CONFIGURATION', 'Send the scene configuration as a JSON object.', 400);
  const invalidFields = invalidGeometryFields(value.geometry);
  if (invalidFields.length) {
    throw new MediaError('SCENE_CONFIGURATION_INVALID', 'The scene configuration is incomplete or invalid.', 422, { invalidFields });
  }
  if (value.schemaVersion !== 1) throw new MediaError('SCENE_CONFIGURATION_VERSION_UNSUPPORTED', 'Use scene configuration schema version 1.', 422);
  if (typeof value.id !== 'string' || !uuidPattern.test(value.id)) throw new MediaError('INVALID_SCENE_CONFIGURATION_ID', 'The scene configuration ID must be a UUID.', 422);
  if (!isRecord(value.source)
    || value.source.videoId !== videoId
    || value.source.sha256 !== upload.source.sha256
    || value.source.width !== upload.source.media.width
    || value.source.height !== upload.source.media.height) {
    throw new MediaError('SCENE_SOURCE_MISMATCH', 'The configuration source must match the uploaded video identity, checksum, and dimensions.', 422);
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new MediaError('INVALID_SCENE_CONFIGURATION_TIMESTAMP', 'The scene configuration must include a valid creation timestamp.', 422);
  }

  const geometry = value.geometry as SceneGeometry;
  return structuredClone({
    schemaVersion: 1 as const,
    id: value.id,
    source: {
      videoId,
      sha256: upload.source.sha256,
      width: upload.source.media.width,
      height: upload.source.media.height,
    },
    geometry: {
      vehicleRegion: { ...geometry.vehicleRegion },
      stopLine: { start: { ...geometry.stopLine.start }, end: { ...geometry.stopLine.end } },
      crossingDirection: geometry.crossingDirection,
      signalRegion: { ...geometry.signalRegion },
      signalAssociation: geometry.signalAssociation.trim(),
    },
    createdAt: new Date(value.createdAt).toISOString(),
  });
}

function configurationDirectory(dataDirectory: string, videoId: string): string {
  return path.join(dataDirectory, 'videos', videoId, 'configurations');
}

export async function saveSceneConfiguration(
  dataDirectory: string,
  videoId: string,
  upload: UploadJob,
  value: unknown,
): Promise<SceneConfigurationSnapshot> {
  const snapshot = snapshotFromInput(value, videoId, upload);
  const directory = configurationDirectory(dataDirectory, videoId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path.join(directory, `${snapshot.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MediaError('SCENE_CONFIGURATION_IMMUTABLE', 'This scene configuration ID already exists. Save edits as a new configuration snapshot.', 409);
    }
    throw error;
  }
  return snapshot;
}
