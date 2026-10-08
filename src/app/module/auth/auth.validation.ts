import { z } from "zod";

export const registerSchema = z.strictObject({
	name: z.string().trim().min(2).max(100),
	email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
	password: z
		.string()
		.min(8)
		.refine(
			(value) => Buffer.byteLength(value, "utf8") <= 72,
			"Password must not exceed 72 UTF-8 bytes",
		)
		.regex(/[a-z]/, "Password needs a lowercase letter")
		.regex(/[A-Z]/, "Password needs an uppercase letter")
		.regex(/[0-9]/, "Password needs a number")
		.regex(/[^a-zA-Z0-9]/, "Password needs a special character"),
});

export const verifyEmailSchema = z.strictObject({
	email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
	otp: z.string().regex(/^\d{6}$/, "OTP must be six digits"),
});

export const resendOtpSchema = z.strictObject({
	email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});
