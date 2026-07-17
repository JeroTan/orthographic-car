import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SECTION_HEADER_SIZE = 32;

describe('packed residential buildings', () => {
	it('contains six increasingly tall model variants', async () => {
		const bytes = await readFile(
			new URL('../assets/buildings/residential-buildings.bin', import.meta.url),
		);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const magic = String.fromCharCode(...bytes.subarray(0, 4));
		const variantCount = view.getUint32(4, true);
		const heights = Array.from({ length: variantCount }, (_, index) =>
			view.getFloat32(8 + index * SECTION_HEADER_SIZE + 8, true) * 2,
		);

		expect({ magic, variantCount }).toEqual({ magic: 'BLD1', variantCount: 6 });
		expect(heights.every((height, index) => index === 0 || height > heights[index - 1])).toBe(
			true,
		);
	});
});
