import { ApiExtraModels, ApiProperty } from "@nestjs/swagger";
import { Subject } from "./subject.entity";

@ApiExtraModels(Subject)
export class Schedule {
    public declare updating: boolean;
    @ApiProperty({
        additionalProperties: {
            $ref: "#/components/schemas/Subject",
        },
    })
    public declare schedules: Record<string, Subject>;
}
