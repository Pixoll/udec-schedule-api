import { type ArgumentMetadata, Injectable, type PipeTransform } from "@nestjs/common";

@Injectable()
export class LowercaseQueryKeysPipe implements PipeTransform {
    public transform(value: unknown, metadata: ArgumentMetadata): unknown {
        if (metadata.type === "query" && typeof value === "object" && value !== null) {
            return Object.fromEntries(Object.entries(value as Record<string, unknown>)
                .map(([k, v]) => [k.toLowerCase(), v])
            );
        }

        return value;
    }
}
