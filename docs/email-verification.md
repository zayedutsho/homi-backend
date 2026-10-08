# Email verification

POST /api/v1/auth/verify-email is public and uses User plus the registration Redis OTP record. Send email and a six-digit string otp. Success: HTTP 200, emailVerified=true, no login tokens. Invalid/expired: 400; already verified: 409; inactive: 403; five attempts exhausted: 429. Responses follow the shared envelopes.

Redis Lua scripts count attempts atomically without resetting the original TTL, then consume only the matching hash/user/purpose. PostgreSQL updateMany inside a transaction updates only an active, undeleted, unverified account. If the code expires before consumption, the database change rolls back. Concurrent database updates are guarded by the conditional update. PostgreSQL and Redis do not share a transaction: a database commit failure after Redis consumption can require a replacement OTP; do not claim cross-system atomicity. Resend is the next endpoint and is still pending.

Tests: TypeScript and build passed; five verification tests use actual isolated Redis keys and explicitly stubbed PostgreSQL writes. Seven registration regression tests passed. Actual user verification is pending Postman.

Postman body: {"email":"your-registered-email","otp":"<six-digit-code-from-email>"}. Header Content-Type: application/json; No Auth. After success, repeat the request: expect 409 Email is already verified. If the old OTP expired, register a fresh unused address/alias to obtain a fresh code; resend is not implemented yet. Never log or commit OTP values.

?????: ?? endpoint email ??? OTP ???? Redis attempt count ????? ??? bcrypt ???? code ?????? ????? ???? ??? transaction-? User-?? emailVerified=true ??? ??? Redis code ???? ???? ??? code ???? ??????? ??? ??? ???

Execution flow: Request ? Zod validation ? Controller ? Service ? User lookup ? Redis attempt check ? bcrypt comparison ? Database transaction + OTP consumption ? Response.

Video: This endpoint verifies a tenant's email using the code sent during registration. We validate the request and check the code against its hash in Redis. Each code has a limited lifetime and permits up to five attempts. A successful verification marks the account verified and consumes the code to prevent replay. No login tokens are issued here; the user can log in separately.

Suggested commit: feat(auth): verify email with single-use Redis OTP
