import { ApiExtraModels, ApiProperty } from "@nestjs/swagger";
import { SubjectScheduleTBD } from "./subject-schedule-tbd.entity";
import { SubjectSchedule } from "./subject-schedule.entity";

// noinspection JSUnusedGlobalSymbols
@ApiExtraModels(SubjectSchedule, SubjectScheduleTBD)
export class Subject {
    public declare code: number;
    public declare name: string;
    public declare credits?: number;
    public declare section: number;
    @ApiProperty({
        type: "array",
        items: {
            oneOf: [{
                $ref: "#/components/schemas/SubjectSchedule",
            }, {
                $ref: "#/components/schemas/SubjectScheduleTBD",
            }],
        },
    })
    public declare schedule: Array<SubjectSchedule | SubjectScheduleTBD>;
}
