# Admin: approve owner application

PATCH http://localhost:5000/api/v1/owner-applications/APPLICATION_ID/approve

Authorization: Bearer ADMIN_ACCESS_TOKEN
Content-Type: application/json
Body: `{}` (no client-supplied role, reviewer or status fields allowed).

For the pending application confirmed in your earlier Postman test:
http://localhost:5000/api/v1/owner-applications/b63655b6-d20c-4bbb-b59c-079db3577cda/approve

Expected HTTP 200:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Owner application approved successfully",
  "data": {
    "id": "APPLICATION_UUID",
    "userId": "APPLICANT_UUID",
    "status": "APPROVED",
    "reviewedById": "ADMIN_UUID",
    "reviewedAt": "ISO_TIMESTAMP",
    "rejectionReason": null,
    "updatedAt": "ISO_TIMESTAMP",
    "user": {
      "id": "APPLICANT_UUID",
      "name": "Applicant name",
      "email": "applicant@example.com",
      "role": "OWNER"
    }
  }
}
```

Check the admin list using status=APPROVED. Then call /api/v1/auth/me with the
applicant's access token: current role must be OWNER. Existing JWT role claims
are not authoritative; middleware rereads User.role. New login/refresh tokens
also receive OWNER. Refresh sessions are preserved and tenant profile is retained.

Negative test: repeat approval of the same application. Expect HTTP 409:

```json
{
  "success": false,
  "message": "Only pending owner applications can be approved",
  "errors": []
}
```

Other errors: missing token 401; non-admin or inactive/unverified/deleted admin
403; self approval 403; invalid UUID or non-empty body 400 Validation failed;
unknown valid application UUID 404 Owner application not found; already rejected
application 409; inactive/deleted/unverified/non-TENANT applicant 409
Applicant must be an active, verified tenant before approval.

Implementation: one Prisma transaction reads applicant ID, locks both User rows
in sorted order, then locks the OwnerApplication row. Admin and applicant status
are rechecked after locking. Only PENDING transitions to APPROVED. The applicant
becomes OWNER, reviewer/timestamp are saved, an APPROVED OwnerApplicationReview
is inserted, and an OWNER_APPLICATION_APPROVED AuditLog records the state/role
change. No applicant contact details, secrets or tokens are copied into audit
metadata. Audit/history/write failure rolls back all changes. Concurrent approvals
produce one winner and one conflict without duplicate history/audit records.

No new schema migration or environment variables. Admin identity always comes
from authentication; user IDs and state transitions cannot be chosen by request body.
No rejection endpoint is implemented yet. Approval grants ownership eligibility;
property/room creation endpoints remain separate unimplemented steps.

Tests: npm run test:approve-owner-application. Live PostgreSQL tests create random
test users/applications, exercise promotion, history, replay, concurrent approval,
ineligible applicants/reviewers, self approval, audit rollback, actual HTTP auth,
UUID/body validation and authoritative /auth/me role. Cleanup removes only test
records. The real pending application is not approved by automated tests.

Bangla: ADMIN pending আবেদন approve করলে user-এর role OWNER হয়। একই transaction-এ
application, review history ও audit save হয়। কোনো write fail হলে সব rollback হয়।
একই আবেদন দ্বিতীয়বার approve করা যায় না।

Execution: Request → Admin auth → Zod body/UUID → Controller → Service → locked
transaction → eligibility/state checks → application/user/history/audit → Response.

Important code: approveApplication uses conditional updateMany for PENDING,
user.update to promote OWNER, ownerApplicationReview.create for review history,
and auditLog.create for the approval event.
Database changes: update application/reviewer/timestamp and User.role; insert
review-history and audit records. No credentials or refresh sessions changed.

Video: “I log in as an admin and approve a pending owner application. The backend
checks that both the admin and applicant are active and verified, then locks the
records to prevent simultaneous approvals. One transaction approves the application,
promotes the tenant to owner, and records the reviewer, history, and audit event.
The user's profile now shows OWNER. Repeating approval returns a conflict, and a
failed write rolls everything back.”

Commit: feat(owner): approve applications and promote tenants transactionally
