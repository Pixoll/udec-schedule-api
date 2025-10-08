import { Module } from "@nestjs/common";
import { ScheduleModule } from "./modules/schedule/schedule.module";

@Module({
    imports: [ScheduleModule],
})
export class AppModule {
}
