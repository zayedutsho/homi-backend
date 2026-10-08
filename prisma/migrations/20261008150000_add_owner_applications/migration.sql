CREATE TYPE "OwnerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "owner_applications" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "contactNumber" TEXT NOT NULL, "address" TEXT NOT NULL,
 "status" "OwnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
 "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "rejectionReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "owner_applications_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "owner_application_reviews" (
 "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "reviewerId" TEXT,
 "decision" "OwnerApplicationStatus" NOT NULL, "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "owner_application_reviews_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "owner_application_reviews_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED'))
);
CREATE TABLE "audit_logs" (
 "id" TEXT NOT NULL, "userId" TEXT, "action" TEXT NOT NULL,
 "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "metadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "owner_applications_userId_createdAt_idx" ON "owner_applications"("userId", "createdAt");
CREATE INDEX "owner_applications_status_createdAt_idx" ON "owner_applications"("status", "createdAt");
-- Retain history but permit at most one pending application per tenant.
CREATE UNIQUE INDEX "owner_applications_one_pending_per_user" ON "owner_applications"("userId") WHERE "status" = 'PENDING';
CREATE INDEX "owner_application_reviews_applicationId_createdAt_idx" ON "owner_application_reviews"("applicationId", "createdAt");
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
ALTER TABLE "owner_applications" ADD CONSTRAINT "owner_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_applications" ADD CONSTRAINT "owner_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "owner_application_reviews" ADD CONSTRAINT "owner_application_reviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "owner_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_application_reviews" ADD CONSTRAINT "owner_application_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
