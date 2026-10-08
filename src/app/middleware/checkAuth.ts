import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";

export interface RequestUser {
	email: string;
	name: string;
	userId: string;
	role: Role;
}

declare global {
	namespace Express {
		interface Request {
			user?: RequestUser;
		}
	}
}

// Check the signed identity, then use current database values for account status and roles.
export const auth = (...requiredRoles: Role[]) => {
	return catchAsync(
		async (req: Request, _res: Response, next: NextFunction) => {
			const authorization = req.headers.authorization;
			// An explicit header takes precedence over cookies, including an invalid header.
			const token =
				authorization !== undefined
					? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1]
					: req.cookies?.accessToken;
			if (!token || typeof token !== "string")
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"A valid Bearer access token is required",
				);
			const verified = jwtUtils.verifyToken(token, config.jwt_access_secret);
			if (
				!verified.success ||
				!verified.data ||
				typeof verified.data === "string" ||
				typeof verified.data.userId !== "string"
			) {
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"Invalid or expired access token",
				);
			}
			const user = await prisma.user.findUnique({
				where: { id: verified.data.userId },
				select: {
					id: true,
					name: true,
					email: true,
					role: true,
					status: true,
					isDeleted: true,
					emailVerified: true,
				},
			});
			if (!user)
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"User not found. Please log in again.",
				);
			if (user.status !== "ACTIVE" || user.isDeleted || !user.emailVerified) {
				throw new AppError(
					httpStatus.FORBIDDEN,
					"Your account must be active and email verified.",
				);
			}
			if (requiredRoles.length && !requiredRoles.includes(user.role)) {
				throw new AppError(
					httpStatus.FORBIDDEN,
					"You do not have permission to access this resource",
				);
			}
			req.user = {
				userId: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			};
			next();
		},
	);
};
