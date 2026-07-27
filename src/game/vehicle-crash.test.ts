import { describe, expect, it } from 'vitest';
import {
	applyVehicleCrashImpulse,
	createVehicleCrashState,
	stepVehicleCrashState,
} from './vehicle-crash';

describe('vehicle crash tumble', () => {
	it('converts a hard impulse into airborne angular motion, then settles on ground', () => {
		const crash = createVehicleCrashState();
		applyVehicleCrashImpulse(crash, {
			heading: 0,
			velocityX: 6,
			velocityZ: 24,
			intensity: 0.9,
			verticalVelocity: 8,
		});

		expect(Math.abs(crash.crashYawVelocity)).toBeGreaterThan(0);
		expect(Math.abs(crash.crashPitchVelocity)).toBeGreaterThan(0);
		expect(Math.abs(crash.crashRollVelocity)).toBeGreaterThan(0);

		stepVehicleCrashState(crash, 0.2, true);

		expect(Math.abs(crash.crashPitch)).toBeGreaterThan(0.1);
		expect(Math.abs(crash.crashRoll)).toBeGreaterThan(0.1);

		for (let frame = 0; frame < 120; frame += 1) {
			stepVehicleCrashState(crash, 0.05, false);
		}

		expect(crash.crashYaw).toBe(0);
		expect(crash.crashPitch).toBe(0);
		expect(crash.crashRoll).toBe(0);
	});
});
