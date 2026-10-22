/* tslint:disable */
/* eslint-disable */

export function check_tx(hex: string, network: string, height: number, transparent_input_values_zat: any): any;

export function check_tx_at_nu7(hex: string, network: string, tip_height: number, transparent_input_values_zat: any): any;

export function decode_tx(hex: string, network: string): any;

export function fee_zat(hex: string, transparent_input_values_zat: any): any;

export function inspect_pczt(base64_or_hex: string, network: string): any;

export function trace_tx(hex: string, network: string): any;

export function upgrade_at(network: string, height: number): any;

export function zip318_tx(hex: string, network: string, height: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly check_tx: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly check_tx_at_nu7: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly decode_tx: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly fee_zat: (a: number, b: number, c: any) => [number, number, number];
    readonly inspect_pczt: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly trace_tx: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly upgrade_at: (a: number, b: number, c: number) => [number, number, number];
    readonly zip318_tx: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly rustsecp256k1_v0_14_context_create: (a: number) => number;
    readonly rustsecp256k1_v0_14_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_14_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_14_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
