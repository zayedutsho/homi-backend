import { z } from "zod";

export const submitOwnerApplicationSchema = z.strictObject({
	reason: z.string().trim().min(20).max(2000),
	contactNumber: z
		.string()
		.trim()
		.regex(/^\+?[0-9]{7,20}$/, "Use 7–20 digits with an optional leading +"),
	address: z.string().trim().min(5).max(300),
});
