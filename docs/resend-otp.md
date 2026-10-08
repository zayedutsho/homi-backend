# Resend verification OTP

POST /api/v1/auth/resend-otp; No Auth; Content-Type: application/json. Body contains email only. Use an existing unverified account. Success: 200 with generic message and otpExpiresInSeconds=600. Repeat within 60 seconds: 429. Invalid email: 400. Already verified/unknown/inactive account: generic 200 and no email.

User is read only. Redis replaces the EMAIL_VERIFICATION record, resets attempts and starts a fresh 600-second expiry. SET NX EX 60 atomically limits concurrent resends. The route has a separate Redis IP limit of 10 valid requests per 15 minutes. On email failure, cleanup removes only the matching OTP hash and request-owned cooldown; the prior code was invalidated and a new resend is required. No tokens or codes/hashes are returned or logged.

Database and SMTP are stubbed in automated tests; actual Redis behavior uses isolated random keys. Four resend tests, seven registration regressions, five verification regressions, TypeScript/build and targeted lint passed. Actual resend delivery remains pending Postman.

?????: ?? endpoint ???? verification OTP ?????? ???? Redis record replace ??? attempt count ????? ??? expiry ?? ????? ???? ??? user ?? ????????? ??? ???? resend ???? ???? ??? PostgreSQL User record ???????? ?? ???

Execution flow: Request ? Zod ? IP limit ? Controller ? Service ? User lookup ? Redis cooldown ? Hash/new OTP record ? Nodemailer ? Response.

Video: This endpoint lets an unverified tenant request a fresh email code. It replaces the previous OTP record, resets the attempt count, and starts a new ten-minute expiry. A Redis cooldown prevents repeated sends within sixty seconds, and an IP rate limit reduces spam. The response remains generic for accounts that do not need verification. It does not change the user's verification status or issue login tokens.

Suggested commit: feat(auth): add rate-limited verification OTP resend
