export type RuntimeConfig = {
  sessionTtlSeconds: number;
  heartbeatGraceSeconds: number;
  maxFileBytes: number;
  maxSessionBytes: number;
  maxStatements: number;
  maxPdfPages: number;
  maxSessionsPerIp: number;
  maxSessionsPerHour: number;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  trustProxy: boolean;
  redisUrl?: string;
  storageMode: "local" | "s3";
  localStoragePath: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  antivirusRequired: boolean;
  antivirusCommand: string;
  pdftoppmCommand: string;
  tesseractCommand: string;
  ocrLanguage: string;
};

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const ocrLanguage = env.PDF_OCR_LANGUAGE || "por";
  if (!ocrLanguage.split("+").includes("por")) throw new Error("PDF_OCR_LANGUAGE deve incluir o idioma português (por).");
  const config: RuntimeConfig = {
    sessionTtlSeconds: positiveInt(env.SESSION_TTL_SECONDS, 7200),
    heartbeatGraceSeconds: positiveInt(env.HEARTBEAT_GRACE_SECONDS, 300),
    maxFileBytes: positiveInt(env.MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
    maxSessionBytes: positiveInt(env.MAX_SESSION_SIZE_MB, 75) * 1024 * 1024,
    maxStatements: positiveInt(env.MAX_STATEMENT_FILES, 5),
    maxPdfPages: positiveInt(env.MAX_PDF_PAGES, 100),
    maxSessionsPerIp: positiveInt(env.MAX_ACTIVE_SESSIONS_PER_IP, 1),
    maxSessionsPerHour: positiveInt(env.MAX_SESSIONS_PER_HOUR, 3),
    maxConcurrentJobs: positiveInt(env.MAX_CONCURRENT_JOBS, 2),
    maxQueuedJobs: positiveInt(env.MAX_QUEUED_JOBS, 20),
    trustProxy: env.TRUST_PROXY === "true",
    storageMode: env.STORAGE_MODE === "s3" ? "s3" : "local",
    localStoragePath: env.LOCAL_STORAGE_PATH || ".local-storage",
    antivirusRequired: env.ANTIVIRUS_REQUIRED === "true",
    antivirusCommand: env.ANTIVIRUS_COMMAND || "clamscan",
    pdftoppmCommand: env.PDF_RENDER_COMMAND || "pdftoppm",
    tesseractCommand: env.PDF_OCR_COMMAND || "tesseract",
    ocrLanguage,
  };
  assignOptional(config, "redisUrl", env.REDIS_URL);
  assignOptional(config, "s3Bucket", env.S3_BUCKET);
  assignOptional(config, "s3Region", env.S3_REGION);
  assignOptional(config, "s3Endpoint", env.S3_ENDPOINT);
  assignOptional(config, "s3AccessKeyId", env.S3_ACCESS_KEY_ID);
  assignOptional(config, "s3SecretAccessKey", env.S3_SECRET_ACCESS_KEY);
  return config;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Configuração numérica inválida: ${raw}.`);
  return parsed;
}

function assignOptional<K extends keyof RuntimeConfig>(config: RuntimeConfig, key: K, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) Object.assign(config, { [key]: normalized });
}
