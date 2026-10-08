# Google authentication

POST `/api/v1/auth/google`, Content-Type `application/json`, no Authorization header required.

```json
{ "idToken": "PASTE_FRESH_GOOGLE_ID_TOKEN" }
```

Start the backend with `npm run dev`. In a second terminal run
`npm run dev:google-test`, open http://localhost:3000, sign in and copy the token.
Select Homi Local in Postman and use the Google login request. Put the token in
the raw request body directly, or temporarily set the local secret googleIdToken
variable. Clear that variable after testing; never export populated tokens.

For a new-user success test, choose a Google account whose email is not already
registered in Homi. The existing credential account for your Gmail address will
produce the intentional 409 conflict. Do not delete it or change its verification
state to bypass linking. A separate secure account-linking endpoint is not implemented.

Expected success for both new and returning users: HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Google login successful",
  "data": { "accessToken": "APPLICATION_ACCESS_JWT", "refreshToken": "APPLICATION_REFRESH_JWT" }
}
```

Cookies follow existing login settings: HttpOnly, SameSite=Lax, Secure in production.
Use the returned access token in GET `/api/v1/auth/me`; expect TENANT and
emailVerified true. Repeat Google login using a fresh ID token: the same Homi user
is used. Refresh and logout accept the resulting application refresh tokens.
No OTP email is sent during either Google flow.

Errors use `{ "success": false, "message": "...", "errors": [] }`:

| HTTP | Trigger | Message |
| --- | --- | --- |
| 401 | Invalid signature, wrong audience/issuer, expired or malformed Google token | Invalid or expired Google ID token |
| 403 | email_verified is not boolean true | Google email must be verified before logging in |
| 403 | Linked account blocked, deleted or ineligible | Account is inactive or ineligible for Google login |
| 409 | Existing email without Google linkage | An account with this email already exists. Sign in with your password; Google linking requires a separate secure account-linking process. |
| 409 | Concurrent registration uniqueness conflict | Google account or email already registered. Retry Google sign-in; if the conflict remains, sign in with your password and request secure account linking. |
| 400 | Missing/empty idToken, extra fields | Validation failed (errors contains field details) |
| 429 | More than 10 valid Google requests per IP in 15 minutes | Too many authentication requests. Please try again later. |

Negative Postman test: replace the token with `invalid-token` and expect 401.
Do not edit a genuine JWT to simulate a verified/unverified email; modifying it
invalidates its signature. These states are covered in automated tests.

Implementation: Google's official OAuth2Client.verifyIdToken verifies signature,
audience, issuer and expiry using rotating public keys. Additional claim checks
enforce exact audience/issuer, unexpired exp, stable sub and boolean email_verified.
Returning accounts are located by provider GOOGLE + providerAccountId sub, never
email. A changed Google email does not overwrite the stored Homi profile.
New users, tenant profiles, AuthAccounts and hashed refresh sessions are created
in one Prisma transaction. Existing roles are preserved for returning users.
No provider token or secret is persisted. Credential registration still creates
emailVerified false and requires Homi OTP. Password is nullable for Google-only users.

The requested `isVerified = true` rule maps to the existing `emailVerified = true`
field; a duplicate verification flag was not added.

Tests: `npm run test:google`; live isolated database tests:
`npx tsx --test tests/googleIntegration.test.ts`. Live tests mock only Google
identity input, create unique test records, and clean them up. Browser sign-in
with a genuine token remains the user's final Postman confirmation.

Bangla: Google token backend-এ যাচাই করা হয়। Google email verified হলে নতুন
TENANT account verified অবস্থায় তৈরি হয় এবং সঙ্গে সঙ্গে access ও refresh token
পায়; Homi OTP লাগে না। Password registration-এ OTP আগের মতোই লাগবে। একই email-এর
পুরোনো account থাকলে নিরাপত্তার জন্য automatic linking হবে না।

30-second walkthrough: “This is Homi’s Google login. I sign in on the local Google
test page, copy the ID token, and submit it in Postman. The backend verifies
Google’s signature, audience, issuer, expiry, and email verification. A new user
gets a verified tenant account and our application tokens immediately, without
OTP. Returning users are identified by Google’s stable subject. Existing email
conflicts require secure linking. Refresh rotation and logout continue to work.”

Suggested commit: `feat(auth): add verified Google tenant login with linked accounts`

Reference: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
