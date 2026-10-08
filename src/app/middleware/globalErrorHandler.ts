import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../utils/AppError";

export const globalErrorHandler: ErrorRequestHandler = (
	err,
	_req,
	res,
	_next,
) => {
	let status = 500;
	let message = "Internal server error";
	let errors: { field: string; message: string }[] = [];
	if (err instanceof ZodError) {
		status = 400;
		message = "Validation failed";
		errors = err.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
	} else if (err instanceof AppError) {
		status = err.statusCode;
		message = err.message;
	} else if (
		err instanceof Prisma.PrismaClientKnownRequestError &&
		err.code === "P2002"
	) {
		status = 409;
		message = "User with this email already exists";
	} else if (
		err instanceof SyntaxError &&
		"status" in err &&
		err.status === 400
	) {
		status = 400;
		message = "Invalid JSON body";
	} else {
		// Never log request bodies, Prisma parameters, SMTP credentials or raw errors.
		console.error("Request failed with an unexpected server error");
	}
	res.status(status).json({ success: false, message, errors });
};
