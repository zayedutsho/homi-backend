import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";

import {
	registerSchema,
	verifyEmailSchema,
	resendOtpSchema,
	loginSchema,
	refreshTokenSchema,
} from "./auth.validation";
import { validateRequest } from "../../middleware/validateRequest";
import {
	registrationRateLimit,
	resendOtpRateLimit,
	loginRateLimit,
	refreshRateLimit,
	logoutRateLimit,
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
router.post(
	"/login",
	validateRequest(loginSchema),
	loginRateLimit,
	AuthController.loginUser,
);
router.get(
	"/me",
	auth(Role.ADMIN, Role.OWNER, Role.TENANT),
	AuthController.getMe,
);
router.post(
	"/refresh-token",
	validateRequest(refreshTokenSchema),
	refreshRateLimit,
	AuthController.refreshToken,
);
router.post(
	"/logout",
	validateRequest(refreshTokenSchema),
	logoutRateLimit,
	AuthController.logout,
);
export const AuthRoutes = router;
