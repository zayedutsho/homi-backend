# Admin: list owner applications

GET http://localhost:5000/api/v1/owner-applications?page=1&limit=10&status=PENDING

Authorization: Bearer ADMIN_ACCESS_TOKEN. No body required. Only an active,
verified, non-deleted ADMIN can access this endpoint. Current database role
overrides stale/forged role claims in tokens.

Query: page positive integer (default 1, maximum 1000000), limit 1–100 (default 10),
optional status PENDING/APPROVED/REJECTED. Omit status to show all applications.
Unknown query fields, repeated/array parameters, decimals and invalid bounds
return 400 Validation failed. A page beyond the last page returns data [].

Expected HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Owner applications fetched successfully",
  "data": [
    {
      "id": "APPLICATION_UUID",
      "userId": "APPLICANT_UUID",
      "reason": "Application reason",
      "contactNumber": "+8801700000000",
      "address": "Uttara, Dhaka",
      "status": "PENDING",
      "reviewedAt": null,
      "rejectionReason": null,
      "createdAt": "ISO_TIMESTAMP",
      "updatedAt": "ISO_TIMESTAMP",
      "user": {
        "id": "APPLICANT_UUID",
        "name": "Applicant name",
        "email": "applicant@example.com",
        "role": "TENANT",
        "status": "ACTIVE",
        "emailVerified": true,
        "isDeleted": false
      },
      "reviewedBy": null
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

Numbers depend on your database. Pending results should include your earlier
submitted application. Empty result totals are 0/0. Reviewed results include
reviewer id/name when present. Full review-history entries are not fetched by
this list endpoint; review/detail endpoints remain NOT STARTED.

Negative permission test: use your TENANT access token; expect HTTP 403:

```json
{
  "success": false,
  "message": "You do not have permission to access this resource",
  "errors": []
}
```

Missing token: 401. Blocked/unverified/deleted admin: 403 account eligibility
error. Negative validation test with an admin token: ?limit=101 returns 400
Validation failed with limit field details.

Admin setup (if no admin exists): set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD
in ignored .env. Choose a separate email not registered as a tenant/owner and a
strong password of at least 12 characters. Run `npm run seed:admin`; no credentials
are printed. The existing seed creates a verified ADMIN, keeps existing admins
unchanged, and refuses to promote existing tenant/owner accounts. It does not
reset an existing admin password or unban an admin. No admin was created for
you during implementation. Never commit .env or share your password in chat.
Login at POST /api/v1/auth/login using those credentials and copy the resulting
accessToken to the local Postman adminToken variable. Use adminToken for this GET.

Implementation: auth(Role.ADMIN) checks current User eligibility/role. Zod parses
query into a local object (Express 5 query is read-only). Prisma findMany uses
bounded skip/take, status where, safe select and createdAt desc/id desc ordering.
Count uses the same where and a RepeatableRead transaction snapshot. Applications
belonging to soft-deleted/banned applicants remain visible with current flags so
admins can retain and inspect history. No records are changed and no audit write
is performed for this read endpoint. No schema migration needed.

Tests: npm run test:list-owner-applications uses isolated live PostgreSQL fixtures
and checks filters/meta, empty pages, safe fields, role/status guards, query bounds
and deterministic order. Cleanup deletes only test applications/users.

Bangla: ADMIN pending বা reviewed owner application দেখতে পারবে। Pagination ও
status filter আছে। TENANT/OWNER এই list দেখতে পারবে না। Password বা token response-এ
থাকবে না এবং এই endpoint কোনো data পরিবর্তন করে না।

Execution: Request → Auth/RBAC → Zod query → Controller → Service → Prisma
findMany + count → Response with meta.

Important code: listApplications applies status/skip/take/select/orderBy;
RepeatableRead keeps count and page consistent. Database changes: none.

Video: “I log in as an admin and open Homi's owner-application list. I can filter
pending, approved, or rejected applications and use pagination. Each result shows
the application and safe applicant details, while passwords and tokens are excluded.
The response includes the total and page count. Tenant tokens receive forbidden.
This endpoint only reads applications; approval and rejection will be separate
admin actions.”

Commit: feat(owner): add paginated admin owner application listing
