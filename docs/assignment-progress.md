# Assignment progress

## Current endpoint

| Endpoint | Implementation | Local verification | Postman | Commit |
| --- | --- | --- | --- | --- |
| POST /api/v1/auth/register | IN PROGRESS | DONE: static/build + 7 stubbed automated tests; live signup pending Postman | NOT STARTED | NOT STARTED |

Registration uses Redis for OTP storage per user instruction, superseding the original separate Prisma Otp model requirement. TTL is 600 seconds. Verification/resend endpoints are NOT STARTED; attempt checking and single-use consumption will be added with verification.

## Requirements coverage

| Area | Status | Notes |
| --- | --- | --- |
| Database | IN PROGRESS | Existing User/Tenant models and initial migration; real connection unverified |
| Authentication | IN PROGRESS | Registration first; existing login/refresh/profile remain partial |
| Owner approval, properties, rooms | NOT STARTED | Pending authentication |
| Viewing, rental, reservations, tenancy | NOT STARTED | One active tenancy per room planned |
| Payment gateway | NOT STARTED | Real credentials required later |
| Roommate, maintenance, admin reporting/audit | NOT STARTED | Pending |
| Security | IN PROGRESS | Registration validation, Redis rate limit, verification guards, safe errors |
| Postman documentation | IN PROGRESS | Registration collection/environment |
| Deployment | NOT STARTED | No hosting configuration supplied |
| Video walkthrough | NOT STARTED | Endpoint script in registration guide |
| Commits | IN PROGRESS | Two existing commits; no new commit until checks pass |

## Environment blockers

No local .env was present at inspection. PostgreSQL, Redis and SMTP integration checks require real configuration. Never treat dependency stubs as real integration verification.

## Next endpoints (one per confirmed Postman test)

Verify email; resend OTP; login; refresh rotation; logout; current user; Google; forgot password; verify reset OTP; reset password; owner application; admin review; user management; property/room workflows; viewing/rental; payment/tenancy; roommate/maintenance/reporting.

## Verification evidence

- Installed Prisma/client/adapter: 7.10.0 (within existing ^7.9.1 ranges); npm lockfile added for reproducibility.
- Prisma client generated and schema validation passed; no schema changes.
- TypeScript and ESM build passed.
- Lint exited successfully with three existing warnings and informational diagnostics.
- Seven registration tests passed using explicit infrastructure stubs.
- Live PostgreSQL/Redis/SMTP connection checks: DONE. End-to-end registration and Postman confirmation remain IN PROGRESS.
- Broken healthcare seed replaced with a safe admin seed function to restore compilation; CLI wiring and real seeding are still pending.
- Original user deletions were preserved. No commits made.

Registration refactor: all auth service functions now live in src/app/module/auth/auth.service.ts using plain async functions and shared imports. The separate registration.service.ts and production dependency factory were removed at user request.

Registration readability: renamed service/controller to registerUser and payload to IRegisterUserPayload. Added sequential steps, descriptive variable names, named OTP lifetime, and direct password/OTP hashing. Registration still forces TENANT.

## Connection readiness ? October 8, 2026

- Redis Cloud URL configured only in ignored .env; actual application client returned PONG.
- TLS supported through rediss:// or REDIS_TLS=true, including when REDIS_URL is used. Current provider URL uses redis:// as supplied.
- Actual Gmail SMTP transport authentication verified; no email sent.
- Actual Neon User/Tenant queries succeeded; registration tables ready.
- TypeScript, build and all seven automated regression tests passed.
- Postman registration confirmation remains NOT STARTED. No other endpoint started.
- Repeat safe infrastructure checks: npm.cmd run check:registration-connections. No raw connection errors/credentials are printed.

## HTML email templates

- DONE: reusable verification OTP, reset-password OTP and optional welcome templates with inline styles, table layouts, escaped names, and HTML/plain-text content.
- DONE: registration passes name, OTP and the same expiry used by Redis to Nodemailer.
- DONE: five template tests, seven registration tests, TypeScript, build, targeted lint and live SMTP connectivity checks.
- NOT STARTED: resend/forgot-password endpoints; reusable sendVerificationEmail and sendResetPasswordEmail are ready for these future flows. Welcome email is prepared but not sent automatically.
- IN PROGRESS: inbox rendering and registration Postman confirmation; no new endpoint implemented.

## User Postman evidence ? October 8, 2026

- DONE: user supplied a successful POST /api/v1/auth/register response: HTTP 201 envelope, TENANT role, emailVerified=false, verificationRequired=true, 600-second expiry and no login tokens.
- IN PROGRESS: user confirmation of Gmail OTP delivery and HTML appearance is still pending.
- Next endpoint remains paused at the user testing checkpoint; verify-email has not been started.

## Email verification endpoint

- Registration and branded OTP delivery: DONE, user confirmed receipt and committed changes.
- POST /api/v1/auth/verify-email: IN PROGRESS pending user Postman test.
- DONE: strict validation, five-attempt atomic Redis limit, secure bcrypt comparison, conditional transactional User update, atomic Redis code consumption, safe response and no token issuance.
- DONE: TypeScript/build; five verification tests with real isolated Redis keys and stubbed PostgreSQL writes, and seven registration regression tests. No real user verified by the automated tests.
- DONE: Postman request/examples and blank secret verificationOtp environment variable.
- Commit: NOT STARTED for this endpoint. Resend OTP remains NOT STARTED.

Verification debugging: read-only check confirmed the original test account is active/unverified and its Redis OTP record is missing. A fresh registration code is required to retry. Verification remains IN PROGRESS pending Postman confirmation.

## Resend verification OTP

- DONE: User supplied successful email verification response; verify-email Postman positive test confirmed.
- IN PROGRESS: POST /api/v1/auth/resend-otp awaiting Postman confirmation.
- DONE: replacement hashed OTP, attempts reset, 600-second TTL, branded SMTP email, 60-second Redis cooldown, separate IP rate counter, generic response for ineligible accounts, request-specific failure cleanup.
- DONE: TypeScript/build/targeted lint; four resend tests against isolated real Redis keys and stubbed PostgreSQL/SMTP; seven registration and five verification regression tests. No real user code changed by tests.
- DONE: Postman examples. Commit for resend: NOT STARTED.
