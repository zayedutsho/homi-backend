import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";

const app: Application = express();

app.use(
  cors({
    origin: config.frontend_url,
    credentials: true,
  }),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

// app.use("/api/v1/auth", AuthRoutes);
// app.use("/api/v1/user", UserRoutes);
// app.use("/api/v1/appointment", AppointementRoutes);
// app.use("/api/v1/doctor", DoctorRoutes);
// app.use("/api/v1/schedule", ScheduleRoutes);
// app.use("/api/v1/payment", PaymentRoutes);
// app.use("/api/v1/prescription", PrescriptionRoutes);
// app.use("/api/v1/analytics", AnalyticsRoutes);

// app.get("/test", async (req: Request, res: Response, next: NextFunction) => {
// 	try {
// 		const grantIdTokenResult = await getBkashIdToken();

// 		console.log(grantIdTokenResult);

// 		res.status(httpStatus.OK).json({
// 			success: true,
// 			message: "Welcome to PH Healthcare System Backend",
// 			data: null,
// 		});
// 	} catch (error) {
// 		console.log(error);
// 		next(error);
// 	}
// });

// Basic route
app.get("/", async (req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: "Welcome to HomeCare System Backend",
  });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
