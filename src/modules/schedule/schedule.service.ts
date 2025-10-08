import { Injectable, Logger } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout } from "node:timers";
import type { Schedule } from "./entities/schedule.entity";
import { CFMEntryType, type ScheduleFile, type Subject, updateCfmSchedule, updateEngineeringSchedule } from "./lib";

@Injectable()
export class ScheduleService {
    private readonly logger: Logger;
    private readonly pyApiUrl: string;
    private readonly scheduleFilesDir: string;
    private readonly pdfFilesDir: string;
    private readonly engineeringScheduleFilePath: string;
    private readonly cfmScheduleFilePaths: Readonly<Record<CFMEntryType, string>>;
    private readonly scheduleLoaderFns: Array<() => Promise<Record<string, ScheduleFile>>>;
    private readonly cacheTTL: number;
    private readonly scheduleUpdateTimeoutMs: number;
    private scheduleUpdateTimeout: NodeJS.Timeout | null;
    private updating: boolean;
    private lastUpdated: number;
    private readonly cachedSchedules: Record<string, Subject>;

    public constructor() {
        const { PY_PORT } = process.env;
        if (!PY_PORT || Number.isNaN(+PY_PORT)) {
            throw new Error("Must provide valid PY_PORT");
        }

        const resourcesDir = path.join(process.cwd(), "resources");

        this.logger = new Logger(ScheduleService.name);
        this.pyApiUrl = `http://localhost:${PY_PORT}/api/parse-xlsx-borders`;

        this.scheduleFilesDir = path.join(resourcesDir, "schedules");
        this.pdfFilesDir = path.join(resourcesDir, "pdf");

        this.engineeringScheduleFilePath = path.join(this.scheduleFilesDir, "engineering.json");
        this.cfmScheduleFilePaths = Object.freeze(Object.fromEntries(Object.keys(CFMEntryType).map(k =>
            [k, path.join(this.scheduleFilesDir, `cfm-${k.toLowerCase()}.json`)]
        ))) as Readonly<Record<CFMEntryType, string>>;

        this.scheduleLoaderFns = [
            () => this.updateEngineeringSchedule(),
            () => this.updateCfmSchedule(),
        ];

        this.cacheTTL = 900_000; // 15 mins
        this.scheduleUpdateTimeoutMs = 3_600_000; // 1 hour
        this.scheduleUpdateTimeout = null;
        this.updating = false;
        this.lastUpdated = 0;
        this.cachedSchedules = {};

        if (!existsSync(this.scheduleFilesDir)) {
            mkdirSync(this.scheduleFilesDir, { recursive: true });
        }

        if (existsSync(this.pdfFilesDir)) {
            rmSync(this.pdfFilesDir, {
                recursive: true,
                force: true,
            });
        }

        mkdirSync(this.pdfFilesDir, { recursive: true });

        // noinspection JSIgnoredPromiseFromCall
        this.updateSchedules();
    }

    public async getSchedule(): Promise<Schedule> {
        if (this.updating) {
            return {
                updating: true,
                schedules: this.cachedSchedules,
            };
        }

        if (this.lastUpdated + this.cacheTTL > Date.now()) {
            return {
                updating: false,
                schedules: this.cachedSchedules,
            };
        }

        return await this.updateSchedules();
    }

    private async updateSchedules(): Promise<Schedule> {
        this.updating = true;

        if (this.scheduleUpdateTimeout !== null) {
            clearTimeout(this.scheduleUpdateTimeout);
        }

        for (const loaderFn of this.scheduleLoaderFns) {
            try {
                const schedules = Object.values(await loaderFn());
                for (const schedule of schedules) {
                    // eslint-disable-next-line max-depth
                    for (const [key, value] of Object.entries(schedule.subjects)) {
                        this.cachedSchedules[key] = value;
                    }
                }
            } catch (error) {
                this.logger.error(error);
            }
        }

        this.lastUpdated = Date.now();

        const updateDate = new Date(this.lastUpdated + this.scheduleUpdateTimeoutMs).toISOString();
        this.logger.log(`Set schedule update for ${updateDate}`);

        this.updating = false;
        this.scheduleUpdateTimeout = setTimeout(() => this.updateSchedules(), this.scheduleUpdateTimeoutMs);

        return {
            updating: false,
            schedules: this.cachedSchedules,
        };
    }

    private async updateEngineeringSchedule(): Promise<Record<"engineering", ScheduleFile>> {
        const oldFile = this.readScheduleFile(this.engineeringScheduleFilePath);
        const newFile = await updateEngineeringSchedule(oldFile, {
            logger: this.logger,
            pdfFilesDir: this.pdfFilesDir,
            pyApiUrl: this.pyApiUrl,
        });

        if (newFile.updatedAt > oldFile.updatedAt) {
            this.saveScheduleFile(this.engineeringScheduleFilePath, newFile);
        }

        return { engineering: newFile };
    }

    private async updateCfmSchedule(): Promise<Record<CFMEntryType, ScheduleFile>> {
        const oldFiles = Object.fromEntries(Object.entries(this.cfmScheduleFilePaths).map(([key, path]) =>
            [key, this.readScheduleFile(path)]
        )) as Record<CFMEntryType, ScheduleFile>;

        const newFiles = await updateCfmSchedule(oldFiles, {
            logger: this.logger,
            pdfFilesDir: this.pdfFilesDir,
            pyApiUrl: this.pyApiUrl,
        });

        for (const [key, file] of Object.entries(newFiles)) {
            if (file.updatedAt > oldFiles[key].updatedAt) {
                this.saveScheduleFile(this.cfmScheduleFilePaths[key], file);
            }
        }

        return newFiles;
    }

    private readScheduleFile(filePath: string): ScheduleFile {
        if (!existsSync(filePath)) {
            return {
                updatedAt: 0,
                subjects: {},
            };
        }

        return JSON.parse(readFileSync(filePath, "utf-8")) as ScheduleFile;
    }

    private saveScheduleFile(filePath: string, scheduleFile: ScheduleFile): void {
        writeFileSync(filePath, JSON.stringify(scheduleFile), "utf-8");
    }
}
