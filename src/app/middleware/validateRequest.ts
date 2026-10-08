import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { catchAsync } from "../utils/catchAsync";

export const validateRequest = (schema: ZodType) =>
	catchAsync((req: Request, _res: Response, next: NextFunction) => {
		req.body = schema.parse(req.body ?? {});
		next();
	});
