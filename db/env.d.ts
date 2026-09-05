declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    OWNER_ACCOUNT_USER_ID?: string;
    OWNER_EMAIL?: string;
    ALLOW_FIRST_USER_BOOTSTRAP?: string;
    TOKENROUTER_API_KEY?: string;
    PROVIDER_KEY_ENCRYPTION_KEY?: string;
    GOOGLE_DRIVE_CLIENT_ID?: string;
    GOOGLE_DRIVE_CLIENT_SECRET?: string;
    GOOGLE_DRIVE_REFRESH_TOKEN?: string;
    GOOGLE_DRIVE_ROOT_FOLDER_ID?: string;
  }
}
