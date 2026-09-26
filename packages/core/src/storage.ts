import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { insert } from "./db";

interface R2Config {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket: string;
  secureBucket?: string;
}

function requiredPreviewValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Preview object storage is disabled until ${name} is configured.`);
  return value;
}

function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * True for any Vercel deployment that is not Production. A Vercel runtime with
 * VERCEL_ENV missing counts as Preview, so a missing system variable fails
 * closed instead of falling through to the general credentials.
 */
export function isNonProductionVercel(): boolean {
  const env = envValue("VERCEL_ENV");
  if (env === "preview") return true;
  if (env === "production" || env === "development") return false;
  return envValue("VERCEL") === "1";
}

// Preview bucket names must say so. Production buckets never do, so this holds
// even when the general R2_* variables are absent from the Preview scope and
// there is nothing to compare against.
const PREVIEW_BUCKET_PATTERN = /preview/i;

/**
 * Resolve object storage without allowing Vercel Preview to fall through to
 * the general (Production) credentials or bucket. Preview must use a separate
 * bucket and bucket-scoped credentials. The bucket-scoped token in Cloudflare
 * is the real boundary; these checks catch misconfiguration.
 */
export function getR2Config(): R2Config {
  if (!isNonProductionVercel()) {
    return {
      endpoint: envValue("R2_ENDPOINT"),
      accessKeyId: envValue("R2_ACCESS_KEY_ID"),
      secretAccessKey: envValue("R2_SECRET_ACCESS_KEY"),
      bucket: envValue("R2_BUCKET_NAME") || "crucible-files",
      secureBucket: envValue("R2_SECURE_BUCKET_NAME"),
    };
  }

  const config: R2Config = {
    endpoint: requiredPreviewValue("R2_PREVIEW_ENDPOINT"),
    accessKeyId: requiredPreviewValue("R2_PREVIEW_ACCESS_KEY_ID"),
    secretAccessKey: requiredPreviewValue("R2_PREVIEW_SECRET_ACCESS_KEY"),
    bucket: requiredPreviewValue("R2_PREVIEW_BUCKET_NAME"),
    secureBucket: envValue("R2_PREVIEW_SECURE_BUCKET_NAME"),
  };

  const generalBuckets = new Set(
    ["crucible-files", envValue("R2_BUCKET_NAME"), envValue("R2_SECURE_BUCKET_NAME")]
      .filter((b): b is string => Boolean(b))
      .map((b) => b.toLowerCase())
  );
  for (const bucket of [config.bucket, config.secureBucket]) {
    if (!bucket) continue;
    if (generalBuckets.has(bucket.toLowerCase())) {
      throw new Error("Preview object storage must use a bucket separate from the general R2 buckets.");
    }
    if (!PREVIEW_BUCKET_PATTERN.test(bucket)) {
      throw new Error("Preview object storage bucket names must contain \"preview\".");
    }
  }
  const generalKey = envValue("R2_ACCESS_KEY_ID");
  if (generalKey && config.accessKeyId === generalKey) {
    throw new Error("Preview object storage must use an access key separate from the general R2 key.");
  }
  const generalSecret = envValue("R2_SECRET_ACCESS_KEY");
  if (generalSecret && config.secretAccessKey === generalSecret) {
    throw new Error("Preview object storage must use a secret key separate from the general R2 secret.");
  }

  return config;
}

/**
 * Guard for operations that take the bucket from a stored row (secure_object,
 * deletion_task) rather than from getBucket(). In Preview, a row naming any
 * bucket other than the configured Preview buckets is refused.
 */
export function assertBucketAllowed(bucket: string): void {
  if (!isNonProductionVercel()) return;
  const config = getR2Config();
  const allowed = [config.bucket, config.secureBucket].filter(Boolean);
  if (!allowed.includes(bucket.trim())) {
    throw new Error("Preview object storage refused a bucket outside its configured Preview buckets.");
  }
}

// Exported so secureObject.ts (the encrypted-object platform) can reuse the
// same R2 client/credential setup rather than re-deriving it.
export function getS3Client() {
  const config = getR2Config();
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId!,
      secretAccessKey: config.secretAccessKey!,
    },
  });
}

export function getBucket() {
  return getR2Config().bucket;
}

// Secure (encrypted-at-rest) objects can live in a dedicated private bucket
// via R2_SECURE_BUCKET_NAME in Production/local or R2_PREVIEW_SECURE_BUCKET_NAME
// in Vercel Preview. Preview falls back only to its separately configured
// Preview bucket, never to the general Production bucket.
export function getSecureBucket() {
  const config = getR2Config();
  return config.secureBucket || config.bucket;
}

export interface FileObjectRecord {
  id: string;
  org_id: string;
  bucket: string;
  object_key: string;
  byte_size: number;
  mime_type: string;
  sha256: string | null;
  created_at: string;
}

export async function uploadFile(
  orgId: string,
  key: string,
  buffer: Buffer,
  mimeType: string,
  sha256?: string | null
): Promise<FileObjectRecord> {
  const client = getS3Client();
  const bucket = getBucket();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return createFileObject(orgId, bucket, key, buffer.length, mimeType, sha256 ?? null);
}

export async function getSignedUrl(
  key: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = getS3Client();
  const bucket = getBucket();

  return awsGetSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

export async function createFileObject(
  orgId: string,
  bucket: string,
  key: string,
  byteSize: number,
  mimeType: string,
  sha256: string | null
): Promise<FileObjectRecord> {
  return insert<FileObjectRecord>("file_object", {
    org_id: orgId,
    bucket,
    object_key: key,
    byte_size: byteSize,
    mime_type: mimeType,
    sha256,
  });
}
