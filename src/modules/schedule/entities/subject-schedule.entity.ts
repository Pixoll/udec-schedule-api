import { ApiProperty } from "@nestjs/swagger";
import { ClassDay, ClassType } from "../lib";

// noinspection JSUnusedGlobalSymbols
export class SubjectSchedule {
    @ApiProperty({
        type: Boolean,
        enum: [true],
    })
    public declare defined: true;
    @ApiProperty({
        enum: ClassType,
        enumName: "ClassType",
    })
    public declare type: ClassType;
    public declare group?: number;
    @ApiProperty({
        enum: ClassDay,
        enumName: "ClassDay",
    })
    public declare day: ClassDay;
    public declare blocks: number[];
    public declare classroom: string;
}
