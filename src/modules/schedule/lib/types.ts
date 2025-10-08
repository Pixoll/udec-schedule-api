export enum ClassType {
    // noinspection JSUnusedGlobalSymbols
    T = "t",
    P = "p",
    L = "l",
    TEST = "test",
}

export enum ClassDay {
    // noinspection JSUnusedGlobalSymbols
    LU = "lu",
    MA = "ma",
    MI = "mi",
    JU = "ju",
    VI = "vi",
    SA = "sa",
    DO = "do",
}

export type ScheduleFile = {
    updatedAt: number;
    subjects: Record<string, Subject>;
};

export type Subject = {
    code: number;
    name: string;
    credits?: number;
    section: number;
    schedule: SubjectSchedule[];
};

export type SubjectSchedule = SubjectScheduleDefined | SubjectScheduleTBD;

export type SubjectScheduleDefined = {
    defined: true;
    type: ClassType;
    group?: number;
    day: ClassDay;
    blocks: number[];
    classroom: string;
};

export type SubjectScheduleTBD = {
    defined: false;
    type?: ClassType;
    group?: number;
};
