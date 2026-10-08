type EmailContent = { subject: string; html: string; text: string };
export type OtpEmailOptions = {
	name: string;
	otp: string;
	expiresInSeconds: number;
};

export const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[character] || character,
	);

const layout = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#F3F7F6;font-family:Arial,Helvetica,sans-serif;color:#203532;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#F3F7F6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background-color:#FFFFFF;border:1px solid #DFE9E6;border-radius:16px;">
<tr><td style="padding:28px 24px;border-bottom:1px solid #E8EFED;"><span style="font-size:28px;font-weight:bold;color:#0F766E;">Homi<span style="color:#203532;">.</span></span><p style="margin:8px 0 0;font-size:12px;color:#627570;">A place to feel at home.</p></td></tr>
<tr><td style="padding:32px 24px;font-size:16px;line-height:1.6;">${content}</td></tr>
<tr><td style="padding:20px 24px;border-top:1px solid #E8EFED;font-size:12px;line-height:1.6;color:#627570;">Homi &middot; Housing &amp; Roommate Management<br>This is an automated message. Please do not reply.</td></tr>
</table></td></tr></table></body></html>`;

const otpTemplate = (
	options: OtpEmailOptions,
	purpose: "verification" | "reset",
): EmailContent => {
	const { name, otp, expiresInSeconds } = options;
	if (!/^\d{6}$/.test(otp)) throw new Error("OTP must contain six digits");
	if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0)
		throw new Error("OTP expiry must be a positive number of seconds");
	const expiration =
		expiresInSeconds % 60 === 0
			? `${expiresInSeconds / 60} ${expiresInSeconds === 60 ? "minute" : "minutes"}`
			: `${expiresInSeconds} ${expiresInSeconds === 1 ? "second" : "seconds"}`;
	const subject =
		purpose === "verification"
			? "Verify your Homi email"
			: "Reset your Homi password";
	const title =
		purpose === "verification"
			? "Your home starts here"
			: "Reset your password";
	const description =
		purpose === "verification"
			? "Verify your email to continue setting up your Homi account."
			: "Use this code to verify your password reset request. Your password has not been changed.";
	const warning =
		purpose === "verification"
			? "If you did not create a Homi account, you can safely ignore this email."
			: "If you did not request a password reset, ignore this email and keep your code private.";
	const text = `Hi ${name},\n\n${description}\nYour Homi ${purpose === "verification" ? "verification" : "password reset"} code is ${otp}.\nIt expires in ${expiration}.\n\nNever share this code. Homi will never ask you to share it.\n${warning}\n\nHomi — Housing & Roommate Management\nThis is an automated message. Please do not reply.`;
	const html = layout(
		subject,
		`<h1 style="margin:0 0 20px;font-size:26px;line-height:1.3;color:#203532;">${title}</h1>
<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p><p style="margin:0 0 24px;color:#526861;">${description}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#EFFAF7;border:1px solid #CDE8DF;border-radius:12px;"><tr><td align="center" style="padding:20px 8px;">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:1px;color:#0F766E;">YOUR ONE-TIME CODE</p>
<p style="margin:0;font-family:Courier New,monospace;font-size:32px;font-weight:bold;letter-spacing:4px;color:#0F766E;">${escapeHtml(otp)}</p>
<p style="margin:12px 0 0;font-size:13px;color:#526861;">Expires in ${escapeHtml(expiration)}</p></td></tr></table>
<p style="margin:24px 0 12px;font-size:14px;">Never share this code. Homi will never ask you to share it.</p>
<p style="margin:0;font-size:13px;color:#627570;">${warning}</p>`,
	);
	return { subject, html, text };
};

export const verificationOtpTemplate = (options: OtpEmailOptions) =>
	otpTemplate(options, "verification");
export const resetPasswordOtpTemplate = (options: OtpEmailOptions) =>
	otpTemplate(options, "reset");

export const welcomeEmailTemplate = (name: string): EmailContent => ({
	subject: "Welcome to Homi",
	html: layout(
		"Welcome to Homi",
		`<h1 style="margin:0 0 20px;font-size:26px;line-height:1.3;">Welcome home.</h1><p>Hi ${escapeHtml(name)},</p><p style="color:#526861;">Welcome to Homi, your place to explore housing and connect with potential roommates.</p><p style="font-size:14px;color:#627570;">We're glad you're here.</p>`,
	),
	text: `Hi ${name},\n\nWelcome to Homi, your place to explore housing and connect with potential roommates.\nWe're glad you're here.\n\nHomi — Housing & Roommate Management\nThis is an automated message. Please do not reply.`,
});
