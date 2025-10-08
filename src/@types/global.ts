// noinspection JSUnusedGlobalSymbols

declare global {
    interface String {
        toUpperCase<S extends string>(this: S): Uppercase<S>;
    }

    interface ObjectConstructor {
        entries<K extends string, V>(o: Record<K, V>): Array<[K, V]>;
    }
}

export {};
