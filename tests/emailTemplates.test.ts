import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import {
	verificationOtpTemplate,
	resetPasswordOtpTemplate,
	welcomeEmailTemplate,
} from "../src/app/utils/emailTemplates";

for (const render of [verificationOtpTemplate, resetPasswordOtpTemplate]) {
	test(`${render.name} escapes names and renders the actual OTP and expiry in both formats`, () => {
		const otp = randomInt(100000, 1000000).toString();
		const name = '<img src=x onerror="alert(1)"> & Jane';
		const email = render({ name, otp, expiresInSeconds: 300 });
		assert.ok(
			email.html.includes(
				"&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Jane",
			),
		);
		assert.ok(!email.html.includes(name));
		assert.ok(email.html.includes(otp));
		assert.ok(email.text.includes(otp));
		assert.match(email.html, /5 minutes/);
		assert.match(email.text, /5 minutes/);
		assert.match(email.html, /#0F766E/);
		assert.match(email.html, /max-width:560px/);
		assert.match(email.html, /role="presentation"/);
		assert.match(email.text, /Never share this code/);
		assert.match(email.text, /If you did not/);
	});
	test(`${render.name} rejects invalid values and accurately displays non-minute expiry`, () => {
		const otp = randomInt(100000, 1000000).toString();
		assert.throws(() =>
			render({ name: "Jane", otp: "<bad>", expiresInSeconds: 600 }),
		);
		assert.throws(() => render({ name: "Jane", otp, expiresInSeconds: 0 }));
		assert.match(
			render({ name: "Jane", otp, expiresInSeconds: 90 }).text,
			/90 seconds/,
		);
	});
}

test("welcome email escapes personalized HTML and supplies plain text", () => {
	const email = welcomeEmailTemplate("<script>Jane</script>");
	assert.ok(!email.html.includes("<script>"));
	assert.match(email.html, /&lt;script&gt;Jane&lt;\/script&gt;/);
	assert.match(email.text, /Welcome to Homi/);
});
