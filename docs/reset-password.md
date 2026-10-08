# Reset password

POST http://localhost:5000/api/v1/auth/reset-password

No Authorization required. Content-Type: application/json.

```json
{
  "resetToken": "TOKEN_FROM_VERIFY_RESET_OTP",
  "password": "NewStrongPassword456!"
}
```

Run forgot-password and verify-reset-otp again if your reset token has expired.
It lasts five minutes. In Postman choose Homi Local: Verify reset OTP saves the
token into resetToken; Reset password uses it and clears it after success.

Expected HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password reset successfully. Please log in with your new password.",
  "data": null
}
```

After success, check credential login with the new password (200), the old
password (401 Invalid email or password), and a refresh token obtained BEFORE
reset (401). Save that pre-reset token temporarily outside the collection's
automatically updated refreshToken variable if needed. Never export real tokens.

Negative test: replay the same well-formed reset token request. Expect HTTP 400:

```json
{
  "success": false,
  "message": "Invalid or expired password reset token",
  "errors": []
}
```

Malformed tokens, weak passwords, passwords exceeding 72 UTF-8 bytes, and extra
fields return 400 Validation failed with field details. Token must be the opaque
64-character lowercase hex value, not a JWT or OTP. Unknown, expired, consumed,
wrong-purpose, stale-password and ineligible-account grants use the same 400.
Independent rate limit: ten valid requests per IP in fifteen minutes; excess 429.
Redis connection/operation failures use safe 503 responses.

Implementation: SHA-256 derives the Redis grant key; no raw token is stored.
Purpose/userId/password fingerprint are validated. bcrypt hashes the new password
using configured rounds. Prisma locks the User row, rereads eligibility and
password fingerprint, then Redis Lua rechecks grant TTL/value and consumes it.
User.password update and revocation of all active RefreshSessions commit in one
Prisma transaction. needPasswordChange becomes false. Other users are unaffected.
User row locking is shared with credential login, Google login, refresh and logout.
Credential login rechecks password/status under that lock before issuing a session,
preventing an old password check from creating a session after reset commits.

No schema changes or new environment variables. Response returns no password,
hash, token or user details. Current browser auth cookies are cleared. The user
must log in again. Existing access JWTs can remain valid until their configured
expiry; immediate access-token invalidation is not added in this step.

PostgreSQL and Redis cannot commit atomically. If a database write fails AFTER
Redis consumption, database changes roll back, but the reset token remains spent;
request a fresh recovery code. If consumption fails, the database is unchanged.
If reset changes the password, other earlier grants fail their password fingerprint
check. These cross-store failure and concurrency boundaries are tested.

Tests: `npm run test:reset-password` uses live PostgreSQL/Redis, isolated randomly
named test users, and cleanup. Checks new/old passwords, refresh revocation, replay,
concurrent winner, ineligibility, expiry/purpose/fingerprint, transaction rollback,
HTTP response/cookie clearing and Zod rules. No real user's password is changed.

Bangla: resetToken যাচাই করে নতুন password hash করে save করে। একই transaction-এ
সব পুরোনো refresh session revoke হয়। Token একবার ব্যবহার করা যায়; নতুন password
দিয়ে আবার login করতে হবে।

Execution: Request → Zod → Rate limit → Controller → Service → Redis grant lookup
→ bcrypt → locked Prisma transaction → consume grant → password/session updates → Response.

Important code: resetPassword checks the grant; timingSafeEqual checks its
password fingerprint; transaction.user.update saves the hash and
transaction.refreshSession.updateMany revokes active sessions.

Video: “This is Homi's final password recovery step. I submit the reset token from
OTP verification and a strong new password. The backend verifies the token and
account, consumes the token once, and stores a bcrypt password hash. A database
transaction also revokes all existing refresh sessions. The old password fails,
and the new password works. Replaying the reset token is rejected. I must log in
again after the reset.”

Commit: `feat(auth): reset passwords and revoke refresh sessions`
