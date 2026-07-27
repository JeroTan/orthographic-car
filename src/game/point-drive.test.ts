import { describe, expect, it } from 'vitest';

import { pointDriveInput } from './point-drive';

describe('point drive input', () => {
	it('accelerates and steers toward a side target in front of the reverse cone', () => {
		const input = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 0 },
			{ x: 8, z: 0 },
		);

		expect(input).toMatchObject({ accelerate: true, brake: false });
		expect(input.left || input.right).toBe(true);
	});

	it('brakes first then keeps reverse engaged for a target behind the car', () => {
		const input = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 12 },
			{ x: 0, z: -8 },
		);

		expect(input).toMatchObject({ accelerate: false, brake: true, left: false, right: false });
	});

	it('reverses steering direction while vehicle is moving backward', () => {
		const forward = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 4 },
			{ x: 8, z: 8 },
		);
		const reverse = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: -4 },
			{ x: 8, z: 8 },
		);

		expect([forward.left, forward.right]).toEqual([reverse.right, reverse.left]);
	});
});
