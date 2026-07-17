import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SECTION_HEADER_SIZE = 40;
const FRONT_LEFT_SECTION = 1;
const FRONT_RIGHT_SECTION = 2;
const REAR_LEFT_SECTION = 3;
const REAR_RIGHT_SECTION = 4;

function readWheelSection(view, index) {
	const offset = 8 + index * SECTION_HEADER_SIZE;
	return {
		x: view.getFloat32(offset + 4, true),
		z: view.getFloat32(offset + 12, true),
		width: view.getFloat32(offset + 16, true) * 2,
	};
}

describe('packed Porsche model', () => {
	it('faces its narrow front axle toward game forward +Z', async () => {
		const bytes = await readFile(
			new URL('../assets/porsche-car-model/porsche-model.bin', import.meta.url),
		);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const front = [
			readWheelSection(view, FRONT_LEFT_SECTION),
			readWheelSection(view, FRONT_RIGHT_SECTION),
		];
		const rear = [
			readWheelSection(view, REAR_LEFT_SECTION),
			readWheelSection(view, REAR_RIGHT_SECTION),
		];
		const averageWidth = (sections) =>
			sections.reduce((total, section) => total + section.width, 0) / sections.length;

		expect(front.every((wheel) => wheel.z > 0)).toBe(true);
		expect(rear.every((wheel) => wheel.z < 0)).toBe(true);
		expect(front[0].x).toBeLessThan(0);
		expect(front[1].x).toBeGreaterThan(0);
		expect(rear[0].x).toBeLessThan(0);
		expect(rear[1].x).toBeGreaterThan(0);
		expect(averageWidth(rear)).toBeGreaterThan(averageWidth(front));
	});
});
