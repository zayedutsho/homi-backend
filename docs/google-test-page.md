# Google ID token test page

Run `npm run dev:google-test` from the repository root, then open
http://localhost:3000 (not a file URL or 127.0.0.1). Keep that origin authorized
in your Google Cloud web client. The server reads `GOOGLE_CLIENT_ID` through
the existing backend configuration and exposes only this public identifier.
It binds to the IPv4 loopback interface and does not start the backend.

Click Sign in with Google, choose an account, and click Copy ID token.
Google Identity Services supplies the token through `response.credential`.
The page does not log tokens, write browser storage, or submit tokens anywhere.
The token stays in page memory; clearing or leaving the page removes it.
Copying explicitly writes the OS clipboard; Clear token does not erase that clipboard.
Google's own library performs the sign-in exchange with Google.

In Postman, use POST http://localhost:5000/api/v1/auth/google with
Content-Type: application/json and raw JSON:

```json
{
  "idToken": "PASTE_THE_COPIED_GOOGLE_ID_TOKEN_HERE"
}
```

Use the fresh token directly in the request; do not include `Bearer ` or cookie
prefixes, and do not paste it into chat, logs, or committed files.

`/api/v1/auth/google` is implemented. See [Google authentication](google-auth.md)
for responses and the existing-email conflict rule. A verified Google email
does not require Homi OTP.

Stop the helper with Ctrl+C. If port 3000 is occupied, stop the other local
server before launching this helper. Redirect URIs are unnecessary for this
popup callback flow. Client secrets are unnecessary for this page.

References: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
and https://developers.google.com/identity/gsi/web/reference/js-reference
