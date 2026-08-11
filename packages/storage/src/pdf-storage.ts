import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorageConfig, StoredObject } from "./object-storage";

export type PdfObjectKeyInput = {
  workspaceId: string;
  paperId: string;
  sha256: string;
};

export function createPdfObjectKey(input: PdfObjectKeyInput): string {
  return `workspaces/${input.workspaceId}/papers/${input.paperId}/files/${input.sha256}.pdf`;
}

export function createS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

export async function putPdfObject(params: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<StoredObject> {
  await params.client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType
    })
  );

  return {
    key: params.key,
    contentType: params.contentType,
    byteLength: params.body.byteLength
  };
}

export async function getPdfObject(params: { client: S3Client; bucket: string; key: string }) {
  return params.client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key
    })
  );
}
