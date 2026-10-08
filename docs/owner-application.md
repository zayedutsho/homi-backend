# Submit owner application

POST http://localhost:5000/api/v1/owner-applications

Authorization: Bearer YOUR_APPLICATION_ACCESS_TOKEN
Content-Type: application/json

```json
{
  "reason": "I manage rental properties and would like to list them on Homi.",
  "contactNumber": "+8801700000000",
  "address": "Uttara, Dhaka"
}
```

Use a logged-in active verified TENANT (Google or credential). Reason: 20–2000
characters; contactNumber: 7–20 digits with optional leading +; address: 5–300
characters. Strings are trimmed. userId, role, status and reviewer fields cannot
be submitted; identity is taken exclusively from authentication.

Expected HTTP 201:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Owner application submitted successfully. Awaiting admin review.",
  "data": {
    "id": "APPLICATION_UUID",
    "userId": "CURRENT_USER_UUID",
    "reason": "I manage rental properties and would like to list them on Homi.",
    "contactNumber": "+8801700000000",
    "address": "Uttara, Dhaka",
    "status": "PENDING",
    "reviewedAt": null,
    "rejectionReason": null,
    "createdAt": "ISO_TIMESTAMP",
    "updatedAt": "ISO_TIMESTAMP"
  }
}
```

Negative test: send the same request again. Expected HTTP 409:

```json
{
  "success": false,
  "message": "You already have a pending owner application",
  "errors": []
}
```

Missing/invalid access token: 401. Owners/admins: 403 permission error.
Blocked/deleted/unverified users: 403. Invalid fields or injected status/userId:
400 Validation failed with field details. Read roles from the database, not JWT
claims. /auth/me should still show TENANT after submission.

Models: User has many OwnerApplications; each application belongs to an applicant
and optionally an admin reviewer. Applications store status, current review details
and timestamps. OwnerApplicationReview retains decisions, reasons, reviewer and
timestamp as a history per application. Database check restricts review decisions
to APPROVED/REJECTED. No review history rows are created before an actual review.
User has many AuditLogs; logs identify actor/action/entity without copying private
contact data or application reasons. Reviewer/actor references may become null
on hard deletion; applicant hard deletion is restricted to preserve application
history. Normal user management should use soft deletion.

Submission locks User, rechecks eligibility, checks for existing pending application,
then creates application and audit atomically. PostgreSQL partial unique index
owner_applications_one_pending_per_user guarantees only one PENDING row per user,
even outside this service. Rejected history is retained; a tenant may submit again
when there is no pending application. Only future admin approval will promote OWNER.
No approval/rejection/list endpoint is implemented here.

Audit insert failure rolls back submission. Safe select returns only the caller's
application, never password/provider/session data. No new environment variables.

Tests: npm run test:owner-application. Live PostgreSQL tests create isolated random
test users, remove their logs/applications and delete users afterward. They test
creation/audit, role preservation, duplicate/concurrent/direct SQL constraint,
reapplication history, ineligible users, rollback, actual HTTP auth/validation.
Postman confirmation remains pending until the user tests.

Bangla: verified TENANT owner হওয়ার আবেদন করতে পারবে। আবেদন PENDING হবে এবং
admin approve না করা পর্যন্ত role TENANT-ই থাকবে। একই user-এর একাধিক pending
আবেদন database-ও আটকাবে।

Execution: Request → Auth/RBAC → Zod → Controller → Service → locked Prisma
transaction → application + audit → Response.

Important code: submitApplication rechecks User eligibility; ownerApplication.create
saves the request; auditLog.create records submission in the same transaction.
Database changes: new OwnerApplication and AuditLog records; User role unchanged.

Video: “This is Homi's owner-application endpoint. I log in as a verified tenant
and submit my reason, contact number, and address. The backend checks my current
role and creates a pending application with an audit record in one transaction.
My role stays tenant until an admin approves. A database constraint prevents
duplicate pending applications, including simultaneous requests. Repeating the
request returns a conflict. Admin review comes next.”

Commit: feat(owner): add tenant owner applications with audit tracking
