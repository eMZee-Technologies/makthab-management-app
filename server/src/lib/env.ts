import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const DB_PROVIDERS = ["sqlite", "postgresql"] as const;
type DatabaseProvider = (typeof DB_PROVIDERS)[number];

function databaseProvider(): DatabaseProvider {
  const v = process.env.DATABASE_PROVIDER ?? "sqlite";
  if (!(DB_PROVIDERS as readonly string[]).includes(v)) {
    throw new Error(`Invalid DATABASE_PROVIDER: "${v}" (expected "sqlite" or "postgresql")`);
  }
  return v as DatabaseProvider;
}

/** Well-known placeholders from .env.example — never acceptable in production. */
export const INSECURE_JWT_DEFAULTS = new Set([
  "dev-access-secret-change-me",
  "dev-refresh-secret-change-me",
]);

/**
 * Resolve a JWT signing secret. In production the var must be set explicitly
 * and must not equal the documented development placeholders — otherwise any
 * reader of .env.example can forge tokens.
 */
export function resolveJwtSecret(
  name: "JWT_SECRET" | "JWT_REFRESH_SECRET",
  value: string | undefined,
  nodeEnv: string,
  devFallback: string
): string {
  const isProd = nodeEnv === "production";
  if (isProd) {
    if (value === undefined || value === "") {
      throw new Error(`Missing required env var: ${name} (must be set in production)`);
    }
    if (INSECURE_JWT_DEFAULTS.has(value)) {
      throw new Error(
        `${name} is set to a documented development default; refuse to start in production`
      );
    }
    return value;
  }
  if (value !== undefined && value !== "") return value;
  return devFallback;
}

const STORAGE_BACKENDS = ["local", "s3"] as const;
type StorageBackend = (typeof STORAGE_BACKENDS)[number];

function storageBackend(): StorageBackend | undefined {
  const v = process.env.STORAGE_BACKEND;
  if (v === undefined || v === "") return undefined;
  if (!(STORAGE_BACKENDS as readonly string[]).includes(v)) {
    throw new Error(`Invalid STORAGE_BACKEND: "${v}" (expected "local" or "s3")`);
  }
  return v as StorageBackend;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  jwtSecret: resolveJwtSecret("JWT_SECRET", process.env.JWT_SECRET, nodeEnv, "dev-access-secret-change-me"),
  jwtRefreshSecret: resolveJwtSecret(
    "JWT_REFRESH_SECRET",
    process.env.JWT_REFRESH_SECRET,
    nodeEnv,
    "dev-refresh-secret-change-me"
  ),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "7d",
  // "walink" (default): client-side wa.me click-to-chat, text-only, no
  // account needed. "business-api": server sends the PDF directly via the
  // Meta Cloud API — requires the three vars below.
  whatsappGateway: process.env.WHATSAPP_GATEWAY ?? "walink",
  whatsappBusinessApiToken: process.env.WHATSAPP_BUSINESS_API_TOKEN || undefined,
  whatsappBusinessPhoneNumberId: process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID || undefined,
  whatsappBusinessApiVersion: process.env.WHATSAPP_BUSINESS_API_VERSION ?? "v21.0",
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  databaseProvider: databaseProvider(),
  // Optional outbound delivery for OTP / admin alerts (MVP logs when unset).
  smtpHost: process.env.SMTP_HOST || undefined,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpUser: process.env.SMTP_USER || undefined,
  smtpPass: process.env.SMTP_PASS || undefined,
  smtpFrom: process.env.SMTP_FROM || undefined,
  smsProvider: process.env.SMS_PROVIDER || undefined,
  smsApiKey: process.env.SMS_API_KEY || undefined,
  // Login lockout after N consecutive failures (0 disables lockout).
  loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? 8),
  loginLockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15),
  // Default role assigned on self-signup (admin may override on approve).
  signupDefaultRole: process.env.SIGNUP_DEFAULT_ROLE ?? "Teacher",
  // File storage: omit STORAGE_BACKEND to auto-select (s3 in production, local otherwise).
  storageBackend: storageBackend(),
  localUploadPath: process.env.LOCAL_UPLOAD_PATH || undefined,
  s3Bucket: process.env.S3_BUCKET || undefined,
  awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
};

export const isProd = env.nodeEnv === "production";
