import axios from "axios";
import { Agent } from "node:https";
import { pdfToCsv, type PdfToCsvOptions } from "./pdf-to-csv";
import { ClassDay, ClassType, type ScheduleFile, type Subject, type SubjectSchedule } from "./types";

// eslint-disable-next-line max-len
const subjectScheduleRegex = /(?:[[|l(]?(?<type>[TPL])(?: ?G(?<group>\d))?[\]|l)])? *(?:(?<day>Lu|Ma|Mi|Ju|Vi|Sa|Do) ?(?<blocks>[\d ,]+) ?\(?(?<classroom>[^)]+)\)|(?<tbd>Coordinar?(?: con)? docentes?))/gi;

const scheduleApiUrl = "https://ofivirtualfi.udec.cl/api/file/documents/"
    + "?limit=1"
    + "&searchFields=resourceType,mimeType"
    + "&search=scheduleSubjects,application/pdf"
    + "&sort=id_file+desc"
    + "&exactMatching=true";

export async function updateEngineeringScheduleOld(
    scheduleFile: ScheduleFile,
    options: Pick<PdfToCsvOptions, "logger" | "pdfFilesDir" | "pyApiUrl">
): Promise<ScheduleFile> {
    const fileDocument = await axios.get<DocumentFileResponse>(scheduleApiUrl, {
        httpsAgent: new Agent({ rejectUnauthorized: false }),
    }).then(r => r.data);

    if (!fileDocument.success) {
        throw new Error("Could not fetch latest subject information:", { cause: fileDocument });
    }

    const pdfFile = fileDocument.data.data[0];
    if (!pdfFile) {
        throw new Error("Could not find PDF file:", { cause: fileDocument });
    }

    const fileTimestamp = new Date(pdfFile.updatedAt ?? pdfFile.createdAt).getTime();
    if (fileTimestamp === scheduleFile.updatedAt) {
        return scheduleFile;
    }

    const csv = await pdfToCsv(`https://ofivirtualfi.udec.cl/api/file/downloadFile/${pdfFile.fileName}`, {
        ...options,
        ignoreSSL: true,
        mergeRows: true,
    });
    const subjects = await getSubjects(csv);

    return {
        updatedAt: fileTimestamp,
        subjects,
    };
}

async function getSubjects(csv: string[][]): Promise<Record<string, Subject>> {
    const subjectRows = csv.filter((row): row is CsvRow => row.length === 10 && /^(\d{6})+$/m.test(row[0] ?? ""));
    const subjects: Record<string, Subject> = {};

    await Promise.all(subjectRows.map<Promise<void>>(async (row) => {
        const codes = row[0].split("\n").map(c => +c);
        const sections = row[1].split("\n");
        const name = row[2].split("\n");
        const credits = row[3].split("\n").map(n => +n).filter(n => !Number.isNaN(n));
        const schedule = parseSubjectSchedule(row[8]);

        if (credits.length === 0) {
            const { data } = await axios.get<string>(`https://alumnos.udec.cl/?q=node/25&codasignatura=${codes[0]}`);
            const creditsString = data.match(/cr[eé]ditos *(?:<\/strong>)? *: *(\d+)/i)?.[1];

            if (creditsString) {
                credits.push(+creditsString);
            }
        }

        for (let i = 0; i < codes.length; i++) {
            const code = codes[i]!;
            const splitSections = codes.length === sections.length
                ? sections[i]!.trim().split(/\s*-\s*/)
                : sections;

            for (const section of splitSections) {
                const key = `${code}-${section}`;
                if (key in subjects) continue;

                subjects[key] = {
                    code,
                    name: name[i] ?? name[0]!,
                    credits: credits[i] ?? credits[0]!,
                    section: +section,
                    schedule,
                };
            }
        }
    }));

    return subjects;
}

function parseSubjectSchedule(text: string): SubjectSchedule[] {
    const scheduleMatches = text.replaceAll("\n", " ").matchAll(subjectScheduleRegex);
    const schedule: SubjectSchedule[] = [];

    let lastScheduleIndex = -1;
    for (const match of scheduleMatches) {
        const groups = match.groups as unknown as SubjectScheduleMatchGroups;

        let type = groups.type ? ClassType[groups.type.toUpperCase()] : undefined;
        const group = groups.group ? +groups.group : undefined;

        let i = lastScheduleIndex;
        while (i >= 0 && !type) {
            type = schedule[i--]?.type;
        }

        if (groups.tbd !== undefined) {
            schedule.push({
                defined: false,
                type,
                group,
            });
            lastScheduleIndex++;
            continue;
        }

        if (type === undefined) {
            console.error("Could not resolve schedule from", groups);
            continue;
        }

        const day = ClassDay[groups.day.toUpperCase()];
        const blockStrings = groups.blocks?.match(/\d+/g) as string[] | null;
        const blocks = blockStrings?.flatMap(n => +n > 13 ? n.split("").map(m => +m) : +n) ?? [];
        const classroom = groups.classroom.trim();

        schedule.push({
            defined: true,
            type,
            group,
            day,
            blocks,
            classroom,
        });
        lastScheduleIndex++;
    }

    return schedule;
}

type SubjectScheduleMatchGroups = {
    type: Lowercase<keyof typeof ClassType> | undefined;
    group: string | undefined;
    day: Lowercase<keyof typeof ClassDay>;
    blocks: string | undefined;
    classroom: string;
    tbd: undefined;
} | {
    type: Lowercase<keyof typeof ClassType> | undefined;
    group: string | undefined;
    day: undefined;
    blocks: undefined;
    classroom: undefined;
    tbd: string;
};

type CsvRow = [string, string, string, string, string, string, string, string, string, string];

type DocumentFileResponse = {
    success: true;
    data: {
        totalItems: number;
        totalPages: number;
        currentPage: number;
        data: DocumentFile[];
    };
} | {
    success: false;
    errorCode: number;
    error: string;
};

type DocumentFile = {
    id_file: number;
    originalName: string;
    fileName: string;
    displayName: string | null;
    mimeType: string;
    size: number;
    encoding: string;
    filePath: string;
    destination: string;
    resourceId: number | null;
    resourceType: string;
    visibility: string | null;
    createdAt: string;
    updatedAt: string | null;
    deletedAt: string | null;
};
