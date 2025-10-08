import { ApiProperty } from "@nestjs/swagger";
import type { ClassType } from "../lib";

// noinspection JSUnusedGlobalSymbols
export class SubjectScheduleTBD {
    @ApiProperty({
        type: Boolean,
        enum: [false],
    })
    public declare defined: boolean;
    public declare type?: ClassType;
    public declare group?: number;
}
