import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { config as dotenv } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import shell from "shelljs";
import { AppModule } from "./app.module";
import { exceptionFactory } from "./exceptions/exception.factory";
import { CatchEverythingFilter } from "./filters/catch-everything.filter";
import { LoggingInterceptor } from "./interceptors/logging.interceptor";
import { LowercaseQueryKeysPipe } from "./pipes/lowercase-query-keys.pipe";

void async function () {
    dotenv({ quiet: true });

    const { FRONTEND_ORIGIN, NODE_ENV, GLOBAL_PREFIX = "api", TS_PORT: PORT = 3000 } = process.env;

    if (!FRONTEND_ORIGIN) {
        throw new Error("No frontend origin provided");
    }

    const pyApiScriptPath = path.join(process.cwd(), "python/api.sh");
    const pyApiScript = readFileSync(pyApiScriptPath, "utf-8");

    shell.exec(pyApiScript, { shell: "/bin/bash" }, (error) => {
        const pyApiLogger = new Logger("PythonAPI");
        const logFn = error ? pyApiLogger.warn : pyApiLogger.log;
        logFn.call(pyApiLogger, `Python API exited with code ${error}`);
    });

    const logger = new Logger("Application");
    logger.log("Waiting for Python API...");
    await new Promise(resolve => setTimeout(() => resolve(undefined), 10_000));

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        cors: {
            origin: FRONTEND_ORIGIN,
            credentials: true,
        },
        logger: ["debug"],
    });

    app.getHttpAdapter().getInstance().disable("x-powered-by");

    app.setGlobalPrefix(GLOBAL_PREFIX)
        .useGlobalFilters(new CatchEverythingFilter())
        .useGlobalInterceptors(new LoggingInterceptor())
        .useGlobalPipes(
            new LowercaseQueryKeysPipe(),
            new ValidationPipe({
                exceptionFactory,
                forbidNonWhitelisted: true,
                stopAtFirstError: true,
                transform: true,
                whitelist: true,
            })
        );

    if (NODE_ENV === "development") {
        const swaggerConfig = new DocumentBuilder()
            .setTitle("UdeC Schedule API")
            .build();

        SwaggerModule.setup(GLOBAL_PREFIX, app, () => SwaggerModule.createDocument(app, swaggerConfig, {
            ignoreGlobalPrefix: false,
            operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
        }));
    }

    await app.listen(PORT);

    const appUrl = await app.getUrl()
        .then(url => url.replace("[::1]", "localhost").replace(/\/$/, "") + "/" + GLOBAL_PREFIX);

    logger.log(`Application is running at ${appUrl}`);
}();
