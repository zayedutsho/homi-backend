import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

const createToken = (
	payload: JwtPayload,
	secret: string,
	expiresIn: SignOptions["expiresIn"],
) => {
	const token = jwt.sign(payload, secret, {
		expiresIn,
	});

	return token;
};

const verifyToken = (token: string, secret: string) => {
	try {
		const verifiedToken = jwt.verify(token, secret, { algorithms: ["HS256"] });
		return {
			success: true,
			data: verifiedToken,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Invalid token",
		};
	}
};

export const jwtUtils = {
	createToken,
	verifyToken,
};
