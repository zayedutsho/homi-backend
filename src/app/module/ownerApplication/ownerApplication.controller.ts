import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { OwnerApplicationService } from "./ownerApplication.service";

const submitApplication = catchAsync(async (req, res) => {
	if (!req.user) throw new AppError(401, "Authentication is required");
	const result = await OwnerApplicationService.submitApplication(
		req.user.userId,
		req.body,
	);
	sendResponse(res, {
		statusCode: 201,
		success: true,
		message: "Owner application submitted successfully. Awaiting admin review.",
		data: result,
	});
});

export const OwnerApplicationController = { submitApplication };
