import type { Logger } from "@nestjs/common";
import axios from "axios";
import { ClassDay, ClassType, type ScheduleFile, type Subject, type SubjectScheduleDefined } from "./types";

const BASE_API_URL = "https://ofivirtualfi.udec.cl/intranet-horarios/api/horario";
const ONE_HOUR_IN_MS = 3_600_000;

const apiClient = axios.create({
    baseURL: BASE_API_URL,
});

enum DayNumber {
    LU = 1,
    MA,
    MI,
    JU,
    VI,
    SA,
    DO,
}

const dayNumberToClassDay = {
    [DayNumber.LU]: ClassDay.LU,
    [DayNumber.MA]: ClassDay.MA,
    [DayNumber.MI]: ClassDay.MI,
    [DayNumber.JU]: ClassDay.JU,
    [DayNumber.VI]: ClassDay.VI,
    [DayNumber.SA]: ClassDay.SA,
    [DayNumber.DO]: ClassDay.DO,
} as const satisfies Record<DayNumber, ClassDay>;

export async function updateEngineeringSchedule(scheduleFile: ScheduleFile, options: Options): Promise<ScheduleFile> {
    if (scheduleFile.updatedAt + ONE_HOUR_IN_MS >= Date.now()) {
        return scheduleFile;
    }

    const { logger } = options;

    logger.debug("Fetching engineering subjects list");

    const subjectsResponse = await apiClient.get<SubjectsResponse>("/").then(r => r.data);

    if (!subjectsResponse.data) {
        throw new Error("Could not fetch latest subjects list:", { cause: subjectsResponse.error ?? "unknown" });
    }

    let count = 1;

    const subjects: Record<string, Subject> = {};

    for (const responseSubject of subjectsResponse.data.info.subjects) {
        for (const responseSection of responseSubject.sections) {
            const key = `${responseSubject.id_subject}-${responseSection.section_number}`;

            const subject: Subject = {
                code: responseSubject.id_subject,
                name: responseSubject.name,
                section: responseSection.section_number,
                schedule: [],
            };

            subjects[key] = subject;

            if (count === 1 || count % 50 === 0) {
                logger.debug(`Fetching engineering subjects schedules (#${count} for now)`);
            }

            count++;

            if (!responseSubject.definedSchedule) {
                continue;
            }

            const sectionScheduleResponse = await apiClient
                .get<SubjectScheduleResponse>(`/asignatura/${responseSection.id_section}`)
                .then(r => r.data);

            if (!sectionScheduleResponse.data) {
                const reason = sectionScheduleResponse.error ?? "unknown";
                logger.error(`Could not fetch subject schedule for ${logger} (#${count}). Reason: ${reason}`);
                continue;
            }

            for (const responseSchedule of sectionScheduleResponse.data) {
                const day = dayNumberToClassDay[responseSchedule.dia];
                const block = Math.floor(responseSchedule.horaInit / 100) - 7;

                const previousBlock = subject.schedule.find((s): s is SubjectScheduleDefined =>
                    s.defined && s.type === ClassType.T && s.classroom === responseSchedule.aula && s.day === day
                );

                // eslint-disable-next-line max-depth
                if (!previousBlock) {
                    subject.schedule.push({
                        defined: true,
                        type: ClassType.T,
                        classroom: responseSchedule.aula,
                        day: day,
                        blocks: [block],
                    });
                } else if (!previousBlock.blocks.includes(block)) {
                    previousBlock.blocks.push(block);
                }
            }
        }
    }

    logger.debug("Done fetching engineering subjects schedules");

    return {
        updatedAt: Date.now(),
        subjects,
    };
}

export type Options = {
    logger: Logger;
};

type SubjectsResponse = {
    data: {
        info: {
            subjects: ResponseSubject[];
            period: string;
        };
    } | null;
    error: string | null;
};

type ResponseSubject = {
    definedSchedule: boolean;
    id_subject: number;
    depto: number;
    name: string;
    sections: ResponseSubjectSection[];
};

type ResponseSubjectSection = {
    section_number: number;
    id_section: number;
};

type SubjectScheduleResponse = {
    data: ResponseSubjectSchedule[];
    error: string | null;
};

type ResponseSubjectSchedule = {
    "aula": string;
    "dia": DayNumber;
    "horaInit": number;
    "horaFin": number;
};
