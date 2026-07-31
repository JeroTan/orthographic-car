import { describe, expect, it } from 'vitest';

import {
	stepVehicleMotion,
	type VehicleMotionProfile,
	type VehicleMotionState,
} from './vehicle-motion';

const CAR_PROFILE: VehicleMotionProfile = {
	maxForwardSpeed: 40,
	maxReverseSpeed: 12,
	acceleration: 8,
	reverseAcceleration: 5,
	braking: 14,
	coastDrag: 2,
	turningDrag: 3,
	wheelbase: 2.6,
	maxSteeringAngle: 0.5,
	steeringResponse: 3,
	maxLateralAcceleration: 9,
	accelerationTaper: 0.75,
	accelerationCurve: 1.5,
};

function movingState(): VehicleMotionState {
	return { heading: 0, speed: 10, steeringAngle: 0 };
}

describe('shared vehicle motion', () => {
	it('uses bounded wheelbase steering instead of assigning a destination heading', () => {
		const car = movingState();
		const truck = movingState();

		stepVehicleMotion(
			car,
			{ drive: 1, brake: 0, steering: 1 },
			CAR_PROFILE,
			0.05,
		);
		stepVehicleMotion(
			truck,
			{ drive: 1, brake: 0, steering: 1 },
			{ ...CAR_PROFILE, wheelbase: 5.2, maxSteeringAngle: 0.4 },
			0.05,
		);

		expect(car.heading).toBeGreaterThan(0);
		expect(car.heading).toBeLessThan(0.35);
		expect(truck.heading).toBeGreaterThan(0);
		expect(truck.heading).toBeLessThan(car.heading);
	});

	it('accepts controls for acceleration, braking, and reverse', () => {
		const state = movingState();

		stepVehicleMotion(
			state,
			{ drive: 1, brake: 0, steering: 0 },
			CAR_PROFILE,
			0.1,
		);
		expect(state.speed).toBeGreaterThan(10);

		for (let step = 0; step < 4; step += 1) {
			stepVehicleMotion(
				state,
				{ drive: 0, brake: 1, steering: 0 },
				CAR_PROFILE,
				0.25,
			);
		}
		expect(state.speed).toBe(0);

		stepVehicleMotion(
			state,
			{ drive: -1, brake: 0, steering: 0 },
			CAR_PROFILE,
			0.5,
		);
		expect(state.speed).toBeLessThan(0);
	});
});
