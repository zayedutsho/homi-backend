import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";

import {
	registerSchema,
	verifyEmailSchema,
	resendOtpSchema,
} from "./auth.validation";
import { validateRequest } from "../../middleware/validateRequest";
import {
	registrationRateLimit,
	resendOtpRateLimit,
} from "../../middleware/registrationRateLimit";

const router = Router();
router.post(
	"/register",
	validateRequest(registerSchema),
	registrationRateLimit,
	AuthController.registerUser,
);
router.post(
	"/verify-email",
	validateRequest(verifyEmailSchema),
	AuthController.verifyEmail,
);
router.post(
	"/resend-otp",
	validateRequest(resendOtpSchema),
	resendOtpRateLimit,
	AuthController.resendOtp,
);
router.post("/login", AuthController.loginUser);
router.get(
	"/me",
	auth(Role.ADMIN, Role.OWNER, Role.TENANT),
	AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
export const AuthRoutes = router;
