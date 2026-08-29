export function newerSnapshot(current, candidate) {
  if (!candidate?.capturedAt) return current ?? candidate;
  if (!current?.capturedAt) return candidate;
  const currentAt = Date.parse(current.capturedAt);
  const candidateAt = Date.parse(candidate.capturedAt);
  if (!Number.isFinite(candidateAt)) return current;
  return !Number.isFinite(currentAt) || candidateAt >= currentAt ? candidate : current;
}
