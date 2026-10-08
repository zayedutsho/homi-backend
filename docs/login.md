# Credential login

POST /api/v1/auth/login with email/password and No Auth. A verified active user receives HTTP 200 and accessToken/refreshToken. Invalid email/password returns generic 401; unverified/blocked/deleted returns 403; malformed body returns 400; ten valid requests/IP/15 minutes triggers 429. Tokens and password hashes are never logged. No database records are changed by login yet.

JWT access/refresh secrets must be distinct, at least 32 characters and not placeholders. Expiry must include s/m/h/d units; local values are 15m and 7d. The local ignored .env placeholder secrets were replaced with random secrets. Restart the backend to load them. JWT verification permits HS256. Refresh JWTs include a distinct jti. Cookies are HttpOnly, SameSite=Lax, Secure in production, with lifetime derived from token expiry. Postman can use Bearer tokens from JSON; the collection captures tokens into environment variables without console logging.

Important limitation: hashed database sessions, rotation/revocation and logout are pending. Unique JWT IDs do not revoke earlier refresh tokens; do not claim session security is complete. They will be implemented endpoint by endpoint.

Checks: seven login tests with stubbed PostgreSQL/Redis, seven registration regressions, TypeScript/build and targeted lint. Real credential login awaits user Postman test.

?????: email ??? password ???? bcrypt ???? password ????? ???? User verified ? active ??? accessToken ??? refreshToken ???? ??? credential ??? 401 ??? unverified/banned account ??? 403 ????

Execution flow: Request ? Zod ? Login IP limit ? Controller ? User query ? bcrypt comparison ? Account checks ? JWT signing ? Response.

Video: This endpoint signs in a verified user with their email and password. We normalize the email, compare the password with its stored hash, and check account status. Unverified, banned, and deleted accounts cannot log in. Successful login returns an expiring access token and refresh token, which Postman stores for later authenticated requests. Password hashes are never returned.

Suggested commit: feat(auth): secure verified-user credential login

Update: login now creates a hashed RefreshSession in PostgreSQL. Refresh-token rotation and replay-family revocation are implemented; see refresh-token.md. Logout remains pending.
