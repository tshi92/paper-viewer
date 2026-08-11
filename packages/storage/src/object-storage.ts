export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

export type StoredObject = {
  key: string;
  contentType: string;
  byteLength: number;
};
