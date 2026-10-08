import { AppError } from "../../utils/AppError";
import jwt, { type JwtPayload } from "jsonwebtoken";
import config from "../../config";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";

const registerUser = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.registerUser(req.body);
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message:
			"Tenant registered successfully. Please check your email for the verification code.",
		data: result,
	});
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.forgotPassword(req.body);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message:
			"If this account is eligible for password recovery, a code has been sent",
		data: result,
	});
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.googleLogin(req.body);
	for (const [name, token] of Object.entries(result)) {
		res.cookie(name, token, {
			httpOnly: true,
			secure: config.node_env === "production",
			sameSite: "lax",
			maxAge: Math.max(
				0,
				((jwt.decode(token) as JwtPayload).exp ?? 0) * 1000 - Date.now(),
			),
		});
	}
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Google login successful",
		data: result,
	});
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const result = await AuthService.loginUser(payload);
	const { accessToken, refreshToken } = result;

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env === "production",
		sameSite: "lax",
		maxAge: Math.max(
			0,
			((jwt.decode(accessToken) as JwtPayload).exp ?? 0) * 1000 - Date.now(),
		),
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: config.node_env === "production",
		sameSite: "lax",
		maxAge: Math.max(
			0,
			((jwt.decode(refreshToken) as JwtPayload).exp ?? 0) * 1000 - Date.now(),
		),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new Error("User information is missing in the request");
	}

	const result = await AuthService.getMe(user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	const token = req.body.refreshToken ?? req.cookies?.refreshToken;
	if (!token || typeof token !== "string")
		throw new AppError(401, "Refresh token is required");
	const result = await AuthService.refreshToken(token);
	const { accessToken, refreshToken: newRefreshToken } = result;

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env === "production",
		sameSite: "lax",
		maxAge: Math.max(
			0,
			((jwt.decode(accessToken) as JwtPayload).exp ?? 0) * 1000 - Date.now(),
		),
	});
	res.cookie("refreshToken", newRefreshToken, {
		httpOnly: true,
		secure: config.node_env === "production",
		sameSite: "lax",
		maxAge: Math.max(
			0,
			((jwt.decode(newRefreshToken) as JwtPayload).exp ?? 0) * 1000 -
				Date.now(),
		),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.verifyEmail(req.body);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Email verified successfully",
		data: result,
	});
});

const resendOtp = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.resendOtp(req.body);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "If this account needs verification, a new code has been sent",
		data: result,
	});
});

const logout = catchAsync(async (req: Request, res: Response) => {
	const token = req.body.refreshToken ?? req.cookies?.refreshToken;
	await AuthService.logout(typeof token === "string" ? token : undefined);
	const cookieOptions = {
		httpOnly: true,
		secure: config.node_env === "production",
		sameSite: "lax" as const,
		path: "/",
	};
	res.clearCookie("accessToken", cookieOptions);
	res.clearCookie("refreshToken", cookieOptions);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Logged out successfully",
		data: null,
	});
});

export const AuthController = {
	forgotPassword,
	googleLogin,
	logout,
	resendOtp,
	verifyEmail,
	registerUser,
	loginUser,
	getMe,
	refreshToken,
};
