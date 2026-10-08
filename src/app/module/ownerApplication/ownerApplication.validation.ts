import { z } from "zod";

export const submitOwnerApplicationSchema = z.strictObject({
	reason: z.string().trim().min(20).max(2000),
	contactNumber: z
		.string()
		.trim()
		.regex(/^\+?[0-9]{7,20}$/, "Use 7–20 digits with an optional leading +"),
	address: z.string().trim().min(5).max(300),
});

const positiveInteger = (maximum: number) =>
	z
		.string()
		.regex(/^[1-9]\d*$/)
		.transform(Number)
		.pipe(z.number().int().min(1).max(maximum));

export const listOwnerApplicationsSchema = z.strictObject({
	page: positiveInteger(1000000).default(1),
	limit: positiveInteger(100).default(10),
	status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export type IListOwnerApplications = z.infer<
	typeof listOwnerApplicationsSchema
>;

export const ownerApplicationIdSchema = z.strictObject({ id: z.uuid() });
export const approveOwnerApplicationSchema = z.strictObject({});
