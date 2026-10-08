import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { OwnerApplicationService } from "./ownerApplication.service";
import { listOwnerApplicationsSchema } from "./ownerApplication.validation";

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

const listApplications = catchAsync(async (req, res) => {
	// Express 5 query is a getter; parse into a local value instead of assigning it.
	const query = listOwnerApplicationsSchema.parse(req.query);
	const result = await OwnerApplicationService.listApplications(query);
	sendResponse(res, {
		statusCode: 200,
		success: true,
		message: "Owner applications fetched successfully",
		data: result.applications,
		meta: result.meta,
	});
});

export const OwnerApplicationController = {
	submitApplication,
	listApplications,
};
