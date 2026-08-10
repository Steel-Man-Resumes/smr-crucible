import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { insert } from "./db";

// Exported so secureObject.ts (the encrypted-object platform) can reuse the
// same R2 client/credential setup rather than re-deriving it.
export function getS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export function getBucket() {
  return process.env.R2_BUCKET_NAME || "crucible-files";
}

// Secure (encrypted-at-rest) objects can live in a dedicated private bucket
// via R2_SECURE_BUCKET_NAME; falls back to the shared bucket if unset --
// objects are ciphertext either way, so co-locating is safe, just less
// separable for a future bucket-level policy split.
export function getSecureBucket() {
  return process.env.R2_SECURE_BUCKET_NAME || getBucket();
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
