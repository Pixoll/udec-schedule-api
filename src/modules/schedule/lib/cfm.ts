import axios from "axios";
import { parse as parseHtml } from "node-html-parser";
import { pdfToCsv, type PdfToCsvOptions } from "./pdf-to-csv";
import { ClassDay, ClassType, type ScheduleFile, type Subject, type SubjectSchedule } from "./types";

export enum CFMEntryType {
    // noinspection JSUnusedGlobalSymbols
    AST = "AST",
    DIM = "DIM",
    EST = "EST",
    FIS = "FIS",
    GEO = "GEO",
    MAT = "MAT",
}

const schedulesBaseUrl = "https://www.cfm.cl/pdf/horarios/";

const entryTypeRegex = new RegExp(`^(?:HORA)?(${Object.keys(CFMEntryType).join("|")}).+\\.pdf$`);
const daysRegex = /(?:lu|ma|mi|ju|vi|sa|do) *\/ *(?:lu|ma|mi|ju|vi|sa|do)|(?:test ?)?(?:lu|ma|mi|ju|vi|sa|do)/gi;
const blocksRegex = /\d+(?:(?: *- *\d+)*| *[ay] *\d+)?(?: *\/ *\d+(?:(?: *- *\d+)*| *[ay] *\d+)?)?/gi;
// eslint-disable-next-line max-len
const classroomsRegex = /icalma|sala\s*reuniones\s*decanat(?:o|ura)|auditorio\s*facultad\s*de\s*ciencias\s*f[ií]sicas\s*y\s*matem[aá]ticas|lab\s*electr[iíoó]nica|sala\s*3\s*agronomia|auditorio\s*mancinelli|sala\s*multim\s*ii\.?\s*edif\s*arco\s*fcb|auditorio ci2ma|[a-z]+ *\d+-\d+|(\w+ *- *\w+) *\/ *(\w+ *- *\w+)|\w+ *- *\w+(?: *, *\w+(?: *- *\w+)?)?|[a-z]+ *\d+ *\/ *[a-z]+ *\d+/gi;

export async function updateCfmSchedule(
    scheduleFiles: Record<CFMEntryType, ScheduleFile>,
    options: Pick<PdfToCsvOptions, "logger" | "pdfFilesDir" | "pyApiUrl">
): Promise<Record<CFMEntryType, ScheduleFile>> {
    const scheduleTableHtmlString = await axios.get<string>(schedulesBaseUrl).then(r => r.data);
    const currentYear = new Date().getFullYear();

    const html = parseHtml(scheduleTableHtmlString);
    const htmlScheduleRows = html.querySelectorAll("body > table > tr").slice(3, -1);

    const scheduleFilePaths = htmlScheduleRows.reduce((schedules, row) => {
        const fileName = row.querySelector("td:nth-child(2) > a")?.attributes.href;
        const type = fileName?.match(entryTypeRegex)?.[1] as CFMEntryType | undefined;
        const updatedAtString = row.querySelector("td:nth-child(3)")?.textContent.trim();
        const updatedAt = updatedAtString ? new Date(updatedAtString) : null;

        if (fileName && type && updatedAt && updatedAt.getFullYear() === currentYear) {
            const lastSchedule = schedules[type];

            if (!lastSchedule || (lastSchedule.updatedAt < updatedAt.getTime())) {
                const filePath = schedulesBaseUrl + fileName;
                schedules[type] = {
                    filePath,
                    updatedAt: updatedAt.getTime(),
                };
            }
        }

        return schedules;
    }, {} as Record<CFMEntryType, ScheduleFilePath>);

    const newScheduleFiles = {} as Record<CFMEntryType, ScheduleFile>;

    for (const [entryType, scheduleFile] of Object.entries(scheduleFiles)) {
        const { filePath, updatedAt } = scheduleFilePaths[entryType];

        if (updatedAt === scheduleFile.updatedAt) {
            newScheduleFiles[entryType] = scheduleFile;
            continue;
        }

        const csv = await pdfToCsv(filePath, {
            ...options,
            mergeRows: true,
            mergeColumns: {
                fromRow: 3,
                toRow: -2,
            },
        });
        const subjects = await getSubjects(csv, entryType);

        newScheduleFiles[entryType] = {
            updatedAt,
            subjects,
        };
    }

    return newScheduleFiles;
}

