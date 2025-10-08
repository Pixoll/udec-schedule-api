import { ApiProperty } from "@nestjs/swagger";
import type { ClassDay, ClassType } from "../lib";

// noinspection JSUnusedGlobalSymbols
export class SubjectSchedule {
    @ApiProperty({
        type: Boolean,
        enum: [true],
    })
    public declare defined: true;
    public declare type: ClassType;
    public declare group?: number;
    public declare day: ClassDay;
    public declare blocks: number[];
    public declare classroom: string;
}
