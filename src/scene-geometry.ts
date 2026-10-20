export type NormalizedPoint = { x: number; y: number };
export type NormalizedRegion = { x: number; y: number; width: number; height: number };
export type SceneGeometry = {
  vehicleRegion: NormalizedRegion | null;
  stopLine: { start: NormalizedPoint; end: NormalizedPoint } | null;
  crossingDirection: 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left' | null;
  signalRegion: NormalizedRegion | null;
  signalAssociation: string;
};
export type PlayerRect = { left: number; top: number; width: number; height: number };

function isNormalizedPoint(point: NormalizedPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function isNormalizedRegion(region: NormalizedRegion | null): region is NormalizedRegion {
  return Boolean(region)
    && Number.isFinite(region!.x) && Number.isFinite(region!.y)
    && Number.isFinite(region!.width) && Number.isFinite(region!.height)
    && region!.x >= 0 && region!.y >= 0 && region!.width > 0 && region!.height > 0
    && region!.x + region!.width <= 1 && region!.y + region!.height <= 1;
}

export function isValidSceneGeometry(geometry: SceneGeometry): string[] {
  const invalid: string[] = [];
  if (!isNormalizedRegion(geometry.vehicleRegion)) invalid.push('vehicleRegion');
  const line = geometry.stopLine;
  if (!line || !isNormalizedPoint(line.start) || !isNormalizedPoint(line.end)
    || (line.start.x === line.end.x && line.start.y === line.end.y)) invalid.push('stopLine');
  if (!geometry.crossingDirection) invalid.push('crossingDirection');
  if (!isNormalizedRegion(geometry.signalRegion)) invalid.push('signalRegion');
  if (!geometry.signalAssociation.trim()) invalid.push('signalAssociation');
  return invalid;
}

export function getContainedVideoRect(containerWidth: number, containerHeight: number, mediaWidth: number, mediaHeight: number): PlayerRect {
  if (![containerWidth, containerHeight, mediaWidth, mediaHeight].every(Number.isFinite)
    || containerWidth <= 0 || containerHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function toPlayerPoint(point: NormalizedPoint, frame: PlayerRect): NormalizedPoint {
  return { x: frame.left + point.x * frame.width, y: frame.top + point.y * frame.height };
}

export function toMediaPoint(point: NormalizedPoint, frame: PlayerRect): NormalizedPoint {
  if (frame.width <= 0 || frame.height <= 0) return { x: Number.NaN, y: Number.NaN };
  return { x: (point.x - frame.left) / frame.width, y: (point.y - frame.top) / frame.height };
}
