import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessCrossingEvents } from '../../server/crossing-analysis.ts';
import { assembleSignalTimeline, classifySignalObservation } from '../../server/signal-analysis.ts';
import { assembleTrackResult } from '../../server/traffic-analysis.ts';

const reportDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(reportDirectory, '../..');
const demoDirectory = path.join(repositoryRoot, 'example/demo-traffic-video');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const trackingBytes = await readFile(path.join(reportDirectory, 'yolo-tracking.json'));
const tracking = JSON.parse(trackingBytes);
const manifest = await readJson('example/demo-traffic-video/manifest.json');
const configuration = await readJson('reports/per112/scene-configuration.json');
const groundTruthBytes = await readFile(path.join(demoDirectory, manifest.groundTruth.path));
const groundTruth = JSON.parse(groundTruthBytes);

if (manifest.video.sha256 !== sha256(await readFile(path.join(demoDirectory, manifest.video.path)))) {
  throw new Error('Manifest source hash does not match the video supplied to inference.');
}
if (manifest.groundTruth.sha256 !== sha256(groundTruthBytes)) {
  throw new Error('Manifest annotation hash does not match the frozen ground truth.');
}

const signalObservations = tracking.signalPixelObservations.map((item) => classifySignalObservation(
  item.frameIndex,
  item.timeSeconds,
  item.colorScores,
  item.signalRegionTooSmall ?? false,
));
const signalTimeline = assembleSignalTimeline({ durationSeconds: manifest.video.durationSeconds, observations: signalObservations });
const trackResult = assembleTrackResult({ width: tracking.width, height: tracking.height, frames: tracking.frames });
if (configuration.source.sha256 !== manifest.video.sha256
  || configuration.source.width !== manifest.video.width
  || configuration.source.height !== manifest.video.height) {
  throw new Error('Scene configuration source does not match the source video manifest.');
}
const assessments = assessCrossingEvents({ trackResult, configuration, signalTimeline });
const redAnnotation = groundTruth.events.find((event) => event.type === 'red_crossing');
const greenAnnotation = groundTruth.events.find((event) => event.type === 'green_crossing');
const stopAnnotation = groundTruth.events.find((event) => event.type === 'correct_stop');
const redMidpoint = (redAnnotation.startSeconds + redAnnotation.endSeconds) / 2;
const withinAnnotation = assessments.filter((item) => item.outcome === 'candidate'
  && item.crossingTimeSeconds >= redAnnotation.startSeconds - 1 / 30
  && item.crossingTimeSeconds <= redAnnotation.endSeconds + 1 / 30);
const greenWindowCandidates = assessments.filter((item) => item.outcome === 'candidate'
  && item.timeRange.endSeconds >= greenAnnotation.startSeconds
  && item.timeRange.startSeconds <= greenAnnotation.endSeconds);
const otherRedCandidates = assessments.filter((item) => item.outcome === 'candidate' && !withinAnnotation.includes(item));
const greenObservation = trackResult.tracks.flatMap((track) => track.observations
  .filter((observation) => observation.frameIndex === 30 && observation.box.x > 900 && observation.box.y < 800)
  .map((observation) => ({ trackId: track.trackId, observation })))[0];
const stopObservation = trackResult.tracks.flatMap((track) => track.observations
  .filter((observation) => observation.frameIndex === 105 && observation.box.x < 1000 && observation.box.y > 650)
  .map((observation) => ({ trackId: track.trackId, observation })))[0];
if (!greenObservation || !stopObservation) throw new Error('Could not associate YOLO tracks to independently reviewed green/stop frame regions.');
const greenTrackAssessments = assessments.filter((item) => item.trackId === greenObservation.trackId
  && item.timeRange.endSeconds >= greenAnnotation.startSeconds
  && item.timeRange.startSeconds <= greenAnnotation.endSeconds);
const stopTrackRedWindowAssessments = assessments.filter((item) => item.trackId === stopObservation.trackId
  && item.timeRange.endSeconds > stopAnnotation.startSeconds
  && item.timeRange.startSeconds < stopAnnotation.endSeconds);
