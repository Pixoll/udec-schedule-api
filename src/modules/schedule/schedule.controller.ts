import { HttpException } from "@/exceptions/http-exception.entity";
import { Controller, Get } from "@nestjs/common";
import { ApiInternalServerErrorResponse, ApiOkResponse } from "@nestjs/swagger";
import { Schedule } from "./entities/schedule.entity";
import { ScheduleService } from "./schedule.service";

@Controller("schedule")
export class ScheduleController {
    public constructor(private scheduleService: ScheduleService) {
    }

    /**
     * Get the entire schedule.
     */
    @Get()
    @ApiOkResponse({
        description: "An object containing the entire schedule.",
        type: Schedule,
    })
    @ApiInternalServerErrorResponse({
        description: "An error occurred while retrieving the schedule.",
        type: HttpException,
    })
    public async getSchedule(): Promise<Schedule> {
        return await this.scheduleService.getSchedule();
    }
}
