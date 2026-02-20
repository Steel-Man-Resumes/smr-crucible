import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { insert } from "./db";

function getS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function getBucket() {
  return process.env.R2_BUCKET_NAME || "crucible-files";
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
