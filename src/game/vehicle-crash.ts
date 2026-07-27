export interface VehicleCrashState {
	crashYaw: number;
	crashPitch: number;
	crashRoll: number;
	crashYawVelocity: number;
	crashPitchVelocity: number;
	crashRollVelocity: number;
}

export interface VehicleCrashImpulse {
	heading: number;
	velocityX: number;
	velocityZ: number;
	intensity: number;
	verticalVelocity: number;
}

const MAX_ANGULAR_VELOCITY = 8;
const AIR_ANGULAR_DAMPING = 0.35;
const GROUND_ANGULAR_DAMPING = 7.5;
const GROUND_TILT_SETTLE_RATE = 11;
const GROUND_YAW_SETTLE_RATE = 5;
const SETTLE_EPSILON = 0.003;

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function wrapAngle(value: number): number {
	return Math.atan2(Math.sin(value), Math.cos(value));
}

function settleAngle(value: number, response: number): number {
	return value + wrapAngle(-value) * response;
}

function snapSmall(value: number): number {
	return Math.abs(value) < SETTLE_EPSILON ? 0 : value;
}

export function createVehicleCrashState(): VehicleCrashState {
	return {
		crashYaw: 0,
		crashPitch: 0,
		crashRoll: 0,
		crashYawVelocity: 0,
		crashPitchVelocity: 0,
		crashRollVelocity: 0,
	};
}

/**
 * Adds visible angular inertia from a linear collision impulse. This is a
 * lightweight rigid-body approximation: road vehicles remain one body, but
 * strong hits can spin and tumble rather than only squash in place.
 */
export function applyVehicleCrashImpulse(
	state: VehicleCrashState,
	impulse: VehicleCrashImpulse,
): void {
	if (impulse.verticalVelocity <= 0.25 || impulse.intensity <= 0.12) return;

	const forwardX = Math.sin(impulse.heading);
	const forwardZ = Math.cos(impulse.heading);
	const rightX = Math.cos(impulse.heading);
	const rightZ = -Math.sin(impulse.heading);
	const longitudinal = impulse.velocityX * forwardX + impulse.velocityZ * forwardZ;
	const lateral = impulse.velocityX * rightX + impulse.velocityZ * rightZ;
	const tumble = clamp(
		impulse.intensity * 0.65 + Math.min(10, impulse.verticalVelocity) * 0.05,
		0,
		1,
	);
	const direction = Math.sign(lateral) || Math.sign(longitudinal) || 1;

	state.crashYawVelocity = clamp(
		state.crashYawVelocity + lateral * 0.18 + direction * tumble * 0.7,
		-MAX_ANGULAR_VELOCITY,
		MAX_ANGULAR_VELOCITY,
	);
	state.crashPitchVelocity = clamp(
		state.crashPitchVelocity - longitudinal * 0.17 + direction * tumble * 0.35,
		-MAX_ANGULAR_VELOCITY,
		MAX_ANGULAR_VELOCITY,
	);
	state.crashRollVelocity = clamp(
		state.crashRollVelocity + lateral * 0.24 + direction * tumble * 0.28,
		-MAX_ANGULAR_VELOCITY,
		MAX_ANGULAR_VELOCITY,
	);
}

export function stepVehicleCrashState(
	state: VehicleCrashState,
	deltaSeconds: number,
	airborne: boolean,
): void {
	const delta = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.25);
	if (delta === 0) return;

	state.crashYaw += state.crashYawVelocity * delta;
	state.crashPitch += state.crashPitchVelocity * delta;
	state.crashRoll += state.crashRollVelocity * delta;

	const damping = Math.exp(-(airborne ? AIR_ANGULAR_DAMPING : GROUND_ANGULAR_DAMPING) * delta);
	state.crashYawVelocity *= damping;
	state.crashPitchVelocity *= damping;
	state.crashRollVelocity *= damping;

	if (airborne) return;

	const tiltResponse = 1 - Math.exp(-GROUND_TILT_SETTLE_RATE * delta);
	const yawResponse = 1 - Math.exp(-GROUND_YAW_SETTLE_RATE * delta);
	state.crashYaw = snapSmall(settleAngle(state.crashYaw, yawResponse));
	state.crashPitch = snapSmall(settleAngle(state.crashPitch, tiltResponse));
	state.crashRoll = snapSmall(settleAngle(state.crashRoll, tiltResponse));
	state.crashYawVelocity = snapSmall(state.crashYawVelocity);
	state.crashPitchVelocity = snapSmall(state.crashPitchVelocity);
	state.crashRollVelocity = snapSmall(state.crashRollVelocity);
}

export function hasVehicleCrashMotion(state: VehicleCrashState): boolean {
	return (
		Math.abs(state.crashYaw) > SETTLE_EPSILON ||
		Math.abs(state.crashPitch) > SETTLE_EPSILON ||
		Math.abs(state.crashRoll) > SETTLE_EPSILON ||
		Math.abs(state.crashYawVelocity) > SETTLE_EPSILON ||
		Math.abs(state.crashPitchVelocity) > SETTLE_EPSILON ||
		Math.abs(state.crashRollVelocity) > SETTLE_EPSILON
	);
}
