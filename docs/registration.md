# Tenant registration

POST /api/v1/auth/register is public. It uses User and the existing Tenant profile in PostgreSQL, and Redis for the OTP as explicitly requested. No schema changes or new migration are needed for this endpoint.

## Setup

1. Run npm.cmd install (npm.cmd avoids Windows PowerShell execution-policy errors).
2. Copy .env.example to .env if you do not already have .env. Replace the PostgreSQL, Redis and SMTP values with your own working configuration. Do not paste credentials into chat or commit .env.
3. Run npx.cmd prisma generate, then npx.cmd prisma migrate deploy against your intended database. This applies the existing initial migration; do not reset an existing database.
4. Run npm.cmd run dev.
5. Import postman/homi.postman_collection.json and postman/homi.local.postman_environment.json. Select Homi Local and set registrationEmail to your real inbox.

Required configuration:

- DATABASE_URL: your PostgreSQL connection string.
- REDIS_URL: your Redis connection string. Use rediss:// when your provider requires TLS. Alternatively unset REDIS_URL and configure REDIS_HOST, REDIS_PORT, REDIS_USER, REDIS_PASSWORD, REDIS_TLS. REDIS_URL takes precedence.
- SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, EMAIL_SENDER: your SMTP settings. For Gmail use your own App Password and email address. Port 587 uses SMTP_SECURE=false and required STARTTLS; port 465 uses SMTP_SECURE=true.
- PORT=5000 and BCRYPT_SALT_ROUNDS=12.
- Replace the example JWT secrets with independently generated secrets for the existing auth routes.

## Postman positive test

METHOD: POST
URL: http://localhost:5000/api/v1/auth/register
AUTH: No Auth
HEADERS: Content-Type: application/json
BODY:

~~~json
{
  "name": "Test Tenant",
  "email": "your-real-inbox@example.com",
  "password": "StrongPassword123!"
}
~~~

EXPECTED STATUS: 201
EXPECTED RESPONSE: success=true; data.user.role=TENANT; data.user.emailVerified=false; data.verificationRequired=true; data.otpExpiresInSeconds=600. No password, OTP, password hash, accessToken, refreshToken or Set-Cookie header. Check the inbox and spam folder for a six-digit code.

EXPECTED DATABASE: one User and one linked Tenant. Redis contains homi:otp:EMAIL_VERIFICATION:<user-id> with a bcrypt hash, purpose, attempts=0, creation/expiry times and TTL at most 600 seconds. Do not paste this record or OTP into shared logs.

## Negative tests

- Repeat a successful registration with the same email: 409, message User with this email already exists, errors=[]. Email matching ignores case and surrounding spaces.
- Set password to short or email to invalid: 400, message Validation failed, errors includes field details.
- Add role=ADMIN or role=OWNER: 400; clients cannot choose their role.
- After 10 schema-valid requests from one IP within 15 minutes: 429 with Retry-After=900. Invalid bodies are rejected before this registration rate counter.
- Unavailable Redis or rejected SMTP delivery: 503; no successful registration response. The PostgreSQL transaction rolls back; cleanup removes only that user-specific OTP key, or TTL expires it if cleanup is unavailable.

## Design and limits

User and Tenant are created in one nested Prisma query inside a transaction. Redis storage and SMTP delivery run before database commit; a known failure rolls back database writes and triggers Redis cleanup. PostgreSQL, Redis and SMTP do not share an atomic transaction. A process crash or ambiguous SMTP acknowledgment may leave an expiring orphan code/email; it cannot authenticate a missing user. A production outbox/recovery workflow can address this later.

Verification and resend endpoints are still pending. The verification endpoint must enforce attempts, expiration, purpose, single-use consumption and replay protection. Redis eviction/restart can remove OTPs, so the later resend endpoint is required. Users cannot log in or refresh tokens until verified; existing auth middleware also rejects unverified or deleted accounts.

Redis currently handles the registration rate limit as well as OTP storage. Proxy trust is intentionally unset; configure an exact trusted proxy setup during deployment to avoid treating all users behind a hosting proxy as one IP.

## Checks

TypeScript, ESM build, Prisma schema validation and seven automated tests were run. Tests use explicit PostgreSQL/Redis/email stubs and real hashing/Express HTTP handling. Live infrastructure validation remains pending credentials. No new commit has been created pending Postman confirmation.

## Learning explanation

What this endpoint does: ???? user ?? TENANT ?????? ???? ???, ?????? emailVerified=false ????? Email ? ?? ??????? OTP ?????? ??? ???? login token ??? ???

Execution flow: Request ? Zod Validation ? Redis rate limit ? Controller ? Service ? PostgreSQL + Redis + SMTP ? Response.

Important code: registerSchema input normalize ??? validate ???? randomInt secure OTP ???? ???? bcrypt password ??? OTP hash ???? prisma.$transaction-?? nested create User ??? Tenant ???? ???? Redis SET EX code-?? ????? ?? ????? ????? Prisma select ???? ?????? fields ???? ????

Database changes: PostgreSQL ? User ??? linked Tenant ???? ??? Redis ? expiring OTP record ??? IP rate counter ????? Prisma schema ???????? ?????

Video explanation: This endpoint registers a new tenant using their name, email, and password. We validate the input, normalize the email, and hash the password. The user starts unverified. We generate a six-digit code, store only its hash in Redis with a ten-minute expiry, and send the code by email. Registration returns no login tokens. Email verification must be completed before the account can log in.

Suggested commit: feat: implement tenant registration with Redis email OTP

## Latest connection verification ? October 8, 2026

Redis Cloud PING returned PONG; Gmail SMTP authentication passed without sending email; Neon User/Tenant queries succeeded. The real registration signup/email flow still awaits Postman confirmation. Repeat checks with npm.cmd run check:registration-connections. TLS is enabled by rediss:// or REDIS_TLS=true; current Redis Cloud URL is redis:// as supplied. Credentials remain only in ignored .env.

## Branded email test

Registration now sends personalized Homi HTML and plain text. Inspect the teal header, six-digit code, expiry matching the API/Redis TTL, security warning and footer on desktop and mobile. Use a fresh email address or your Gmail plus-address alias if your original email is already registered. Reset-password and welcome templates are prepared; their future auth flows have not been implemented. Visual rendering across email clients remains unverified until inbox testing.
