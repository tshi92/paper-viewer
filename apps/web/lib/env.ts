import { z } from "zod";

/**
 * Empty string counts as "unconfigured" for every optional or defaulted
 * variable: dashboards (Vercel) and .env templates make it far too easy to
 * ship `VAR=""`, and one such value must not take the whole app down at the
 * first getEnv() call.
 */
function blankAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  APP_URL: blankAsUndefined(z.string().url().default("http://localhost:3000")),
  S3_ENDPOINT: blankAsUndefined(z.string().url().optional()),
  S3_REGION: blankAsUndefined(z.string().min(1).default("us-east-1")),
  S3_ACCESS_KEY_ID: blankAsUndefined(z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY: blankAsUndefined(z.string().min(1).optional()),
  S3_BUCKET: blankAsUndefined(z.string().min(1).default("paper-pdfs")),
  S3_FORCE_PATH_STYLE: blankAsUndefined(z.enum(["true", "false"]).default("true")),
  BLOB_READ_WRITE_TOKEN: blankAsUndefined(z.string().min(1).optional()),
  MAX_PDF_UPLOAD_MB: blankAsUndefined(z.coerce.number().int().positive().default(50)),
  INGEST_API_KEY: z.string().min(16),
  // Vercel Cron authentication. When unconfigured, /api/cron/* simply 404s; it
  // is off by default locally so the endpoint is never left exposed.
  CRON_SECRET: blankAsUndefined(z.string().min(16).optional()),
  RESEND_API_KEY: blankAsUndefined(z.string().min(1).optional()),
  LLM_API_KEY: blankAsUndefined(z.string().min(1).optional()),
  LLM_BASE_URL: blankAsUndefined(z.string().url().default("https://api.deepseek.com")),
  LLM_MODEL: blankAsUndefined(z.string().default("deepseek-v4-pro"))
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export function getS3Config() {
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  };
}

export { type Env };
