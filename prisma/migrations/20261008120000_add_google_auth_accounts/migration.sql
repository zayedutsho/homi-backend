ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');
CREATE TABLE "auth_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key" ON "auth_accounts"("provider", "providerAccountId");
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
