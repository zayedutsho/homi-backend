# Refresh-token rotation

POST /api/v1/auth/refresh-token; No Auth; Content-Type: application/json; body contains refreshToken. A body token overrides cookies. An empty JSON body uses the refreshToken cookie. Log in again after the RefreshSession migration; older tokens have no stored session and are rejected.

User has many RefreshSession records. Each login starts a family; each rotation creates another session in that family. Stored fields include a SHA-256 hash of the random signed refresh JWT, token ID, expiry and revocation timestamp. Plain tokens are never stored. PostgreSQL transaction conditionally revokes the current session and creates the next. If insertion fails, the revocation rolls back. Concurrent reuse permits only one rotation; detected reuse revokes the entire family, including any replacement. Independent login families are retained.

Success: 200 with replacement accessToken/refreshToken. Malformed body: 400; missing/invalid/expired/untracked/replayed token: 401; inactive/unverified account: 403; too many requests: 429. Cookie expiry matches JWT expiry; HttpOnly and SameSite=Lax, Secure in production. No codes, tokens, hashes or credentials should be shared in logs or docs.

Postman: log in and save the refresh token locally. Refresh once: expect 200 and new refresh token. Replay the old token: expect 401 and family revocation. The replacement now cannot refresh either, so log in again after the replay test. Postman automation overwrites current token variables on successful refresh.

Access tokens are checked against current account status and remain valid until their expiry; replay revokes refresh sessions, not already-issued access JWTs. Logout is the next endpoint. Sessions keep history; expiry cleanup is not implemented yet.

?????: refreshToken-?? hash database session-?? ????? ?????? Transaction ?????? session revoke ??? ???? token ? session ???? ???? ?????? token ???? ??????? ???? ?? login family revoke ?? ??? ???? ??? login ???? ???

Execution flow: Request ? Zod/rate limit ? Controller ? JWT validation ? Session/hash/account checks ? Database transaction ? Replacement tokens ? Response.

Video: Refresh-token rotation renews an expired access token using a valid refresh token. The database stores only the refresh token's hash. In a transaction, we revoke the old session and create a replacement. Reusing an old refresh token revokes its login family, so the client must log in again. This prevents a refresh token from being used repeatedly.

Suggested commit: feat(auth): add hashed refresh sessions and token rotation

Concurrency protection: parameterized SELECT FOR UPDATE locks the User row before session reads, serializing refresh/replay operations for that user. Transaction waits are bounded at 10 seconds with a 15-second execution timeout to accommodate Neon network latency. Integration tests use real Neon transactions and isolated temporary test users; database cleanup deletes only those test users.
