import { ApiProperty } from "@nestjs/swagger";
import { ClassType } from "../lib";

// noinspection JSUnusedGlobalSymbols
export class SubjectScheduleTBD {
    @ApiProperty({
        type: Boolean,
        enum: [false],
    })
    public declare defined: boolean;
    @ApiProperty({
        enum: ClassType,
        enumName: "ClassType",
    })
    public declare type?: ClassType;
    public declare group?: number;
}
