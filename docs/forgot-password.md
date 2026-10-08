# Forgot password

POST http://localhost:5000/api/v1/auth/forgot-password

Public endpoint. No Authorization header. Content-Type: application/json.

```json
{ "email": "YOUR_VERIFIED_CREDENTIAL_ACCOUNT_EMAIL" }
```

Expected HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "If this account is eligible for password recovery, a code has been sent",
  "data": { "otpExpiresInSeconds": 600 }
}
```

Use a verified, active user created with a password. Google-only accounts have
password null and should use Google sign-in; they do not receive a reset OTP.
Unknown, inactive, deleted, unverified and Google-only accounts receive the
same response. Check the inbox/spam folder for eligible accounts. A successful
HTTP response does not confirm account existence or email delivery.

Email delivery uses the existing escaped, personalized Homi reset-password HTML
and plain-text templates. The code lifetime passed to the template equals the
Redis TTL: 600 seconds. Only a bcrypt hash is stored, with purpose PASSWORD_RESET,
userId, attempts and timestamps. No OTP, hash, credentials or tokens are logged
or returned. The reset key is separate from EMAIL_VERIFICATION keys.

Repeated requests within 60 seconds receive the generic 200 without another
email. After the cooldown, requesting again replaces the earlier OTP and resets
attempts. A separate hashed-IP rate counter permits 10 requests per 15 minutes;
exceeding it returns 429 with Retry-After. Storage outage at rate-limit/client
initialization returns 503 for every account; per-account cooldown or delivery
failures preserve the generic response and produce only safe operational logs.
On delivery failure, Lua conditionally removes only this request's code/cooldown.
Delivery timing is not equalized; generic responses do not eliminate all timing
side channels.

Negative test: `{ "email": "not-an-email" }` returns HTTP 400:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

Enumeration check: use an unknown valid email and expect the same HTTP 200/data,
with no email sent. Immediate repeat for an eligible email should not send a
second email. Do not share the OTP value in chat.

No Prisma schema or database writes are needed. User is read with explicit select.
Passwords, verification flags, linked identities and refresh sessions are unchanged.
verify-reset-otp and reset-password are NOT STARTED; do not try the reset code
against the registration verify-email endpoint.

Verification: nine tests use actual isolated Redis keys, with database reads and
SMTP mocked; no real recovery emails sent by automated tests. Run
`npm run test:forgot-password`. Tests cover hashed replacement, expiry, purpose,
cooldown, failed delivery cleanup, ineligible accounts, Zod and actual Express HTTP.
Genuine inbox delivery is pending the user's Postman test.

Bangla: এই endpoint verified credential user-এর email-এ password reset OTP পাঠায়।
OTP Redis-এ hash হিসেবে ১০ মিনিট থাকে। Unknown বা Google-only account-এর জন্যও
একই response আসে। এই ধাপে password পরিবর্তন হয় না।

Execution: Request → Zod validation → rate limit → Controller → Service →
User lookup → Redis cooldown/hash → Nodemailer → generic response.

Important code: forgotPassword checks credential eligibility; Redis SET NX EX
enforces cooldown, SET EX saves the expiring hash; sendResetPasswordEmail reuses
the branded template. Conditional Lua cleanup preserves newer requests.

Video: “This is Homi's forgot-password endpoint. I submit the email of a verified
credential user. The backend creates a six-digit reset code, stores only its hash
in Redis for ten minutes, and sends our branded email. A cooldown and IP limit
prevent repeated emails. Unknown and Google-only accounts get the same response
to protect account privacy. This step does not change the password; OTP verification
and password reset come next.”

Commit: `feat(auth): add password recovery OTP requests`
