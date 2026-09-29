import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";

const router = Router();
router.post("/register", AuthController.registerTenant);
router.post("/login", AuthController.loginUser);
router.get(
  "/me",
  auth(Role.ADMIN, Role.OWNER, Role.TENANT),
  AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
export const AuthRoutes = router;
