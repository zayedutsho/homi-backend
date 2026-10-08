import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { submitOwnerApplicationSchema } from "./ownerApplication.validation";
import { OwnerApplicationController } from "./ownerApplication.controller";

const router = Router();
router.post(
	"/",
	auth(Role.TENANT),
	validateRequest(submitOwnerApplicationSchema),
	OwnerApplicationController.submitApplication,
);
export const OwnerApplicationRoutes = router;
