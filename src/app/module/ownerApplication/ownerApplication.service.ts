import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { ISubmitOwnerApplication } from "./ownerApplication.interface";

const submitApplication = async (
	userId: string,
	payload: ISubmitOwnerApplication,
) => {
	try {
		return await prisma.$transaction(
			async (transaction) => {
				// Serialize submission with other changes to the user's role/status.
				await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
				const user = await transaction.user.findUnique({
					where: { id: userId },
					select: {
						role: true,
						status: true,
						emailVerified: true,
						isDeleted: true,
					},
				});
				if (
					user?.role !== "TENANT" ||
					user.status !== "ACTIVE" ||
					!user.emailVerified ||
					user.isDeleted
				)
					throw new AppError(
						403,
						"Only active, verified tenants can apply to become owners",
					);
				const pending = await transaction.ownerApplication.findFirst({
					where: { userId, status: "PENDING" },
					select: { id: true },
				});
				if (pending)
					throw new AppError(
						409,
						"You already have a pending owner application",
					);
				const application = await transaction.ownerApplication.create({
					data: {
						userId,
						reason: payload.reason,
						contactNumber: payload.contactNumber,
						address: payload.address,
						status: "PENDING",
					},
					select: {
						id: true,
						userId: true,
						reason: true,
						contactNumber: true,
						address: true,
						status: true,
						reviewedAt: true,
						rejectionReason: true,
						createdAt: true,
						updatedAt: true,
					},
				});
				await transaction.auditLog.create({
					data: {
						userId,
						action: "OWNER_APPLICATION_SUBMITTED",
						entityType: "OwnerApplication",
						entityId: application.id,
						metadata: { status: "PENDING" },
					},
				});
				return application;
			},
			{ maxWait: 10000, timeout: 15000 },
		);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "P2002"
		)
			throw new AppError(409, "You already have a pending owner application");
		throw error;
	}
};

export const OwnerApplicationService = { submitApplication };
