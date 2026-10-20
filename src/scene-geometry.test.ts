import { describe, expect, it } from 'vitest';
import {
  getContainedVideoRect,
  isValidSceneGeometry,
  toMediaPoint,
  toPlayerPoint,
  type SceneGeometry,
} from './scene-geometry';

const validGeometry: SceneGeometry = {
  vehicleRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  stopLine: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.6 } },
  crossingDirection: 'top-to-bottom',
  signalRegion: { x: 0.78, y: 0.08, width: 0.14, height: 0.2 },
  signalAssociation: 'traffic-signal-1',
};

describe('normalized scene geometry', () => {
  it('accepts complete, in-frame movement geometry with an associated signal', () => {
    expect(isValidSceneGeometry(validGeometry)).toEqual([]);
  });

  it('reports each missing or invalid field needed before analysis', () => {
    expect(isValidSceneGeometry({
      vehicleRegion: { x: 0.8, y: 0.8, width: 0.4, height: 0.4 },
      stopLine: { start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 } },
      crossingDirection: null,
      signalRegion: null,
      signalAssociation: '',
    })).toEqual(['vehicleRegion', 'stopLine', 'crossingDirection', 'signalRegion', 'signalAssociation']);
  });

  it('maps frame coordinates through contain letterboxing and its inverse', () => {
    const frame = getContainedVideoRect(800, 600, 1920, 1080);
    expect(frame).toEqual({ left: 0, top: 75, width: 800, height: 450 });
    expect(toPlayerPoint({ x: 0.25, y: 0.5 }, frame)).toEqual({ x: 200, y: 300 });
    expect(toMediaPoint({ x: 200, y: 300 }, frame)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('keeps the same normalized marks when the player is resized', () => {
    const mark = { x: 0.3, y: 0.65 };
    const large = toPlayerPoint(mark, getContainedVideoRect(800, 600, 1920, 1080));
    const small = toPlayerPoint(mark, getContainedVideoRect(400, 500, 1920, 1080));
    expect(large).not.toEqual(small);
    expect(toMediaPoint(small, getContainedVideoRect(400, 500, 1920, 1080))).toEqual(mark);
  });
});
