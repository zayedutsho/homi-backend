# Verify password reset OTP

POST http://localhost:5000/api/v1/auth/verify-reset-otp

Public endpoint; no Authorization header. Content-Type: application/json.

```json
{ "email": "YOUR_VERIFIED_CREDENTIAL_EMAIL", "otp": "SIX_DIGIT_EMAIL_CODE" }
```

First request a fresh code using forgot-password. Use the same email and the
latest code within ten minutes; OTP must be a string, including any leading zeros.

HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password reset code verified successfully",
  "data": {
    "resetToken": "OPAQUE_SINGLE_PURPOSE_TOKEN",
    "resetTokenExpiresInSeconds": 300
  }
}
```

No cookies or login tokens are issued. Keep resetToken locally for the subsequent
reset-password request. Do not paste tokens/OTP into chat or commit/export them.
Reset-password is NOT STARTED; the token may expire while waiting for that step,
so request and verify a fresh code when needed.

Negative test: immediately replay the successful email/code request. Expect 400:

```json
{
  "success": false,
  "message": "Invalid or expired password reset code",
  "errors": []
}
```

Wrong/expired/replaced codes, wrong purpose and unknown/ineligible users return
the same 400. Five attempted codes per OTP are permitted; further attempts return
429 with “Too many reset OTP attempts. Request a new code.” An independent IP
limit permits ten valid requests per fifteen minutes, including successful ones.
Invalid email/OTP format returns 400 Validation failed with field errors.
Redis failures return safe 503. No actual OTP or token is logged.

User is read with a narrow select and must be active, verified, not deleted and
have a credential password. Google-only accounts cannot reset a nonexistent
password. Redis purpose PASSWORD_RESET is isolated from registration verification.
Lua increments attempts atomically while preserving TTL. bcrypt compares the
code. Another Lua operation checks the matching hash/user/purpose, creates the
grant with NX/EX, then deletes the OTP, allowing one concurrent winner.

The token contains 32 random bytes encoded as hex. Only its SHA-256 hash appears
in the Redis key `homi:password-reset:grant:<hash>`, with a five-minute TTL.
The grant stores userId, purpose and a fingerprint of the current password hash
to let reset-password reject stale grants after a password change. It is an
opaque reset permission, not a JWT; existing auth middleware rejects it.
Future reset-password must validate purpose/TTL/account/fingerprint, consume
the grant once, hash the new password, and revoke existing refresh sessions.
These reset-password operations are not implemented in this step.

No schema/database writes or new environment variables. Passwords, refresh
sessions and email verification flags are unchanged. Redis multi-key Lua assumes
the currently configured non-cluster connection; a future sharded Redis setup
needs compatible key hash tags.

Tests: `npm run test:verify-reset-otp`. Actual Redis with isolated random test keys;
Prisma User reads are stubbed. Covers successful grant, TTL, hashed storage,
five attempts, replay, concurrent winner, missing/wrong-purpose record,
ineligible accounts, storage failure and actual HTTP validation. No real account
OTP is touched by automated tests.

Bangla: এই endpoint email-এর reset OTP যাচাই করে। সঠিক OTP একবার ব্যবহার করে
৫ মিনিটের resetToken পাওয়া যায়। এটি login token নয়; password এই ধাপে বদলায় না।

Execution: Request → Validation → IP rate limit → Controller → Service → User
lookup → Redis attempt limit → bcrypt comparison → atomic OTP consumption/grant → Response.

Important code: verifyResetOtp performs eligibility checks; Lua counts attempts
and prevents concurrent replay; randomBytes creates an unpredictable reset token.
Database changes: none. Redis consumes OTP and creates an expiring reset grant.

Video: “This endpoint verifies Homi's password-reset code. I submit the same email
and the latest six-digit OTP from my inbox. The backend checks account eligibility,
expiry, purpose, and attempt limits, then compares the code securely. Success
consumes the OTP once and returns a five-minute reset token. Concurrent requests
cannot reuse the code. This token does not log the user in, and the password stays
unchanged until the next reset-password step.”

Commit: `feat(auth): verify reset OTP and issue expiring reset grants`
