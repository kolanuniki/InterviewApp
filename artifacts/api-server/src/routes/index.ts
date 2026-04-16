import { Router, type IRouter } from "express";
import healthRouter from "./health";
import interviewRouter from "./interview/index";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/interview", interviewRouter);

export default router;
