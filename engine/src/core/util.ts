/** Use in the `default` branch of a switch to get a compile error when a union variant is unhandled. */
export function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

/** Immutable "set key" for records. */
export function withEntry<K extends PropertyKey, V>(record: Readonly<Record<K, V>>, key: K, value: V): Readonly<Record<K, V>> {
    return { ...record, [key]: value } as Record<K, V>;
}

/** Immutable "delete key" for records. */
export function without<K extends PropertyKey, V>(record: Readonly<Record<K, V>>, key: K): Readonly<Record<K, V>> {
    const copy = { ...record } as Record<K, V>;
    delete copy[key];
    return copy;
}

export function keysOf<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
}

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Splits an array into ones that meet the condition and ones that don't meet the condition */
export function partition<T>(array: readonly T[], condition: (element: T) => boolean): [T[], T[]] {
    return array.reduce<[T[], T[]]>(
        (acc, element) => {
            acc[condition(element) ? 0 : 1].push(element);
            return acc;
        },
        [[], []],
    );
}

type OmitUndefined<T> = {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
    [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export const omitUndefined = <T extends object>(obj: T): OmitUndefined<T> => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as OmitUndefined<T>;

export function capitalize(s: string, restLowercase?: boolean): string {
    return s.charAt(0).toUpperCase() + (restLowercase ? s.slice(1).toLowerCase() : s.slice(1));
}