const annotationSignalTimelineMatches = groundTruth.signalTimeline.length === signalTimeline.intervals.length
  && groundTruth.signalTimeline.every((expected, index) => {
    const observed = signalTimeline.intervals[index];
    const expectedState = expected.state === 'amber' ? 'yellow' : expected.state;
    return observed.state === expectedState
      && observed.startFrameIndex === expected.startFrame
      && observed.endFrameExclusive === expected.endFrameExclusive;
  });
const redCandidateTimingErrors = withinAnnotation.map((item) => Math.abs(item.crossingTimeSeconds - redMidpoint));

if (!annotationSignalTimelineMatches) {
  throw new Error('Pixel-derived signal intervals do not match the independently annotated timeline.');
}
if (withinAnnotation.length !== 1 || redCandidateTimingErrors[0] > 1 / 30) {
  throw new Error(`Expected exactly one red candidate within one frame of its annotation; got ${withinAnnotation.length}.`);
}
if (greenWindowCandidates.length !== 0
  || greenTrackAssessments.length === 0
  || greenTrackAssessments.some((item) => item.outcome !== 'not_candidate' || item.reason !== 'signal_not_red')) {
  throw new Error('The green crossing control must produce no red candidate and be classified as signal_not_red.');
}
if (stopTrackRedWindowAssessments.length !== 0 || otherRedCandidates.length !== 0) {
  throw new Error('The stopped vehicle or another track produced an unexpected red candidate during the red interval.');
}

const output = {
  schemaVersion: 1,
  sourceSha256: manifest.video.sha256,
  groundTruthSha256: manifest.groundTruth.sha256,
  trackingOutputSha256: sha256(trackingBytes),
  configuration,
  detectorTrackingProvenance: tracking.provenance,
  signalTimeline: {
    stabilityRule: signalTimeline.stabilityRule,
    intervals: signalTimeline.intervals,
  },
  redAnnotation: { ...redAnnotation, midpointSeconds: redMidpoint },
  greenControl: { annotation: greenAnnotation, manuallyMatchedTrackId: greenObservation.trackId, frameObservation: greenObservation.observation },
  stopControl: { annotation: stopAnnotation, manuallyMatchedTrackId: stopObservation.trackId, frameObservation: stopObservation.observation },
  trackSummary: trackResult.tracks.map((track) => ({
    trackId: track.trackId,
    firstSeenSeconds: track.firstSeenSeconds,
    lastSeenSeconds: track.lastSeenSeconds,
    observations: track.observations.length,
    gaps: track.gaps,
    firstObservation: track.observations[0],
    lastObservation: track.observations.at(-1),
  })),
  crossingAssessments: assessments,
  acceptanceSummary: {
    redCandidatesWithinOneFrameOfAnnotation: withinAnnotation.length,
    redCandidateTimingErrorSeconds: redCandidateTimingErrors,
    annotationSignalTimelineMatches,
    candidatesDuringGreenAnnotationWindow: greenWindowCandidates.length,
    greenTrackControlAssessments: greenTrackAssessments.map((item) => ({ outcome: item.outcome, reason: item.reason, crossingTimeSeconds: item.crossingTimeSeconds })),
    stopTrackAssessmentsDuringRedStopWindow: stopTrackRedWindowAssessments.map((item) => ({ outcome: item.outcome, reason: item.reason, crossingTimeSeconds: item.crossingTimeSeconds })),
    additionalCandidateCountOutsideRedAnnotation: otherRedCandidates.length,
  },
};
await writeFile(path.join(reportDirectory, 'crossing-assessments.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  signalIntervals: output.signalTimeline.intervals,
  tracks: output.trackSummary.map(({ trackId, firstSeenSeconds, lastSeenSeconds, observations }) => ({ trackId, firstSeenSeconds, lastSeenSeconds, observations })),
  crossingAssessments: assessments.map((item) => ({ outcome: item.outcome, reason: item.reason, crossingTimeSeconds: item.crossingTimeSeconds, frameRange: item.frameRange, trackId: item.trackId })),
  acceptanceSummary: output.acceptanceSummary,
}, null, 2));
