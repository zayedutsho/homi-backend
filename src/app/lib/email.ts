import nodemailer from "nodemailer";
import config from "../config";
import { AppError } from "../utils/AppError";
import {
	verificationOtpTemplate,
	resetPasswordOtpTemplate,
	welcomeEmailTemplate,
	type OtpEmailOptions,
} from "../utils/emailTemplates";

export const createEmailTransporter = () => {
	if (
		!config.smtp_host ||
		!config.smtp_user ||
		!config.smtp_password ||
		!config.email_sender
	) {
		throw new AppError(503, "Email delivery is not configured");
	}
	return nodemailer.createTransport({
		host: config.smtp_host,
		port: Number(config.smtp_port || 587),
		secure: config.smtp_secure,
		requireTLS: !config.smtp_secure,
		auth: { user: config.smtp_user, pass: config.smtp_password },
		connectionTimeout: 5000,
		greetingTimeout: 5000,
		socketTimeout: 10000,
	});
};

const sendEmail = async (
	email: string,
	content: ReturnType<typeof verificationOtpTemplate>,
) => {
	const transporter = createEmailTransporter();
	try {
		const result = await transporter.sendMail({
			from: config.email_sender,
			to: email,
			...content,
		});
		if (!result.accepted.length || result.rejected.length)
			throw new Error("Recipient rejected");
	} catch {
		throw new AppError(503, "Email could not be sent. Please try again later.");
	} finally {
		transporter.close();
	}
};

export const sendVerificationEmail = (
	email: string,
	options: OtpEmailOptions,
) => sendEmail(email, verificationOtpTemplate(options));
export const sendResetPasswordEmail = (
	email: string,
	options: OtpEmailOptions,
) => sendEmail(email, resetPasswordOtpTemplate(options));
export const sendWelcomeEmail = (email: string, name: string) =>
	sendEmail(email, welcomeEmailTemplate(name));
