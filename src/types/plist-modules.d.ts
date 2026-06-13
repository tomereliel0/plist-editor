declare module 'plist' {
	export function parse(source: string): unknown;
	export function build(value: unknown): string;
}

declare module 'bplist-parser' {
	export function parseBuffer(buffer: Uint8Array): unknown[];
}