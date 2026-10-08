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

User Postman confirmation: resend OTP returned 200, followed by successful verification of the previously unverified test account. Registration, verification and resend OTP are DONE. Git push confirmation is pending; login work has not started.

## Credential login

- User confirmed verification/resend success and Git push completion.
- IN PROGRESS: POST /api/v1/auth/login awaiting Postman confirmation.
- DONE: email/password Zod validation; generic 401 invalid credentials; 403 unverified/inactive/deleted; access/refresh JWTs; configured expiry and distinct secrets validation; separate login rate limit; secure production cookies with correct expiry.
- DONE: seven login tests (stubbed database/Redis) and seven registration regression tests; build and TypeScript checks. Postman login request/examples and token capture added.
- NOT STARTED: hashed RefreshSession storage, refresh rotation, revocation and logout. Current JWT issuance is not a complete session-management system.
- Database changes: none for login. Placeholder local JWT secrets replaced with random distinct values in ignored .env; restart backend to load them.
- Commit: NOT STARTED for login.

## Current user profile

- DONE: user supplied successful credential-login response. Token values are not recorded in documentation.
- IN PROGRESS: GET /api/v1/auth/me awaiting Postman confirmation.
- DONE: strict Bearer parsing with cookie fallback, header precedence, signature/expiry checks, account status checks, database-authoritative roles/name, explicit safe User/Tenant selects and deleted-profile filtering.
- DONE: TypeScript/build/targeted lint, actual Express HTTP test covering valid/invalid/expired tokens and inactive accounts with stubbed database reads; seven login regressions.
- DONE: Postman profile request/examples. Database changes: none. Commit: NOT STARTED.
- Next planned auth endpoint: refresh rotation with hashed sessions.

## Refresh-token rotation

- DONE: user supplied successful current-user Postman response.
- IN PROGRESS: POST /api/v1/auth/refresh-token awaiting final integration checks/Postman.
- DONE: RefreshSession schema and additive migration applied to Neon; generated client and Prisma validation. User 1:N RefreshSession stores only tokenHash, family ID, expiry and revocation timestamp.
- DONE: login creates sessions; refresh verifies JWT/hash/account and conditionally consumes the old session then inserts replacement within a database transaction. Replay commits revocation of the family. Cookie/body support, input validation and IP limit included.
- Legacy refresh JWTs without a database session require a fresh login. Access JWTs remain valid until expiry; immediate access-token session revocation is not implemented. Logout remains NOT STARTED.
- DONE: Postman refresh request/examples/token capture. Commit: NOT STARTED.

Refresh integration testing: row locking and bounded transaction waits fixed the concurrent-refresh issue found on Neon. Live database tests verify hash storage, replay-family revocation, one concurrent winner, expiry/account rejection and rollback. Temporary test users/sessions are deleted by test cleanup. HTTP body/cookie checks are also being verified.

Final refresh verification: DONE — six live Neon integration/HTTP tests passed; seven login and one profile regression tests passed. Prisma validation/client generation, additive migration deployment, TypeScript, build and targeted lint passed. Refresh endpoint remains IN PROGRESS only pending the user's Postman confirmation. No real user tokens or session hashes were printed.

## Logout

- DONE: user supplied refresh rotation success and expected 401 on replay. Refresh Postman checks confirmed.
- IN PROGRESS: POST /api/v1/auth/logout awaiting integration and Postman confirmation.
- Implemented: revoke the identified refresh family, clear auth cookies, body/cookie support, Zod validation/IP limit, safe idempotent logout and user row locking shared with refresh. Other login families remain active. Access JWTs remain valid until expiry.
- Postman logout request/examples/token-variable cleanup added. No schema changes. Commit: NOT STARTED.

Logout verification: DONE — two live Neon/HTTP tests passed, including rotation-family revocation, independent-login preservation, repeat logout, cookie clearing and malformed-body rejection. Temporary test users were cleaned up. TypeScript/build/targeted lint passed. Logout remains IN PROGRESS pending user Postman confirmation.

User confirmation: logout Postman test PASSED. POST /api/v1/auth/logout is DONE. Next planned endpoint: Google authentication; configuration readiness checked before implementation.

## Google authentication ? updated business rule

- Implemented POST /api/v1/auth/google: genuine server-side verification; email_verified must be true; verified Google users skip Homi OTP. Credential registration still requires OTP.
- New Google users are TENANT, emailVerified true (existing verification field), nullable password, linked AuthAccount by GOOGLE + stable sub. User/tenant/account/session created transactionally. Returning identities preserve stored roles/profile.
- Existing email conflicts require secure linking, which remains a separate unimplemented endpoint. Inactive/deleted/unverified linked users are rejected.
- Existing token issuance, refresh rotation, logout and authorization preserved. Documentation and Postman Google request updated.
- IN PROGRESS: verification and user Postman confirmation. No further endpoint work until confirmation.

Google verification: DONE ? 10 Google service/HTTP/cryptographic tests, two live database Google integration tests (including rollback), eight refresh/logout regressions, seven credential login tests and seven registration tests passed. Prisma schema validation/client generation, migration deployment, TypeScript, build and targeted lint passed. Live test users were cleaned up. Google identity claims were simulated in automated database tests; genuine browser-token Postman confirmation remains pending. No OTP or credentials were logged. Google endpoint remains IN PROGRESS only pending user testing confirmation.
