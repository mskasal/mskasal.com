/* tslint:disable */
/* eslint-disable */

export function pong_game(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly pong_game: () => void;
  readonly wasm_bindgen_9b4eb71ea036e717___convert__closures_____invoke___web_sys_6f10bedbef31ddea___features__gen_MessageEvent__MessageEvent_____: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen_9b4eb71ea036e717___closure__destroy___dyn_core_7d5f0a2ba6a62c33___ops__function__FnMut__web_sys_6f10bedbef31ddea___features__gen_MessageEvent__MessageEvent____Output_______: (a: number, b: number) => void;
  readonly wasm_bindgen_9b4eb71ea036e717___convert__closures_____invoke______: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
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
