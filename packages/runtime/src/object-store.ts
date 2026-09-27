import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RuntimeConfig } from "./config.js";

export interface ObjectStore {
  mode: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  authorizeUpload(key: string, contentType: string, size: number): Promise<string | null>;
}

export class LocalObjectStore implements ObjectStore {
  readonly mode = "local" as const;
  private readonly root: string;
  constructor(config: RuntimeConfig) {
    let resolved = resolve(config.localStoragePath);
    if (!existsSync(resolved)) {
      const upOne = resolve(process.cwd(), "..", config.localStoragePath);
      const upTwo = resolve(process.cwd(), "../..", config.localStoragePath);
      if (existsSync(upTwo)) {
        resolved = upTwo;
      } else if (existsSync(upOne)) {
        resolved = upOne;
      }
    }
    this.root = resolved;
  }
  async put(key: string, data: Buffer) { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, data, { flag: "wx" }); }
  async get(key: string) { return readFile(this.path(key)); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
  async authorizeUpload() { return null; }
  private path(key: string) { const result = resolve(this.root, key); if (!result.startsWith(this.root)) throw new Error("Caminho de objeto inválido."); return result; }
}

export class S3ObjectStore implements ObjectStore {
  readonly mode = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: RuntimeConfig) {
    if (!config.s3Bucket || !config.s3Region) throw new Error("S3_BUCKET e S3_REGION são obrigatórios.");
    this.bucket = config.s3Bucket;
    const clientConfig: S3ClientConfig = { region: config.s3Region, forcePathStyle: Boolean(config.s3Endpoint) };
    if (config.s3Endpoint) clientConfig.endpoint = config.s3Endpoint;
    if (config.s3AccessKeyId && config.s3SecretAccessKey) clientConfig.credentials = { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey };
    this.client = new S3Client(clientConfig);
  }
  async put(key: string, data: Buffer, contentType: string) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType })); }
  async get(key: string) { const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); return Buffer.from(await response.Body!.transformToByteArray()); }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async authorizeUpload(key: string, contentType: string, size: number) { return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: 300 }); }
}

export function createObjectStore(config: RuntimeConfig): ObjectStore { return config.storageMode === "s3" ? new S3ObjectStore(config) : new LocalObjectStore(config); }
