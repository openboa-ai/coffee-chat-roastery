#!/usr/bin/env node
interface Output {
    write(value: string): unknown;
}
export declare function runCli(arguments_: string[], output?: Output): Promise<number>;
export {};
