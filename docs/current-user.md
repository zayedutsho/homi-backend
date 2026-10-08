# Current user profile

GET /api/v1/auth/me; Authorization: Bearer <accessToken>; no body. HTTP 200 returns safe User fields plus nullable Tenant contact/address. HTTP 401 for missing, malformed, expired or wrong-signature token/missing user; HTTP 403 for blocked/deleted/unverified user. Explicit headers override cookies, so an invalid header cannot silently fall back to a valid cookie. Current role and name are read from PostgreSQL, rather than trusting outdated JWT values. Cookies remain supported if no Authorization header is supplied.

No database changes. No password hashes, tokens or internal deletion flags returned. Existing secure auth-cookie fallback means a missing-token negative test must clear Postman's cookie jar too; an invalid Authorization header is an easier reliable negative test.

Validation is in auth middleware; this GET endpoint has no body/query inputs requiring a Zod schema. TypeScript/build/targeted lint and an Express HTTP regression test passed with stubbed database reads. Seven login tests also passed. Real user profile confirmation remains pending Postman.

?????: accessToken ???? ??????? user-?? profile ????? ???? Middleware JWT ????? ??? ??? database ???? account status ? role ???? Password hash response-? ???? ???

Execution flow: Request ? JWT validation ? Database account checks ? Controller ? Safe profile query ? Response.

Video: This endpoint returns the authenticated user's profile. We validate the access token and check the current account in the database. Banned, deleted and unverified users cannot access the endpoint. The response includes safe identity fields and tenant contact information while excluding password hashes and tokens. Current roles come from the database so permissions reflect account changes immediately.

Suggested commit: feat(auth): secure current-user profile endpoint