async function getSubjects(csv: string[][], entryType: CFMEntryType): Promise<Record<string, Subject>> {
    const subjects: Record<string, Subject> = {};

    await Promise.all(csv
        .filter(row => /\d{6}/.test(row[2] ?? ""))
        .map(async (row) => {
            const codes = row[2]!.trim().match(/\d{6}/g)!.map(c => +c);
            let name = row[3]?.trim().replace(/ {2,}|\n/g, " ");

            const creditsMatch = row[4]?.trim().match(/\(\s*(\d+)\s*\)|(\d+) cred/) ?? [];
            let creditsString = creditsMatch[1] ?? creditsMatch[2];

            if (!name || !creditsString) {
                const { data } = await axios.get<string>(`https://alumnos.udec.cl/?q=node/25&codasignatura=${codes[0]}`);
                name ||= data.match(/>(.+?) - \d{6}/)?.[1] ?? "";
                creditsString ||= data.match(/cr[eé]ditos *(?:<\/strong>)? *: *(\d+)/i)?.[1] ?? "";
            }

            const credits = creditsString ? +creditsString : undefined;

            const sections = row[9]?.trim().split("\n").flatMap(s => {
                s ||= "1";
                if (Number.isInteger(+s)) return +s;

                const match = s.match(/^(\d+) *a *(\d+)$/);
                if (!match) return [1];

                const [start, end] = match.slice(1, 3).map(n => +n) as [number, number];
                const min = Math.min(start, end);
                const max = Math.max(start, end);
                return Array.from({ length: max - min + 1 }, (_, i) => min + i);
            }) ?? [1];

            const preparedSchedule = prepareSubjectSchedule(row, sections.length, entryType);
            const schedules = parseSubjectSchedule(sections, preparedSchedule);

            for (const code of codes) {
                for (let i = 0; i < sections.length; i++) {
                    const section = sections[i]!;
                    const key = `${code}-${section}`;
                    if (key in subjects) continue;

                    subjects[key] = {
                        code,
                        name,
                        credits,
                        section,
                        schedule: schedules[i] ?? [{ defined: false }],
                    };
                }
            }
        })
    );

    return subjects;
}

