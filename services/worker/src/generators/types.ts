/**
 * Shared types for Stage B artifact generators.
 */

export interface ArtifactJobData {
  runId: string;
  bundleId: string;
  orgId: string;
  projectId: string;
  artifactKey: string;
  params: Record<string, unknown>;
}

export interface GeneratorResult {
  artifactKey: string;
  fileObjectId: string;
  fileName: string;
  byteSize: number;
}
