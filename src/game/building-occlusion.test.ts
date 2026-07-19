import { describe, expect, it } from 'vitest';

import { buildingOccludesCar } from './building-occlusion';

describe('building occlusion', () => {
	it('fades a building between car and camera when screen bounds overlap', () => {
		expect(
			buildingOccludesCar(
				{ x: 0.01, y: 0.01, z: 0.25, radiusX: 0.08, radiusY: 0.12 },
				{ x: 0, y: 0, z: 0.5 },
			),
		).toBe(true);
	});

	it('keeps buildings behind or beside car opaque', () => {
		expect(
			buildingOccludesCar(
				{ x: 0, y: 0, z: 0.75, radiusX: 0.2, radiusY: 0.2 },
				{ x: 0, y: 0, z: 0.5 },
			),
		).toBe(false);
		expect(
			buildingOccludesCar(
				{ x: 0.4, y: 0, z: 0.25, radiusX: 0.05, radiusY: 0.05 },
				{ x: 0, y: 0, z: 0.5 },
			),
		).toBe(false);
	});
});