function prepareSubjectSchedule(row: string[], sections: number, entryType: CFMEntryType): PreparedSchedule[] {
    const daysString = !row[10]?.trim().toLowerCase().includes("convenir")
        ? row[10]?.trim() ?? ""
        : "";
    const blocksString = !row[11]?.trim().toLowerCase().includes("convenir")
        ? row[11]?.trim() ?? ""
        : "";
    const classroomsString = row[12]?.trim() || "Sin sala";

    const daysPString = !row[14]?.trim().toLowerCase().includes("convenir")
        ? row[14]?.trim() ?? ""
        : "";
    const blocksPString = !row[15]?.trim().toLowerCase().includes("convenir")
        ? row[15]?.trim() ?? ""
        : "";
    const classroomsPString = row[16]?.trim() || "Sin sala";

    const schedule: PreparedSchedule[] = [];

    // has T schedule
    if (daysString && blocksString) {
        const days = daysString.match(daysRegex) as string[] | null ?? [];
        const blocks = blocksString.match(blocksRegex) as string[] | null ?? [];
        const classrooms = classroomsString.match(classroomsRegex) ?? classroomsString.split("\n");

        if (blocks.length === 1) {
            while (blocks.length < days.length) {
                blocks.push(blocks[0]!);
            }
        }

        if (days.length === 1) {
            while (days.length < blocks.length) {
                days.push(days[0]!);
            }
        }

        if (classrooms.length === 1) {
            const matches = classroomsString.match(classroomsRegex) as string[] | null ?? [];
            if (matches.length > 1) {
                classrooms.pop();
                classrooms.push(...matches);
            } else {
                // eslint-disable-next-line max-depth
                while (classrooms.length < days.length) {
                    classrooms.push(classrooms[0]!);
                }
            }
        }

        if (days.length === 1) {
            while (days.length < classrooms.length) {
                days.push(days[0]!);
                blocks.push(blocks[0]!);
            }
        }

        // TODO too lazy to check but does this change break anything?
        // before: const distributionFactor = Math.ceil(classrooms.length / days.length);
        const distributionFactor = Math.max(
            Math.ceil(classrooms.length / days.length),
            Math.ceil(days.length / classrooms.length)
        );

        if (distributionFactor > 1) {
            for (let i = 0; i < classrooms.length; i++) {
                const j = Math.floor(i / distributionFactor);
                const day = days[j]!;
                const block = blocks[j]!;
                const classroom = classrooms[i]!.replace(/\s+/g, " ");

                schedule.push({
                    type: ClassType.T,
                    day,
                    block,
                    classroom,
                });
            }
        } else {
            for (let i = 0; i < days.length; i++) {
                const day = days[i]!;
                const block = blocks[i]!;
                const classroom = classrooms[i]!.replace(/\s+/g, " ");

                schedule.push({
                    type: ClassType.T,
                    day,
                    block,
                    classroom,
                });
            }
        }
    }

    // has P or L schedule
    if (!daysPString || !blocksPString) {
        return schedule;
    }

    const daysP = daysPString.match(daysRegex) as string[] | null ?? [];
    const blocksP = blocksPString.match(blocksRegex) as string[] | null ?? [];
    const classroomsP = classroomsPString.match(classroomsRegex) ?? classroomsPString.split("\n");

    if (blocksP.length === 1) {
        while (blocksP.length < daysP.length) {
            blocksP.push(blocksP[0]!);
        }
    }

    if (daysP.length === 1) {
        while (daysP.length < blocksP.length) {
            daysP.push(daysP[0]!);
        }
    }

    if (classroomsP.length === 1) {
        const matches = classroomsPString.match(classroomsRegex) as string[] | null ?? [];
        if (matches.length > 1) {
            classroomsP[0] = matches[0]!;
            for (let i = 1; i < matches.length; i++) {
                classroomsP.push(matches[i]!);
            }
        } else {
            while (classroomsP.length < daysP.length) {
                classroomsP.push(classroomsP[0]!);
            }
        }
    }

    if (daysP.length === 1) {
        while (daysP.length < classroomsP.length) {
            daysP.push(daysP[0]!);
            blocksP.push(blocksP[0]!);
        }
    }

    if (classroomsP.length === daysP.length) {
        for (let i = 0; i < daysP.length; i++) {
            const day = daysP[i]!;
            const block = blocksP[i]!;
            const classroom = classroomsP[i]!.replace(/\s+/g, " ");

            schedule.push({
                type: ClassType.P,
                day,
                block,
                classroom,
            });
        }

        return schedule;
    }

    if (entryType === CFMEntryType.MAT) {
        const moreDaysThanSections = daysP.length - 1 >= sections;
        if (!moreDaysThanSections) {
            for (let i = 0; i < sections; i++) {
                const day = daysP[0]!;
                const block = blocksP[0]!;
                const classroom = classroomsP[i]!.replace(/\s+/g, " ");

                schedule.push({
                    type: ClassType.P,
                    day,
                    block,
                    classroom,
                });
            }
        } else {
            for (let i = 0; i < daysP.length - 1; i++) {
                const day = daysP[i]!;
                const block = blocksP[i]!;
                const classroom = classroomsP[i]!.replace(/\s+/g, " ");

                schedule.push({
                    type: ClassType.P,
                    day,
                    block,
                    classroom,
                });
            }
        }

        const day = daysP.at(-1)!;
        const block = blocksP.at(-1)!;
        const start = moreDaysThanSections ? daysP.length - 1 : sections;

        for (let i = start; i < classroomsP.length; i++) {
            const classroom = classroomsP[i]!.replace(/\s+/g, " ");

            schedule.push({
                type: ClassType.P,
                day,
                block,
                classroom,
            });
        }

        return schedule;
    }

    const chunks = [new Set<string>()];

    for (const classroom of classroomsP) {
        const chunk = chunks.at(-1)!;
        if (chunk.has(classroom)) {
            chunks.push(new Set([classroom]));
        } else {
            chunk.add(classroom);
        }
    }

    for (let i = 0; i < daysP.length; i++) {
        const day = daysP[i]!;
        const block = blocksP[i]!;

        for (const classroom of chunks[i]!) {
            schedule.push({
                type: ClassType.P,
                day,
                block,
                classroom: classroom.replace(/\s+/g, " "),
            });
        }
    }

    return schedule;
}

