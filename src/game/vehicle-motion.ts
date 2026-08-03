export interface VehicleMotionInstruction {
	/** -1 reverse, 0 coast, 1 forward. */
	drive: number;
	/** Service-brake pressure from 0 to 1. */
	brake: number;
	/** -1 right, 0 straight, 1 left. */
	steering: number;
	handbrake?: boolean;
}

export interface VehicleMotionState {
	heading: number;
	speed: number;
	steeringAngle: number;
}

export interface VehicleMotionProfile {
	maxForwardSpeed: number;
	maxReverseSpeed: number;
	acceleration: number;
	reverseAcceleration: number;
	braking: number;
	coastDrag: number;
	turningDrag: number;
	wheelbase: number;
	maxSteeringAngle: number;
	steeringResponse: number;
	maxLateralAcceleration: number;
	steeringAssistLateralAcceleration?: number;
	accelerationTaper: number;
	accelerationCurve: number;
	brakingYawBoost?: number;
	handbrakeDrag?: number;
	handbrakeYawBoost?: number;
}

export interface VehicleMotionResult {
	longitudinalAcceleration: number;
	yawRate: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function moveToward(current: number, target: number, amount: number): number {
	if (current < target) return Math.min(target, current + amount);
	return Math.max(target, current - amount);
}

function normalizeAngle(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function accelerationFactor(
	speed: number,
	maxForwardSpeed: number,
	taper: number,
	curve: number,
): number {
	const ratio = clamp(Math.max(0, speed) / Math.max(0.01, maxForwardSpeed), 0, 1);
	return 1 - taper * Math.pow(ratio, curve);
}

/**
 * Shared ground-vehicle motion. Callers provide instructions; this module owns
 * acceleration, braking, steering response, wheelbase turn radius, and grip cap.
 */
export function stepVehicleMotion(
	state: VehicleMotionState,
	instruction: VehicleMotionInstruction,
	profile: VehicleMotionProfile,
	deltaSeconds: number,
): VehicleMotionResult {
	const delta = Number.isFinite(deltaSeconds)
		? clamp(deltaSeconds, 0, 0.25)
		: 0;
	const previousSpeed = state.speed;
	const previousHeading = state.heading;
	const drive = clamp(instruction.drive, -1, 1);
	const brake = clamp(instruction.brake, 0, 1);
	const steering = clamp(instruction.steering, -1, 1);

	if (brake > 0) {
		state.speed = moveToward(state.speed, 0, profile.braking * brake * delta);
	} else if (drive > 0) {
		if (state.speed < 0) {
			state.speed = moveToward(state.speed, 0, profile.braking * drive * delta);
		} else {
			const acceleration =
				profile.acceleration *
				accelerationFactor(
					state.speed,
					profile.maxForwardSpeed,
					profile.accelerationTaper,
					profile.accelerationCurve,
				);
			state.speed = Math.min(
				profile.maxForwardSpeed,
				state.speed + acceleration * drive * delta,
			);
		}
	} else if (drive < 0) {
		if (state.speed > 0) {
			state.speed = moveToward(state.speed, 0, profile.braking * -drive * delta);
		} else {
			state.speed = Math.max(
				-profile.maxReverseSpeed,
				state.speed - profile.reverseAcceleration * -drive * delta,
			);
		}
	} else {
		state.speed = moveToward(state.speed, 0, profile.coastDrag * delta);
	}

	const targetSteering = steering * profile.maxSteeringAngle;
	state.steeringAngle = moveToward(
		state.steeringAngle,
		targetSteering,
		profile.steeringResponse * delta,
	);

	if (Math.abs(state.speed) > 1e-5 && Math.abs(state.steeringAngle) > 1e-5) {
		const wheelbase = Math.max(0.1, profile.wheelbase);
		const rawYawRate = (state.speed / wheelbase) * Math.tan(state.steeringAngle);
		const lateralAccelerationLimit =
			!instruction.handbrake && brake === 0
				? (profile.steeringAssistLateralAcceleration ?? profile.maxLateralAcceleration)
				: profile.maxLateralAcceleration;
		const gripYawLimit =
			lateralAccelerationLimit / Math.max(1, Math.abs(state.speed));
		const yawBoost = instruction.handbrake
			? (profile.handbrakeYawBoost ?? 1)
			: brake > 0
				? (profile.brakingYawBoost ?? 1)
				: 1;
		const yawRate = clamp(
			rawYawRate * yawBoost,
			-gripYawLimit * yawBoost,
			gripYawLimit * yawBoost,
		);
		state.heading = normalizeAngle(state.heading + yawRate * delta);

		const steerRatio =
			Math.abs(state.steeringAngle) / Math.max(0.01, profile.maxSteeringAngle);
		const speedRatio =
			Math.abs(state.speed) /
			Math.max(
				0.01,
				state.speed >= 0 ? profile.maxForwardSpeed : profile.maxReverseSpeed,
			);
		state.speed = moveToward(
			state.speed,
			0,
			profile.turningDrag * steerRatio * clamp(speedRatio, 0, 1) * delta,
		);
	}

	if (instruction.handbrake) {
		state.speed = moveToward(
			state.speed,
			0,
			(profile.handbrakeDrag ?? profile.braking) * delta,
		);
	}

	return {
		longitudinalAcceleration: delta > 0 ? (state.speed - previousSpeed) / delta : 0,
		yawRate: delta > 0 ? normalizeAngle(state.heading - previousHeading) / delta : 0,
	};
}
