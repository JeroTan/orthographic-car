// @ts-expect-error Vitest runs in Node; browser tsconfig intentionally omits Node declarations.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseTrafficModels } from './traffic-model';
import { TRAFFIC_MODEL_IDS } from './traffic-vehicle-catalog';

const RECORD_BYTES = 76;

function packedCatalogBuffer(): ArrayBuffer {
	const headerSize = 12 + TRAFFIC_MODEL_IDS.length * RECORD_BYTES;
	const bytesPerModel =
		3 * Int16Array.BYTES_PER_ELEMENT +
		3 * Int8Array.BYTES_PER_ELEMENT +
		2 * Uint16Array.BYTES_PER_ELEMENT;
	const buffer = new ArrayBuffer(headerSize + TRAFFIC_MODEL_IDS.length * (bytesPerModel + 1));
	const view = new DataView(buffer);
	for (const [index, character] of [...'TVM2'].entries()) view.setUint8(index, character.charCodeAt(0));
	view.setUint32(4, TRAFFIC_MODEL_IDS.length, true);
	view.setUint32(8, headerSize, true);
	let dataOffset = headerSize;
	for (const [index, id] of TRAFFIC_MODEL_IDS.entries()) {
		const offset = 12 + index * RECORD_BYTES;
		const idBytes = new TextEncoder().encode(id);
		view.setUint8(offset, idBytes.length);
		new Uint8Array(buffer, offset + 1, idBytes.length).set(idBytes);
		view.setUint32(offset + 36, 1, true);
		view.setFloat32(offset + 40, 0, true);
		view.setFloat32(offset + 44, 0.5, true);
		view.setFloat32(offset + 48, 0, true);
		view.setFloat32(offset + 52, 0.5, true);
		view.setFloat32(offset + 56, 0.5, true);
		view.setFloat32(offset + 60, 0.5, true);
		dataOffset = Math.ceil(dataOffset / Int16Array.BYTES_PER_ELEMENT) * Int16Array.BYTES_PER_ELEMENT;
		view.setUint32(offset + 64, dataOffset, true);
		dataOffset += 3 * Int16Array.BYTES_PER_ELEMENT;
		view.setUint32(offset + 68, dataOffset, true);
		dataOffset += 3 * Int8Array.BYTES_PER_ELEMENT;
		dataOffset = Math.ceil(dataOffset / Uint16Array.BYTES_PER_ELEMENT) * Uint16Array.BYTES_PER_ELEMENT;
		view.setUint32(offset + 72, dataOffset, true);
		dataOffset += 2 * Uint16Array.BYTES_PER_ELEMENT;
	}
	return buffer;
}

describe('packed traffic models', () => {
	it('accepts one compact quantized geometry for every catalog model', () => {
		const models = parseTrafficModels(packedCatalogBuffer());
		expect(new Set(models.keys())).toEqual(new Set(TRAFFIC_MODEL_IDS));
		for (const model of models.values()) {
			expect(model.geometry.getAttribute('position').normalized).toBe(true);
			expect(model.geometry.getAttribute('uv').normalized).toBe(true);
			expect(model.halfExtentMeters.length()).toBeGreaterThan(0);
		}
	});

	it('does not pack multiple source vehicles into one bus model', () => {
		const source = readFileSync(
			new URL('../assets/traffic-models/traffic-models.bin', import.meta.url),
		);
		const models = parseTrafficModels(
			source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
		);
		const busVertexCounts = ['city-bus-1', 'city-bus-2', 'city-bus-3'].map(
			(id) => models.get(id)?.geometry.getAttribute('position').count ?? 0,
		);

		expect(Math.min(...busVertexCounts)).toBeGreaterThan(0);
		expect(Math.max(...busVertexCounts)).toBeLessThan(30_000);
	});
});