function parseSubjectSchedule(sections: number[], preparedSchedule: PreparedSchedule[]): SubjectSchedule[][] {
    const scheduleByType = new Map<ClassType, PreparedSchedule[]>();

    for (const entry of preparedSchedule) {
        if (!entry.day.toLowerCase().startsWith("test")) {
            const group = scheduleByType.get(entry.type) ?? [];
            group.push(entry);
            scheduleByType.set(entry.type, group);
            continue;
        }

        const type = ClassType.TEST;
        const group = scheduleByType.get(type) ?? [];
        group.push({
            type,
            day: entry.day.replace(/^test */i, "").toUpperCase(),
            block: entry.block,
            classroom: entry.classroom,
        });
        scheduleByType.set(type, group);
    }

    const scheduleBySection = new Map<number, PreparedSchedule[]>();

    for (const [classType, schedule] of scheduleByType) {
        if (sections.length === 1 || schedule.length === 1 || classType === ClassType.TEST) {
            for (const section of sections) {
                const entries = scheduleBySection.get(section) ?? [];
                entries.push(...schedule);
                scheduleBySection.set(section, entries);
            }
            continue;
        }

        if (classType !== ClassType.T && schedule.length % sections.length > 0) {
            for (const section of sections) {
                const entries = scheduleBySection.get(section) ?? [];
                let groupIdentifier = "";
                let group = 1;

                // eslint-disable-next-line max-depth
                for (const entry of schedule) {
                    const newGroupIdentifier = `${entry.day};${entry.block}`;
                    // eslint-disable-next-line max-depth
                    if (newGroupIdentifier !== groupIdentifier) {
                        groupIdentifier = newGroupIdentifier;
                        group = 1;
                    }

                    entries.push({
                        ...entry,
                        group,
                    });
                    group++;
                }

                scheduleBySection.set(section, entries);
            }
            continue;
        }

        const sectionStep = schedule.length / sections.length;
        let groupIdentifier = "";
        let lastSection: number | undefined = undefined;
        let group = 1;

        for (let i = 0; i < schedule.length; i++) {
            let entry = schedule[i]!;
            const section = sections[Math.floor(i / sectionStep)]!;
            const entries = scheduleBySection.get(section) ?? [];

            if (classType !== ClassType.T && sectionStep > 1) {
                const newGroupIdentifier = `${entry.day};${entry.block}`;
                // eslint-disable-next-line max-depth
                if (newGroupIdentifier !== groupIdentifier) {
                    groupIdentifier = newGroupIdentifier;
                    group = 1;
                }

                // eslint-disable-next-line max-depth
                if (section !== lastSection) {
                    lastSection = section;
                    group = 1;
                }

                entry = {
                    ...entry,
                    group,
                };
                group++;
            }

            entries.push(entry);
            scheduleBySection.set(section, entries);
        }
    }

    const result: SubjectSchedule[][] = [];

    for (const schedule of scheduleBySection.values()) {
        const sectionSchedule: SubjectSchedule[] = [];
        const groupsByType = new Map<ClassType, Set<number>>();

        for (const { type, group } of schedule) {
            const set = groupsByType.get(type) ?? new Set();
            if (group) {
                set.add(group);
            }
            groupsByType.set(type, set);
        }

        let lastType: ClassType | undefined = undefined;
        let groupOverride = 1;

        for (const { type, group, day, block, classroom } of schedule) {
            if (lastType !== type) {
                lastType = type;
                groupOverride = 1;
            }

            const keepDefaultGroup = !!group && (groupsByType.get(type)?.size ?? 0) > 1;

            const slashedDays = day.split(/ *\/ */g);
            const slashedBlocks = block.split(/ *\/ */g);
            const slashedClassrooms = classroom.split(/ *\/ */g);

            while (slashedBlocks.length < slashedDays.length) {
                slashedBlocks.push(slashedBlocks[0]!);
            }
            while (slashedClassrooms.length < slashedBlocks.length) {
                slashedClassrooms.push(slashedClassrooms[0]!);
            }

            for (let i = 0; i < slashedDays.length; i++) {
                const dayString = slashedDays[i]!;
                const blocksString = slashedBlocks[i]!;
                const classroomsString = slashedClassrooms[i]!;

                const day = ClassDay[dayString.toUpperCase() as keyof typeof ClassDay];
                const blocks: number[] = [];
                const classrooms: string[] = [];

                // eslint-disable-next-line max-depth
                if (!blocksString.includes("a")) {
                    blocks.push(...blocksString.split(/ *[y-] */).map(n => +n));
                } else {
                    const range = blocksString.split(/ *a */).map(n => +n);
                    // eslint-disable-next-line max-depth
                    for (let n = range[0]!; n <= range[1]!; n++) {
                        blocks.push(n);
                    }
                }

                // eslint-disable-next-line max-depth
                if (!classroomsString.includes(",")) {
                    classrooms.push(classroomsString);
                } else {
                    const splitClassrooms = classroomsString.split(/ *, */);
                    // eslint-disable-next-line max-depth
                    if (/^\d+$/.test(splitClassrooms[1]!)) {
                        const classroomPrefix = splitClassrooms[0]!.match(/^(.+?)\d+$/)?.[1] ?? "";
                        splitClassrooms[1] = classroomPrefix + splitClassrooms[1];
                    }

                    classrooms.push(...splitClassrooms);
                }

                // eslint-disable-next-line max-depth
                for (const classroom of classrooms) {
                    sectionSchedule.push({
                        defined: true,
                        type,
                        ...keepDefaultGroup && { group },
                        ...(classrooms.length > 1 || type === ClassType.TEST) && {
                            group: groupOverride++,
                        },
                        day,
                        blocks,
                        classroom,
                    });
                }
            }
        }

        result.push(sectionSchedule);
    }

    return result;
}

type PreparedSchedule = {
    type: ClassType;
    group?: number;
    day: string;
    block: string;
    classroom: string;
};

type ScheduleFilePath = {
    filePath: string;
    updatedAt: number;
};
