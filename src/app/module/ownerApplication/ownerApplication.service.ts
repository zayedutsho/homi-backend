import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { ISubmitOwnerApplication } from "./ownerApplication.interface";
import type { IListOwnerApplications } from "./ownerApplication.validation";

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

const listApplications = async (query: IListOwnerApplications) => {
	const { page, limit, status } = query;
	const where = status ? { status } : {};
	// One repeatable-read snapshot keeps the count and returned page consistent.
	const [applications, total] = await prisma.$transaction(
		[
			prisma.ownerApplication.findMany({
				where,
				skip: (page - 1) * limit,
				take: limit,
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
					user: {
						select: {
							id: true,
							name: true,
							email: true,
							role: true,
							status: true,
							emailVerified: true,
							isDeleted: true,
						},
					},
					reviewedBy: { select: { id: true, name: true } },
				},
			}),
			prisma.ownerApplication.count({ where }),
		],
		{ isolationLevel: "RepeatableRead" },
	);
	return {
		applications,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

const approveApplication = async (
	reviewerId: string,
	applicationId: string,
) => {
	return prisma.$transaction(
		async (transaction) => {
			const initial = await transaction.ownerApplication.findUnique({
				where: { id: applicationId },
				select: { userId: true },
			});
			if (!initial) throw new AppError(404, "Owner application not found");
			// Lock users in a consistent order, then the application; submissions lock applicant too.
			await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" IN (${reviewerId}, ${initial.userId}) ORDER BY "id" FOR UPDATE`;
			await transaction.$queryRaw`SELECT "id" FROM "owner_applications" WHERE "id" = ${applicationId} FOR UPDATE`;
			const reviewer = await transaction.user.findUnique({
				where: { id: reviewerId },
				select: {
					role: true,
					status: true,
					isDeleted: true,
					emailVerified: true,
				},
			});
			if (
				reviewer?.role !== "ADMIN" ||
				reviewer.status !== "ACTIVE" ||
				reviewer.isDeleted ||
				!reviewer.emailVerified
			)
				throw new AppError(
					403,
					"Only active, verified admins can review owner applications",
				);
			const application = await transaction.ownerApplication.findUnique({
				where: { id: applicationId },
				select: { id: true, userId: true, status: true },
			});
			if (!application) throw new AppError(404, "Owner application not found");
			if (application.userId === reviewerId)
				throw new AppError(
					403,
					"You cannot approve your own owner application",
				);
			if (application.status !== "PENDING")
				throw new AppError(
					409,
					"Only pending owner applications can be approved",
				);
			const applicant = await transaction.user.findUnique({
				where: { id: application.userId },
				select: {
					role: true,
					status: true,
					emailVerified: true,
					isDeleted: true,
				},
			});
			if (
				applicant?.role !== "TENANT" ||
				applicant.status !== "ACTIVE" ||
				!applicant.emailVerified ||
				applicant.isDeleted
			)
				throw new AppError(
					409,
					"Applicant must be an active, verified tenant before approval",
				);
			const reviewedAt = new Date();
			const updated = await transaction.ownerApplication.updateMany({
				where: { id: applicationId, status: "PENDING" },
				data: {
					status: "APPROVED",
					reviewedById: reviewerId,
					reviewedAt,
					rejectionReason: null,
				},
			});
			if (updated.count !== 1)
				throw new AppError(
					409,
					"Only pending owner applications can be approved",
				);
			await transaction.user.update({
				where: { id: application.userId },
				data: { role: "OWNER" },
			});
			await transaction.ownerApplicationReview.create({
				data: {
					applicationId,
					reviewerId,
					decision: "APPROVED",
					createdAt: reviewedAt,
				},
			});
			await transaction.auditLog.create({
				data: {
					userId: reviewerId,
					action: "OWNER_APPLICATION_APPROVED",
					entityType: "OwnerApplication",
					entityId: applicationId,
					metadata: {
						applicantId: application.userId,
						previousStatus: "PENDING",
						status: "APPROVED",
						previousRole: "TENANT",
						role: "OWNER",
					},
				},
			});
			return transaction.ownerApplication.findUniqueOrThrow({
				where: { id: applicationId },
				select: {
					id: true,
					userId: true,
					status: true,
					reviewedById: true,
					reviewedAt: true,
					rejectionReason: true,
					updatedAt: true,
					user: { select: { id: true, name: true, email: true, role: true } },
				},
			});
		},
		{ maxWait: 10000, timeout: 15000 },
	);
};

export const OwnerApplicationService = {
	submitApplication,
	listApplications,
	approveApplication,
};
